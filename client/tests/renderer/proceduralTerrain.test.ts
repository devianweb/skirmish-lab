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
  createProceduralPlatformSmall,
  createProceduralPlatformLarge,
  createProceduralCatwalk,
  createProceduralLadder,
} from '../../src/renderer/ModelLoader';
import { resolveTerrainStructure, TERRAIN_PALETTE_CATALOG, TERRAIN_STRUCTURES } from '@skirmish-lab/shared';

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

/** Meshes that count as the piece's body: real meshes, not visual-only decor (kick-plates, tread ridges). */
function bodyMeshes(o: THREE.Object3D): THREE.Box3[] {
  o.updateMatrixWorld(true);
  const out: THREE.Box3[] = [];
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && m.userData.decor !== true) out.push(new THREE.Box3().setFromObject(c));
  });
  return out;
}

const unitPieceOf = (type: string) => ({
  id: 'u',
  terrainType: type,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  blocksLineOfSight: true,
  providesCover: true,
  isObstacle: true,
});

describe('catalog parity sweep: every palette piece', () => {
  const loader = new ModelLoader(async () => new THREE.Group());
  // Climbing fittings have custom shapes (wedge, rails) rather than one mesh per fallback solid.
  const CUSTOM_SHAPE = new Set(['stairs', 'ladder']);

  for (const type of Object.keys(TERRAIN_PALETTE_CATALOG)) {
    it(`${type}: procedural builder (no fallback block), body inside the unit box`, () => {
      const mesh = loader.createTerrainMesh(type);
      let fallback = false;
      mesh.traverse((c) => {
        if (c.userData.fallbackBlock === true) fallback = true;
      });
      expect(fallback, `${type} renders the generic fallback block`).toBe(false);
      const boxes = bodyMeshes(mesh);
      expect(boxes.length, `${type} has no body meshes`).toBeGreaterThan(0);
      const b = boxes.reduce((acc, x) => acc.union(x), new THREE.Box3());
      expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(b.max.y).toBeLessThanOrEqual(1 + 1e-6);
      expect(b.min.x).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.z).toBeLessThanOrEqual(0.5 + 1e-6);
    });

    if (CUSTOM_SHAPE.has(type)) continue;
    it(`${type}: every collision solid is built from meshes that fill its bounds`, () => {
      const solids = resolveTerrainStructure(unitPieceOf(type)).solids;
      const boxes = bodyMeshes(loader.createTerrainMesh(type));
      const eps = 1e-6;
      for (const s of solids) {
        // A solid may be split into several meshes (body + coping, plinth + shaft + cap), but the
        // meshes lying inside it must together span exactly its bounds, so mesh and collision agree.
        const inside = boxes.filter(
          (m) =>
            m.min.x >= s.minX - eps && m.max.x <= s.maxX + eps &&
            m.min.y >= s.minY - eps && m.max.y <= s.maxY + eps &&
            m.min.z >= s.minZ - eps && m.max.z <= s.maxZ + eps
        );
        const u = inside.reduce((acc, x) => acc.union(x), new THREE.Box3());
        const ok =
          inside.length > 0 &&
          Math.abs(u.min.x - s.minX) < eps && Math.abs(u.max.x - s.maxX) < eps &&
          Math.abs(u.min.y - s.minY) < eps && Math.abs(u.max.y - s.maxY) < eps &&
          Math.abs(u.min.z - s.minZ) < eps && Math.abs(u.max.z - s.maxZ) < eps;
        expect(ok, `${type} solid ${s.id} has no mesh filling its bounds`).toBe(true);
      }
    });
  }

  it('area pieces are structures with no solids (visual only)', () => {
    expect(TERRAIN_STRUCTURES['rubble-field'].solids).toHaveLength(0);
    expect(TERRAIN_STRUCTURES['hazard-pool'].solids).toHaveLength(0);
  });
});

