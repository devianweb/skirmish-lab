import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cloneObject3D } from './utils';

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
 * Loads and caches low-poly models. Until real GLTF assets exist, unit types
 * resolve to procedural low-poly prototypes so the renderer is fully
 * functional without any bundled art.
 */
export class ModelLoader {
  private loadFn: LoadModelFn;
  /** Loaded/cached prototypes by URL — never handed out directly. */
  private cache = new Map<string, THREE.Object3D>();
  /** In-flight loads, so concurrent requests for the same URL hit the network once. */
  private inFlight = new Map<string, Promise<THREE.Object3D>>();
  /** Procedural prototypes by unit type. */
  private prototypes = new Map<string, THREE.Object3D>();

  constructor(loadFn: LoadModelFn = defaultLoadFn) {
    this.loadFn = loadFn;
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
   * Get a renderable mesh for a unit type. Later this will map unit types to
   * GLTF asset URLs; for now every type gets a procedural low-poly fighter.
   */
  createUnitMesh(unitType: string): THREE.Object3D {
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
 * deliberately few polygons, matching the low-poly art style until real
 * (converted .STL) models land.
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
