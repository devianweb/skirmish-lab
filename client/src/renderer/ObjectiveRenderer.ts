import * as THREE from 'three';
import { GameState, Objective, OBJECTIVE_CONTROL_RADIUS } from '@skirmish-lab/shared';
import { disposeObject3D } from './utils';
import { ModelLoader } from './ModelLoader';

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
 * Renders 3D objective markers on the battlefield:
 * - 3.0" control radius boundary ring and soft capture zone on the ground.
 * - Central low-poly supply crate objective base.
 * - Floating diamond crystal marker.
 * - Team-colored reactive visual state (Blue = Host, Red = Guest, Orange = Contested, Gold = Neutral).
 */
export class ObjectiveRenderer {
  private objectiveGroup: THREE.Group;
  private currentSignature: string | null = null;

  constructor(scene: THREE.Scene, private modelLoader?: ModelLoader) {
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

    // 1. Soft control boundary ring on the ground (y = 0.015)
    const ringGeo = new THREE.RingGeometry(radius - 0.04, radius, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.name = `objective-${obj.id}-ring`;
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.015;
    group.add(ringMesh);

    // 2. Soft semi-transparent ground control disc (y = 0.012)
    const discGeo = new THREE.RingGeometry(0.01, radius - 0.04, 48);
    const discMat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.name = `objective-${obj.id}-disc`;
    discMesh.rotation.x = -Math.PI / 2;
    discMesh.position.y = 0.012;
    group.add(discMesh);

    // 3. Central supply crate base
    const baseGroup = new THREE.Group();
    baseGroup.name = `objective-${obj.id}-base`;
    if (this.modelLoader) {
      const crateMesh = this.modelLoader.createTerrainMesh('crate-medium');
      crateMesh.scale.set(1.0, 1.0, 1.0);
      crateMesh.position.y = 0;
      baseGroup.add(crateMesh);
    } else {
      const boxGeo = new THREE.BoxGeometry(0.7, 0.5, 0.7);
      const boxMat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.2,
      });
      const boxMesh = new THREE.Mesh(boxGeo, boxMat);
      boxMesh.position.y = 0.25;
      baseGroup.add(boxMesh);
    }
    group.add(baseGroup);

    // 4. Floating diamond / crystal marker
    const gemGeo = new THREE.OctahedronGeometry(0.24, 0);
    const gemMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.2,
      metalness: 0.8,
      emissive: color,
      emissiveIntensity: 0.35,
    });
    const gemMesh = new THREE.Mesh(gemGeo, gemMat);
    gemMesh.name = `objective-${obj.id}-gem`;
    gemMesh.position.y = 0.9;
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
