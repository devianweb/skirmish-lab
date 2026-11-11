// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

function labels(scene: THREE.Scene): CSS2DObject[] {
  const found: CSS2DObject[] = [];
  scene.traverse((o) => {
    if (o instanceof CSS2DObject) found.push(o);
  });
  return found;
}

const line = (x: number, label?: string, fires = true) => ({
  from: { x, y: 1.1, z: 0 },
  to: { x, y: 1.1, z: 10 },
  fires,
  ...(label ? { label } : {}),
});

describe('aim line weapon labels', () => {
  it('draws one floating label per labelled line and none for unlabelled lines', () => {
    const scene = new THREE.Scene();
    const renderer = new MarkerRenderer(scene, new ModelLoader());
    renderer.setAimLines({ lines: [line(0, 'Rifle'), line(1, 'Frag Launcher'), line(2), line(3, undefined, false)] });
    expect(labels(scene).map((l) => l.element.textContent)).toEqual(['Rifle', 'Frag Launcher']);
  });

  it('removes the labels (scene and DOM) when the aim lines are cleared', () => {
    const scene = new THREE.Scene();
    const renderer = new MarkerRenderer(scene, new ModelLoader());
    renderer.setAimLines({ lines: [line(0, 'Rifle')] });
    const el = labels(scene)[0].element;
    document.body.appendChild(el);
    renderer.setAimLines(null);
    expect(labels(scene)).toHaveLength(0);
    expect(document.body.contains(el)).toBe(false);
  });
});
