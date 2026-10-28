import * as THREE from 'three';
import { TerrainPiece, terrainHalfExtents, Vector3 } from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { disposeObject3D } from './utils';

/** Minimal unit shape the markers need (decoupled from game state schema). */
export interface MarkerUnit {
  id: string;
  position: Vector3;
  remainingMovement?: number;
}

export interface AttackRangeMarker {
  position: Vector3;
  range: number;
  /** Optional 2D visibility polygon in world XZ coordinates for LoS shadow fill. */
  losPolygon?: Array<{ x: number; z: number }>;
}

export interface MovePathMarker {
  from: Vector3;
  to: Vector3;
}

const SELECTION_COLOR = 0x29b6f6;
const TARGET_COLOR = 0xff5252;
const REACHABLE_TARGET_COLOR = 0x8e2424;
const RANGE_COLOR = 0xffd54f;
const ATTACK_RANGE_COLOR = 0xef5350;
const PATH_COLOR = 0x69f0ae;
const OUTCOME_COLOR = 0xef5350;

/**
 * Renders gameplay UI markers in the scene: selection indicator under the
 * player's chosen unit, target indicator under a prospective attack target,
 * darker red rings under all reachable enemy targets within range,
 * movement-range ring for the active unit, thin attack-range ring during
 * shoot/charge/fight targeting, movement path preview line, and floating
 * wound-count tokens after an attack resolves.
 *
 * Markers use registered GLB assets when available (assetManifest) and
 * procedural ring/token fallbacks otherwise. Pure view layer — no game
 * state is read here; callers pass plain data.
 */
