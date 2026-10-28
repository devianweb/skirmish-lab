import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

describe('MarkerRenderer', () => {
  let scene: THREE.Scene;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRenderer(): MarkerRenderer {
    scene = new THREE.Scene();
    return new MarkerRenderer(scene, new ModelLoader());
  }

  it('shows a selection marker under the selected unit', () => {
    const renderer = makeRenderer();
    renderer.setSelection({ id: 'u1', position: { x: 3, y: 0, z: 4 } });

    expect(renderer.getRenderedMarkerNames()).toContain('marker-selection');
    const marker = scene.getObjectByName('marker-selection')!;
    expect(marker.position.x).toBe(3);
    expect(marker.position.z).toBe(4);
  });

  it('shows a target marker at the target unit position', () => {
    const renderer = makeRenderer();
    renderer.setTarget({ id: 'enemy', position: { x: -2, y: 0, z: 6 } });

    const marker = scene.getObjectByName('marker-target')!;
    expect(marker.position.x).toBe(-2);
    expect(marker.position.z).toBe(6);
  });

  it('sizes the movement-range ring to the remaining movement', () => {
    const renderer = makeRenderer();
    renderer.setMovementRange({ id: 'u1', position: { x: 0, y: 0, z: 0 }, remainingMovement: 5 });

    const marker = scene.getObjectByName('marker-movement-range')!;
    expect(marker).toBeDefined();
    // Fallback ring geometry spans the movement radius around its center.
    const ring = marker.children[0] as THREE.Mesh;
    const geometry = ring.geometry as THREE.RingGeometry;
    const outer = geometry.parameters.outerRadius;
    expect(outer).toBeCloseTo(5, 1);
  });

  it('hides the movement ring when no movement is left', () => {
    const renderer = makeRenderer();
    renderer.setMovementRange({ id: 'u1', position: { x: 0, y: 0, z: 0 }, remainingMovement: 0 });
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-movement-range');
  });

  it('replaces markers on update instead of stacking them', () => {
    const renderer = makeRenderer();
    renderer.setSelection({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
    renderer.setSelection({ id: 'u1', position: { x: 5, y: 0, z: 5 } });

    const markers = renderer.getRenderedMarkerNames().filter((name) => name === 'marker-selection');
    expect(markers).toHaveLength(1);
    expect(scene.getObjectByName('marker-selection')!.position.x).toBe(5);
  });

  it('shows a wound outcome token that clears itself after a delay', () => {
    vi.useFakeTimers();
    try {
      const renderer = makeRenderer();
      renderer.showOutcome({ x: 2, y: 0, z: 2 }, 2);

      expect(renderer.getRenderedMarkerNames()).toContain('marker-outcome-2');

      vi.advanceTimersByTime(2600);
      expect(renderer.getRenderedMarkerNames()).not.toContain('marker-outcome-2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores zero-wound outcomes (nothing to show)', () => {
    const renderer = makeRenderer();
    renderer.showOutcome({ x: 2, y: 0, z: 2 }, 0);
    expect(renderer.getRenderedMarkerNames()).toHaveLength(0);
  });

  it('clears everything on clearAll', () => {
    const renderer = makeRenderer();
    renderer.setSelection({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
    renderer.setTarget({ id: 'u2', position: { x: 1, y: 0, z: 1 } });
    renderer.setMovementRange({ id: 'u1', position: { x: 0, y: 0, z: 0 }, remainingMovement: 4 });

    renderer.clearAll();
    expect(renderer.getRenderedMarkerNames()).toHaveLength(0);
  });
});
