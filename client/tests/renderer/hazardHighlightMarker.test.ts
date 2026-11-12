// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  MarkerRenderer,
  HAZARD_HIGHLIGHT_COLOR,
  HazardHighlightMarker,
} from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { TerrainPiece } from '@skirmish-lab/shared';

const pool = (id = 'pool-1', x = 0, z = 0): TerrainPiece => ({
  id,
  terrainType: 'hazard-pool',
  position: { x, y: 0, z },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 4, y: 0.1, z: 4 },
  blocksLineOfSight: false,
  providesCover: false,
  isObstacle: false,
  isDangerous: true,
});

function make() {
  const scene = new THREE.Scene();
  return { scene, renderer: new MarkerRenderer(scene, new ModelLoader()) };
}

describe('MarkerRenderer hazard highlights', () => {
  it('HAZARD_HIGHLIGHT_COLOR is a hazard color not used by any other marker', () => {
    expect(HAZARD_HIGHLIGHT_COLOR).toBe(0xaeea00);
  });

  it('draws a pulsing outline per piece with the distinct hazard color', () => {
    const { scene, renderer } = make();
    const terrain = [pool('pool-1', -9, -8), pool('pool-2', -3, -8)];
    renderer.setHazardHighlights({ pieceIds: ['pool-1'] }, terrain);

    const group = scene.getObjectByName('marker-hazard-highlights');
    expect(group).toBeDefined();
    const outline = group!.getObjectByName('hazard-outline-pool-1') as THREE.Line;
    expect(outline).toBeDefined();
    expect(outline.position.x).toBe(-9);
    expect(outline.position.z).toBe(-8);

    const mat = outline.material as THREE.LineBasicMaterial;
    expect(mat.color.getHex()).toBe(HAZARD_HIGHLIGHT_COLOR);
    expect(mat.transparent).toBe(true);
  });

  it('shows a floating CSS2D label when a dangerous piece is hovered', () => {
    const { scene, renderer } = make();
    const terrain = [pool('pool-1', -9, -8)];
    renderer.setHazardHighlights({ pieceIds: ['pool-1'], hoveredPieceId: 'pool-1' }, terrain);

    const group = scene.getObjectByName('marker-hazard-highlights')!;
    const label = group.getObjectByName('hazard-label-pool-1') as CSS2DObject;
    expect(label).toBeDefined();
    expect(label.element.textContent).toContain('Hazard pool · dangerous: roll per wound, each 1 is a wound');
    expect(label.element.style.pointerEvents).toBe('none');
  });

  it('updates pulsing opacity on updateAnimation', () => {
    const { scene, renderer } = make();
    const terrain = [pool('pool-1', 0, 0)];
    renderer.setHazardHighlights({ pieceIds: ['pool-1'] }, terrain);

    const outline = scene.getObjectByName('hazard-outline-pool-1') as THREE.Line;
    const mat = outline.material as THREE.LineBasicMaterial;

    renderer.updateAnimation(0);
    const op0 = mat.opacity;
    renderer.updateAnimation(250);
    const op250 = mat.opacity;
    expect(op0).not.toBe(op250);

    // 1000 ms later, opacity returns to matching phase
    renderer.updateAnimation(1000);
    expect(mat.opacity).toBeCloseTo(op0, 4);
  });

  it('removes the highlight on null, empty pieceIds, or clearAll', () => {
    const { scene, renderer } = make();
    const terrain = [pool('pool-1', 0, 0)];
    renderer.setHazardHighlights({ pieceIds: ['pool-1'] }, terrain);
    expect(scene.getObjectByName('marker-hazard-highlights')).toBeDefined();

    renderer.setHazardHighlights(null, terrain);
    expect(scene.getObjectByName('marker-hazard-highlights')).toBeUndefined();

    renderer.setHazardHighlights({ pieceIds: ['pool-1'] }, terrain);
    expect(scene.getObjectByName('marker-hazard-highlights')).toBeDefined();

    renderer.setHazardHighlights({ pieceIds: [] }, terrain);
    expect(scene.getObjectByName('marker-hazard-highlights')).toBeUndefined();

    renderer.setHazardHighlights({ pieceIds: ['pool-1'] }, terrain);
    expect(scene.getObjectByName('marker-hazard-highlights')).toBeDefined();

    renderer.clearAll();
    expect(scene.getObjectByName('marker-hazard-highlights')).toBeUndefined();
  });
});
