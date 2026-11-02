import * as THREE from 'three';
import {
  GameState,
  Objective,
  ShootingRayDebugInfo,
  TerrainPiece,
  Unit,
  Vector3,
  findWalkableSurfaceAt,
} from '@skirmish-lab/shared';
import { BoardRenderer } from './BoardRenderer';
import { CameraController } from './CameraController';
import {
  AttackRangeMarker,
  DeploymentZoneMarker,
  MarkerRenderer,
  MarkerUnit,
  MovePathMarker,
} from './MarkerRenderer';
import { ModelLoader } from './ModelLoader';
import { SceneManager } from './SceneManager';
import { UnitRenderer } from './UnitRenderer';
import { ObjectiveRenderer } from './ObjectiveRenderer';

/**
 * The subset of SceneManager GameView depends on. Kept minimal so tests can
 * inject a stub instead of a WebGL-backed scene.
 */
export interface SceneManagerLike {
  getScene(): THREE.Scene;
  startAnimationLoop(callback?: () => void): void;
  getCamera?(): THREE.Camera;
  getRendererElement?(): HTMLElement;
}

export type PickTarget =
  | { kind: 'unit'; unitId: string }
  | { kind: 'position'; position: Vector3; terrainId?: string };

export interface GameViewOptions {
  /** Mount point for the real Three.js canvas (used when sceneManager is not injected). */
  container?: HTMLElement;
  /** Injected scene manager (tests). Mutually exclusive with container. */
  sceneManager?: SceneManagerLike;
  /** Injected camera controller (optional with an injected scene manager). */
  cameraController?: { update(): void; setupForRole?(role: 'host' | 'guest'): void };
  /** Injected board renderer (defaults to the real one on the scene). */
  boardRenderer?: BoardRenderer;
  /** Injected unit renderer (defaults to the real one on the scene). */
  unitRenderer?: UnitRenderer;
  /** Injected objective renderer (defaults to a new one on the scene). */
  objectiveRenderer?: ObjectiveRenderer;
  /** Injected model loader (defaults to a new one). */
  modelLoader?: ModelLoader;
  /** Camera for pick raycasting (defaults to the SceneManager camera). */
  camera?: THREE.Camera;
  /** Element receiving pick events (defaults to the renderer canvas / container). */
  inputElement?: HTMLElement;
}

/**
 * State-driven rendering: the single entry point that turns game state into a
 * Three.js scene. Owns SceneManager, CameraController, BoardRenderer,
 * UnitRenderer, and MarkerRenderer wiring.
 *
 * One-way data flow (GameState → scene, never the reverse):
 *   - Board/terrain re-render only when they actually change (signature diff)
 *   - Units are diffed and synced on every call
 *   - The input state object is never modified
 *
 * Picking: `onPick` subscriptions receive unit/position picks from board
 * clicks. Camera drags are filtered out (pointer travel > 5px is ignored).
 */
export class GameView {
  private sceneManager: SceneManagerLike;
  private cameraController: { update(): void } | null;
  private boardRenderer: BoardRenderer;
  private unitRenderer: UnitRenderer;
  private markerRenderer: MarkerRenderer;
  private objectiveRenderer: ObjectiveRenderer;
  private boardSignature: string | null = null;

  private camera: THREE.Camera | null;
  private inputElement: HTMLElement | null;
  private pickHandlers: Array<(target: PickTarget) => void> = [];
  private hoverHandlers: Array<(target: PickTarget | null) => void> = [];
  private pointerDownAt: { x: number; y: number } | null = null;
  /** Max pointer travel (px) between down and up to count as a pick click. */
  private static readonly PICK_DRAG_TOLERANCE = 5;

  constructor(options: GameViewOptions) {
    let inputElement: HTMLElement | null = options.inputElement ?? null;

    if (options.sceneManager) {
      this.sceneManager = options.sceneManager;
      this.cameraController = options.cameraController ?? null;
    } else if (options.container) {
      const manager = new SceneManager(options.container);
      this.sceneManager = manager;
      this.cameraController = new CameraController(
        manager.getCamera(),
        manager.getRenderer().domElement
      );
      inputElement = inputElement ?? manager.getRenderer().domElement;
    } else {
      throw new Error('GameView requires a container or an injected SceneManager');
    }

    const scene = this.sceneManager.getScene();
    const modelLoader = options.modelLoader ?? new ModelLoader();
    this.boardRenderer = options.boardRenderer ?? new BoardRenderer(scene, modelLoader);
    this.unitRenderer = options.unitRenderer ?? new UnitRenderer(scene, modelLoader);
    this.markerRenderer = new MarkerRenderer(scene, modelLoader);
    this.objectiveRenderer = options.objectiveRenderer ?? new ObjectiveRenderer(scene, modelLoader);

    this.camera = options.camera ?? this.sceneManager.getCamera?.() ?? null;
    this.inputElement = this.camera ? inputElement : null;
    if (this.inputElement) {
      this.setupPicking(this.inputElement);
    }
  }

