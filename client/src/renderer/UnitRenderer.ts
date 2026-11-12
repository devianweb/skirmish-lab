import * as THREE from 'three';
import { GameState, Vector3 } from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { disposeObject3D } from './utils';
import { getUnitRimColor } from './rimColors';
import { easeInOut, samplePathAtProgress } from './animationMath';

// Original palette: player 0 (host) blue, player 1 (guest) red — generic colors.
const PLAYER_COLORS = [0x3a7bd5, 0xd54a3a];
const UNKNOWN_PLAYER_COLOR = 0x8a8a8a;

const MOVEMENT_DURATION_SECONDS = 0.4;
const CASUALTY_DURATION_SECONDS = 0.4;
const CASUALTY_SINK_DISTANCE = 0.3;
const HIT_FLASH_DURATION_SECONDS = 0.25;
const HIT_FLASH_COLOR = 0xff2222;

const MOVEMENT_ACTION_TYPES = new Set([
  'advance',
  'rush',
  'charge',
  'charge-leg',
  'consolidate-move',
  'push-move',
  'pile-in-move',
  'respond-reaction',
  'pick-casualties',
  'fight',
]);

interface ActiveMovementTween {
  unitId: string;
  unitRoot: THREE.Group;
  isSquad: boolean;
  models: Array<{
    modelId: string;
    modelMesh: THREE.Object3D;
    path: Vector3[];
    startPos: Vector3;
    endPos: Vector3;
  }>;
  targetUnitPosition: Vector3;
  elapsed: number;
  duration: number;
}

interface ActiveCasualty {
  mesh: THREE.Object3D;
  startY: number;
  elapsed: number;
  duration: number;
}

interface ActiveHitFlash {
  mesh: THREE.Object3D;
  unitId: string;
  materials: Array<{
    material: THREE.Material & { color?: THREE.Color; emissive?: THREE.Color };
    originalColor?: THREE.Color;
    originalEmissive?: THREE.Color;
  }>;
  elapsed: number;
  duration: number;
}

/**
 * Creates, updates, and removes unit meshes so the scene always mirrors the
 * units in game state. One-way binding: reads from game state only — it never
 * adds, removes, or modifies anything in the state object.
 *
 * Supports visual-only movement tweening, casualty fade/sink, and hit flashes
 * that never block or alter game state or networking.
 */
export class UnitRenderer {
  private unitGroup: THREE.Group;
  private casualtiesGroup: THREE.Group;
  private modelLoader: ModelLoader;
  /** unitId -> rendered mesh */
  private meshes = new Map<string, THREE.Object3D>();

  private prevModelPositions = new Map<string, Vector3>();
  private prevModelWounds = new Map<string, number>();

  private activeMovementTweens: ActiveMovementTween[] = [];
  private activeCasualties: ActiveCasualty[] = [];
  private activeHitFlashes: ActiveHitFlash[] = [];

  private reducedMotionOverride?: boolean;

  constructor(scene: THREE.Scene, modelLoader: ModelLoader = new ModelLoader()) {
    this.unitGroup = new THREE.Group();
    this.unitGroup.name = 'units';
    this.casualtiesGroup = new THREE.Group();
    this.casualtiesGroup.name = 'casualties';
    this.modelLoader = modelLoader;
    scene.add(this.unitGroup);
    scene.add(this.casualtiesGroup);
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotionOverride = enabled;
  }

