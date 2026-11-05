import type { Vector3 } from '../types';
import type { GameState, Unit, Weapon } from '../gameTypes';
import { hasTrait } from '../rules/traits';
import {
  computeShootingRayDebug,
  findCoverSource,
  traceLineOfSight,
  type ShootingRayDebugInfo,
} from './spatial';
import { EYE_HEIGHT } from './terrainStructure';
import { baseRadius, centreDistance, closestModelPair, livingModelPositions, modelGap } from './unitGeometry';

/**
 * Per-model shooting (squads). Kept apart from `unitGeometry` because it needs line of sight and
 * cover from `spatial`, which itself imports `unitGeometry` (pure measuring stays a leaf module).
 */

/** A single model standing in for its unit when tracing sight lines (same id, status and rules). */
function modelAsUnit(unit: Unit, position: Vector3): Unit {
  return { ...unit, position };
}

export interface FiringModel {
  position: Vector3;
}

/**
 * Attacker models that can fire `weapon` at `target`: the model sees at least one living target model
 * (3D line of sight from its eye; own squad-mates never block, other units' models do) and that same
 * target model is within the weapon's range by base-edge gap. Lobbed weapons need range only.
 * A target is valid when this list is non-empty; its length is the number of models whose attacks count.
 */
export function firingModels(state: GameState, attacker: Unit, target: Unit, weapon: Weapon): FiringModel[] {
  const range = weapon.profile.range;
  const lobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
  const rA = baseRadius(attacker);
  const rT = baseRadius(target);
  const targetModels = livingModelPositions(target);
  const result: FiringModel[] = [];
  for (const from of livingModelPositions(attacker)) {
    const shooter = modelAsUnit(attacker, from);
    const canFire = targetModels.some((to) => {
      if (modelGap(from, to, rA, rT) > range + 0.01) return false;
      if (lobbed) return true;
      return traceLineOfSight(state, shooter, modelAsUnit(target, to)).clear;
    });
    if (canFire) result.push({ position: from });
  }
  return result;
}

/** How many living target models are individually in cover, each judged against the nearest firing model. */
export function coveredTargetModelCount(
  state: GameState,
  firing: FiringModel[],
  attacker: Unit,
  target: Unit
): number {
  const shooters = firing.length > 0 ? firing.map((f) => f.position) : [attacker.position];
  let covered = 0;
  for (const to of livingModelPositions(target)) {
    let nearest = shooters[0];
    for (const s of shooters) {
      if (centreDistance(s, to) < centreDistance(nearest, to)) nearest = s;
    }
    if (findCoverSource(state, modelAsUnit(attacker, nearest), modelAsUnit(target, to)) !== null) covered++;
  }
  return covered;
}

/**
 * Cover for a squad target: it gets cover only when a strict majority of its living models are
 * individually in cover, each judged against the nearest firing model. A single-model target is
 * judged on its own (as before). With no firing models the attacker's anchor stands in.
 */
export function targetCoverByMajority(
  state: GameState,
  firing: FiringModel[],
  attacker: Unit,
  target: Unit
): boolean {
  return coveredTargetModelCount(state, firing, attacker, target) * 2 > livingModelPositions(target).length;
}

/** One attacker model's aim: eye-level segment to the target model it shoots at (or would, if it could). */
export interface ModelAim {
  /** Attacker model position on the ground. */
  shooter: Vector3;
  /** Its nearest visible in-range target model, or the nearest target model when none is visible. */
  targetModel: Vector3;
  /** Eye-level start and end of the ray. */
  from: Vector3;
  to: Vector3;
  fires: boolean;
}

export interface SquadAim {
  aims: ModelAim[];
  firingCount: number;
  shooterCount: number;
  targetModelCount: number;
  coveredModelCount: number;
  /** Cover applies (more than half the target models are in cover). */
  coverByMajority: boolean;
  /** The picked target model's position, only when at least one firing model sees it in range. */
  aimedModel?: Vector3;
}

const eye = (p: Vector3): Vector3 => ({ x: p.x, y: (p.y ?? 0) + EYE_HEIGHT, z: p.z });

