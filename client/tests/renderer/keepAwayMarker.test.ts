import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

const zone = (over: Partial<{ x: number; z: number; radius: number; exempt: boolean; otherTier: boolean }> = {}) => ({
  x: 0,
  y: 0,
  z: 0,
  radius: 2,
  exempt: false,
  otherTier: false,
  ...over,
});

function make() {
  const scene = new THREE.Scene();
  return { scene, renderer: new MarkerRenderer(scene, new ModelLoader()) };
}

describe('MarkerRenderer keep-away zones', () => {
  it('draws a disc and ring per zone, sized to the zone radius and centred on the model', () => {
    const { scene, renderer } = make();
    renderer.setKeepAwayZones([zone({ x: 3, z: -4, radius: 2 }), zone({ x: 8, z: 1, radius: 2 })]);
    const group = scene.getObjectByName('marker-keep-away-zones')!;
    expect(group.children).toHaveLength(4);
    expect(group.children[0].position.x).toBe(3);
    expect(group.children[0].position.z).toBe(-4);
    expect(group.children[0].scale.x).toBe(2);
  });

  it('colours the exempt charge target differently and draws other-tier zones fainter', () => {
    const { scene, renderer } = make();
    renderer.setKeepAwayZones([zone(), zone({ exempt: true }), zone({ otherTier: true })]);
    const meshes = scene.getObjectByName('marker-keep-away-zones')!.children as THREE.Mesh[];
    const mat = (i: number) => meshes[i].material as THREE.MeshBasicMaterial;
    expect(mat(2).color.getHex()).not.toBe(mat(0).color.getHex());
    expect(mat(4).color.getHex()).toBe(mat(0).color.getHex());
    expect(mat(4).opacity).toBeLessThan(mat(0).opacity);
  });

  it('does not rebuild for an identical zone list, rebuilds when it changes', () => {
    const { scene, renderer } = make();
    renderer.setKeepAwayZones([zone()]);
    const first = scene.getObjectByName('marker-keep-away-zones');
    renderer.setKeepAwayZones([zone()]);
    expect(scene.getObjectByName('marker-keep-away-zones')).toBe(first);
    renderer.setKeepAwayZones([zone({ x: 1 })]);
    expect(scene.getObjectByName('marker-keep-away-zones')).not.toBe(first);
  });

  it('removes the zones on null and on clearAll, and can redraw afterwards', () => {
    const { scene, renderer } = make();
    renderer.setKeepAwayZones([zone()]);
    renderer.setKeepAwayZones(null);
    expect(scene.getObjectByName('marker-keep-away-zones')).toBeUndefined();
    renderer.setKeepAwayZones([zone()]);
    renderer.clearAll();
    expect(scene.getObjectByName('marker-keep-away-zones')).toBeUndefined();
    renderer.setKeepAwayZones([zone()]);
    expect(scene.getObjectByName('marker-keep-away-zones')).toBeDefined();
  });
});
