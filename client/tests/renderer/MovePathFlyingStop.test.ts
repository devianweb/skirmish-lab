// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { FLYING_PATH_COLOR, MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

const A = { x: 0, y: 0, z: 0 };
const B = { x: 4, y: 0, z: 0 };
const C = { x: 4, y: 3, z: 3 };

function setup() {
  const scene = new THREE.Scene();
  const renderer = new MarkerRenderer(scene, new ModelLoader());
  return { scene, renderer };
}

function lines(scene: THREE.Scene): THREE.Line[] {
  const found: THREE.Line[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Line && o.name.startsWith('marker-move')) found.push(o);
  });
  return found;
}

function labels(scene: THREE.Scene): CSS2DObject[] {
  const found: CSS2DObject[] = [];
  scene.traverse((o) => {
    if (o instanceof CSS2DObject) found.push(o);
  });
  return found;
}

describe('flying path line', () => {
  it('draws a Flying path dashed in the flying colour', () => {
    const { scene, renderer } = setup();
    renderer.setMovePath({ from: A, to: B, waypoints: [A, B], flying: true });
    const flying = lines(scene).find((l) => l.name === 'marker-move-flying');
    expect(flying).toBeDefined();
    const mat = flying!.material as THREE.LineDashedMaterial;
    expect(mat).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(mat.color.getHex()).toBe(FLYING_PATH_COLOR);
    expect(flying!.geometry.getAttribute('lineDistance')).toBeDefined();
  });

  it('a walking path stays a solid line', () => {
    const { scene, renderer } = setup();
    renderer.setMovePath({ from: A, to: B, waypoints: [A, B] });
    expect(lines(scene).some((l) => l.material instanceof THREE.LineDashedMaterial)).toBe(false);
  });

  it('with classified legs every leg of a Flying path is dashed, except a fall', () => {
    const { scene, renderer } = setup();
    renderer.setMovePath({
      from: A,
      to: C,
      waypoints: [A, B, C],
      flying: true,
      segments: [
        { from: A, to: B, kind: 'walk', label: null },
        { from: B, to: C, kind: 'climb', label: 'climb 3.0"' },
      ],
    });
    const segs = lines(scene).filter((l) => l.name.startsWith('marker-move-segment-'));
    expect(segs).toHaveLength(2);
    for (const l of segs) {
      expect(l.material).toBeInstanceOf(THREE.LineDashedMaterial);
      expect((l.material as THREE.LineDashedMaterial).color.getHex()).toBe(FLYING_PATH_COLOR);
    }
  });
});

describe('stop marker', () => {
  it('adds a ring and a label with the reason at the stop point', () => {
    const { scene, renderer } = setup();
    renderer.setMovePath({ from: A, to: B, waypoints: [A, B], stop: { at: B, text: 'Stopped: out of movement' } });
    const label = labels(scene).find((l) => l.name === 'marker-move-label-stop');
    expect(label?.element.textContent).toBe('Stopped: out of movement');
    expect(label?.position.x).toBeCloseTo(4);
    expect(label?.element.style.pointerEvents).toBe('none');
    expect(scene.getObjectByName('marker-move-stop-ring')).toBeDefined();
  });

  it('no stop, no marker; and replacing the preview removes the old label', () => {
    const { scene, renderer } = setup();
    renderer.setMovePath({ from: A, to: B, stop: { at: B, text: 'Stopped: blocked by terrain' } });
    renderer.setMovePath({ from: A, to: B });
    expect(labels(scene)).toHaveLength(0);
    expect(scene.getObjectByName('marker-move-stop-ring')).toBeUndefined();
  });
});