  /**
   * Bring the scene in line with the given game state. Call this whenever
   * confirmed state changes (e.g. from GameManager.onStateUpdate).
   */
  syncFromState(state: GameState): void {
    const signature = this.computeBoardSignature(state);
    if (signature !== this.boardSignature) {
      this.boardRenderer.renderBoard(state);
      this.boardRenderer.renderTerrain(state);
      this.boardSignature = signature;
    }
    this.unitRenderer.syncFromState(state);
    this.objectiveRenderer.syncFromState(state);
  }

  /** Start the render loop (camera controls and outcome orientation are updated each frame). */
  start(): void {
    this.sceneManager.startAnimationLoop(() => {
      this.cameraController?.update();
      this.markerRenderer.orientOutcomeToCamera(this.camera);
    });
  }

  /**
   * Position the camera for the given player role so they view the battlefield
   * from behind their deployment zone.
   */
  setupCameraForRole(role: 'host' | 'guest'): void {
    if (this.cameraController && 'setupForRole' in this.cameraController) {
      (this.cameraController as any).setupForRole(role);
    }
  }

  /**
   * Subscribe to board picks (unit or ground position) from clicks.
   * Returns an unsubscribe function.
   */
  onPick(handler: (target: PickTarget) => void): () => void {
    this.pickHandlers.push(handler);
    return () => {
      this.pickHandlers = this.pickHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to pointer hover over the board (unit or ground position).
   * Returns an unsubscribe function.
   */
  onHover(handler: (target: PickTarget | null) => void): () => void {
    this.hoverHandlers.push(handler);
    return () => {
      this.hoverHandlers = this.hoverHandlers.filter((h) => h !== handler);
    };
  }

  // --- Gameplay UI markers (delegates to MarkerRenderer) -----------------

  setSelectionMarker(unit: MarkerUnit | null): void {
    this.markerRenderer.setSelection(unit);
  }

  setTargetMarker(unit: MarkerUnit | MarkerUnit[] | null): void {
    this.markerRenderer.setTarget(unit);
  }

  setReachableTargetsMarker(units: MarkerUnit[]): void {
    this.markerRenderer.setReachableTargets(units);
  }

  setMovementRangeMarker(unit: MarkerUnit | null, overrideRadius?: number, color?: number): void {
    this.markerRenderer.setMovementRange(unit, overrideRadius, color);
  }

  setAttackRangeMarker(spec: AttackRangeMarker | null): void {
    this.markerRenderer.setAttackRange(spec);
  }

  setMovePathMarker(path: MovePathMarker | null): void {
    this.markerRenderer.setMovePath(path);
  }

  setMeleeContactMarker(unit: MarkerUnit | null): void {
    this.markerRenderer.setMeleeContact(unit);
  }

  setTerrainDebugMarker(
    piece: TerrainPiece | TerrainPiece[] | null,
    options?: { hoveredPieceId?: string; activeCoverPieceId?: string }
  ): void {
    this.markerRenderer.setTerrainDebug(piece, options);
  }

  setShootingDebugRayMarker(debug: ShootingRayDebugInfo | null): void {
    this.markerRenderer.setShootingDebugRay(debug);
  }

  setUnitsDebugMarker(units: Unit[] | null): void {
    this.markerRenderer.setUnitsDebug(units);
  }

  setObjectivesDebugMarker(objectives: Objective[] | null): void {
    this.markerRenderer.setObjectivesDebug(objectives);
  }

  setDeploymentZonesMarker(zones: DeploymentZoneMarker | null): void {
    this.markerRenderer.setDeploymentZones(zones);
  }

  setSquadCoherencyMarker(positions: Vector3[] | null, radius?: number): void {
    this.markerRenderer.setSquadCoherency(positions, radius);
  }

  showOutcomeToken(position: Vector3, wounds: number): void {
    this.markerRenderer.showOutcome(position, wounds);
  }

  clearMarkers(): void {
    this.markerRenderer.clearAll();
  }

  /** Clear the entire 3D battlefield (board, terrain, units, markers, and objectives). */
  clear(): void {
    this.boardRenderer.clear();
    this.unitRenderer.clear();
    this.markerRenderer.clearAll();
    this.objectiveRenderer.clear();
    this.boardSignature = null;
  }

  getObjectiveRenderer(): ObjectiveRenderer {
    return this.objectiveRenderer;
  }

  // --- internals ----------------------------------------------------------

  private setupPicking(element: HTMLElement): void {
    element.addEventListener('pointerdown', (event) => {
      this.pointerDownAt = { x: event.clientX, y: event.clientY };
    });
    element.addEventListener('pointermove', (event) => {
      if (this.hoverHandlers.length === 0) return;
      const target = this.computePickTarget(event, element);
      for (const handler of this.hoverHandlers) {
        handler(target);
      }
    });
    element.addEventListener('pointerleave', () => {
      for (const handler of this.hoverHandlers) {
        handler(null);
      }
    });
    element.addEventListener('click', (event) => {
      if (!this.pointerDownAt) return;
      const travel = Math.hypot(
        event.clientX - this.pointerDownAt.x,
        event.clientY - this.pointerDownAt.y
      );
      if (travel > GameView.PICK_DRAG_TOLERANCE) return; // camera drag, not a pick

      const target = this.computePickTarget(event, element);
      if (target) {
        for (const handler of this.pickHandlers) {
          handler(target);
        }
      }
    });
  }

  private computePickTarget(event: MouseEvent, element: HTMLElement): PickTarget | null {
    if (!this.camera) return null;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);

    const unitHit = this.unitRenderer.raycastUnitHit(raycaster);
    if (unitHit) {
      return {
        kind: 'unit',
        unitId: unitHit.unitId,
        ...(unitHit.modelId ? { modelId: unitHit.modelId } : {}),
      };
    }

    const terrainHit = this.boardRenderer.raycastTerrainHit?.(raycaster) ?? null;

    // If an elevated walkable platform, ladder, stairs, or elevated piece was clicked,
    // preserve the 3D elevation so models can climb, traverse, and drop from vertical structures.
    if (terrainHit && terrainHit.point) {
      const piece = terrainHit.piece;
      const isWalkableOrClimbable =
        piece?.isWalkable ||
        piece?.terrainType === 'platform' ||
        piece?.terrainType === 'stairs' ||
        piece?.terrainType === 'ladder' ||
        piece?.climbType === 'stairs' ||
        piece?.climbType === 'ladder' ||
        (piece?.elevation !== undefined && piece.elevation > 0);

      if (isWalkableOrClimbable) {
        const isSloped =
          piece?.terrainType === 'stairs' ||
          piece?.climbType === 'stairs' ||
          piece?.climbType === 'ramp';
        const y =
          isSloped
            ? Math.round(terrainHit.point.y * 100) / 100
            : piece?.elevation !== undefined
              ? piece.elevation
              : Math.round(terrainHit.point.y * 100) / 100;
        return {
          kind: 'position',
          position: {
            x: Math.round(terrainHit.point.x * 100) / 100,
            y,
            z: Math.round(terrainHit.point.z * 100) / 100,
          },
          terrainId: terrainHit.terrainId,
        };
      }
    }

    // Structured floors (decks, catwalks, the ruin ledge): a hit on a floor's top face picks that floor height
    // so models and stacked pieces land on it; hits on walls or legs fall through to the ground plane.
    if (terrainHit && terrainHit.point && terrainHit.piece) {
      const surface = findWalkableSurfaceAt(
        { terrain: [terrainHit.piece] } as unknown as GameState,
        terrainHit.point,
        0.05
      );
      if (surface && Math.abs(terrainHit.point.y - surface.topY) <= 0.15) {
        return {
          kind: 'position',
          position: {
            x: Math.round(terrainHit.point.x * 100) / 100,
            y: surface.topY,
            z: Math.round(terrainHit.point.z * 100) / 100,
          },
          terrainId: terrainHit.terrainId,
        };
      }
    }

    // No elevated terrain hit — resolve the ground plane (y = 0).
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, point)) {
      return {
        kind: 'position',
        position: { x: Math.round(point.x * 100) / 100, y: 0, z: Math.round(point.z * 100) / 100 },
        ...(terrainHit?.terrainId ? { terrainId: terrainHit.terrainId } : {}),
      };
    }
    return null;
  }

  /**
   * Signature of everything the board layer renders. Units are excluded —
   * they are diffed on every sync; the board only rebuilds on real changes.
   */
  private computeBoardSignature(state: GameState): string {
    return JSON.stringify({ board: state.board, terrain: state.terrain });
  }
}
