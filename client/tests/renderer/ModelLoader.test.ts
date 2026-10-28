import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModelLoader } from '../../src/renderer/ModelLoader';
import { disposeObject3D } from '../../src/renderer/utils';
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

/** Does the object graph contain a node with the given name? */
function hasDescendantName(root: THREE.Object3D, name: string): boolean {
  let found = false;
  root.traverse((child) => {
    if (child.name === name) found = true;
  });
  return found;
}

/** First Mesh descendant (createUnitMesh returns a container group). */
function firstMesh(root: THREE.Object3D): THREE.Mesh {
  let mesh: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!mesh && (child as THREE.Mesh).isMesh) mesh = child as THREE.Mesh;
  });
  return mesh as THREE.Mesh;
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

  it('gives each instance its own geometry — disposing one unit cannot break another', () => {
    const loader = new ModelLoader();
    const first = loader.createUnitMesh('trooper') as THREE.Group;
    const second = loader.createUnitMesh('trooper') as THREE.Group;

    const firstGeometry = firstMesh(first).geometry;
    const secondGeometry = firstMesh(second).geometry;
    expect(firstGeometry).not.toBe(secondGeometry); // not shared with prototype/siblings

    // Simulate the renderer removing `first` (dispose on remove).
    disposeObject3D(first);

    // The surviving instance still has usable geometry.
    expect((secondGeometry as THREE.BufferGeometry).getAttribute('position')).not.toBeNull();
    // And a fresh instance of the same type is unaffected.
    const third = loader.createUnitMesh('trooper') as THREE.Group;
    const thirdGeometry = firstMesh(third).geometry;
    expect(thirdGeometry).not.toBe(firstGeometry);
    expect((thirdGeometry as THREE.BufferGeometry).getAttribute('position')).not.toBeNull();
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

  // --- Phase 5: GLB asset registry with placeholder swap ---------------------

  describe('asset registry', () => {
    it('createUnitMesh swaps the procedural placeholder for the loaded GLB', async () => {
      const glb = makeProto('glb-fighter');
      const loadFn = vi.fn().mockResolvedValue(glb);
      const loader = new ModelLoader(loadFn);
      loader.registerUnitAsset('leader', { url: 'leader.glb', scale: 2 });

      const mesh = loader.createUnitMesh('leader');
      // Placeholder first (synchronous creation).
      expect(mesh.name).toBe('unit-leader');
      expect(hasDescendantName(mesh, 'fighter')).toBe(true);

      await vi.waitFor(() => {
        expect(hasDescendantName(mesh, 'glb-fighter')).toBe(true);
        expect(hasDescendantName(mesh, 'fighter')).toBe(false); // placeholder gone
      });
      expect(loadFn).toHaveBeenCalledWith('leader.glb');
      expect(mesh.children[0].scale.x).toBe(2); // manifest scale applied
      expect(mesh.children).toHaveLength(1);
    });

    it('preserves userData.tintColor across the async GLB swap', async () => {
      const glb = makeProto('glb-fighter');
      const loadFn = vi.fn().mockResolvedValue(glb);
      const loader = new ModelLoader(loadFn);
      loader.registerUnitAsset('leader', { url: 'leader.glb' });

      const mesh = loader.createUnitMesh('leader');
      mesh.userData.tintColor = 0x3a7bd5;

      await vi.waitFor(() => {
        expect(hasDescendantName(mesh, 'glb-fighter')).toBe(true);
      });
      expect(collectHexColors(mesh)).toContain('3a7bd5');
    });

    it('keeps the placeholder when the GLB fails to load', async () => {
      const loadFn = vi.fn().mockRejectedValue(new Error('404'));
      const loader = new ModelLoader(loadFn);
      loader.registerUnitAsset('leader', { url: 'missing.glb' });

      const mesh = loader.createUnitMesh('leader');
      await vi.waitFor(() => expect(loadFn).toHaveBeenCalledTimes(1));
      // Give the rejection handler ticks to run.
      await Promise.resolve();
      await Promise.resolve();
      expect(mesh.children).toHaveLength(1);
      expect(hasDescendantName(mesh, 'fighter')).toBe(true); // placeholder kept
    });

    it('unregistered unit types stay procedural', () => {
      const loadFn = vi.fn();
      const loader = new ModelLoader(loadFn);
      const mesh = loader.createUnitMesh('unknown-type');
      expect(hasDescendantName(mesh, 'fighter')).toBe(true);
      expect(loadFn).not.toHaveBeenCalled();
    });

    it('createTerrainMesh uses registered terrain GLBs, unscaled for callers', async () => {
      const glb = makeProto('glb-wall');
      const loadFn = vi.fn().mockResolvedValue(glb);
      const loader = new ModelLoader(loadFn);
      loader.registerTerrainAsset('wall', { url: 'wall.glb' });

      const mesh = loader.createTerrainMesh('wall');
      expect(mesh.name).toBe('terrain-wall');
      expect(mesh.children.length).toBeGreaterThan(0); // procedural placeholder
      await vi.waitFor(() => {
        expect(hasDescendantName(mesh, 'glb-wall')).toBe(true);
      });
      expect(mesh.scale.x).toBe(1); // scale belongs to terrain data, not the loader
    });

    it('createMarkerMesh uses registered markers with a procedural fallback', async () => {
      const glb = makeProto('glb-target');
      const loadFn = vi.fn().mockResolvedValue(glb);
      const loader = new ModelLoader(loadFn);
      loader.registerMarkerAsset('target', { url: 'target.glb' });

      const marker = loader.createMarkerMesh('target', () => makeProto('fallback'));
      expect(hasDescendantName(marker, 'fallback')).toBe(true);
      await vi.waitFor(() => {
        expect(hasDescendantName(marker, 'glb-target')).toBe(true);
        expect(hasDescendantName(marker, 'fallback')).toBe(false);
      });

      // Unregistered markers keep the fallback permanently.
      const plain = new ModelLoader(vi.fn()).createMarkerMesh('unknown', () =>
        makeProto('kept-fallback')
      );
      expect(hasDescendantName(plain, 'kept-fallback')).toBe(true);
    });
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
