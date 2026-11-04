import type { Vector3 } from '../types';
import type { GameState, Unit, Weapon } from '../gameTypes';
import { hasTrait } from '../rules/traits';
import { findCoverSource, traceLineOfSight } from './spatial';
import { baseRadius, centreDistance, livingModelPositions, modelGap } from './unitGeometry';

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
  const targetModels = livingModelPositions(target);
  const shooters = firing.length > 0 ? firing.map((f) => f.position) : [attacker.position];
  let covered = 0;
  for (const to of targetModels) {
    let nearest = shooters[0];
    for (const s of shooters) {
      if (centreDistance(s, to) < centreDistance(nearest, to)) nearest = s;
    }
    if (findCoverSource(state, modelAsUnit(attacker, nearest), modelAsUnit(target, to)) !== null) covered++;
  }
  return covered * 2 > targetModels.length;
}
