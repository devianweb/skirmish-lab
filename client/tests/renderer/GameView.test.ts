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
});
