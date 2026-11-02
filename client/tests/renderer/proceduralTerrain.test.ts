import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ModelLoader,
  createProceduralSolidWall,
  createProceduralWindowWall,
  createProceduralDoorwayWall,
  createProceduralColumn,
  createProceduralLCornerRuin,
  createProceduralShortWall,
  createProceduralLongWall,
} from '../../src/renderer/ModelLoader';
import { resolveTerrainStructure } from '@skirmish-lab/shared';

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

  it('window, doorway and ruin meshes are exactly the shared structure solids (no drift from collision)', () => {
    for (const [type, build] of [
      ['wall-window', createProceduralWindowWall],
      ['wall-doorway', createProceduralDoorwayWall],
      ['ruin-l', createProceduralLCornerRuin],
    ] as const) {
      const solids = resolveTerrainStructure({
        id: 'u',
        terrainType: type,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      }).solids;
      const group = build();
      group.updateMatrixWorld(true);
      const meshes: THREE.Box3[] = [];
      group.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) meshes.push(new THREE.Box3().setFromObject(c));
      });
      expect(meshes).toHaveLength(solids.length);
      for (const s of solids) {
        const match = meshes.some(
          (m) =>
            Math.abs(m.min.x - s.minX) < 1e-6 && Math.abs(m.max.x - s.maxX) < 1e-6 &&
            Math.abs(m.min.y - s.minY) < 1e-6 && Math.abs(m.max.y - s.maxY) < 1e-6 &&
            Math.abs(m.min.z - s.minZ) < 1e-6 && Math.abs(m.max.z - s.maxZ) < 1e-6
        );
        expect(match, `${type} solid ${s.id}`).toBe(true);
      }
    }
  });

  it('ruin has an open courtyard: no mesh at ground level in the interior', () => {
    const ruin = createProceduralLCornerRuin();
    expect(occupied(ruin, new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.4), new THREE.Vector3(0.4, 0.5, 0.3)))).toBe(false);
  });

  it('segmented walls have no gaps: 2", 4" and 6" meshes are continuous along their length', () => {
    for (const [build, segments] of [
      [createProceduralShortWall, 1],
      [createProceduralSolidWall, 2],
      [createProceduralLongWall, 3],
    ] as const) {
      const wall = build();
      wall.updateMatrixWorld(true);
      // Every vertical slice along the wall's length must be occupied (no see-through seams)
      for (let i = 0; i < 40; i++) {
        const x = -0.5 + (i + 0.5) / 40;
        const slice = new THREE.Box3(new THREE.Vector3(x - 0.001, 0.2, -0.4), new THREE.Vector3(x + 0.001, 0.8, 0.4));
        expect(occupied(wall, slice), `${segments}-segment wall slice x=${x.toFixed(3)}`).toBe(true);
      }
    }
  });
});
