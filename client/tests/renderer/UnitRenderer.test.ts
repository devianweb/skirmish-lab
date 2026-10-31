import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { UnitRenderer } from '../../src/renderer/UnitRenderer';
import { makeState, makeUnit, collectHexColors } from './helpers';

describe('UnitRenderer', () => {
  function setup(): { renderer: UnitRenderer; unitGroup: THREE.Group } {
    const scene = new THREE.Scene();
    const renderer = new UnitRenderer(scene);
    const unitGroup = (renderer as any).unitGroup as THREE.Group;
    return { renderer, unitGroup };
  }

  it('creates one mesh per non-destroyed unit, tagged with the unit id', () => {
    const { renderer, unitGroup } = setup();
    const state = makeState({
      units: [makeUnit({ id: 'a', ownerId: 'host-1' }), makeUnit({ id: 'b', ownerId: 'guest-1' })],
    });

    renderer.syncFromState(state);

    expect(unitGroup.children.length).toBe(2);
    expect(unitGroup.children.map((c) => c.userData.unitId).sort()).toEqual(['a', 'b']);
  });

  it('positions and rotates meshes from unit state', () => {
    const { renderer, unitGroup } = setup();
    const state = makeState({
      units: [makeUnit({ id: 'a', position: { x: 10, y: 0, z: -4 }, rotation: { x: 0, y: Math.PI / 2, z: 0 } })],
    });

    renderer.syncFromState(state);

    const mesh = unitGroup.children[0];
    expect(mesh.position.x).toBe(10);
    expect(mesh.position.y).toBe(0);
    expect(mesh.position.z).toBe(-4);
    expect(mesh.rotation.y).toBe(Math.PI / 2);
  });

  it('moves an existing mesh when a unit moves in state', () => {
    const { renderer, unitGroup } = setup();
    const unit = makeUnit({ id: 'a', position: { x: 0, y: 0, z: 0 } });
    const state = makeState({ units: [unit] });

    renderer.syncFromState(state);
    const mesh = unitGroup.children[0];
    expect(mesh.position.x).toBe(0);

    unit.position = { x: 12, y: 0, z: 5 };
    renderer.syncFromState(state);

    expect(mesh.position.x).toBe(12);
    expect(mesh.position.z).toBe(5);
    expect(unitGroup.children.length).toBe(1); // same mesh, not recreated
  });

  it('removes meshes for units that disappear from state', () => {
    const { renderer, unitGroup } = setup();
    const state = makeState({
      units: [makeUnit({ id: 'a' }), makeUnit({ id: 'b' })],
    });

    renderer.syncFromState(state);
    expect(unitGroup.children.length).toBe(2);

    state.units = state.units.filter((u) => u.id !== 'a');
    renderer.syncFromState(state);

    expect(unitGroup.children.length).toBe(1);
    expect(unitGroup.children[0].userData.unitId).toBe('b');
  });

  it('does not render destroyed units and drops their meshes on re-sync', () => {
    const { renderer, unitGroup } = setup();
    const unit = makeUnit({ id: 'a' });
    const state = makeState({ units: [unit] });

    renderer.syncFromState(state);
    expect(unitGroup.children.length).toBe(1);

    unit.isDestroyed = true;
    renderer.syncFromState(state);

    expect(unitGroup.children.length).toBe(0);
  });

  it('re-syncing an unchanged state does not duplicate meshes', () => {
    const { renderer, unitGroup } = setup();
    const state = makeState({ units: [makeUnit({ id: 'a' }), makeUnit({ id: 'b' })] });

    renderer.syncFromState(state);
    renderer.syncFromState(state);
    renderer.syncFromState(state);

    expect(unitGroup.children.length).toBe(2);
  });

  it('colors units by owning player', () => {
    const { renderer, unitGroup } = setup();
    const state = makeState({
      units: [makeUnit({ id: 'host-unit', ownerId: 'host-1' }), makeUnit({ id: 'guest-unit', ownerId: 'guest-1' })],
    });

    renderer.syncFromState(state);

    const hostMesh = unitGroup.children.find((c) => c.userData.unitId === 'host-unit')!;
    const guestMesh = unitGroup.children.find((c) => c.userData.unitId === 'guest-unit')!;
    const hostColors = collectHexColors(hostMesh);
    const guestColors = collectHexColors(guestMesh);

    expect(hostColors.length).toBeGreaterThan(0);
    expect(guestColors.length).toBeGreaterThan(0);
    expect(hostColors).not.toEqual(guestColors);
  });

  it('clear() removes all unit meshes', () => {
    const { renderer, unitGroup } = setup();
    renderer.syncFromState(makeState({ units: [makeUnit(), makeUnit()] }));

    renderer.clear();

    expect(unitGroup.children.length).toBe(0);
  });

  it('a re-added unit of a removed unit type renders with intact geometry', () => {
    const { renderer, unitGroup } = setup();
    const state = makeState({ units: [makeUnit({ id: 'a', unitType: 'trooper' })] });

    renderer.syncFromState(state);
    state.units = [];
    renderer.syncFromState(state); // removal path disposes the mesh
    expect(unitGroup.children.length).toBe(0);

    state.units = [makeUnit({ id: 'b', unitType: 'trooper' })];
    renderer.syncFromState(state);

    expect(unitGroup.children.length).toBe(1);
    // createUnitMesh returns a container group; find the first real mesh in it.
    const container = unitGroup.children[0] as THREE.Group;
    let meshChild: THREE.Mesh | null = null;
    container.traverse((child) => {
      if (!meshChild && (child as THREE.Mesh).isMesh) meshChild = child as THREE.Mesh;
    });
    const geometry = (meshChild as THREE.Mesh).geometry as THREE.BufferGeometry;
    expect(geometry.getAttribute('position')).not.toBeNull();
    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('never modifies the game state it renders', () => {
    const { renderer } = setup();
    const state = makeState({ units: [makeUnit(), makeUnit({ ownerId: 'guest-1' })] });
    const before = JSON.stringify(state);

    renderer.syncFromState(state);
    renderer.syncFromState(state);

    expect(JSON.stringify(state)).toBe(before);
  });

  describe('Phase 9C: Multi-Model Squad Rendering', () => {
    it('instantiates multiple 3D model meshes for multi-model squads with local relative offsets', () => {
      const { renderer, unitGroup } = setup();
      const squad = makeUnit({
        id: 'squad-1',
        ownerId: 'host-1',
        position: { x: 5, y: 0, z: 5 },
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.0, y: 0, z: 5.0 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.8, y: 0, z: 5.0 } },
          { id: 'm3', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 4.2, y: 0, z: 5.0 } },
        ],
      });
      const state = makeState({ units: [squad] });

      renderer.syncFromState(state);

      expect(unitGroup.children.length).toBe(1);
      const squadRoot = unitGroup.children[0] as THREE.Group;
      expect(squadRoot.userData.unitId).toBe('squad-1');
      expect(squadRoot.position.x).toBe(5);
      expect(squadRoot.position.z).toBe(5);

      // Squad group contains 3 child model meshes
      expect(squadRoot.children.length).toBe(3);
      const modelMeshes = squadRoot.children;
      // Local offsets: m1 at 0, m2 at +0.8, m3 at -0.8
      expect(modelMeshes[0].position.x).toBeCloseTo(0, 2);
      expect(modelMeshes[1].position.x).toBeCloseTo(0.8, 2);
      expect(modelMeshes[2].position.x).toBeCloseTo(-0.8, 2);
    });

    it('removes and disposes casualty model meshes when models are destroyed', () => {
      const { renderer, unitGroup } = setup();
      const squad = makeUnit({
        id: 'squad-1',
        position: { x: 5, y: 0, z: 5 },
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.0, y: 0, z: 5.0 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.8, y: 0, z: 5.0 } },
        ],
      });
      const state = makeState({ units: [squad] });

      renderer.syncFromState(state);
      const squadRoot = unitGroup.children[0] as THREE.Group;
      expect(squadRoot.children.length).toBe(2);

      // Suffer casualty on m1
      squad.models[0].isDestroyed = true;
      squad.position = { x: 5.8, y: 0, z: 5.0 }; // Centroid moves to m2
      renderer.syncFromState(state);

      expect(squadRoot.children.length).toBe(1);
      expect(squadRoot.children[0].userData.modelId).toBe('m2');
    });

    it('raycasting any squad member mesh returns the squad unitId', () => {
      const { renderer } = setup();
      const squad = makeUnit({
        id: 'squad-alpha',
        position: { x: 0, y: 0, z: 0 },
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.8, y: 0, z: 0 } },
        ],
      });
      const state = makeState({ units: [squad] });
      renderer.syncFromState(state);

      // Raycast aimed directly down at model m2 at (0.8, 0, 0)
      const raycaster = new THREE.Raycaster(
        new THREE.Vector3(0.8, 10, 0),
        new THREE.Vector3(0, -1, 0)
      );
      const hit = renderer.raycastUnit(raycaster);
      expect(hit).toBe('squad-alpha');
    });
  });
});
