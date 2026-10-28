import * as THREE from 'three';
import { GameState } from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { disposeObject3D } from './utils';

// Original palette: player 0 (host) blue, player 1 (guest) red — generic colors.
const PLAYER_COLORS = [0x3a7bd5, 0xd54a3a];
const UNKNOWN_PLAYER_COLOR = 0x8a8a8a;

/**
 * Creates, updates, and removes unit meshes so the scene always mirrors the
 * units in game state. One-way binding: reads from game state only — it never
 * adds, removes, or modifies anything in the state object.
 */
export class UnitRenderer {
  private unitGroup: THREE.Group;
  private modelLoader: ModelLoader;
  /** unitId -> rendered mesh */
  private meshes = new Map<string, THREE.Object3D>();

  constructor(scene: THREE.Scene, modelLoader: ModelLoader = new ModelLoader()) {
    this.unitGroup = new THREE.Group();
    this.unitGroup.name = 'units';
    this.modelLoader = modelLoader;
    scene.add(this.unitGroup);
  }

  /**
   * Diff the current meshes against `state.units`:
   *   - new units get a mesh (position, rotation, owner color from state)
   *   - existing meshes get their transform/color refreshed from state
   *   - meshes for destroyed or removed units are disposed
   * Idempotent — syncing an unchanged state is a no-op visually.
   */
  syncFromState(state: GameState): void {
    const visibleIds = new Set<string>();

    for (const unit of state.units) {
      if (unit.isDestroyed) {
        continue;
      }
      visibleIds.add(unit.id);

      let mesh = this.meshes.get(unit.id);
      if (!mesh) {
        mesh = this.modelLoader.createUnitMesh(unit.unitType);
        mesh.userData.unitId = unit.id;
        this.meshes.set(unit.id, mesh);
        this.unitGroup.add(mesh);
      }

      mesh.position.set(unit.position.x, unit.position.y, unit.position.z);
      mesh.rotation.set(unit.rotation.x, unit.rotation.y, unit.rotation.z);
      this.applyOwnerColor(mesh, unit.ownerId, state);
    }

    for (const [unitId, mesh] of this.meshes) {
      if (!visibleIds.has(unitId)) {
        this.unitGroup.remove(mesh);
        disposeObject3D(mesh);
        this.meshes.delete(unitId);
      }
    }
  }

  clear(): void {
    for (const [unitId, mesh] of this.meshes) {
      this.unitGroup.remove(mesh);
      disposeObject3D(mesh);
      this.meshes.delete(unitId);
    }
  }

  /** Color every mesh in a unit by its owning player's index in the state. */
  private applyOwnerColor(mesh: THREE.Object3D, ownerId: string, state: GameState): void {
    const playerIndex = state.players.findIndex((p) => p.id === ownerId);
    const color = playerIndex === -1 ? UNKNOWN_PLAYER_COLOR : PLAYER_COLORS[playerIndex];

    mesh.traverse((child) => {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (material && material.color) {
        material.color.setHex(color);
      }
    });
  }
}