  isReducedMotion(): boolean {
    if (this.reducedMotionOverride !== undefined) {
      return this.reducedMotionOverride;
    }
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Snaps any currently in-flight animations to their target endpoints immediately.
   * Called before processing new incoming game states.
   */
  snapAllTweensToEnd(): void {
    // 1. Snap movement tweens to destinations
    for (const tween of this.activeMovementTweens) {
      tween.unitRoot.position.set(
        tween.targetUnitPosition.x,
        tween.targetUnitPosition.y ?? 0,
        tween.targetUnitPosition.z
      );
      if (tween.isSquad) {
        for (const m of tween.models) {
          m.modelMesh.position.set(
            m.endPos.x - tween.targetUnitPosition.x,
            (m.endPos.y ?? 0) - (tween.targetUnitPosition.y ?? 0),
            m.endPos.z - tween.targetUnitPosition.z
          );
        }
      } else if (tween.models[0]) {
        tween.models[0].modelMesh.position.set(0, 0, 0);
      }
    }
    this.activeMovementTweens = [];

    // 2. Snap casualties (finish fade and dispose immediately)
    for (const casualty of this.activeCasualties) {
      this.casualtiesGroup.remove(casualty.mesh);
      disposeObject3D(casualty.mesh);
    }
    this.activeCasualties = [];

    // 3. Snap hit flashes (restore original colors)
    for (const flash of this.activeHitFlashes) {
      for (const entry of flash.materials) {
        if (entry.originalColor && entry.material.color) {
          entry.material.color.copy(entry.originalColor);
        }
        if (entry.originalEmissive && (entry.material as any).emissive) {
          (entry.material as any).emissive.copy(entry.originalEmissive);
        }
      }
    }
    this.activeHitFlashes = [];
  }

  /**
   * Advance all active animations (movement, casualty sink/fade, hit flash) by deltaSeconds.
   */
  update(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;

    // 1. Update movement tweens
    for (let i = this.activeMovementTweens.length - 1; i >= 0; i--) {
      const tween = this.activeMovementTweens[i];
      tween.elapsed += deltaSeconds;
      const t = Math.max(0, Math.min(1, tween.elapsed / tween.duration));
      const progress = easeInOut(t);
      const done = tween.elapsed >= tween.duration;

      if (tween.isSquad) {
        const currentModelPositions = tween.models.map((m) =>
          done ? m.endPos : samplePathAtProgress(m.path, progress)
        );
        const count = currentModelPositions.length || 1;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        for (const p of currentModelPositions) {
          sumX += p.x;
          sumY += (p.y ?? 0);
          sumZ += p.z;
        }
        const currentCentroid = done
          ? tween.targetUnitPosition
          : { x: sumX / count, y: sumY / count, z: sumZ / count };

        tween.unitRoot.position.set(currentCentroid.x, currentCentroid.y, currentCentroid.z);
        for (let mIdx = 0; mIdx < tween.models.length; mIdx++) {
          const m = tween.models[mIdx];
          const p = currentModelPositions[mIdx];
          m.modelMesh.position.set(
            p.x - currentCentroid.x,
            (p.y ?? 0) - currentCentroid.y,
            p.z - currentCentroid.z
          );
        }
      } else {
        const m = tween.models[0];
        const pos = done ? m.endPos : samplePathAtProgress(m.path, progress);
        tween.unitRoot.position.set(pos.x, pos.y ?? 0, pos.z);
        m.modelMesh.position.set(0, 0, 0);
      }

      if (done) {
        this.activeMovementTweens.splice(i, 1);
      }
    }

    // 2. Update casualty animations (sink 0.3" and fade out over 0.4s)
    for (let i = this.activeCasualties.length - 1; i >= 0; i--) {
      const casualty = this.activeCasualties[i];
      casualty.elapsed += deltaSeconds;
      const progress = Math.min(1, casualty.elapsed / casualty.duration);
      casualty.mesh.position.y = casualty.startY - CASUALTY_SINK_DISTANCE * progress;

      const opacity = Math.max(0, 1 - progress);
      casualty.mesh.traverse((child) => {
        const node = child as THREE.Mesh;
        if (node.isMesh && node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const m of mats) {
            m.transparent = true;
            m.opacity = opacity;
          }
        }
      });

      if (casualty.elapsed >= casualty.duration) {
        this.casualtiesGroup.remove(casualty.mesh);
        disposeObject3D(casualty.mesh);
        this.activeCasualties.splice(i, 1);
      }
    }

    // 3. Update hit flashes (revert red tint after 0.25s)
    for (let i = this.activeHitFlashes.length - 1; i >= 0; i--) {
      const flash = this.activeHitFlashes[i];
      flash.elapsed += deltaSeconds;
      if (flash.elapsed >= flash.duration) {
        for (const entry of flash.materials) {
          if (entry.originalColor && entry.material.color) {
            entry.material.color.copy(entry.originalColor);
          }
          if (entry.originalEmissive && (entry.material as any).emissive) {
            (entry.material as any).emissive.copy(entry.originalEmissive);
          }
        }
        this.activeHitFlashes.splice(i, 1);
      }
    }
  }

