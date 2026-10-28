import * as THREE from 'three';
import { Vector3 } from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { disposeObject3D } from './utils';

/** Minimal unit shape the markers need (decoupled from game state schema). */
export interface MarkerUnit {
  id: string;
  position: Vector3;
  remainingMovement?: number;
}

const SELECTION_COLOR = 0x4fc3f7;
const TARGET_COLOR = 0xef5350;
const RANGE_COLOR = 0xffd54f;
const OUTCOME_COLOR = 0xef5350;

/**
 * Renders gameplay UI markers in the scene: selection indicator under the
 * player's chosen unit, target indicator under a prospective attack target,
 * movement-range ring for the active unit, and floating wound-count tokens
 * after an attack resolves.
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
  private range: THREE.Object3D | null = null;
  private outcome: THREE.Object3D | null = null;
  private outcomeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: THREE.Scene, modelLoader: ModelLoader = new ModelLoader()) {
    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'markers';
    this.modelLoader = modelLoader;
    scene.add(this.markerGroup);
  }

  /** Indicator under the selected/active unit (blue). */
  setSelection(unit: MarkerUnit | null): void {
    this.replaceMarker('selection', unit, () => this.createFlatRing(SELECTION_COLOR, 0.55, 0.02));
  }

  /** Indicator under a prospective attack target (red). */
  setTarget(unit: MarkerUnit | null): void {
    this.replaceMarker('target', unit, () => this.createFlatRing(TARGET_COLOR, 0.6, 0.025));
  }

  /** Movement-range ring sized to the unit's remaining movement (yellow). */
  setMovementRange(unit: MarkerUnit | null): void {
    if (!unit) {
      this.removeMarker('range');
      return;
    }
    this.removeMarker('range');
    const radius = Math.max(unit.remainingMovement ?? 0, 0);
    if (radius <= 0) return;

    const marker = this.modelLoader.createMarkerMesh('movement-range', () =>
      this.createRangeRing(RANGE_COLOR, radius)
    );
    marker.name = 'marker-movement-range';
    marker.position.set(unit.position.x, 0.03, unit.position.z);
    this.markerGroup.add(marker);
    this.range = marker;
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
    marker.name = `marker-${key}`;
    marker.position.set(position.x, 1.6, position.z);
    this.markerGroup.add(marker);
    this.outcome = marker;

    this.outcomeTimer = setTimeout(() => this.clearOutcome(), 2500);
  }

  clearAll(): void {
    this.removeMarker('selection');
    this.removeMarker('target');
    this.removeMarker('range');
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

  private removeMarker(kind: 'selection' | 'target' | 'range'): void {
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
    fallbackFactory: () => THREE.Object3D
  ): void {
    this.removeMarker(kind);
    if (!unit) return;

    const marker = this.modelLoader.createMarkerMesh(kind, fallbackFactory);
    marker.name = `marker-${kind}`;
    marker.position.set(unit.position.x, 0.02, unit.position.z);
    this.markerGroup.add(marker);
    this[kind] = marker;
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

  /** Range-ring fallback: thin annulus scaled to the movement radius. */
  private createRangeRing(color: number, radius: number): THREE.Object3D {
    const geometry = new THREE.RingGeometry(radius - 0.06, radius, 48);
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
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
}
