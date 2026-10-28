import * as THREE from 'three';

/**
 * Recursively dispose a Three.js object's geometries and materials so
 * re-rendering a board or unit list doesn't leak GPU resources.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

/**
 * Deep-clone an Object3D including per-instance geometries and materials.
 * Object3D.clone() shares geometry and material references across clones —
 * cloning both here means each instance fully owns its GPU resources, so
 * disposing one instance never affects the prototype or its siblings.
 *
 * Note: per-instance geometry clones are cheap for the current procedural
 * low-poly primitives; revisit with geometry sharing/instancing when real
 * GLTF assets land.
 */
export function cloneObject3D(root: THREE.Object3D): THREE.Object3D {
  const clone = root.clone(true);
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry = mesh.geometry.clone();
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      mesh.material = material.map((m) => m.clone());
    } else if (material) {
      mesh.material = material.clone();
    }
  });
  return clone;
}