/**
 * Per-model aiming for the targeting preview and the F9 debugger: for each living attacker model, the
 * target model it shoots at. Same range and sight rules as `firingModels`. `aimedModelId` is the target
 * model the player pointed at; it is reported only when a firing model can actually see it.
 */
export function squadAim(
  state: GameState,
  attacker: Unit,
  target: Unit,
  weapon: Weapon,
  aimedModelId?: string
): SquadAim {
  const range = weapon.profile.range;
  const lobbed = hasTrait(weapon.profile.specialRules, 'lobbed');
  const rA = baseRadius(attacker);
  const rT = baseRadius(target);
  const targetModels = livingModelPositions(target);
  const sees = (from: Vector3, to: Vector3): boolean => {
    if (modelGap(from, to, rA, rT) > range + 0.01) return false;
    if (lobbed) return true;
    return traceLineOfSight(state, modelAsUnit(attacker, from), modelAsUnit(target, to)).clear;
  };

  const picked = aimedModelId ? target.models?.find((m) => m.id === aimedModelId && !m.isDestroyed) : undefined;
  const pickedPos = picked ? picked.position ?? target.position : undefined;

  const aims: ModelAim[] = [];
  const firing: FiringModel[] = [];
  for (const shooter of livingModelPositions(attacker)) {
    const byDistance = [...targetModels].sort((a, b) => centreDistance(shooter, a) - centreDistance(shooter, b));
    // Preview only: aim at the clicked model when this shooter sees it in range, else the nearest visible.
    const visible = pickedPos && sees(shooter, pickedPos) ? pickedPos : byDistance.find((to) => sees(shooter, to));
    const targetModel = visible ?? byDistance[0];
    if (visible) firing.push({ position: shooter });
    aims.push({ shooter, targetModel, from: eye(shooter), to: eye(targetModel), fires: !!visible });
  }

  const coveredModelCount = coveredTargetModelCount(state, firing, attacker, target);
  const aimedModel = pickedPos && firing.some((f) => sees(f.position, pickedPos)) ? { ...pickedPos } : undefined;

  return {
    aims,
    firingCount: firing.length,
    shooterCount: aims.length,
    targetModelCount: targetModels.length,
    coveredModelCount,
    coverByMajority: coveredModelCount * 2 > targetModels.length,
    ...(aimedModel ? { aimedModel } : {}),
  };
}

/**
 * F9 shooting-ray debug for unit-vs-unit shooting: the detailed card (terrain crossings, flank rays) is
 * traced between the closest pair of models, plus one eye-level ray per attacker model. Line of sight and
 * cover follow the squad rules (any model can fire; cover needs more than half the target models) rather
 * than the closest pair alone.
 */
export function computeSquadShootingRayDebug(
  state: GameState,
  attacker: Unit,
  target: Unit,
  weapon: Weapon
): ShootingRayDebugInfo {
  const pair = closestModelPair(attacker, target);
  const base = computeShootingRayDebug(
    state,
    pair ? modelAsUnit(attacker, pair.from) : attacker,
    pair ? modelAsUnit(target, pair.to) : target
  );
  const aim = squadAim(state, attacker, target, weapon);
  const isSquad = aim.shooterCount > 1 || aim.targetModelCount > 1;
  return {
    ...base,
    attackerId: attacker.id,
    targetId: target.id,
    hasLineOfSight: isSquad ? aim.firingCount > 0 : base.hasLineOfSight,
    providesCover: isSquad ? aim.coverByMajority : base.providesCover,
    coverReason: isSquad
      ? `${aim.coveredModelCount}/${aim.targetModelCount} target models in cover (more than half needed)`
      : base.coverReason,
    modelRays: aim.aims.map((a) => ({ from: a.from, to: a.to, fires: a.fires })),
    firingCount: aim.firingCount,
    shooterCount: aim.shooterCount,
    targetModelCount: aim.targetModelCount,
    coveredModelCount: aim.coveredModelCount,
  };
}
