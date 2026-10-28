import * as THREE from 'three';
import { GameState } from '@skirmish-lab/shared';
import { BoardRenderer } from './BoardRenderer';
import { CameraController } from './CameraController';
import { ModelLoader } from './ModelLoader';
import { SceneManager } from './SceneManager';
import { UnitRenderer } from './UnitRenderer';

/**
 * The subset of SceneManager GameView depends on. Kept minimal so tests can
 * inject a stub instead of a WebGL-backed scene.
 */
export interface SceneManagerLike {
  getScene(): THREE.Scene;
  startAnimationLoop(callback?: () => void): void;
}

export interface GameViewOptions {
  /** Mount point for the real Three.js canvas (used when sceneManager is not injected). */
  container?: HTMLElement;
  /** Injected scene manager (tests). Mutually exclusive with container. */
  sceneManager?: SceneManagerLike;
  /** Injected camera controller (optional with an injected scene manager). */
  cameraController?: { update(): void };
  /** Injected board renderer (defaults to the real one on the scene). */
  boardRenderer?: BoardRenderer;
  /** Injected unit renderer (defaults to the real one on the scene). */
  unitRenderer?: UnitRenderer;
  /** Injected model loader (defaults to a new one). */
  modelLoader?: ModelLoader;
}

/**
 * State-driven rendering: the single entry point that turns game state into a
 * Three.js scene. Owns SceneManager, CameraController, BoardRenderer, and
 * UnitRenderer wiring.
 *
 * One-way data flow (GameState → scene, never the reverse):
 *   - Board/terrain re-render only when they actually change (signature diff)
 *   - Units are diffed and synced on every call
 *   - The input state object is never modified
 */
export class GameView {
  private sceneManager: SceneManagerLike;
  private cameraController: { update(): void } | null;
  private boardRenderer: BoardRenderer;
  private unitRenderer: UnitRenderer;
  private boardSignature: string | null = null;

  constructor(options: GameViewOptions) {
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
    } else {
      throw new Error('GameView requires a container or an injected SceneManager');
    }

    const scene = this.sceneManager.getScene();
    const modelLoader = options.modelLoader ?? new ModelLoader();
    this.boardRenderer = options.boardRenderer ?? new BoardRenderer(scene);
    this.unitRenderer = options.unitRenderer ?? new UnitRenderer(scene, modelLoader);
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
  }

  /** Start the render loop (camera controls are updated each frame). */
  start(): void {
    this.sceneManager.startAnimationLoop(() => this.cameraController?.update());
  }

  /**
   * Signature of everything the board layer renders. Units are excluded —
   * they are diffed on every sync; the board only rebuilds on real changes.
   */
  private computeBoardSignature(state: GameState): string {
    return JSON.stringify({ board: state.board, terrain: state.terrain });
  }
}
