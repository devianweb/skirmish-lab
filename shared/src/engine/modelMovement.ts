import { Model, Unit } from '../gameTypes';

/**
 * Per-model movement budgets for split moves, rushes and charges of a squad.
 *
 * `unit.modelMovementSpent` keeps what each model has walked this action. `unit.remainingMovement` is the
 * most any living model can still walk (budget minus the smallest spend), so a squad-mate that walked
 * further never costs another model its own distance.
 */

function livingOf(unit: Unit): Model[] {
  return (unit.models ?? []).filter((m) => !m.isDestroyed);
}

/** The smallest distance any living model has spent (0 when no tally exists). */
function smallestSpent(unit: Unit): number {
  const spent = unit.modelMovementSpent;
  const living = livingOf(unit);
  if (!spent || living.length === 0) return 0;
  return Math.min(...living.map((m) => spent[m.id] ?? 0));
}

/**
 * What one model can still walk. `unitRemaining` is the unit-level figure the action works from (the
 * unit's `remainingMovement`, or the full budget when the action has not started yet).
 */
export function modelRemainingMovement(unit: Unit, model: Model, unitRemaining: number): number {
  const ahead = (unit.modelMovementSpent?.[model.id] ?? 0) - smallestSpent(unit);
  return Math.max(0, Math.round((unitRemaining - ahead) * 100) / 100);
}

/**
 * Add each living model's cost for this leg to its own tally and return the new unit-level remaining
 * distance (`unitRemaining` minus how far the smallest spend grew). Only squads (more than one living
 * model) keep a tally; a single model returns the plain `unitRemaining - cost`.
 */
export function spendModelMovement(unit: Unit, unitRemaining: number, costs: number[]): number {
  const living = livingOf(unit);
  if (living.length <= 1) {
    const cost = costs.length > 0 ? Math.max(...costs) : 0;
    return Math.max(0, Math.round((unitRemaining - cost) * 100) / 100);
  }
  const before = smallestSpent(unit);
  const spent = { ...(unit.modelMovementSpent ?? {}) };
  living.forEach((m, i) => {
    spent[m.id] = Math.round(((spent[m.id] ?? 0) + (costs[i] ?? 0)) * 100) / 100;
  });
  unit.modelMovementSpent = spent;
  const grew = smallestSpent(unit) - before;
  return Math.max(0, Math.round((unitRemaining - grew) * 100) / 100);
}

/** Whole-unit move (no per-model paths): every living model walked the same distance. */
export function spendAllModels(unit: Unit, cost: number): void {
  if (!unit.modelMovementSpent) return;
  const spent = { ...unit.modelMovementSpent };
  for (const m of livingOf(unit)) spent[m.id] = Math.round(((spent[m.id] ?? 0) + cost) * 100) / 100;
  unit.modelMovementSpent = spent;
}

/** Forget the per-model tally (new activation, new charge, charge finished). */
export function resetModelMovement(unit: Unit): void {
  delete unit.modelMovementSpent;
}
