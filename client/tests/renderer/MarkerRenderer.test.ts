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
    // Marker container is scaled on X/Z by the movement radius so both
    // procedural fallback and swapped GLBs match the remaining movement.
    expect(marker.scale.x).toBeCloseTo(5, 1);
    expect(marker.scale.z).toBeCloseTo(5, 1);
    const ring = marker.children[0] as THREE.Mesh;
    const geometry = ring.geometry as THREE.RingGeometry;
    const outer = geometry.parameters.outerRadius * marker.scale.x;
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

  it('shows a 0-wound outcome token when damage is 0, and ignores negative', () => {
    const renderer = makeRenderer();
    renderer.showOutcome({ x: 2, y: 0, z: 2 }, 0);
    expect(renderer.getRenderedMarkerNames()).toContain('marker-outcome-0');

    renderer.clearAll();
    renderer.showOutcome({ x: 2, y: 0, z: 2 }, -1);
    expect(renderer.getRenderedMarkerNames()).toHaveLength(0);
  });

  it('renders unit debug wireframes when units are provided', () => {
    const renderer = makeRenderer();
    renderer.setUnitsDebug([
      {
        id: 'u1',
        ownerId: 'h1',
        armyId: 'a1',
        unitType: 'trooper',
        name: 'Trooper 1',
        quality: 4,
        defense: 5,
        speed: 6,
        position: { x: 1, y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        status: [],
        wounds: 1,
        maxWounds: 1,
        isActivated: false,
        isDestroyed: false,
        models: [],
        weapons: [],
        specialRules: [],
        hasMoved: false,
        remainingMovement: 6,
      },
    ]);
    expect(renderer.getRenderedMarkerNames()).toContain('marker-units-debug');
  });

  it('renders objective debug wireframes (3D cylinder bounds) when objectives are provided', () => {
    const renderer = makeRenderer();
    renderer.setObjectivesDebug([
      {
        id: 'obj-1',
        name: 'Objective Alpha',
        position: { x: 0, y: 0, z: 0 },
        controllingPlayerId: null,
        isContested: false,
      },
    ]);
    expect(renderer.getRenderedMarkerNames()).toContain('marker-objectives-debug');

    renderer.setObjectivesDebug(null);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-objectives-debug');
  });

  it('clears everything on clearAll', () => {
    const renderer = makeRenderer();
    renderer.setSelection({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
    renderer.setTarget({ id: 'u2', position: { x: 1, y: 0, z: 1 } });
    renderer.setMovementRange({ id: 'u1', position: { x: 0, y: 0, z: 0 }, remainingMovement: 4 });
    renderer.setAttackRange({ position: { x: 0, y: 0, z: 0 }, range: 18 });
    renderer.setMovePath({ from: { x: 0, y: 0, z: 0 }, to: { x: 3, y: 0, z: 4 } });

    renderer.clearAll();
    expect(renderer.getRenderedMarkerNames()).toHaveLength(0);
  });

  it('renders attack-range ring, LoS shadow fan, reachable-target rings, and move-path line, and orients outcome tokens toward the camera', () => {
    const renderer = makeRenderer();
    renderer.setAttackRange({
      position: { x: 1, y: 0, z: 2 },
      range: 12,
      losPolygon: [
        { x: 13, z: 2 },
        { x: 1, z: 14 },
        { x: -11, z: 2 },
        { x: 1, z: -10 },
      ],
    });
    renderer.setReachableTargets([
      { id: 'e1', position: { x: 2, y: 0, z: 3 } },
      { id: 'e2', position: { x: 4, y: 0, z: 5 } },
    ]);
    renderer.setMovePath({ from: { x: 0, y: 0, z: 0 }, to: { x: 3, y: 0, z: 4 } });
    renderer.showOutcome({ x: 0, y: 0, z: 0 }, 2);

    expect(renderer.getRenderedMarkerNames()).toContain('marker-attack-range');
    expect(renderer.getRenderedMarkerNames()).toContain('marker-reachable-targets');
    expect(renderer.getRenderedMarkerNames()).toContain('marker-move-path');
    const attackMarker = scene.getObjectByName('marker-attack-range')!;
    expect(attackMarker.scale.x).toBe(12);
    expect(attackMarker.getObjectByName('los-shadow-fan')).toBeDefined();

    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 10, 0);
    renderer.orientOutcomeToCamera(camera);
    const outcome = scene.getObjectByName('marker-outcome-2')!;
    expect(outcome.rotation.y).toBeCloseTo(Math.PI, 2);

    renderer.setTerrainDebug({
      id: 'terrain-wall-north',
      terrainType: 'wall',
      position: { x: 0, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    });
    expect(renderer.getRenderedMarkerNames()).toContain('marker-terrain-debug');
  });

  it('renders wireframe debug boxes for all terrain pieces with hovered and active cover highlights', () => {
    const renderer = makeRenderer();
    const terrain = [
      {
        id: 'wall-1',
        terrainType: 'wall',
        position: { x: 0, y: 0, z: 5 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2, z: 1 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      },
      {
        id: 'crate-1',
        terrainType: 'crate',
        position: { x: 3, y: 0, z: 2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: true,
      },
    ];

    renderer.setTerrainDebug(terrain, {
      hoveredPieceId: 'wall-1',
      activeCoverPieceId: 'crate-1',
    });

    expect(renderer.getRenderedMarkerNames()).toContain('marker-terrain-debug');
    const debugGroup = scene.getObjectByName('marker-terrain-debug')!;
    expect(debugGroup.getObjectByName('marker-terrain-wall-1')).toBeDefined();
    expect(debugGroup.getObjectByName('marker-terrain-crate-1')).toBeDefined();
  });

  it('renders 3D shooting line, intersection rings, and flank rays for shooting debug', () => {
    const renderer = makeRenderer();
    renderer.setShootingDebugRay({
      attackerId: 'u1',
      targetId: 'u2',
      from: { x: 0, y: 0.45, z: 0 },
      to: { x: 0, y: 0.45, z: 10 },
      distance: 10,
      hasLineOfSight: true,
      providesCover: true,
      coverPieceId: 'crate-1',
      intersections: [
        {
          pieceId: 'crate-1',
          terrainType: 'crate',
          entryPoint: { x: 0, y: 0.45, z: 4.5 },
          exitPoint: { x: 0, y: 0.45, z: 5.5 },
          tEntry: 0.45,
          tExit: 0.55,
          providesCover: true,
          blocksLineOfSight: false,
          isCoverProvider: true,
          isLoSBlocker: false,
          ignoredAsAdjacentShooterCover: false,
        },
      ],
      flankRays: [
        {
          from: { x: 0, y: 0.45, z: 0 },
          to: { x: -0.3, y: 0.45, z: 10 },
          side: 'left',
          blocked: false,
        },
        {
          from: { x: 0, y: 0.45, z: 0 },
          to: { x: 0.3, y: 0.45, z: 10 },
          side: 'right',
          blocked: true,
          blockedByPieceId: 'crate-1',
        },
      ],
    });

    expect(renderer.getRenderedMarkerNames()).toContain('marker-shooting-debug');
    const rayGroup = scene.getObjectByName('marker-shooting-debug')!;
    expect(rayGroup.children.length).toBeGreaterThanOrEqual(4);

    renderer.clearAll();
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-shooting-debug');
  });

  it('renders melee contact highlight marker under an engaged enemy model', () => {
    const renderer = makeRenderer();
    renderer.setMeleeContact({ id: 'enemy-1', position: { x: 5, y: 0, z: -2 } });

    expect(renderer.getRenderedMarkerNames()).toContain('marker-melee-contact');
    const contactMarker = scene.getObjectByName('marker-melee-contact')!;
    expect(contactMarker.position.x).toBe(5);
    expect(contactMarker.position.z).toBe(-2);
    expect(contactMarker.children.length).toBeGreaterThanOrEqual(2);

    renderer.setMeleeContact(null);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-melee-contact');
  });

  it('renders multi-point move path with waypoints and melee contact indicator', () => {
    const renderer = makeRenderer();
    renderer.setMovePath({
      from: { x: 0, y: 0, z: 0 },
      to: { x: 5, y: 0, z: 5 },
      waypoints: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: 0, z: 3 },
        { x: 5, y: 0, z: 5 },
      ],
      isMeleeContact: true,
    });

    expect(renderer.getRenderedMarkerNames()).toContain('marker-move-path');
    const group = scene.getObjectByName('marker-move-path')!;
    // Waypoints, lines, destination disc, and contact ring
    expect(group.children.length).toBeGreaterThanOrEqual(4);

    renderer.clearAll();
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-move-path');
  });

  it('allows overriding movement-range ring radius (e.g. for Rush double move)', () => {
    const renderer = makeRenderer();
    renderer.setMovementRange({ id: 'u1', position: { x: 2, y: 0, z: 2 }, remainingMovement: 6 }, 12);

    const marker = scene.getObjectByName('marker-movement-range')!;
    expect(marker).toBeDefined();
    expect(marker.scale.x).toBeCloseTo(12, 1);
    expect(marker.scale.z).toBeCloseTo(12, 1);
  });

  it('renders deployment zone boundaries and clears them properly', () => {
    const renderer = makeRenderer();
    renderer.setDeploymentZones({
      hostZone: { minX: -18, maxX: 18, minZ: -18, maxZ: -6 },
      guestZone: { minX: -18, maxX: 18, minZ: 6, maxZ: 18 },
      previewUnitZone: { minX: -18, maxX: 18, minZ: -18, maxZ: 6, color: 0x29b6f6 },
    });

    expect(renderer.getRenderedMarkerNames()).toContain('marker-deployment-zones');
    const group = scene.getObjectByName('marker-deployment-zones')!;
    // 3 zones (host, guest, preview) each with ground plane + outline = 6 children
    expect(group.children.length).toBe(6);

    renderer.setDeploymentZones(null);
    expect(renderer.getRenderedMarkerNames()).not.toContain('marker-deployment-zones');
  });
});
