import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModelLoader } from '../../src/renderer/ModelLoader';
import { collectHexColors } from './helpers';

function makeProto(name = 'proto'): THREE.Object3D {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.name = name;
  group.add(mesh);
  return group;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ModelLoader', () => {
  it('caches loaded models — a second load does not hit the load function', async () => {
    const loadFn = vi.fn().mockResolvedValue(makeProto());
    const loader = new ModelLoader(loadFn);

    const first = await loader.load('trooper.glb');
    const second = await loader.load('trooper.glb');

    expect(loadFn).toHaveBeenCalledTimes(1);
    expect(first).not.toBe(second); // callers get their own clone
    expect((first.children[0] as THREE.Mesh).name).toBe('proto');
  });

  it('deduplicates concurrent loads of the same URL', async () => {
    const gate = deferred<THREE.Object3D>();
    const loadFn = vi.fn().mockReturnValue(gate.promise);
    const loader = new ModelLoader(loadFn);

    const firstPromise = loader.load('trooper.glb');
    const secondPromise = loader.load('trooper.glb');
    gate.resolve(makeProto());
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(loadFn).toHaveBeenCalledTimes(1);
    expect(first).not.toBe(second);
  });

  it('allows a retry after a failed load', async () => {
    const goodProto = makeProto();
    const loadFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(goodProto);
    const loader = new ModelLoader(loadFn);

    await expect(loader.load('trooper.glb')).rejects.toThrow('network down');
    const model = await loader.load('trooper.glb');

    expect(loadFn).toHaveBeenCalledTimes(2);
    expect((model.children[0] as THREE.Mesh).name).toBe('proto');
  });

  it('gives each unit-type mesh its own materials (instances cannot recolor each other)', () => {
    const loader = new ModelLoader();
    const first = loader.createUnitMesh('trooper') as THREE.Group;
    const second = loader.createUnitMesh('trooper') as THREE.Group;

    expect(first).not.toBe(second);

    // Mutate the first instance's transform and materials.
    first.position.set(9, 9, 9);
    for (const color of colorsOf(first)) {
      color.setHex(0xff0000);
    }

    const secondColors = collectHexColors(second);
    expect(secondColors.length).toBeGreaterThan(0);
    for (const hex of secondColors) {
      expect(hex).not.toBe('ff0000');
    }
    expect(second.position.x).toBe(0);
  });

  it('reuses the same prototype per unit type (no rebuild growth)', () => {
    const loader = new ModelLoader();
    const first = loader.createUnitMesh('trooper');
    const second = loader.createUnitMesh('trooper');
    // Same shape even though instances are independent.
    expect(first.children.length).toBe(second.children.length);

    const other = loader.createUnitMesh('heavy');
    expect(other.children.length).toBeGreaterThan(0);
  });
});

function colorsOf(root: THREE.Object3D): THREE.Color[] {
  const colors: THREE.Color[] = [];
  root.traverse((child) => {
    const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (material?.color) {
      colors.push(material.color);
    }
  });
  return colors;
}
