import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BoardRenderer } from '../../src/renderer/BoardRenderer';
import { makeState, makeTerrain } from './helpers';

describe('BoardRenderer', () => {
  function setup(): { renderer: BoardRenderer; scene: THREE.Scene; boardGroup: THREE.Group; terrainGroup: THREE.Group } {
    const scene = new THREE.Scene();
    const renderer = new BoardRenderer(scene);
    const boardGroup = (renderer as any).boardGroup as THREE.Group;
    const terrainGroup = (renderer as any).terrainGroup as THREE.Group;
    return { renderer, scene, boardGroup, terrainGroup };
  }

  it('renders a ground plane sized from board dimensions and grid size', () => {
    const { renderer, boardGroup } = setup();
    renderer.renderBoard(makeState());

    const ground = boardGroup.children.find((c) => c.name === 'ground') as THREE.Mesh;
    expect(ground).toBeDefined();
    const params = (ground.geometry as THREE.PlaneGeometry).parameters;
    expect(params.width).toBe(44); // board.width 44 * gridSize 1
    expect(params.height).toBe(60);
  });

  it('renders a grid with one line per gridSize step across the board', () => {
    const { renderer, boardGroup } = setup();
    renderer.renderBoard(makeState());

    const grid = boardGroup.children.find((c) => c.name === 'grid') as THREE.LineSegments;
    expect(grid).toBeDefined();
    // board.width 44, board.height 60, gridSize 1 -> 45 vertical + 61 horizontal lines
    const position = grid.geometry.getAttribute('position');
    const expectedPoints = (44 + 1 + 60 + 1) * 2;
    expect(position.count).toBe(expectedPoints);
  });

  it('renders nothing into the scene groups before renderBoard is called', () => {
    const { boardGroup, terrainGroup } = setup();
    expect(boardGroup.children.length).toBe(0);
    expect(terrainGroup.children.length).toBe(0);
  });

  it('renders a mesh per terrain piece with position, rotation, and scale from state', () => {
    const { renderer, terrainGroup } = setup();
    const state = makeState({
      terrain: [
        makeTerrain({ id: 't1', terrainType: 'forest', position: { x: 5, y: 0, z: -3 }, scale: { x: 2, y: 3, z: 2 } }),
        makeTerrain({ id: 't2', terrainType: 'crate', position: { x: -5, y: 1, z: 4 }, scale: { x: 1, y: 1, z: 1 } }),
      ],
    });

    renderer.renderTerrain(state);

    expect(terrainGroup.children.length).toBe(2);
    const t1 = terrainGroup.children.find((c) => c.name === 'terrain-t1') as THREE.Mesh;
    expect(t1.position.x).toBe(5);
    expect(t1.position.y).toBe(0);
    expect(t1.position.z).toBe(-3);
    expect(t1.scale.x).toBe(2);
    expect(t1.scale.y).toBe(3);

    const t2 = terrainGroup.children.find((c) => c.name === 'terrain-t2') as THREE.Mesh;
    expect(t2.position.x).toBe(-5);
    expect(t2.position.y).toBe(1);
    expect(t2.position.z).toBe(4);
  });

  it('re-rendering replaces instead of accumulating', () => {
    const { renderer, boardGroup, terrainGroup } = setup();
    const state = makeState({ terrain: [makeTerrain(), makeTerrain({ id: 't2' })] });

    renderer.renderBoard(state);
    renderer.renderTerrain(state);
    renderer.renderBoard(state);
    renderer.renderTerrain(state);

    expect(boardGroup.children.length).toBe(2); // ground + grid
    expect(terrainGroup.children.length).toBe(2);
  });

  it('clear() empties both board and terrain', () => {
    const { renderer, boardGroup, terrainGroup } = setup();
    renderer.renderBoard(makeState());
    renderer.renderTerrain(makeState({ terrain: [makeTerrain()] }));

    renderer.clear();

    expect(boardGroup.children.length).toBe(0);
    expect(terrainGroup.children.length).toBe(0);
  });

  it('never modifies the game state it renders', () => {
    const { renderer } = setup();
    const state = makeState({ terrain: [makeTerrain()] });
    const before = JSON.stringify(state);

    renderer.renderBoard(state);
    renderer.renderTerrain(state);

    expect(JSON.stringify(state)).toBe(before);
  });
});