  /**
   * Diff the current meshes against `state.units`:
   *   - new units get a mesh (position, rotation, owner color from state)
   *   - existing meshes get their transform/color refreshed from state
   *   - meshes for destroyed or removed units are disposed (or animated as casualties)
   * Idempotent — syncing an unchanged state is a no-op visually.
   */
  syncFromState(state: GameState): void {
    // Snap any in-flight tweens before syncing new state
    this.snapAllTweensToEnd();

    const lastEntry = state.actionLog && state.actionLog.length > 0 ? state.actionLog[state.actionLog.length - 1] : undefined;
    const isAccepted = lastEntry?.result === 'accepted';
    const actionType = isAccepted ? lastEntry?.action?.type : undefined;
    const payload = isAccepted ? lastEntry?.action?.payload : undefined;
    const isMovement = Boolean(actionType && MOVEMENT_ACTION_TYPES.has(actionType));

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

      // Prepare model meshes
      for (const model of activeModels) {
        activeModelIds.add(model.id);
        let modelMesh = modelMeshes.get(model.id);
        if (!modelMesh) {
          modelMesh = this.modelLoader.createUnitMesh(unit.unitType);
          modelMesh.userData.modelId = model.id;
          modelMeshes.set(model.id, modelMesh);
          unitRoot.add(modelMesh);
        }
      }

      // Check for position changes to decide if we should tween
      let shouldTweenUnit = false;
      const modelTweenSpecs: ActiveMovementTween['models'] = [];

      for (let mIdx = 0; mIdx < activeModels.length; mIdx++) {
        const model = activeModels[mIdx];
        const modelMesh = modelMeshes.get(model.id)!;
        const newModelPos = model.position ?? unit.position;
        const oldPos = this.prevModelPositions.get(model.id);

        const hasMoved =
          oldPos !== undefined &&
          (Math.abs(oldPos.x - newModelPos.x) > 0.001 ||
            Math.abs((oldPos.y ?? 0) - (newModelPos.y ?? 0)) > 0.001 ||
            Math.abs(oldPos.z - newModelPos.z) > 0.001);

        if (hasMoved && isMovement && !this.isReducedMotion()) {
          shouldTweenUnit = true;
        }

        // Determine path for this model
        let modelPath: Vector3[] | undefined;
        if (payload && 'modelPaths' in payload && Array.isArray((payload as any).modelPaths)) {
          const paths = (payload as any).modelPaths as Vector3[][];
          if (paths[mIdx] && paths[mIdx].length >= 2) {
            modelPath = paths[mIdx];
          }
        }
        if (!modelPath && !isSquad && payload && 'path' in payload && Array.isArray((payload as any).path)) {
          const path = (payload as any).path as Vector3[];
          const unitMatch =
            ('unitId' in payload && (payload as any).unitId === unit.id) ||
            ('attackerId' in payload && (payload as any).attackerId === unit.id);
          if (unitMatch && path.length >= 2) {
            modelPath = path;
          }
        }

        if (modelPath && modelPath.length >= 2 && oldPos) {
          const startDist = Math.hypot(
            modelPath[0].x - oldPos.x,
            (modelPath[0].y ?? 0) - (oldPos.y ?? 0),
            modelPath[0].z - oldPos.z
          );
          const lastPt = modelPath[modelPath.length - 1];
          const endDist = Math.hypot(
            lastPt.x - newModelPos.x,
            (lastPt.y ?? 0) - (newModelPos.y ?? 0),
            lastPt.z - newModelPos.z
          );
          if (startDist <= 0.5 && endDist <= 0.5) {
            modelPath = [oldPos, ...modelPath.slice(1, -1), newModelPos];
          } else {
            modelPath = undefined;
          }
        } else {
          modelPath = undefined;
        }

        if (!modelPath) {
          modelPath = [oldPos ?? newModelPos, newModelPos];
        }

        modelTweenSpecs.push({
          modelId: model.id,
          modelMesh,
          path: modelPath,
          startPos: oldPos ?? newModelPos,
          endPos: newModelPos,
        });

        // Record updated position for next sync
        this.prevModelPositions.set(model.id, { ...newModelPos });

        // Update rotation
        if (isSquad) {
          const mRot = model.rotation ?? unit.rotation;
          modelMesh.rotation.set(mRot.x ?? 0, mRot.y ?? 0, mRot.z ?? 0);
        } else {
          modelMesh.rotation.set(0, 0, 0);
        }
      }

      if (isSquad) {
        unitRoot.rotation.set(0, 0, 0);
      } else {
        unitRoot.rotation.set(unit.rotation.x, unit.rotation.y, unit.rotation.z);
      }

      if (shouldTweenUnit) {
        // Start movement tween at 0%
        if (isSquad) {
          let sumX = 0;
          let sumY = 0;
          let sumZ = 0;
          for (const m of modelTweenSpecs) {
            sumX += m.startPos.x;
            sumY += (m.startPos.y ?? 0);
            sumZ += m.startPos.z;
          }
          const startCentroid = {
            x: sumX / modelTweenSpecs.length,
            y: sumY / modelTweenSpecs.length,
            z: sumZ / modelTweenSpecs.length,
          };
          unitRoot.position.set(startCentroid.x, startCentroid.y, startCentroid.z);
          for (const m of modelTweenSpecs) {
            m.modelMesh.position.set(
              m.startPos.x - startCentroid.x,
              (m.startPos.y ?? 0) - startCentroid.y,
              m.startPos.z - startCentroid.z
            );
          }
        } else {
          const m = modelTweenSpecs[0];
          unitRoot.position.set(m.startPos.x, m.startPos.y ?? 0, m.startPos.z);
          m.modelMesh.position.set(0, 0, 0);
        }

        this.activeMovementTweens.push({
          unitId: unit.id,
          unitRoot,
          isSquad,
          models: modelTweenSpecs,
          targetUnitPosition: { x: unit.position.x, y: unit.position.y ?? 0, z: unit.position.z },
          elapsed: 0,
          duration: MOVEMENT_DURATION_SECONDS,
        });
      } else {
        // Instant snap
        unitRoot.position.set(unit.position.x, unit.position.y, unit.position.z);
        for (const model of activeModels) {
          const modelMesh = modelMeshes.get(model.id)!;
          const modelPos = model.position ?? unit.position;
          const localX = isSquad ? modelPos.x - unit.position.x : 0;
          const localY = isSquad ? (modelPos.y ?? 0) - (unit.position.y ?? 0) : 0;
          const localZ = isSquad ? modelPos.z - unit.position.z : 0;
          modelMesh.position.set(localX, localY, localZ);
        }
      }

      // Check for removed models in this squad
      for (const [mId, mMesh] of modelMeshes) {
        if (!activeModelIds.has(mId)) {
          modelMeshes.delete(mId);
          this.prevModelPositions.delete(mId);
          this.prevModelWounds.delete(mId);
          if (!this.isReducedMotion()) {
            this.startCasualtyAnimation(mMesh);
          } else {
            unitRoot.remove(mMesh);
            disposeObject3D(mMesh);
          }
        }
      }

      // Owner colors applied
      this.applyOwnerColor(unitRoot, unit.ownerId, state, unit.id);

      // Hit flashes (wounds increased)
      for (const model of activeModels) {
        const currentWounds = model.wounds ?? (isSquad ? 0 : unit.wounds);
        const prevWounds = this.prevModelWounds.get(model.id);
        if (prevWounds !== undefined && currentWounds > prevWounds && !this.isReducedMotion()) {
          const mMesh = modelMeshes.get(model.id);
          if (mMesh) {
            this.startHitFlash(mMesh, unit.id);
          }
        }
        this.prevModelWounds.set(model.id, currentWounds);
      }
    }

