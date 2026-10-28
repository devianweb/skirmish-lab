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

  it('never modifies the game state it renders', () => {
    const { renderer } = setup();
    const state = makeState({ units: [makeUnit(), makeUnit({ ownerId: 'guest-1' })] });
    const before = JSON.stringify(state);

    renderer.syncFromState(state);
    renderer.syncFromState(state);

    expect(JSON.stringify(state)).toBe(before);
  });
});
