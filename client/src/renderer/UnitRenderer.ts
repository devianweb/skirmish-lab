import * as THREE from 'three';
import { GameState } from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { disposeObject3D } from './utils';
import { getUnitRimColor } from './rimColors';

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
      if (unit.isDestroyed || unit.isDeployed === false) {
        continue;
      }
      visibleIds.add(unit.id);

      let unitRoot = this.meshes.get(unit.id) as THREE.Group | undefined;
      if (!unitRoot) {
        unitRoot = new THREE.Group();
        unitRoot.name = `unit-${unit.id}`;
        unitRoot.userData.unitId = unit.id;
        unitRoot.userData.modelMeshes = new Map<string, THREE.Object3D>();
        this.meshes.set(unit.id, unitRoot);
        this.unitGroup.add(unitRoot);
      }

      const isSquad = Boolean(unit.models && unit.models.length > 1);

      unitRoot.position.set(unit.position.x, unit.position.y, unit.position.z);
      if (isSquad) {
        // Multi-model squad: keep unitRoot container unrotated so child meshes match absolute world coordinates
        unitRoot.rotation.set(0, 0, 0);
      } else {
        unitRoot.rotation.set(unit.rotation.x, unit.rotation.y, unit.rotation.z);
      }

      const modelMeshes: Map<string, THREE.Object3D> = unitRoot.userData.modelMeshes;
      const activeModelIds = new Set<string>();

      const activeModels =
        unit.models && unit.models.length > 0
          ? unit.models.filter((m) => !m.isDestroyed)
          : [
              {
                id: `${unit.id}-model-1`,
                wounds: unit.wounds,
                maxWounds: unit.maxWounds,
                isDestroyed: false,
                position: unit.position,
                rotation: unit.rotation,
              },
            ];

      for (const model of activeModels) {
        activeModelIds.add(model.id);
        let modelMesh = modelMeshes.get(model.id);
        if (!modelMesh) {
          modelMesh = this.modelLoader.createUnitMesh(unit.unitType);
          modelMesh.userData.modelId = model.id;
          modelMeshes.set(model.id, modelMesh);
          unitRoot.add(modelMesh);
        }

        const modelPos = model.position ?? unit.position;
        // Local offset relative to unitRoot squad centroid
        const localX = isSquad ? modelPos.x - unit.position.x : 0;
        const localY = isSquad ? (modelPos.y ?? 0) - (unit.position.y ?? 0) : 0;
        const localZ = isSquad ? modelPos.z - unit.position.z : 0;
        modelMesh.position.set(localX, localY, localZ);

        if (isSquad) {
          const mRot = model.rotation ?? unit.rotation;
          modelMesh.rotation.set(mRot.x ?? 0, mRot.y ?? 0, mRot.z ?? 0);
        } else {
          modelMesh.rotation.set(0, 0, 0);
        }
      }

      // Remove and dispose any meshes for destroyed or removed models in this squad
      for (const [mId, mMesh] of modelMeshes) {
        if (!activeModelIds.has(mId)) {
          unitRoot.remove(mMesh);
          disposeObject3D(mMesh);
          modelMeshes.delete(mId);
        }
      }

      this.applyOwnerColor(unitRoot, unit.ownerId, state, unit.id);
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

  /**
   * Nearest unit mesh hit by the raycaster (used by GameView picking).
   * Returns the unit ID or null when no unit mesh is hit.
   */
  raycastUnit(raycaster: THREE.Raycaster): string | null {
    return this.raycastUnitHit(raycaster)?.unitId ?? null;
  }

  /**
   * Nearest unit and optional constituent model hit by the raycaster.
   * Returns { unitId, modelId } or null when no unit mesh is hit.
   */
  raycastUnitHit(raycaster: THREE.Raycaster): { unitId: string; modelId?: string } | null {
    let bestUnitId: string | null = null;
    let bestModelId: string | undefined = undefined;
    let bestDistance = Infinity;

    for (const [unitId, mesh] of this.meshes) {
      mesh.updateMatrixWorld(true);
      const hits = raycaster.intersectObject(mesh, true);
      if (hits.length > 0 && hits[0].distance < bestDistance) {
        bestDistance = hits[0].distance;
        bestUnitId = unitId;
        bestModelId = undefined;
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && obj !== mesh) {
          if (obj.userData?.modelId) {
            bestModelId = obj.userData.modelId;
            break;
          }
          obj = obj.parent;
        }
      }
    }
    return bestUnitId ? { unitId: bestUnitId, modelId: bestModelId } : null;
  }

  /** Color meshes: player team tint on miniature body, squad-identifying rim color on base rim, dark slate on base top. */
  private applyOwnerColor(mesh: THREE.Object3D, ownerId: string, state: GameState, unitId?: string): void {
    const playerIndex = state.players.findIndex((p) => p.id === ownerId);
    const color = playerIndex === -1 ? UNKNOWN_PLAYER_COLOR : PLAYER_COLORS[playerIndex];
    mesh.userData.tintColor = color;
    const rimColor = unitId ? getUnitRimColor(unitId) : undefined;

    mesh.traverse((child) => {
      const node = child as THREE.Mesh;
      if (!node.isMesh) return;
      const material = node.material as THREE.MeshStandardMaterial | undefined;
      if (!material || !material.color) return;

      if (node.userData?.isBaseRim) {
        if (rimColor !== undefined) {
          material.color.setHex(rimColor);
        }
      } else if (node.userData?.isBaseTop) {
        material.color.setHex(0x212529); // Dark tournament slate
      } else if (node.userData?.isVisor) {
        material.color.setHex(0x102027); // Dark tinted visor
      } else if (node.userData?.isWeapon) {
        material.color.setHex(0x37474f); // Gunmetal
      } else {
        // Miniature body / armor takes player team color
        material.color.setHex(color);
      }
    });
  }
}
