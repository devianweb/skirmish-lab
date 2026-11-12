// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

function make() {
  const scene = new THREE.Scene();
  return { scene, renderer: new MarkerRenderer(scene, new ModelLoader()) };
}

const badge = (unitId = 'u1', x = 0) => ({
  unitId,
  position: { x, y: 2.5, z: 4 },
  segments: [
    { text: '12.0"', tone: 'distance' as const },
    { text: 'Ferocious ✓ (beyond 9")', tone: 'on' as const },
    { text: 'Relentless ✗ (needs beyond 9")', tone: 'off' as const },
    { text: 'Stealth −1 to hit (beyond 9"), negated by Unstoppable', tone: 'negated' as const },
  ],
});

describe('MarkerRenderer target badges', () => {
  it('draws one CSS2D label per badge at the given position with a styled run per segment', () => {
    const { scene, renderer } = make();
    renderer.setTargetBadges([badge('a', 1), badge('b', 5)]);
    const group = scene.getObjectByName('marker-target-badges')!;
    expect(group.children).toHaveLength(2);
    const label = group.children[0] as CSS2DObject;
    expect(label).toBeInstanceOf(CSS2DObject);
    expect(label.position.x).toBe(1);
    expect(label.position.y).toBe(2.5);
    expect(label.element.style.pointerEvents).toBe('none');
    const spans = Array.from(label.element.querySelectorAll('span[data-tone]')) as HTMLElement[];
    expect(spans.map((s) => s.dataset.tone)).toEqual(['distance', 'on', 'off', 'negated']);
    expect(label.element.textContent).toContain('12.0" · Ferocious ✓ (beyond 9")');
    expect(spans[2].style.opacity).toBe('0.55');
    expect(spans[3].style.textDecoration).toBe('line-through');
    expect(spans[1].style.fontWeight).toBe('700');
  });

  it('replaces badges on the next snapshot and removes them (and their DOM) when empty', () => {
    const { scene, renderer } = make();
    renderer.setTargetBadges([badge('a'), badge('b')]);
    const first = (scene.getObjectByName('marker-target-badges')!.children[0] as CSS2DObject).element;
    document.body.appendChild(first);
    renderer.setTargetBadges([badge('c')]);
    expect(scene.getObjectsByProperty('name', 'marker-target-badges')).toHaveLength(1);
    expect(scene.getObjectByName('marker-target-badges')!.children).toHaveLength(1);
    expect(first.isConnected).toBe(false);
    renderer.setTargetBadges([]);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-target-badges');
  });

  it('keeps the same objects when an identical snapshot is re-sent', () => {
    const { scene, renderer } = make();
    renderer.setTargetBadges([badge('a')]);
    const group = scene.getObjectByName('marker-target-badges');
    renderer.setTargetBadges([badge('a')]);
    expect(scene.getObjectByName('marker-target-badges')).toBe(group);
  });
});

describe('MarkerRenderer threshold rings', () => {
  const spec = {
    position: { x: 2, y: 0, z: -3 },
    rings: [
      { radius: 9.5, label: '9": Ferocious, Relentless' },
      { radius: 6.5, label: '6": Ferocious' },
    ],
  };

  it('draws a dashed ring and one label per ring, centred on the attacker, sized to the radius', () => {
    const { scene, renderer } = make();
    renderer.setThresholdRings(spec);
    const group = scene.getObjectByName('marker-threshold-rings')!;
    const lines = group.children.filter((c): c is THREE.Line => c instanceof THREE.Line);
    const labels = group.children.filter((c): c is CSS2DObject => c instanceof CSS2DObject);
    expect(lines).toHaveLength(2);
    expect(labels).toHaveLength(2);
    expect(lines[0].material).toBeInstanceOf(THREE.LineDashedMaterial);
    expect((lines[0].material as THREE.LineDashedMaterial).color.getHex()).toBe(0xff7961);
    expect(lines[0].geometry.getAttribute('lineDistance')).toBeDefined();
    const pos = lines[0].geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeCloseTo(9.5, 5);
    }
    expect(lines[0].position.x).toBe(2);
    expect(lines[0].position.z).toBe(-3);
    expect(labels[0].element.textContent).toBe('9": Ferocious, Relentless');
    expect(labels[0].element.style.pointerEvents).toBe('none');
    expect(Math.hypot(labels[0].position.x - 2, labels[0].position.z + 3)).toBeCloseTo(9.5, 5);
  });

  it('replaces on the next snapshot and clears on null or no rings', () => {
    const { scene, renderer } = make();
    renderer.setThresholdRings(spec);
    renderer.setThresholdRings({ ...spec, rings: [spec.rings[1]] });
    expect(scene.getObjectsByProperty('name', 'marker-threshold-rings')).toHaveLength(1);
    expect(scene.getObjectByName('marker-threshold-rings')!.children).toHaveLength(2);
    renderer.setThresholdRings(null);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-threshold-rings');
    renderer.setThresholdRings({ ...spec, rings: [] });
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-threshold-rings');
  });
});

describe('MarkerRenderer auras', () => {
  const auras = [
    { kind: 'hero' as const, position: { x: 0, y: 0, z: 0 }, radius: 6.5, active: true },
    { kind: 'hero' as const, position: { x: 4, y: 0, z: 0 }, radius: 6.5, active: false },
    { kind: 'blast' as const, position: { x: 8, y: 0, z: 1 }, radius: 3.5, active: true },
  ];
  const mat = (o: THREE.Object3D) => (o as THREE.Mesh).material as THREE.MeshBasicMaterial;

  it('draws one ring per aura: gold for Hero (bright vs faint), orange for Blast, sized to the radius', () => {
    const { scene, renderer } = make();
    renderer.setAuras(auras);
    const group = scene.getObjectByName('marker-auras')!;
    expect(group.children).toHaveLength(3);
    const [a, b, c] = group.children as THREE.Mesh[];
    expect(mat(a).color.getHex()).toBe(0xffd54f);
    expect(mat(c).color.getHex()).toBe(0xff9800);
    expect(mat(a).opacity).toBeGreaterThan(mat(b).opacity);
    expect((a.geometry as THREE.RingGeometry).parameters.outerRadius).toBeCloseTo(6.5, 5);
    expect(c.position.x).toBe(8);
    expect(c.position.z).toBe(1);
  });

  it('replaces on the next snapshot and clears when empty', () => {
    const { scene, renderer } = make();
    renderer.setAuras(auras);
    renderer.setAuras([auras[0]]);
    expect(scene.getObjectsByProperty('name', 'marker-auras')).toHaveLength(1);
    expect(scene.getObjectByName('marker-auras')!.children).toHaveLength(1);
    renderer.setAuras([]);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-auras');
  });
});

describe('clearAll / dispose', () => {
  it('removes every indicator and its DOM labels', () => {
    const { renderer } = make();
    renderer.setTargetBadges([badge()]);
    renderer.setThresholdRings({ position: { x: 0, y: 0, z: 0 }, rings: [{ radius: 5, label: 'x' }] });
    renderer.setAuras([{ kind: 'hero', position: { x: 0, y: 0, z: 0 }, radius: 6.5, active: true }]);
    renderer.clearAll();
    expect(renderer.getRenderedMarkerNames()).toEqual([]);
    renderer.setTargetBadges([badge()]);
    renderer.dispose();
    expect(renderer.getRenderedMarkerNames()).toEqual([]);
  });
});
