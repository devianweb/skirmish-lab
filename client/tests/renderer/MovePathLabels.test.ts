// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

const A = { x: 0, y: 0, z: 0 };
const B = { x: 2, y: 0, z: 0 };
const C = { x: 2, y: 2, z: 0 };
const D = { x: 6, y: 0, z: 4 };

function labels(scene: THREE.Scene): CSS2DObject[] {
  const found: CSS2DObject[] = [];
  scene.traverse((o) => {
    if (o instanceof CSS2DObject) found.push(o);
  });
  return found;
}

function setup() {
  const scene = new THREE.Scene();
  const renderer = new MarkerRenderer(scene, new ModelLoader());
  renderer.setMovePath({
    from: A,
    to: D,
    segments: [
      { from: A, to: B, kind: 'walk', label: null },
      { from: B, to: C, kind: 'climb', label: 'climb 2.0"' },
      { from: C, to: D, kind: 'fall', label: 'fall 2.0"' },
    ],
  });
  return { scene, renderer };
}

describe('move path floating labels', () => {
  it('creates one label per labelled leg, none for plain walking', () => {
    const { scene } = setup();
    const found = labels(scene);
    expect(found.map((l) => l.element.textContent)).toEqual(['climb 2.0"', 'fall 2.0"']);
  });

  it('anchors a label above its leg midpoint and ignores pointer events', () => {
    const { scene } = setup();
    const climb = labels(scene)[0];
    expect(climb.position.x).toBeCloseTo(2);
    expect(climb.position.y).toBeGreaterThan(1);
    expect(climb.position.z).toBeCloseTo(0);
    expect(climb.element.style.pointerEvents).toBe('none');
  });

  it('removes the labels and their DOM elements when the preview is replaced or cleared', () => {
    const { scene, renderer } = setup();
    const els = labels(scene).map((l) => l.element);
    const host = document.createElement('div');
    els.forEach((e) => host.appendChild(e));
    renderer.setMovePath({ from: A, to: B });
    expect(labels(scene)).toHaveLength(0);
    expect(host.children).toHaveLength(0);

    renderer.setMovePath({
      from: A,
      to: C,
      segments: [{ from: A, to: C, kind: 'climb', label: 'climb 2.0"' }],
    });
    expect(labels(scene)).toHaveLength(1);
    renderer.setMovePath(null);
    expect(labels(scene)).toHaveLength(0);
  });
});
