// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { MarkerRenderer } from '../../src/renderer/MarkerRenderer';
import { ModelLoader } from '../../src/renderer/ModelLoader';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
  }) as any;
});

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
    // Threshold ring labels are at the far side (host: +z, guest: -z)
    expect(labels[0].position.x).toBe(2);
    expect(labels[0].position.z).toBeCloseTo(-3 + 9.5, 5);

    // Guest side moves threshold ring labels to -z
    renderer.setThresholdRings(spec, 'guest');
    const guestGroup = scene.getObjectByName('marker-threshold-rings')!;
    const guestLabels = guestGroup.children.filter((c): c is CSS2DObject => c instanceof CSS2DObject);
    expect(guestLabels[0].position.x).toBe(2);
    expect(guestLabels[0].position.z).toBeCloseTo(-3 - 9.5, 5);
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
    { kind: 'hero' as const, side: 'host' as const, position: { x: 0, y: 0, z: 0 }, radius: 6.5, active: true, label: 'Hero 6"' },
    { kind: 'hero' as const, side: 'guest' as const, position: { x: 4, y: 0, z: 0 }, radius: 6.5, active: false },
    { kind: 'blast' as const, position: { x: 8, y: 0, z: 1 }, radius: 3.5, active: true, label: 'Blast 3"' },
  ];

  it('draws dashed rings: host Hero blue, guest Hero red, Blast orange, with active/inactive opacities', () => {
    const { scene, renderer } = make();
    renderer.setAuras(auras, 'host');
    const group = scene.getObjectByName('marker-auras')!;
    const lines = group.children.filter((c): c is THREE.Line => c instanceof THREE.Line);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.material).toBeInstanceOf(THREE.LineDashedMaterial);
      expect(line.geometry.getAttribute('lineDistance')).toBeDefined();
    }
    const [hostHeroLine, guestHeroLine, blastLine] = lines;
    const hostMat = hostHeroLine.material as THREE.LineDashedMaterial;
    const guestMat = guestHeroLine.material as THREE.LineDashedMaterial;
    const blastMat = blastLine.material as THREE.LineDashedMaterial;
    expect(hostMat.color.getHex()).toBe(0x29b6f6);
    expect(guestMat.color.getHex()).toBe(0xef5350);
    expect(blastMat.color.getHex()).toBe(0xff9800);
    expect(hostMat.opacity).toBe(0.85);
    expect(guestMat.opacity).toBe(0.25);
    expect(hostMat.opacity).toBeGreaterThan(guestMat.opacity);
  });

  it('draws floating CSS2D labels on the far side for host (+z) and guest (-z), with no flat meshes remaining', () => {
    const { scene, renderer } = make();
    renderer.setAuras(auras, 'host');
    const group = scene.getObjectByName('marker-auras')!;
    const labelObjects = group.children.filter((c): c is CSS2DObject => c instanceof CSS2DObject);
    const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c instanceof THREE.Line));

    expect(meshes).toHaveLength(0); // No flat label meshes remain
    expect(labelObjects).toHaveLength(2);
    for (const label of labelObjects) {
      expect(label).toBeInstanceOf(CSS2DObject);
      expect(label.element.style.pointerEvents).toBe('none');
    }

    // Host: far side is +z
    const hostHeroLabel = labelObjects[0];
    expect(hostHeroLabel.position.x).toBe(0);
    expect(hostHeroLabel.position.z).toBeCloseTo(6.5, 5); // position.z + radius (0 + 6.5)
    expect(hostHeroLabel.element.textContent).toBe('Hero 6"');

    const hostBlastLabel = labelObjects[1];
    expect(hostBlastLabel.position.x).toBe(8);
    expect(hostBlastLabel.position.z).toBeCloseTo(4.5, 5); // position.z + radius (1 + 3.5)
    expect(hostBlastLabel.element.textContent).toBe('Blast 3"');

    // Guest: far side is -z
    renderer.setAuras(auras, 'guest');
    const groupGuest = scene.getObjectByName('marker-auras')!;
    const guestLabelObjects = groupGuest.children.filter((c): c is CSS2DObject => c instanceof CSS2DObject);
    const guestMeshes = groupGuest.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c instanceof THREE.Line));

    expect(guestMeshes).toHaveLength(0);
    expect(guestLabelObjects).toHaveLength(2);

    const guestHeroLabel = guestLabelObjects[0];
    expect(guestHeroLabel.position.x).toBe(0);
    expect(guestHeroLabel.position.z).toBeCloseTo(-6.5, 5); // position.z - radius (0 - 6.5)

    const guestBlastLabel = guestLabelObjects[1];
    expect(guestBlastLabel.position.x).toBe(8);
    expect(guestBlastLabel.position.z).toBeCloseTo(-2.5, 5); // position.z - radius (1 - 3.5)
  });

  it('aura CSS2D label never takes pointer events', () => {
    const { scene, renderer } = make();
    renderer.setAuras(auras, 'host');
    const group = scene.getObjectByName('marker-auras')!;
    const labelObjects = group.children.filter((c): c is CSS2DObject => c instanceof CSS2DObject);
    expect(labelObjects).toHaveLength(2);
    expect(labelObjects[0].element.style.pointerEvents).toBe('none');
    expect(labelObjects[1].element.style.pointerEvents).toBe('none');
  });

  it('replaces on the next snapshot, skips rebuild on identical snapshot, and clears when empty', () => {
    const { scene, renderer } = make();
    renderer.setAuras(auras, 'host');
    const group = scene.getObjectByName('marker-auras');
    renderer.setAuras(auras, 'host');
    expect(scene.getObjectByName('marker-auras')).toBe(group);

    renderer.setAuras([auras[0]], 'host');
    expect(scene.getObjectsByProperty('name', 'marker-auras')).toHaveLength(1);
    expect(scene.getObjectByName('marker-auras')!.children).toHaveLength(2); // 1 line + 1 label
    renderer.setAuras([], 'host');
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-auras');
  });
});

