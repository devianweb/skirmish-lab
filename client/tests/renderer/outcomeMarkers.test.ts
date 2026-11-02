import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  outcomeMarkerKey,
  OUTCOME_ASSETS,
  registerAssetManifest,
} from '../../src/renderer/assetManifest';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

function showOutcome(wounds: number): THREE.Object3D {
  const scene = new THREE.Scene();
  const loader = new ModelLoader();
  registerAssetManifest(loader);
  const renderer = new MarkerRenderer(scene, loader);
  renderer.showOutcome({ x: 1, y: 0, z: 1 }, wounds);
  const marker = scene.getObjectByName(`marker-outcome-${wounds}`)!;
  renderer.clearAll();
  return marker;
}

function hasTorus(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((o) => {
    if ((o as THREE.Mesh).geometry instanceof THREE.TorusGeometry) found = true;
  });
  return found;
}

describe('outcome markers', () => {
  it('every outcome 0..5 resolves to a registered GLB asset with the same scale', () => {
    const scales = new Set<number | undefined>();
    for (let n = 0; n <= 5; n++) {
      const asset = OUTCOME_ASSETS[outcomeMarkerKey(n)];
      expect(asset, `outcome ${n}`).toBeDefined();
      expect(asset.url).toContain(`number-${n}.glb`);
      scales.add(asset.scale);
    }
    expect(scales.size).toBe(1);
  });

  it('0 is built through the same marker path and float height as 1-5, with no torus', () => {
    for (let n = 0; n <= 5; n++) {
      const marker = showOutcome(n);
      expect(marker, `outcome ${n}`).toBeDefined();
      expect(marker.position.y).toBeCloseTo(1.6);
      expect(hasTorus(marker), `outcome ${n} torus`).toBe(false);
    }
  });

  it('tints 0 neutral grey while 1-5 stay red', () => {
    expect(showOutcome(0).userData.tintColor).toBe(0xb0bec5);
    for (let n = 1; n <= 5; n++) expect(showOutcome(n).userData.tintColor).toBe(0xef5350);
  });
});
