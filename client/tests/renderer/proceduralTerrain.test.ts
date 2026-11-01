import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ModelLoader,
  createProceduralSolidWall,
  createProceduralWindowWall,
  createProceduralDoorwayWall,
  createProceduralColumn,
  createProceduralLCornerRuin,
} from '../../src/renderer/ModelLoader';

function bounds(o: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(o);
}

/** True if any mesh part overlaps the given box region. */
function occupied(o: THREE.Object3D, region: THREE.Box3): boolean {
  o.updateMatrixWorld(true);
  let hit = false;
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && new THREE.Box3().setFromObject(c).intersectsBox(region)) hit = true;
  });
  return hit;
}

const builders = {
  wall: createProceduralSolidWall,
  window: createProceduralWindowWall,
  doorway: createProceduralDoorwayWall,
  column: createProceduralColumn,
  ruin: createProceduralLCornerRuin,
};

describe('procedural wargaming terrain', () => {
  for (const [name, build] of Object.entries(builders)) {
    it(`${name} stays inside the unit collision box with base at y=0`, () => {
      const b = bounds(build());
      expect(b.min.y).toBeCloseTo(0);
      expect(b.max.y).toBeLessThanOrEqual(1 + 1e-6);
      expect(b.min.x).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.z).toBeLessThanOrEqual(0.5 + 1e-6);
    });
  }

  it('doorway leaves a walkable central opening but is solid beside it', () => {
    const w = createProceduralDoorwayWall();
    expect(occupied(w, new THREE.Box3(new THREE.Vector3(-0.1, 0.01, -0.5), new THREE.Vector3(0.1, 0.8, 0.5)))).toBe(false);
    expect(occupied(w, new THREE.Box3(new THREE.Vector3(0.3, 0.1, -0.5), new THREE.Vector3(0.4, 0.9, 0.5)))).toBe(true);
  });

  it('window wall has solid breastwork and an open aperture above it', () => {
    const w = createProceduralWindowWall();
    expect(occupied(w, new THREE.Box3(new THREE.Vector3(-0.1, 0.1, -0.5), new THREE.Vector3(0.1, 0.3, 0.5)))).toBe(true);
    expect(occupied(w, new THREE.Box3(new THREE.Vector3(-0.1, 0.45, -0.5), new THREE.Vector3(0.1, 0.85, 0.5)))).toBe(false);
  });

  it('ModelLoader dispatches terrain types to procedural builders', () => {
    const loader = new ModelLoader(async () => new THREE.Group());
    const door = loader.createTerrainMesh('wall-doorway');
    const solid = loader.createTerrainMesh('wall');
    expect(door.children[0].children.length).toBe(3);
    expect(solid.children[0].children.length).toBeGreaterThan(3);
  });
});
