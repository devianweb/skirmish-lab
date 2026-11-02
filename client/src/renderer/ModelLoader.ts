import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveTerrainStructure, ResolvedSolid } from '@skirmish-lab/shared';
import { cloneObject3D, disposeObject3D } from './utils';

/** Minimal shape of a parsed GLTF result the loader cares about. */
interface GltfResult {
  scene: THREE.Object3D;
}

/** Injectable load function so tests (and future asset pipelines) can stub loading. */
export type LoadModelFn = (url: string) => Promise<THREE.Object3D>;

function defaultLoadFn(url: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf: GltfResult) => resolve(gltf.scene),
      undefined,
      (error: unknown) => reject(error)
    );
  });
}

/**
 * A registered 3D asset: GLB URL plus optional uniform or per-axis scale and Y rotation.
 */
export interface AssetDefinition {
  url: string;
  scale?: number;
  scaleVector?: { x: number; y: number; z: number };
  rotationY?: number;
}

/**
 * Loads and caches low-poly models. Unit, terrain, and marker types map to
 * registered GLB assets; unregistered types fall back to procedural low-poly
 * prototypes so the renderer is fully functional without bundled art.
 *
 * GLB-backed meshes are created synchronously as containers with a
 * procedural placeholder; when the GLB finishes loading the placeholder is
 * swapped for a clone of the cached model (per-instance geometry/materials,
 * so per-unit tinting and disposal stay safe).
 */
export class ModelLoader {
  private loadFn: LoadModelFn;
  /** Loaded/cached prototypes by URL — never handed out directly. */
  private cache = new Map<string, THREE.Object3D>();
  /** In-flight loads, so concurrent requests for the same URL hit the network once. */
  private inFlight = new Map<string, Promise<THREE.Object3D>>();
  /** Procedural prototypes by unit type. */
  private prototypes = new Map<string, THREE.Object3D>();
  /** GLB asset registry: unitType -> asset. */
  private unitAssets = new Map<string, AssetDefinition>();
  /** GLB asset registry: terrainType -> asset. */
  private terrainAssets = new Map<string, AssetDefinition>();
  /** GLB asset registry: marker key -> asset. */
  private markerAssets = new Map<string, AssetDefinition>();

  constructor(loadFn: LoadModelFn = defaultLoadFn) {
    this.loadFn = loadFn;
  }

  /** Map a unit type to a GLB asset (see assetManifest). */
  registerUnitAsset(unitType: string, asset: AssetDefinition): void {
    this.unitAssets.set(unitType, asset);
  }

  /** Map a terrain type to a GLB asset (see assetManifest). */
  registerTerrainAsset(terrainType: string, asset: AssetDefinition): void {
    this.terrainAssets.set(terrainType, asset);
  }

  /** Map a marker key (e.g. 'selection', 'outcome-3') to a GLB asset. */
  registerMarkerAsset(markerKey: string, asset: AssetDefinition): void {
    this.markerAssets.set(markerKey, asset);
  }

  /** Load a GLTF model; returns a fresh clone with its own materials. */
  async load(url: string): Promise<THREE.Object3D> {
    const cached = this.cache.get(url);
    if (cached) {
      return cloneObject3D(cached);
    }

    let pending = this.inFlight.get(url);
    if (!pending) {
      pending = this.loadFn(url).then(
        (obj) => {
          this.cache.set(url, obj);
          this.inFlight.delete(url);
          return obj;
        },
        (error) => {
          this.inFlight.delete(url);
          throw error;
        }
      );
      this.inFlight.set(url, pending);
    }

    const prototype = await pending;
    return cloneObject3D(prototype);
  }

  /**
   * Get a renderable mesh for a unit type. Registered GLB types get a
   * placeholder that swaps to the loaded model; others get the procedural
   * low-poly fighter.
   */
  createUnitMesh(unitType: string): THREE.Object3D {
    const asset = this.unitAssets.get(unitType);
    const container = new THREE.Group();
    container.name = `unit-${unitType}`;
    if (asset) {
      this.addSwappingAsset(container, asset, () => this.createProceduralUnit(unitType));
    } else {
      container.add(this.createProceduralUnit(unitType));
    }
    return container;
  }

