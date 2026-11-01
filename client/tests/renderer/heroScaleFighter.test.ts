// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ModelLoader, createHeroScaleFighter } from '../../src/renderer/ModelLoader';
import { UnitRenderer } from '../../src/renderer/UnitRenderer';
import { getUnitRimColor, UNIT_RIM_PALETTE } from '../../src/renderer/rimColors';
import { createInitialGameState, HOST_PLAYER_ID, GUEST_PLAYER_ID, Unit } from '@skirmish-lab/shared';

describe('Hero Scale (28–32mm) Miniature & 1.0" Base', () => {
  it('creates hero miniature with 1.0" base and 28-32mm (1.10"-1.26") total height', () => {
    const fighter = createHeroScaleFighter();
    const box = new THREE.Box3().setFromObject(fighter);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Base origin at Y = 0
    expect(box.min.y).toBeCloseTo(0, 2);

    // Total height in 28-32mm hero scale (1.10" - 1.26" inches)
    expect(size.y).toBeGreaterThanOrEqual(1.15);
    expect(size.y).toBeLessThanOrEqual(1.26);

    // Fits standard 1.0" base footprint
    expect(size.x).toBeLessThanOrEqual(1.01);
    expect(size.z).toBeLessThanOrEqual(1.01);

    // Has base rim and base top elements
    let hasBaseRim = false;
    let hasBaseTop = false;
    fighter.traverse((c) => {
      if (c.userData?.isBaseRim) hasBaseRim = true;
      if (c.userData?.isBaseTop) hasBaseTop = true;
    });
    expect(hasBaseRim).toBe(true);
    expect(hasBaseTop).toBe(true);
  });

  it('determines squad rim colors consistently and uniquely from palette', () => {
    expect(UNIT_RIM_PALETTE.length).toBeGreaterThanOrEqual(8);
    const c1 = getUnitRimColor('squad-alpha');
    const c2 = getUnitRimColor('squad-alpha');
    const c3 = getUnitRimColor('squad-beta');

    // Deterministic: same ID always gets same color
    expect(c1).toBe(c2);
    expect(UNIT_RIM_PALETTE).toContain(c1);
    expect(UNIT_RIM_PALETTE).toContain(c3);
  });

  it('UnitRenderer applies player team color to body, squad rim color to base rim, and dark slate to base top', () => {
    const scene = new THREE.Scene();
    const loader = new ModelLoader(async () => new THREE.Group());
    const renderer = new UnitRenderer(scene, loader);

    const hostUnit: Unit = {
      id: 'host-patrol-1',
      name: 'Patrol 1',
      ownerId: HOST_PLAYER_ID,
      unitType: 'trooper',
      quality: 3,
      defense: 4,
      wounds: 1,
      maxWounds: 1,
      speed: 6,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      weapons: ['rifle'],
      specialRules: [],
      isDestroyed: false,
      isActivated: false,
      hasMoved: false,
      hasAttacked: false,
      remainingMovement: 6,
    };

    const state = createInitialGameState(HOST_PLAYER_ID, GUEST_PLAYER_ID);
    state.units = [hostUnit];

    renderer.syncFromState(state);

    const unitMesh = scene.getObjectByName('units')?.getObjectByName('unit-trooper');
    expect(unitMesh).toBeTruthy();

    const expectedRimColor = getUnitRimColor('host-patrol-1');
    const hostTeamColor = 0x3a7bd5; // Player 0 (Host) blue

    let rimColorObserved: number | null = null;
    let baseTopColorObserved: number | null = null;
    let bodyColorObserved: number | null = null;

    unitMesh!.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || !mat.color) return;

      if (mesh.userData?.isBaseRim) {
        rimColorObserved = mat.color.getHex();
      } else if (mesh.userData?.isBaseTop) {
        baseTopColorObserved = mat.color.getHex();
      } else if (!mesh.userData?.isVisor && !mesh.userData?.isWeapon) {
        bodyColorObserved = mat.color.getHex();
      }
    });

    expect(rimColorObserved).toBe(expectedRimColor);
    expect(baseTopColorObserved).toBe(0x212529); // Dark slate
    expect(bodyColorObserved).toBe(hostTeamColor); // Host team blue
  });
});
