import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

function make() {
  const scene = new THREE.Scene();
  return { scene, renderer: new MarkerRenderer(scene, new ModelLoader()) };
}

const colorOf = (obj: THREE.Object3D): number => ((obj as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();

describe('MarkerRenderer placement preview', () => {
  it('rings the cursor green when the spot is legal and red when it is not', () => {
    const { scene, renderer } = make();
    renderer.setPlacement({ cursor: { position: { x: 2, y: 0, z: 3 }, valid: true, radius: 0.5 }, circles: [] });
    const ok = scene.getObjectByName('marker-placement')!;
    expect(ok.children[0].position.x).toBe(2);
    expect(ok.children[0].position.z).toBe(3);
    const green = colorOf(ok.children[0]);

    renderer.setPlacement({ cursor: { position: { x: 2, y: 0, z: 3 }, valid: false, radius: 0.5 }, circles: [] });
    const bad = scene.getObjectByName('marker-placement')!;
    expect(colorOf(bad.children[0])).not.toBe(green);
    expect(scene.getObjectsByProperty('name', 'marker-placement')).toHaveLength(1); // replaced, not stacked
  });

  it('draws the circles at their own centre and height, spacing and exclusion in different colours', () => {
    const { scene, renderer } = make();
    renderer.setPlacement({
      cursor: null,
      circles: [
        { x: -4, y: 0, z: 1, radius: 9, kind: 'spacing' },
        { x: 6, y: 3, z: 7, radius: 10, kind: 'exclusion' },
      ],
    });
    const group = scene.getObjectByName('marker-placement')!;
    const rings = group.children.filter((c) => (c as THREE.Mesh).geometry instanceof THREE.RingGeometry);
    expect(rings).toHaveLength(2);
    expect(rings[0].position.x).toBe(-4);
    expect(rings[1].position.y).toBeGreaterThan(3);
    expect(colorOf(rings[0])).not.toBe(colorOf(rings[1]));
    const outer = (rings[1] as THREE.Mesh).geometry as THREE.RingGeometry;
    expect(outer.parameters.outerRadius).toBe(10);
  });

  it('clears when given null or nothing to draw', () => {
    const { scene, renderer } = make();
    renderer.setPlacement({ cursor: null, circles: [{ x: 0, y: 0, z: 0, radius: 9, kind: 'spacing' }] });
    expect(scene.getObjectByName('marker-placement')).toBeTruthy();
    renderer.setPlacement(null);
    expect(scene.getObjectByName('marker-placement')).toBeUndefined();
    renderer.setPlacement({ cursor: null, circles: [] });
    expect(scene.getObjectByName('marker-placement')).toBeUndefined();
  });
});