  /**
   * Get a renderable mesh for a terrain type (GLB with procedural box
   * fallback), unscaled — callers position/scale it from game state data.
   */
  createTerrainMesh(terrainType: string): THREE.Object3D {
    if (
      terrainType === 'stairs' ||
      terrainType === 'stairs-open' ||
      terrainType === 'stairs-closed-short' ||
      terrainType === 'stairs-sides' ||
      terrainType === 'ramp'
    ) {
      const container = new THREE.Group();
      container.name = `terrain-${terrainType}`;
      container.add(createProceduralStairWedge());
      return container;
    }
    const asset = this.terrainAssets.get(terrainType);
    const container = new THREE.Group();
    container.name = `terrain-${terrainType}`;
    const builder = PROCEDURAL_TERRAIN_BUILDERS[terrainType];
    if (!asset && builder) {
      container.add(builder());
      return container;
    }
    if (asset) {
      this.addSwappingAsset(container, asset, () => createProceduralTerrainBlock());
    } else {
      container.add(createProceduralTerrainBlock());
    }
    return container;
  }

  /**
   * Get a renderable marker mesh for a marker key, with a procedural
   * fallback factory for when no GLB is registered (tests, offline).
   */
  createMarkerMesh(markerKey: string, fallbackFactory: () => THREE.Object3D): THREE.Object3D {
    const asset = this.markerAssets.get(markerKey);
    const container = new THREE.Group();
    container.name = `marker-${markerKey}`;
    if (asset) {
      this.addSwappingAsset(container, asset, fallbackFactory);
    } else {
      container.add(fallbackFactory());
    }
    return container;
  }

  /**
   * Fill a container with `fallback`, then swap to the GLB clone when it
   * loads. Failure keeps the fallback (the scene stays functional).
   * If `container.userData.tintColor` was set before the GLB finishes
   * loading, that tint is re-applied to the loaded GLB materials.
   */
  private addSwappingAsset(
    container: THREE.Object3D,
    asset: AssetDefinition,
    fallbackFactory: () => THREE.Object3D
  ): void {
    container.add(fallbackFactory());
    this.load(asset.url).then(
      (model) => {
        if (asset.scaleVector) {
          model.scale.set(asset.scaleVector.x, asset.scaleVector.y, asset.scaleVector.z);
        } else if (asset.scale) {
          model.scale.setScalar(asset.scale);
        }
        if (typeof asset.rotationY === 'number') {
          model.rotation.y = asset.rotationY;
        }
        if (typeof container.userData.tintColor === 'number') {
          const tint = container.userData.tintColor as number;
          const stripMap = Boolean(container.userData.ignoreTextureMap);
          model.traverse((child) => {
            const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (material && material.color) {
              if (stripMap && material.map) {
                material.map = null;
                material.needsUpdate = true;
              }
              material.color.setHex(tint);
            }
          });
        }
        // Replace the placeholder children entirely.
        for (const child of [...container.children]) {
          container.remove(child);
          disposeObject3D(child);
        }
        container.add(model);
      },
      (error) => {
        console.warn(`ModelLoader: keeping placeholder for ${asset.url}`, error);
      }
    );
  }

  private createProceduralUnit(unitType: string): THREE.Object3D {
    let prototype = this.prototypes.get(unitType);
    if (!prototype) {
      prototype = createLowPolyFighter();
      this.prototypes.set(unitType, prototype);
    }
    return cloneObject3D(prototype);
  }
}

/**
 * Procedural 28–32mm Hero-Scale miniature mounted on a standard 1.0" tournament base:
 * - Base bottom: Y = 0.00
 * - Base top: Y = 0.10, radius = 0.46" (with beveled rim from 0.50" to 0.46")
 * - Miniature height: ~1.12" above base -> Total model height ~1.22" (31mm Hero Scale)
 * - Base rim receives distinct squad identification tint in UnitRenderer
 * - Base top stays dark tournament slate (#212529)
 * - Miniature armor/body receives player team tint (Host blue / Guest red)
 */