export class MarkerRenderer {
  private markerGroup: THREE.Group;
  private modelLoader: ModelLoader;
  private selection: THREE.Object3D | null = null;
  private target: THREE.Object3D | null = null;
  private reachableTargets: THREE.Group | null = null;
  private range: THREE.Object3D | null = null;
  private attackRange: THREE.Object3D | null = null;
  private movePath: THREE.Object3D | null = null;
  private terrainDebug: THREE.Object3D | null = null;
  private outcome: THREE.Object3D | null = null;
  private outcomeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: THREE.Scene, modelLoader: ModelLoader = new ModelLoader()) {
    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'markers';
    this.modelLoader = modelLoader;
    scene.add(this.markerGroup);
  }

  /** Indicator under the selected/active/hovered unit (blue circle). */
  setSelection(unit: MarkerUnit | null): void {
    this.replaceMarker('selection', unit, SELECTION_COLOR, () =>
      this.createFlatRing(SELECTION_COLOR, 0.55, 0.02)
    );
  }

  /** Indicator under a hovered or selected attack target (bright red floor ring). */
  setTarget(unit: MarkerUnit | null): void {
    this.replaceMarker('target', unit, TARGET_COLOR, () =>
      this.createFlatRing(TARGET_COLOR, 0.6, 0.025)
    );
  }

  /** Darker red floor rings under all enemy units within attack range. */
  setReachableTargets(units: MarkerUnit[]): void {
    this.removeMarker('reachableTargets');
    if (!units || units.length === 0) return;

    const group = new THREE.Group();
    group.name = 'marker-reachable-targets';
    for (const unit of units) {
      const ring = this.modelLoader.createMarkerMesh('reachable-target', () =>
        this.createFlatRing(REACHABLE_TARGET_COLOR, 0.55, 0.018)
      );
      this.applyTint(ring, REACHABLE_TARGET_COLOR);
      ring.name = `marker-reachable-${unit.id}`;
      ring.position.set(unit.position.x, 0.018, unit.position.z);
      group.add(ring);
    }
    this.markerGroup.add(group);
    this.reachableTargets = group;
  }

  /** Thin movement-range ring sized to the unit's remaining movement. */
  setMovementRange(unit: MarkerUnit | null): void {
    this.removeMarker('range');
    if (!unit) return;
    const radius = Math.max(unit.remainingMovement ?? 0, 0);
    if (radius <= 0) return;

    const normalizedThickness = Math.min(0.25, 0.08 / radius);
    const marker = this.modelLoader.createMarkerMesh('movement-range', () =>
      this.createRangeRing(RANGE_COLOR, 1, normalizedThickness)
    );
    marker.name = 'marker-movement-range';
    marker.position.set(unit.position.x, 0.03, unit.position.z);
    marker.scale.set(radius, 1, radius);
    this.markerGroup.add(marker);
    this.range = marker;
  }

  /**
   * Thin attack-range ring sized to the weapon/charge max range (red), plus a
   * dark transparent red Line-of-Sight fill inside the ring that is blank
   * wherever LoS is blocked by terrain or fighters.
   */
  setAttackRange(spec: AttackRangeMarker | null): void {
    this.removeMarker('attackRange');
    if (!spec || spec.range <= 0) return;

    // Keep world-space rim thickness constant (~0.08 board units) regardless of
    // how large `spec.range` is so a 24" shoot circle stays a crisp thin line.
    const normalizedThickness = Math.min(0.25, 0.08 / spec.range);
    const marker = this.modelLoader.createMarkerMesh('attack-range', () =>
      this.createRangeRing(ATTACK_RANGE_COLOR, 1, normalizedThickness)
    );
    this.applyTint(marker, ATTACK_RANGE_COLOR);
    if (spec.losPolygon && spec.losPolygon.length >= 3) {
      marker.add(this.createLosFanMesh(spec.position, spec.range, spec.losPolygon));
    }
    marker.name = 'marker-attack-range';
    marker.position.set(spec.position.x, 0.035, spec.position.z);
    marker.scale.set(spec.range, 1, spec.range);
    this.markerGroup.add(marker);
    this.attackRange = marker;
  }

  /** Preview line + endpoint disc for a prospective move path. */
  setMovePath(path: MovePathMarker | null): void {
    this.removeMarker('movePath');
    if (!path) return;

    const group = new THREE.Group();
    group.name = 'marker-move-path';

    const points = [
      new THREE.Vector3(path.from.x, 0.06, path.from.z),
      new THREE.Vector3(path.to.x, 0.06, path.to.z),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({ color: PATH_COLOR });
    group.add(new THREE.Line(lineGeo, lineMat));

    const endDisc = this.createFlatRing(PATH_COLOR, 0.4, 0.06);
    endDisc.position.set(path.to.x, 0.06, path.to.z);
    group.add(endDisc);

    this.markerGroup.add(group);
    this.movePath = group;
  }

  /**
   * Wireframe debug box showing the exact 2D Line-of-Sight / obstacle footprint
   * (`terrainHalfExtents`) of a hovered terrain piece.
   */
  setTerrainDebug(piece: TerrainPiece | null): void {
    this.removeMarker('terrainDebug');
    if (!piece) return;

    const { hx, hz } = terrainHalfExtents(piece);
    const height = Math.max(0.5, piece.scale.y);
    const group = new THREE.Group();
    group.name = 'marker-terrain-debug';
    group.position.set(piece.position.x, 0, piece.position.z);
    group.rotation.y = piece.rotation.y || 0;

    // Ground-level footprint outline (bright yellow)
    const floorPts = [
      new THREE.Vector3(-hx, 0.05, -hz),
      new THREE.Vector3(hx, 0.05, -hz),
      new THREE.Vector3(hx, 0.05, hz),
      new THREE.Vector3(-hx, 0.05, hz),
      new THREE.Vector3(-hx, 0.05, -hz),
    ];
    const floorGeo = new THREE.BufferGeometry().setFromPoints(floorPts);
    const floorMat = new THREE.LineBasicMaterial({ color: 0xffeb3b });
    group.add(new THREE.Line(floorGeo, floorMat));

    // 3D bounding wireframe box
    const boxGeo = new THREE.BoxGeometry(hx * 2, height, hz * 2);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const boxLine = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.75 })
    );
    boxLine.position.y = height / 2;
    group.add(boxLine);
    boxGeo.dispose();

    this.markerGroup.add(group);
    this.terrainDebug = group;
  }

  /**
   * Floating wound-count token above a position, auto-cleared after a
   * short delay so results stay visible without cluttering the board.
   */
  showOutcome(position: Vector3, wounds: number): void {
    if (wounds < 1) return;
    this.clearOutcome();

    const key = `outcome-${Math.max(1, Math.min(5, Math.round(wounds)))}`;
    const marker = this.modelLoader.createMarkerMesh(key, () =>
      this.createOutcomeToken(OUTCOME_COLOR, wounds)
    );
    this.applyTint(marker, OUTCOME_COLOR);
    marker.name = `marker-${key}`;
    marker.position.set(position.x, 1.6, position.z);
    // Orient the number's front face (-X in Kenney's number GLBs) toward the
    // default camera quadrant (+X, +Z) so digits like '2' never appear mirrored as '5'.
    marker.rotation.y = (-3 * Math.PI) / 4;
    this.markerGroup.add(marker);
    this.outcome = marker;

    this.outcomeTimer = setTimeout(() => this.clearOutcome(), 2500);
  }

  /** Face the floating outcome token toward the active camera each frame. */
  orientOutcomeToCamera(camera: THREE.Camera | null): void {
    if (!this.outcome || !camera) return;
    const dx = camera.position.x - this.outcome.position.x;
    const dz = camera.position.z - this.outcome.position.z;
    // Kenney number GLBs have their readable front face pointing along -X,
    // so rotating -X toward (dx, dz) requires yaw = atan2(dz, -dx).
    this.outcome.rotation.y = Math.atan2(dz, -dx);
  }

  clearAll(): void {
    this.removeMarker('selection');
    this.removeMarker('target');
    this.removeMarker('reachableTargets');
    this.removeMarker('range');
    this.removeMarker('attackRange');
    this.removeMarker('movePath');
    this.removeMarker('terrainDebug');
    this.clearOutcome();
  }

  /** The markers currently rendered, by kind (for tests/debugging). */
  getRenderedMarkerNames(): string[] {
    return this.markerGroup.children.map((child) => child.name);
  }

  dispose(): void {
    this.clearAll();
  }

  private clearOutcome(): void {
    if (this.outcomeTimer) {
      clearTimeout(this.outcomeTimer);
      this.outcomeTimer = null;
    }
    if (this.outcome) {
      this.markerGroup.remove(this.outcome);
      disposeObject3D(this.outcome);
      this.outcome = null;
    }
  }

  private removeMarker(
    kind:
      | 'selection'
      | 'target'
      | 'reachableTargets'
      | 'range'
      | 'attackRange'
      | 'movePath'
      | 'terrainDebug'
  ): void {
    const current = this[kind];
    if (current) {
      this.markerGroup.remove(current);
      disposeObject3D(current);
      this[kind] = null;
    }
  }

  private replaceMarker(
    kind: 'selection' | 'target',
    unit: MarkerUnit | null,
    tintColor: number,
    fallbackFactory: () => THREE.Object3D
  ): void {
    this.removeMarker(kind);
    if (!unit) return;

    const marker = this.modelLoader.createMarkerMesh(kind, fallbackFactory);
    this.applyTint(marker, tintColor);
    marker.name = `marker-${kind}`;
    marker.position.set(unit.position.x, 0.02, unit.position.z);
    this.markerGroup.add(marker);
    this[kind] = marker;
  }

  private applyTint(marker: THREE.Object3D, color: number): void {
    marker.userData.tintColor = color;
    marker.userData.ignoreTextureMap = true;
    marker.traverse((child) => {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (material && material.color) {
        if (material.map) {
          material.map = null;
          material.needsUpdate = true;
        }
        material.color.setHex(color);
      }
    });
  }

  /** Flat ring fallback: two-tone annulus lying on the board. */
  private createFlatRing(color: number, radius: number, y: number): THREE.Object3D {
    const geometry = new THREE.RingGeometry(radius * 0.75, radius, 32);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  }

  /** Range-ring fallback: thin annulus scaled to the radius. */
  private createRangeRing(
    color: number,
    radius: number,
    thickness: number = 0.04
  ): THREE.Object3D {
    const geometry = new THREE.RingGeometry(
      Math.max(0.01, radius - thickness),
      radius,
      64
    );
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /** Outcome-token fallback: floating octahedron (GLB number tokens in prod). */
  private createOutcomeToken(color: number, wounds: number): THREE.Object3D {
    const geometry = new THREE.OctahedronGeometry(0.22 + 0.05 * wounds);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    return new THREE.Mesh(geometry, material);
  }

  /**
   * Build a 2D triangle-fan mesh (normalized to unit radius so the parent
   * container's `scale.set(range, 1, range)` sizes it to world space) that
   * fills visible Line of Sight with a dark transparent red shadow and leaves
   * blocked shadow wedges blank.
   */
  private createLosFanMesh(
    origin: Vector3,
    range: number,
    polygon: Array<{ x: number; z: number }>
  ): THREE.Mesh {
    const n = polygon.length;
    const vertices = new Float32Array(n * 3 * 3);
    for (let i = 0; i < n; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % n];
      const base = i * 9;
      // Center vertex
      vertices[base + 0] = 0;
      vertices[base + 1] = -0.01;
      vertices[base + 2] = 0;
      // Perimeter vertex i
      vertices[base + 3] = (p1.x - origin.x) / range;
      vertices[base + 4] = -0.01;
      vertices[base + 5] = (p1.z - origin.z) / range;
      // Perimeter vertex i + 1
      vertices[base + 6] = (p2.x - origin.x) / range;
      vertices[base + 7] = -0.01;
      vertices[base + 8] = (p2.z - origin.z) / range;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const material = new THREE.MeshBasicMaterial({
      color: 0xb71c1c,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'los-shadow-fan';
    return mesh;
  }
}
