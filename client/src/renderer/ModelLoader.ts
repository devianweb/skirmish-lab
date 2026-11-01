import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
 * Procedural low-poly fighter: a box torso, icosahedron head, and a base —
 * deliberately few polygons, matching the low-poly art style. Serves as
 * the placeholder/fallback for unit meshes.
 */
function createLowPolyFighter(): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'fighter';

  const torsoGeometry = new THREE.BoxGeometry(0.35, 0.5, 0.25);
  const torsoMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
  const torso = new THREE.Mesh(torsoGeometry, torsoMaterial);
  torso.position.y = 0.45;
  torso.castShadow = true;
  group.add(torso);

  const headGeometry = new THREE.IcosahedronGeometry(0.15, 0);
  const headMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 0.82;
  head.castShadow = true;
  group.add(head);

  const baseGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 8);
  const baseMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const base = new THREE.Mesh(baseGeometry, baseMaterial);
  base.position.y = 0.03;
  base.receiveShadow = true;
  group.add(base);

  return group;
}

/** Procedural terrain fallback: a plain block (1x1x1). */
function createProceduralTerrainBlock(): THREE.Object3D {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
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
  if (treadPoints.length > 0) {
    const treadGeo = new THREE.BufferGeometry().setFromPoints(treadPoints);
    const treadMat = new THREE.LineBasicMaterial({ color: 0x222428 });
    const lines = new THREE.LineSegments(treadGeo, treadMat);
    group.add(lines);
  }

  return group;
}
