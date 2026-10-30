import * as THREE from 'three';
import { GameState, Objective, OBJECTIVE_CONTROL_RADIUS } from '@skirmish-lab/shared';
import { disposeObject3D } from './utils';

const HOST_COLOR = 0x29b6f6;     // Team Blue
const GUEST_COLOR = 0xef5350;    // Team Red
const CONTESTED_COLOR = 0xff9800;// Amber / Orange
const NEUTRAL_COLOR = 0xffd54f;  // Gold / Yellow

export interface ObjectiveMeshItem {
  id: string;
  group: THREE.Group;
  color: number;
}

/**
 * Renders 3D objective markers and beacons on the battlefield:
 * - 3.0" control radius boundary ring and translucent capture zone on the ground.
 * - Central beacon base on the floor.
 * - Vertical glowing light column / pillar.
 * - Floating diamond marker.
 * - Team-colored reactive visual state (Blue = Host, Red = Guest, Orange = Contested, Gold = Neutral).
 */
export class ObjectiveRenderer {
  private objectiveGroup: THREE.Group;
  private currentSignature: string | null = null;

  constructor(scene: THREE.Scene) {
    this.objectiveGroup = new THREE.Group();
    this.objectiveGroup.name = 'objectives';
    scene.add(this.objectiveGroup);
  }

  /**
   * Sync 3D objective visuals from GameState.
   * Reconstructs or updates markers whenever objective data or control state changes.
   */
  syncFromState(state: GameState): void {
    const objectives = state.objectives ?? [];
    const signature = JSON.stringify(
      objectives.map((o) => ({
        id: o.id,
        pos: o.position,
        ctrl: o.controllingPlayerId,
        contested: o.isContested,
      }))
    );

    if (signature === this.currentSignature) return;
    this.currentSignature = signature;

    this.clear();

    for (const obj of objectives) {
      const color = this.getObjectiveColor(obj, state.hostId, state.guestId);
      const mesh = this.createObjectiveMesh(obj, color);
      this.objectiveGroup.add(mesh);
    }
  }

  getGroup(): THREE.Group {
    return this.objectiveGroup;
  }

  private getObjectiveColor(obj: Objective, hostId: string, guestId: string): number {
    if (obj.isContested) return CONTESTED_COLOR;
    if (obj.controllingPlayerId === hostId) return HOST_COLOR;
    if (obj.controllingPlayerId === guestId) return GUEST_COLOR;
    return NEUTRAL_COLOR;
  }

  private createObjectiveMesh(obj: Objective, color: number): THREE.Group {
    const group = new THREE.Group();
    group.name = `objective-${obj.id}`;
    group.position.set(obj.position.x, 0, obj.position.z);

    const radius = OBJECTIVE_CONTROL_RADIUS; // 3.0"

    // 1. Control boundary ring on the ground (y = 0.015)
    const ringGeo = new THREE.RingGeometry(radius - 0.08, radius, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.name = `objective-${obj.id}-ring`;
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.015;
    group.add(ringMesh);

    // 2. Soft semi-transparent ground control disc (y = 0.012)
    const discGeo = new THREE.RingGeometry(0.01, radius - 0.08, 48);
    const discMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.name = `objective-${obj.id}-disc`;
    discMesh.rotation.x = -Math.PI / 2;
    discMesh.position.y = 0.012;
    group.add(discMesh);

    // 3. Central beacon base on the ground
    const baseGeo = new THREE.CylinderGeometry(0.5, 0.6, 0.1, 24);
    const baseMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.3,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.name = `objective-${obj.id}-base`;
    baseMesh.position.y = 0.05;
    group.add(baseMesh);

    // 4. Vertical light column / pillar
    const beamGeo = new THREE.CylinderGeometry(0.08, 0.25, 3.5, 16);
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beamMesh = new THREE.Mesh(beamGeo, beamMat);
    beamMesh.name = `objective-${obj.id}-beam`;
    beamMesh.position.y = 1.75;
    group.add(beamMesh);

    // 5. Floating diamond / gem
    const gemGeo = new THREE.OctahedronGeometry(0.28, 0);
    const gemMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.2,
      metalness: 0.8,
      emissive: color,
      emissiveIntensity: 0.35,
    });
    const gemMesh = new THREE.Mesh(gemGeo, gemMat);
    gemMesh.name = `objective-${obj.id}-gem`;
    gemMesh.position.y = 1.15;
    group.add(gemMesh);

    return group;
  }

  clear(): void {
    this.currentSignature = null;
    while (this.objectiveGroup.children.length > 0) {
      const child = this.objectiveGroup.children[0];
      this.objectiveGroup.remove(child);
      disposeObject3D(child);
    }
  }

  dispose(): void {
    this.clear();
    if (this.objectiveGroup.parent) {
      this.objectiveGroup.parent.remove(this.objectiveGroup);
    }
  }
}