export function createHeroScaleFighter(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'fighter';

  // 1. Standard 1.0" Tournament Base
  // Base core & beveled rim (bottom radius 0.50", top radius 0.46", height 0.09")
  const rimGeo = new THREE.CylinderGeometry(0.46, 0.50, 0.09, 24);
  rimGeo.translate(0, 0.045, 0);
  const rimMat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 });
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.name = 'base-rim';
  rimMesh.userData = { isBase: true, isBaseRim: true };
  rimMesh.receiveShadow = true;
  group.add(rimMesh);

  // Base top surface (dark slate plinth: radius 0.46", height 0.02" at y = 0.09 -> 0.10)
  const topGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.02, 24);
  topGeo.translate(0, 0.09, 0);
  const topMat = new THREE.MeshStandardMaterial({ color: 0x212529, roughness: 0.9, metalness: 0.05 });
  const topMesh = new THREE.Mesh(topGeo, topMat);
  topMesh.name = 'base-top';
  topMesh.userData = { isBase: true, isBaseTop: true };
  topMesh.receiveShadow = true;
  group.add(topMesh);

  // 2. Miniature Body (Heroic Proportions: ~1.12" tall above base, total height ~1.22" / 31mm)
  const armorMat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.25 });

  // Armored Boots & Legs (standing at x = +/-0.12, y from 0.10 to 0.46)
  for (const legX of [-0.12, 0.12]) {
    const legGeo = new THREE.BoxGeometry(0.13, 0.36, 0.16);
    legGeo.translate(legX, 0.10 + 0.18, 0);
    const leg = new THREE.Mesh(legGeo, armorMat);
    leg.castShadow = true;
    group.add(leg);
  }

  // Tactical Belt & Abdomen (y from 0.46 to 0.58)
  const beltGeo = new THREE.BoxGeometry(0.32, 0.12, 0.22);
  beltGeo.translate(0, 0.46 + 0.06, 0);
  const belt = new THREE.Mesh(beltGeo, armorMat);
  belt.castShadow = true;
  group.add(belt);

  // Armored Cuirass / Torso (y from 0.58 to 0.86, chest depth 0.26)
  const torsoGeo = new THREE.BoxGeometry(0.42, 0.28, 0.26);
  torsoGeo.translate(0, 0.58 + 0.14, 0);
  const torso = new THREE.Mesh(torsoGeo, armorMat);
  torso.castShadow = true;
  group.add(torso);

  // Pauldrons / Heavy Shoulder Guards (span ~0.72")
  for (const pX of [-0.27, 0.27]) {
    const pGeo = new THREE.BoxGeometry(0.16, 0.18, 0.22);
    pGeo.translate(pX, 0.77, 0);
    const pMesh = new THREE.Mesh(pGeo, armorMat);
    pMesh.castShadow = true;
    group.add(pMesh);
  }

  // Helmeted Head (y from 0.86 to 1.10)
  const helmGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
  helmGeo.translate(0, 0.86 + 0.12, 0);
  const helm = new THREE.Mesh(helmGeo, armorMat);
  helm.castShadow = true;
  group.add(helm);

  // Helmet Crest / Fin (reaches top height ~1.22" / 31mm)
  const crestGeo = new THREE.BoxGeometry(0.06, 0.12, 0.24);
  crestGeo.translate(0, 1.10 + 0.06, -0.02);
  const crest = new THREE.Mesh(crestGeo, armorMat);
  crest.castShadow = true;
  group.add(crest);

  // Visor Slit (dark glass)
  const visorGeo = new THREE.BoxGeometry(0.18, 0.06, 0.04);
  visorGeo.translate(0, 0.98, 0.13);
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x102027, roughness: 0.3, metalness: 0.8 });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.name = 'visor';
  visor.userData = { isVisor: true };
  group.add(visor);

  // Front-slung Tactical Weapon / Carbine
  const gunGeo = new THREE.BoxGeometry(0.08, 0.12, 0.40);
  gunGeo.translate(0.10, 0.68, 0.20);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5, metalness: 0.6 });
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.name = 'weapon';
  gun.userData = { isWeapon: true };
  gun.castShadow = true;
  group.add(gun);

  return group;
}

/** Low-poly fighter factory for unit meshes and tests. */
export function createLowPolyFighter(): THREE.Object3D {
  return createHeroScaleFighter();
}

/** Procedural terrain block (1x1x1) with base origin at Y = 0. */
function createProceduralTerrainBlock(): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Procedural right-angled triangular prism (wedge) for stairs and ramps.
 * Matches the mathematical collision geometry and F9 wireframe 1:1:
 * - Local Z = -0.5: Ground level foot (Y = 0)
 * - Local Z = +0.5: Elevated platform head (Y = 1.0)
 * - Local X = [-0.5, +0.5]: Width
 */
