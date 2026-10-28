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
 * Deep-clone an Object3D including per-instance materials, so instances
 * never share materials with (and therefore never recolor) the prototype.
 */
export function cloneObject3D(root: THREE.Object3D): THREE.Object3D {
  const clone = root.clone(true);
  clone.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      mesh.material = material.map((m) => m.clone());
    } else if (material) {
      mesh.material = material.clone();
    }
  });
  return clone;
}