describe('area terrain meshes (13.6E)', () => {
  const loader = new ModelLoader(async () => new THREE.Group());
  const scaled = (type: 'rubble-field' | 'hazard-pool') => {
    const mesh = loader.createTerrainMesh(type);
    const { x, y, z } = TERRAIN_PALETTE_CATALOG[type].defaultScale;
    mesh.scale.set(x, y, z);
    return mesh;
  };

  it('rubble field: flat, chunks no taller than 0.25", base slab no thicker than 0.05"', () => {
    const boxes = bodyMeshes(scaled('rubble-field'));
    const top = Math.max(...boxes.map((b) => b.max.y));
    expect(top).toBeLessThanOrEqual(0.25 + 1e-6);
    expect(top).toBeGreaterThan(0.05); // chunks rise above the slab
    const slab = boxes.find((b) => b.max.x - b.min.x > 5.9 && b.max.z - b.min.z > 3.9)!;
    expect(slab, 'full-footprint base slab').toBeDefined();
    expect(slab.min.y).toBeCloseTo(0);
    expect(slab.max.y).toBeLessThanOrEqual(0.05 + 1e-6);
    expect(boxes.length).toBeGreaterThanOrEqual(4);
  });

  it('rubble field is deterministic (identical geometry on every build)', () => {
    const sig = () =>
      bodyMeshes(loader.createTerrainMesh('rubble-field'))
        .map((b) => b.min.toArray().concat(b.max.toArray()).join(','))
        .join('|');
    expect(sig()).toBe(sig());
  });

  it('hazard pool: flat slab no taller than 0.1" with an emissive top inset by 0.1"', () => {
    const mesh = scaled('hazard-pool');
    const boxes = bodyMeshes(mesh);
    expect(Math.max(...boxes.map((b) => b.max.y))).toBeLessThanOrEqual(0.1 + 1e-6);
    let glow: THREE.Mesh | null = null;
    mesh.traverse((c) => {
      const m = c as THREE.Mesh;
      const mat = m.material as THREE.MeshStandardMaterial | undefined;
      if (m.isMesh && mat && mat.emissiveIntensity > 0 && mat.emissive.getHex() !== 0) glow = m;
    });
    expect(glow).not.toBeNull();
    const eb = new THREE.Box3().setFromObject(glow!);
    expect(eb.max.x - eb.min.x).toBeCloseTo(3.8, 4);
    expect(eb.max.z - eb.min.z).toBeCloseTo(3.8, 4);
    expect(eb.max.y).toBeCloseTo(0.1, 4);
  });
});

describe('procedural wargaming terrain', () => {
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

  it('stair wedge faces all point outward (no inside-out faces / broken shading)', () => {
    const loader = new ModelLoader(async () => new THREE.Group());
    const stairs = loader.createTerrainMesh('stairs');
    stairs.updateMatrixWorld(true);
    // The wedge's cross-section centroid (inside the solid): x = 0, y = 1/3, z = 1/6
    const inside = new THREE.Vector3(0, 1 / 3, 1 / 6);
    let triangles = 0;
    stairs.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, i);
        const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
        const c2 = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
        const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c2.clone().sub(a));
        const centroid = a.clone().add(b).add(c2).divideScalar(3);
        expect(normal.dot(centroid.sub(inside)), `triangle ${i / 3}`).toBeGreaterThan(0);
        triangles++;
      }
    });
    expect(triangles).toBe(8);
  });

  it('stair wedge slopes up toward local +Z (the head end the engine uses)', () => {
    const loader = new ModelLoader(async () => new THREE.Group());
    const stairs = loader.createTerrainMesh('stairs');
    let topZ = -Infinity;
    stairs.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.99) topZ = Math.max(topZ, pos.getZ(i));
    });
    expect(topZ).toBeCloseTo(0.5);
  });

  describe('elevation pieces (13.6C)', () => {
    const unitPiece = (type: string) => ({
      id: 'u',
      terrainType: type,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    });

    for (const [type, build] of [
      ['platform-small', createProceduralPlatformSmall],
      ['platform-large', createProceduralPlatformLarge],
      ['catwalk', createProceduralCatwalk],
    ] as const) {
      it(`${type} contains a mesh for every structure solid (deck, legs) plus visual-only decor`, () => {
        const solids = resolveTerrainStructure(unitPiece(type)).solids;
        const group = build();
        group.updateMatrixWorld(true);
        const boxes: THREE.Box3[] = [];
        group.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) boxes.push(new THREE.Box3().setFromObject(c));
        });
        expect(boxes.length).toBeGreaterThan(solids.length); // kick-plates and tread ridges
        for (const s of solids) {
          const match = boxes.some(
            (m) =>
              Math.abs(m.min.x - s.minX) < 1e-6 && Math.abs(m.max.x - s.maxX) < 1e-6 &&
              Math.abs(m.min.y - s.minY) < 1e-6 && Math.abs(m.max.y - s.maxY) < 1e-6 &&
              Math.abs(m.min.z - s.minZ) < 1e-6 && Math.abs(m.max.z - s.maxZ) < 1e-6
          );
          expect(match, `${type} solid ${s.id}`).toBe(true);
        }
      });
    }

    it('a platform leaves the space under the deck open between its pillars', () => {
      const plat = createProceduralPlatformSmall();
      expect(occupied(plat, new THREE.Box3(new THREE.Vector3(-0.2, 0, -0.2), new THREE.Vector3(0.2, 0.8, 0.2)))).toBe(false);
    });

    it('kick-plates are visual dressing above the deck top (never inside the collision structure)', () => {
      const plat = createProceduralPlatformSmall();
      expect(bounds(plat).max.y).toBeGreaterThan(1);
    });

    it('ladder has two rails and rungs', () => {
      const ladder = createProceduralLadder();
      let meshes = 0;
      ladder.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes).toBe(2 + 11);
    });
  });
});