function createProceduralStairWedge(): THREE.Object3D {
  const group = new THREE.Group();

  const positions = new Float32Array([
    // 1. Sloped Hypotenuse (from Z=-0.5, Y=0 to Z=+0.5, Y=1)
    -0.5, 0.0, -0.5,
     0.5, 0.0, -0.5,
     0.5, 1.0,  0.5,
    -0.5, 0.0, -0.5,
     0.5, 1.0,  0.5,
    -0.5, 1.0,  0.5,

    // 2. Vertical Rear Wall (at Z = +0.5, from Y=0 to Y=1)
     0.5, 0.0,  0.5,
    -0.5, 0.0,  0.5,
    -0.5, 1.0,  0.5,
     0.5, 0.0,  0.5,
    -0.5, 1.0,  0.5,
     0.5, 1.0,  0.5,

    // 3. Flat Bottom Base (at Y = 0.0, from Z=-0.5 to Z=+0.5)
    -0.5, 0.0,  0.5,
     0.5, 0.0,  0.5,
     0.5, 0.0, -0.5,
    -0.5, 0.0,  0.5,
     0.5, 0.0, -0.5,
    -0.5, 0.0, -0.5,

    // 4. Left Triangular Side (at X = -0.5)
    -0.5, 0.0, -0.5,
    -0.5, 1.0,  0.5,
    -0.5, 0.0,  0.5,

    // 5. Right Triangular Side (at X = +0.5)
     0.5, 0.0, -0.5,
     0.5, 0.0,  0.5,
     0.5, 1.0,  0.5,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x5a5d64, // Industrial weathered steel / dark concrete
    roughness: 0.75,
    metalness: 0.25,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Add subtle step tread grooves / risers for a wargaming staircase feel
  const stepCount = 6;
  const treadPoints: THREE.Vector3[] = [];
  for (let s = 1; s <= stepCount; s++) {
    const t = s / stepCount;
    const z = -0.5 + t * 1.0;
    const y = t * 1.0;
    treadPoints.push(new THREE.Vector3(-0.49, y, z), new THREE.Vector3(0.49, y, z));
  }
  // Risers (vertical drops between treads) and side stringers along the slope edges
  for (let s = 1; s <= stepCount; s++) {
    const t = s / stepCount;
    const zr = -0.5 + t * 1.0;
    const yTop = t * 1.0;
    const yBottom = (s - 1) / stepCount;
    treadPoints.push(new THREE.Vector3(-0.49, yBottom, zr), new THREE.Vector3(-0.49, yTop, zr));
    treadPoints.push(new THREE.Vector3(0.49, yBottom, zr), new THREE.Vector3(0.49, yTop, zr));
  }
  for (const x of [-0.49, 0.49]) {
    treadPoints.push(new THREE.Vector3(x, 0, -0.5), new THREE.Vector3(x, 1, 0.5));
  }
  if (treadPoints.length > 0) {
    const treadGeo = new THREE.BufferGeometry().setFromPoints(treadPoints);
    const treadMat = new THREE.LineBasicMaterial({ color: 0x222428 });
    const lines = new THREE.LineSegments(treadGeo, treadMat);
    group.add(lines);
  }

  return group;
}

type Part = [cx: number, cy: number, cz: number, w: number, h: number, d: number];

/**
 * Build a unit-box (x,z in [-0.5,0.5], y in [0,1]) piece from box parts.
 * Callers scale the result by the terrain piece's scale, so openings are
 * expressed as fractions of the collision box (e.g. 4"x2.5"x0.3" wall).
 * Each part is [centreX, baseY, centreZ, width, height, depth].
 */
function buildFromParts(parts: Part[]): THREE.Object3D {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.1 });
  for (const [cx, by, cz, w, h, d] of parts) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(cx, by + h / 2, cz);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/**
 * Solids of a terrain type in unit-box fractions (x/z in [-0.5, 0.5], y in [0, 1]), straight from
 * the shared structure definitions the rules engine uses, so mesh and collision cannot drift apart.
 */
function structureSolids(terrainType: string): ResolvedSolid[] {
  return resolveTerrainStructure({
    id: `unit-${terrainType}`,
    terrainType,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
  }).solids;
}

/**
 * Build a piece from the shared structure solids (apertures are open air, so they have no mesh).
 * `extras` are visual-only parts (kick-plates, tread ridges) that never affect collision.
 */
function buildFromStructure(terrainType: string, extras: Part[] = []): THREE.Object3D {
  const parts: Part[] = structureSolids(terrainType).map((s) => [
    (s.minX + s.maxX) / 2,
    s.minY,
    (s.minZ + s.maxZ) / 2,
    s.maxX - s.minX,
    s.maxY - s.minY,
    s.maxZ - s.minZ,
  ]);
  return buildFromParts([...parts, ...extras]);
}

/**
 * Visual-only deck dressing for a deck of `w` x `h` x `d` inches: 0.15" kick-plates around the
 * top edge and tread ridges every 0.5" across it (diamond-tread feel). Never part of collision.
 */
function deckDecor(w: number, h: number, d: number): Part[] {
  const t = 0.1; // kick-plate thickness
  const kick = 0.15 / h;
  const parts: Part[] = [
    [0, 1, -0.5 + t / 2 / d, 1, kick, t / d],
    [0, 1, 0.5 - t / 2 / d, 1, kick, t / d],
    [-0.5 + t / 2 / w, 1, 0, t / w, kick, 1 - (2 * t) / d],
    [0.5 - t / 2 / w, 1, 0, t / w, kick, 1 - (2 * t) / d],
  ];
  for (let x = -w / 2 + 0.5; x < w / 2 - 0.25; x += 0.5) {
    parts.push([x / w, 1, 0, 0.04 / w, 0.03 / h, 1 - (2 * t) / d]);
  }
  return parts;
}

/** Wall ladder: two rails with a rung every 0.25" up the face. */
export function createProceduralLadder(): THREE.Object3D {
  const parts: Part[] = [
    [-0.4, 0, 0, 0.2, 1, 1],
    [0.4, 0, 0, 0.2, 1, 1],
  ];
  const rungs = 11;
  for (let i = 1; i <= rungs; i++) {
    parts.push([0, (i / (rungs + 1)) - 0.01, 0, 0.6, 0.02, 0.6]);
  }
  return buildFromParts(parts);
}

export function createProceduralPlatformSmall(): THREE.Object3D {
  return buildFromStructure('platform-small', deckDecor(4, 3, 4));
}
export function createProceduralPlatformLarge(): THREE.Object3D {
  return buildFromStructure('platform-large', deckDecor(6, 3, 4));
}
export function createProceduralCatwalk(): THREE.Object3D {
  return buildFromStructure('catwalk', deckDecor(6, 3, 2));
}

/**
 * Solid wall built from the shared 2" segments (1, 2 or 3 of them): each segment is a body with a
 * coping strip stacked on top, flush against its neighbours so there are no gaps between segments.
 */
function createSegmentedWall(terrainType: string): THREE.Object3D {
  const parts: Part[] = [];
  for (const s of structureSolids(terrainType)) {
    const cx = (s.minX + s.maxX) / 2;
    const cz = (s.minZ + s.maxZ) / 2;
    const w = s.maxX - s.minX;
    const d = s.maxZ - s.minZ;
    parts.push([cx, 0, cz, w, 0.94, d]);
    parts.push([cx, 0.94, cz, w, 0.06, d]);
  }
  return buildFromParts(parts);
}

export function createProceduralSolidWall(): THREE.Object3D {
  return createSegmentedWall('wall');
}
export function createProceduralShortWall(): THREE.Object3D {
  return createSegmentedWall('wall-short');
}
export function createProceduralLongWall(): THREE.Object3D {
  return createSegmentedWall('wall-long');
}

/** Window wall: two jambs, a sill and a lintel framing the open port (shared structure). */
export function createProceduralWindowWall(): THREE.Object3D {
  return buildFromStructure('wall-window');
}

/** Doorway wall: two jambs and a lintel around an open doorway (shared structure). */
export function createProceduralDoorwayWall(): THREE.Object3D {
  return buildFromStructure('wall-doorway');
}

/** Structural column: plinth, shaft and cap. */
export function createProceduralColumn(): THREE.Object3D {
  return buildFromParts([
    [0, 0, 0, 1, 0.08, 1],
    [0, 0.08, 0, 0.8, 0.84, 0.8],
    [0, 0.92, 0, 1, 0.08, 1],
  ]);
}

/**
 * L-corner ruin: two perpendicular port walls (north and west edges) around an open courtyard,
 * built from the shared structure. The second-floor ledge arrives with 13.6C.
 */
export function createProceduralLCornerRuin(): THREE.Object3D {
  return buildFromStructure('ruin-l');
}

const PROCEDURAL_TERRAIN_BUILDERS: Record<string, () => THREE.Object3D> = {
  'wall-short': createProceduralShortWall,
  wall: createProceduralSolidWall,
  'wall-long': createProceduralLongWall,
  'platform-small': createProceduralPlatformSmall,
  'platform-large': createProceduralPlatformLarge,
  catwalk: createProceduralCatwalk,
  'support-pillar': () => buildFromStructure('support-pillar'),
  'deck-railing': () => buildFromStructure('deck-railing'),
  'deck-parapet': () => buildFromStructure('deck-parapet'),
  ladder: createProceduralLadder,
  'wall-window': createProceduralWindowWall,
  'wall-doorway': createProceduralDoorwayWall,
  column: createProceduralColumn,
  ruin: createProceduralLCornerRuin,
  'ruin-l': createProceduralLCornerRuin,
};