describe('MarkerRenderer Blast sharing mark', () => {
  it('sharing units get orange ring in 0xff9800 and are distinct from dark-red reachable targets', () => {
    const { scene, renderer } = make();
    const sharingUnit = { id: 'u-sharing', position: { x: 3, y: 0, z: 5 } };
    const reachableEnemy = { id: 'u-reachable', position: { x: -3, y: 0, z: 2 } };

    renderer.setBlastSharing([sharingUnit]);
    renderer.setReachableTargets([reachableEnemy]);

    expect(renderer.getRenderedMarkerNames()).toContain('marker-blast-sharing');
    expect(renderer.getRenderedMarkerNames()).toContain('marker-reachable-targets');

    const sharingGroup = scene.getObjectByName('marker-blast-sharing')!;
    expect(sharingGroup.children).toHaveLength(1);
    const sharingRing = sharingGroup.getObjectByName(`marker-blast-sharing-${sharingUnit.id}`)!;
    expect(sharingRing).toBeDefined();
    expect(sharingRing.userData.tintColor).toBe(0xff9800);
    const sharingMesh = sharingRing.children[0] as THREE.Mesh;
    const sharingMat = sharingMesh.material as THREE.MeshBasicMaterial;
    expect(sharingMat.color.getHex()).toBe(0xff9800);

    const reachableGroup = scene.getObjectByName('marker-reachable-targets')!;
    expect(reachableGroup.children).toHaveLength(1);
    const reachableRing = reachableGroup.getObjectByName(`marker-reachable-${reachableEnemy.id}`)!;
    expect(reachableRing).toBeDefined();
    expect(reachableRing.userData.tintColor).toBe(0x8e2424);
    const reachableMesh = reachableRing.children[0] as THREE.Mesh;
    const reachableMat = reachableMesh.material as THREE.MeshBasicMaterial;
    expect(reachableMat.color.getHex()).toBe(0x8e2424);

    expect(scene.getObjectByName(`marker-reachable-${sharingUnit.id}`)).toBeUndefined();
  });

  it('with no Blast aim nothing orange is drawn', () => {
    const { renderer } = make();
    renderer.setBlastSharing(null);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-blast-sharing');
    renderer.setBlastSharing([]);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-blast-sharing');
  });

  it('clearAll and dispose remove the blast sharing mark', () => {
    const { renderer } = make();
    renderer.setBlastSharing([{ id: 'u1', position: { x: 0, y: 0, z: 0 } }]);
    renderer.clearAll();
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-blast-sharing');

    renderer.setBlastSharing([{ id: 'u1', position: { x: 0, y: 0, z: 0 } }]);
    renderer.dispose();
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-blast-sharing');
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

describe('MarkerRenderer labelLayout integration', () => {
  it('stacks overlapping marker labels upward in order (badge before aura before ring before aim-line before path)', () => {
    const { scene, renderer } = make();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 10, 20);
    camera.lookAt(0, 0, 0);

    // Place a badge at (0, 0, 0)
    renderer.setTargetBadges([{
      unitId: 'u1',
      position: { x: 0, y: 0, z: 0 },
      segments: [{ text: 'Badge Label', tone: 'distance' }],
    }]);

    // Place an aura label whose 3D position projects near the same spot
    renderer.setAuras([{
      kind: 'hero',
      side: 'host',
      position: { x: 0, y: 0, z: -6.5 },
      radius: 6.5,
      active: true,
      label: 'Hero 6"', // Far-side host placement puts this at z = 0! Exactly overlapping the badge!
    }], 'host');

    // Run layoutLabels for 1000x1000 viewport
    renderer.layoutLabels(camera, 1000, 1000);

    const groupBadges = scene.getObjectByName('marker-target-badges')!;
    const badgeLabel = groupBadges.children.find((c): c is CSS2DObject => c instanceof CSS2DObject)!;

    const groupAuras = scene.getObjectByName('marker-auras')!;
    const auraLabel = groupAuras.children.find((c): c is CSS2DObject => c instanceof CSS2DObject)!;

    expect(badgeLabel.element.style.pointerEvents).toBe('none');
    expect(auraLabel.element.style.pointerEvents).toBe('none');

    // Badge was placed first (no upward shift, finalY = screenY)
    // Aura label was placed second and overlapped badge, so it shifted upward (finalY < screenY)
    const badgeTransform = badgeLabel.element.style.transform;
    const auraTransform = auraLabel.element.style.transform;

    expect(badgeTransform).toContain('translate(');
    expect(auraTransform).toContain('translate(');

    // Parse screen translateY from translate(...) translate(Xpx, Ypx)
    const getY = (t: string) => {
      const match = t.match(/translate\([^,]+,\s*([^p]+)px\)/);
      return match ? parseFloat(match[1]) : null;
    };

    const badgeY = getY(badgeTransform);
    const auraY = getY(auraTransform);
    expect(badgeY).not.toBeNull();
    expect(auraY).not.toBeNull();
    // In screen space, upward is smaller Y
    expect(auraY!).toBeLessThan(badgeY!);
  });
});
