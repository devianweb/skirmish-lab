import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ObjectiveRenderer } from '../../src/renderer/ObjectiveRenderer';
import { GameState, createInitialGameState } from '@skirmish-lab/shared';

describe('ObjectiveRenderer', () => {
  function setup() {
    const scene = new THREE.Scene();
    const renderer = new ObjectiveRenderer(scene);
    const group = renderer.getGroup();
    return { scene, renderer, group };
  }

  function makeState(): GameState {
    const state = createInitialGameState('player-host', 'player-guest');
    state.objectives = [
      {
        id: 'alpha',
        name: 'Objective Alpha',
        position: { x: -5, y: 0, z: 2 },
        controllingPlayerId: null,
        isContested: false,
      },
      {
        id: 'bravo',
        name: 'Objective Bravo',
        position: { x: 5, y: 0, z: -2 },
        controllingPlayerId: 'player-host',
        isContested: false,
      },
      {
        id: 'charlie',
        name: 'Objective Charlie',
        position: { x: 0, y: 0, z: 6 },
        controllingPlayerId: 'player-guest',
        isContested: false,
      },
      {
        id: 'delta',
        name: 'Objective Delta',
        position: { x: 0, y: 0, z: -6 },
        controllingPlayerId: null,
        isContested: true,
      },
    ];
    return state;
  }

  it('adds an objectives group to the scene', () => {
    const { scene, group } = setup();
    expect(scene.children).toContain(group);
    expect(group.name).toBe('objectives');
  });

  it('renders a 3D beacon group for each objective with control radius and beam', () => {
    const { renderer, group } = setup();
    const state = makeState();
    renderer.syncFromState(state);

    expect(group.children).toHaveLength(4);

    const alphaGroup = group.children.find((c) => c.name === 'objective-alpha') as THREE.Group;
    expect(alphaGroup).toBeDefined();
    expect(alphaGroup.position.x).toBe(-5);
    expect(alphaGroup.position.z).toBe(2);

    // Each objective group has: ring, disc, base (no vertical beam, no floating gem)
    const ring = alphaGroup.children.find((c) => c.name === 'objective-alpha-ring') as THREE.Mesh;
    const disc = alphaGroup.children.find((c) => c.name === 'objective-alpha-disc') as THREE.Mesh;
    const base = alphaGroup.children.find((c) => c.name === 'objective-alpha-base');
    const beam = alphaGroup.children.find((c) => c.name === 'objective-alpha-beam');
    const gem = alphaGroup.children.find((c) => c.name === 'objective-alpha-gem');

    expect(ring).toBeDefined();
    expect(disc).toBeDefined();
    expect(base).toBeDefined();
    expect(beam).toBeUndefined();
    expect(gem).toBeUndefined();

    // Verify ring geometry outer radius is 3.0"
    const ringGeo = ring.geometry as THREE.RingGeometry;
    expect(ringGeo.parameters.outerRadius).toBe(3.0);
  });

  it('applies reactive colors reflecting control states (Host, Guest, Contested, Neutral)', () => {
    const { renderer, group } = setup();
    const state = makeState();
    renderer.syncFromState(state);

    const alphaGroup = group.children.find((c) => c.name === 'objective-alpha') as THREE.Group;
    const bravoGroup = group.children.find((c) => c.name === 'objective-bravo') as THREE.Group;
    const charlieGroup = group.children.find((c) => c.name === 'objective-charlie') as THREE.Group;
    const deltaGroup = group.children.find((c) => c.name === 'objective-delta') as THREE.Group;

    const getHex = (group: THREE.Group, name: string) => {
      const mesh = group.children.find((c) => c.name === name) as THREE.Mesh;
      return (mesh.material as any).color.getHex();
    };

    // Alpha is Neutral -> 0xffd54f
    expect(getHex(alphaGroup, 'objective-alpha-ring')).toBe(0xffd54f);
    // Bravo is Host -> 0x29b6f6
    expect(getHex(bravoGroup, 'objective-bravo-ring')).toBe(0x29b6f6);
    // Charlie is Guest -> 0xef5350
    expect(getHex(charlieGroup, 'objective-charlie-ring')).toBe(0xef5350);
    // Delta is Contested -> 0xff9800
    expect(getHex(deltaGroup, 'objective-delta-ring')).toBe(0xff9800);
  });

  it('updates meshes when objective state changes', () => {
    const { renderer, group } = setup();
    const state = makeState();
    renderer.syncFromState(state);

    // Host captures Alpha
    state.objectives![0].controllingPlayerId = 'player-host';
    renderer.syncFromState(state);

    const alphaGroup = group.children.find((c) => c.name === 'objective-alpha') as THREE.Group;
    const ring = alphaGroup.children.find((c) => c.name === 'objective-alpha-ring') as THREE.Mesh;
    expect((ring.material as any).color.getHex()).toBe(0x29b6f6);
  });

  it('clears all meshes cleanly on clear and dispose', () => {
    const { scene, renderer, group } = setup();
    const state = makeState();
    renderer.syncFromState(state);
    expect(group.children.length).toBe(4);

    renderer.clear();
    expect(group.children.length).toBe(0);

    renderer.syncFromState(state);
    expect(group.children.length).toBe(4);

    renderer.dispose();
    expect(scene.children).not.toContain(group);
  });
});