    // Check for units that disappeared from state
    for (const [unitId, mesh] of this.meshes) {
      if (!visibleIds.has(unitId)) {
        this.meshes.delete(unitId);
        // Remove from prev caches
        for (const key of Array.from(this.prevModelPositions.keys())) {
          if (key.startsWith(unitId)) this.prevModelPositions.delete(key);
        }
        for (const key of Array.from(this.prevModelWounds.keys())) {
          if (key.startsWith(unitId)) this.prevModelWounds.delete(key);
        }

        if (!this.isReducedMotion()) {
          this.startCasualtyAnimation(mesh);
        } else {
          this.unitGroup.remove(mesh);
          disposeObject3D(mesh);
        }
      }
    }
  }

  private startCasualtyAnimation(mesh: THREE.Object3D): void {
    mesh.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    const worldQuat = new THREE.Quaternion();
    mesh.getWorldQuaternion(worldQuat);

    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }

    // Clone materials for opacity fade
    mesh.traverse((child) => {
      const node = child as THREE.Mesh;
      if (node.isMesh && node.material) {
        if (Array.isArray(node.material)) {
          node.material = node.material.map((m) => m.clone());
        } else {
          node.material = node.material.clone();
        }
      }
    });

    mesh.position.copy(worldPos);
    mesh.quaternion.copy(worldQuat);
    this.casualtiesGroup.add(mesh);

    this.activeCasualties.push({
      mesh,
      startY: worldPos.y,
      elapsed: 0,
      duration: CASUALTY_DURATION_SECONDS,
    });
  }

  private startHitFlash(mesh: THREE.Object3D, unitId: string): void {
    const hitMaterials: ActiveHitFlash['materials'] = [];
    mesh.traverse((child) => {
      const node = child as THREE.Mesh;
      if (!node.isMesh) return;
      const mat = node.material as (THREE.MeshStandardMaterial | THREE.MeshBasicMaterial) | undefined;
      if (!mat || !mat.color) return;

      const entry: ActiveHitFlash['materials'][0] = { material: mat };
      entry.originalColor = mat.color.clone();
      mat.color.setHex(HIT_FLASH_COLOR);

      if ((mat as any).emissive) {
        entry.originalEmissive = (mat as any).emissive.clone();
        (mat as any).emissive.setHex(0xaa1111);
      }
      hitMaterials.push(entry);
    });

    if (hitMaterials.length > 0) {
      this.activeHitFlashes.push({
        mesh,
        unitId,
        materials: hitMaterials,
        elapsed: 0,
        duration: HIT_FLASH_DURATION_SECONDS,
      });
    }
  }

  clear(): void {
    this.snapAllTweensToEnd();

    for (const [unitId, mesh] of this.meshes) {
      this.unitGroup.remove(mesh);
      disposeObject3D(mesh);
      this.meshes.delete(unitId);
    }

    while (this.casualtiesGroup.children.length > 0) {
      const child = this.casualtiesGroup.children[0];
      this.casualtiesGroup.remove(child);
      disposeObject3D(child);
    }

    this.activeMovementTweens = [];
    this.activeCasualties = [];
    this.activeHitFlashes = [];
    this.prevModelPositions.clear();
    this.prevModelWounds.clear();
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
