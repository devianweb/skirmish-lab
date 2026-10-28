import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GameView, SceneManagerLike } from '../../src/renderer/GameView';
import { BoardRenderer } from '../../src/renderer/BoardRenderer';
import { UnitRenderer } from '../../src/renderer/UnitRenderer';
import { GameState } from '@skirmish-lab/shared';
import { makeState, makeUnit, makeTerrain } from './helpers';

describe('GameView', () => {
  /** WebGL-free stand-in for SceneManager: real scene, inert loop. */
  function makeSceneManager(): SceneManagerLike & { loopCallback: (() => void) | null } {
    const scene = new THREE.Scene();
    let loopCallback: (() => void) | null = null;
    return {
      getScene: () => scene,
      startAnimationLoop: (cb?: () => void) => {
        loopCallback = cb ?? null;
      },
      get loopCallback() {
        return loopCallback;
      },
    };
  }

  it('requires a container or an injected SceneManager', () => {
    expect(() => new GameView({})).toThrow();
  });

  it('integration: renders board, terrain, and units into the scene from game state', () => {
    const sceneManager = makeSceneManager();
    const gameView = new GameView({ sceneManager });
    const state = makeState({
      terrain: [makeTerrain()],
      units: [makeUnit({ id: 'a', position: { x: 3, y: 0, z: 3 } })],
    });

    gameView.syncFromState(state);

    expect(sceneManager.getScene().getObjectByName('ground')).toBeDefined();
    expect(sceneManager.getScene().getObjectByName('grid')).toBeDefined();
    expect(sceneManager.getScene().getObjectByName('terrain-terrain-1')).toBeDefined();

    // Find the unit mesh by its userData tag via traversal.
    let found: THREE.Object3D | null = null;
    sceneManager.getScene().traverse((o) => {
      if (o.userData?.unitId === 'a') found = o;
    });
    expect(found).not.toBeNull();
    expect((found as THREE.Object3D).position.x).toBe(3);
  });

  it('reflects a unit move on the next sync', () => {
    const sceneManager = makeSceneManager();
    const gameView = new GameView({ sceneManager });
    const unit = makeUnit({ id: 'a', position: { x: 0, y: 0, z: 0 } });
    const state = makeState({ units: [unit] });

    gameView.syncFromState(state);
    unit.position = { x: -7, y: 0, z: 2 };
    gameView.syncFromState(state);

    let found: THREE.Object3D | null = null;
    sceneManager.getScene().traverse((o) => {
      if (o.userData?.unitId === 'a') found = o;
    });
    expect(found).not.toBeNull();
    expect((found as THREE.Object3D).position.x).toBe(-7);
    expect((found as THREE.Object3D).position.z).toBe(2);
  });

  it('does not rebuild the board when only units changed (same ground mesh object)', () => {
    const sceneManager = makeSceneManager();
    const gameView = new GameView({ sceneManager });
    const unit = makeUnit({ id: 'a' });
    const state = makeState({ units: [unit] });

    gameView.syncFromState(state);
    const groundBefore = sceneManager.getScene().getObjectByName('ground');

    unit.position = { x: 5, y: 0, z: 5 };
    gameView.syncFromState(state);

    const groundAfter = sceneManager.getScene().getObjectByName('ground');
    expect(groundAfter).toBe(groundBefore); // identity: board not rebuilt
  });

  it('rebuilds the board when board or terrain changes', () => {
    const sceneManager = makeSceneManager();
    const gameView = new GameView({ sceneManager });
    const terrain = makeTerrain();
    const state = makeState({ terrain: [terrain] });

    gameView.syncFromState(state);
    const groundBefore = sceneManager.getScene().getObjectByName('ground');

    terrain.position = { x: 9, y: 0, z: 9 };
    gameView.syncFromState(state);

    const groundAfter = sceneManager.getScene().getObjectByName('ground');
    expect(groundAfter).not.toBe(groundBefore); // rebuilt
    const terrainMesh = sceneManager.getScene().getObjectByName('terrain-terrain-1') as THREE.Mesh;
    expect(terrainMesh.position.x).toBe(9);
  });

  it('never modifies the game state it syncs from', () => {
    const sceneManager = makeSceneManager();
    const gameView = new GameView({ sceneManager });
    const state = makeState({ terrain: [makeTerrain()], units: [makeUnit()] });
    const before = JSON.stringify(state);

    gameView.syncFromState(state);
    gameView.syncFromState(state);

    expect(JSON.stringify(state)).toBe(before);
  });

  it('start() drives the camera controller from the animation loop', () => {
    const sceneManager = makeSceneManager();
    const cameraController = { update: vi.fn() };
    const gameView = new GameView({ sceneManager, cameraController });

    gameView.start();

    expect(sceneManager.loopCallback).toBeTypeOf('function');
    sceneManager.loopCallback!();
    expect(cameraController.update).toHaveBeenCalledTimes(1);
  });

  it('uses injected board/unit renderers when provided (no scene construction)', () => {
    const sceneManager = makeSceneManager();
    const boardRenderer = { renderBoard: vi.fn(), renderTerrain: vi.fn(), clear: vi.fn() } as unknown as BoardRenderer;
    const unitRenderer = { syncFromState: vi.fn(), clear: vi.fn() } as unknown as UnitRenderer;
    const gameView = new GameView({ sceneManager, boardRenderer, unitRenderer });
    const state: GameState = makeState();

    gameView.syncFromState(state);
    gameView.syncFromState(state);

    expect(boardRenderer.renderBoard).toHaveBeenCalledTimes(1); // unchanged board
    expect(boardRenderer.renderTerrain).toHaveBeenCalledTimes(1);
    expect(unitRenderer.syncFromState).toHaveBeenCalledTimes(2); // every sync

    state.terrain.push(makeTerrain({ id: 't9' }));
    gameView.syncFromState(state);
    expect(boardRenderer.renderBoard).toHaveBeenCalledTimes(2);
  });

  // --- Phase 5: picking and gameplay markers --------------------------------

  describe('picking', () => {
    function makePickableView() {
      const scene = new THREE.Scene();
      const sceneManager: SceneManagerLike = {
        getScene: () => scene,
        startAnimationLoop: () => {},
      };
      const inputElement = document.createElement('div');
      document.body.appendChild(inputElement);
      // jsdom rects are all zeros; provide a deterministic 200x200 rect.
      inputElement.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 200, height: 200, x: 0, y: 0, right: 200, bottom: 200, toJSON: () => ({}) }) as DOMRect;

      const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
      camera.position.set(0, 20, 0);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
      // Production render loop updates world matrices each frame; do it
      // explicitly here since there is no animation loop in tests.
      camera.updateMatrixWorld();

      const gameView = new GameView({ sceneManager, camera, inputElement });
      return { gameView, inputElement, scene };
    }

    function click(element: HTMLElement, x: number, y: number) {
      element.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }));
      element.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }));
    }

    it('picks the unit under the click', () => {
      const { gameView, inputElement, scene } = makePickableView();
      gameView.syncFromState(
        makeState({ units: [makeUnit({ id: 'a', position: { x: 0, y: 0, z: 0 } })] })
      );
      // Sanity: the unit mesh exists in the scene.
      expect(scene.getObjectByName('units')).toBeDefined();

      const picks: any[] = [];
      gameView.onPick((target) => picks.push(target));
      click(inputElement, 100, 100); // board center -> unit at origin

      expect(picks).toEqual([{ kind: 'unit', unitId: 'a' }]);
    });

    it('picks a ground position when no unit is hit', () => {
      const { gameView, inputElement } = makePickableView();
      const picks: any[] = [];
      gameView.onPick((target) => picks.push(target));

      // Right half of the viewport (NDC x = 0.5 -> world x = 5).
      click(inputElement, 150, 100);

      expect(picks).toHaveLength(1);
      expect(picks[0].kind).toBe('position');
      expect(picks[0].position.x).toBeCloseTo(5, 1);
      expect(picks[0].position.z).toBeCloseTo(0, 1);
    });

    it('ignores clicks that are camera drags (pointer travel above tolerance)', () => {
      const { gameView, inputElement } = makePickableView();
      const picks: any[] = [];
      gameView.onPick((target) => picks.push(target));

      inputElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20 }));
      inputElement.dispatchEvent(new MouseEvent('click', { clientX: 90, clientY: 90 }));

      expect(picks).toHaveLength(0);
    });

    it('stops delivering picks after unsubscribe', () => {
      const { gameView, inputElement } = makePickableView();
      const picks: any[] = [];
      const unsubscribe = gameView.onPick((target) => picks.push(target));
      unsubscribe();
      click(inputElement, 100, 100);
      expect(picks).toHaveLength(0);
    });
  });

  describe('gameplay markers', () => {
    it('delegates selection, target, range, and outcome markers into the scene', () => {
      const scene = new THREE.Scene();
      const sceneManager: SceneManagerLike = {
        getScene: () => scene,
        startAnimationLoop: () => {},
      };
      const gameView = new GameView({ sceneManager });

      gameView.setSelectionMarker({ id: 'u1', position: { x: 1, y: 0, z: 2 } });
      gameView.setTargetMarker({ id: 'u2', position: { x: 3, y: 0, z: 4 } });
      gameView.setMovementRangeMarker({ id: 'u1', position: { x: 1, y: 0, z: 2 }, remainingMovement: 3 });
      gameView.showOutcomeToken({ x: 3, y: 0, z: 4 }, 2);

      expect(scene.getObjectByName('marker-selection')).toBeDefined();
      expect(scene.getObjectByName('marker-target')).toBeDefined();
      expect(scene.getObjectByName('marker-movement-range')).toBeDefined();
      expect(scene.getObjectByName('marker-outcome-2')).toBeDefined();

      gameView.clearMarkers();
      expect(scene.getObjectByName('marker-selection')).toBeUndefined();
      expect(scene.getObjectByName('marker-outcome-2')).toBeUndefined();
    });

    it('clear() removes board, terrain, units, and markers so returning to lobby leaves a clean scene', () => {
      const scene = new THREE.Scene();
      const sceneManager: SceneManagerLike = {
        getScene: () => scene,
        startAnimationLoop: () => {},
      };
      const gameView = new GameView({ sceneManager });
      const state = makeState({
        terrain: [makeTerrain()],
        units: [makeUnit({ id: 'u1', position: { x: 1, y: 0, z: 1 } })],
      });

      gameView.syncFromState(state);
      gameView.setSelectionMarker({ id: 'u1', position: { x: 1, y: 0, z: 1 } });
      expect(scene.getObjectByName('ground')).toBeDefined();

      gameView.clear();
      expect(scene.getObjectByName('ground')).toBeUndefined();
      expect(scene.getObjectByName('terrain-terrain-1')).toBeUndefined();
      expect(scene.getObjectByName('marker-selection')).toBeUndefined();
    });

    it('setupCameraForRole delegates to injected cameraController.setupForRole', () => {
      const scene = new THREE.Scene();
      const sceneManager: SceneManagerLike = {
        getScene: () => scene,
        startAnimationLoop: () => {},
      };
      const setupForRoleSpy = vi.fn();
      const cameraController = {
        update: () => {},
        setupForRole: setupForRoleSpy,
      };
      const gameView = new GameView({ sceneManager, cameraController });

      gameView.setupCameraForRole('host');
      expect(setupForRoleSpy).toHaveBeenCalledWith('host');

      gameView.setupCameraForRole('guest');
      expect(setupForRoleSpy).toHaveBeenCalledWith('guest');
    });
  });
});
