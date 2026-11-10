import { GameState, PendingReaction, Unit } from '../gameTypes';
import { coherencyShortfall } from './spatial';

/**
 * Casualties picked by the unit's owner. When an attack's wounds would remove models from a unit that
 * survives (two or more living models), the host leaves the unit untouched and sets a `pick-casualties`
 * reaction for the unit's owner. The wounds (and the pre-rolled wound-effect roll for the last model) are
 * replayed on the unit once the owner has named the models to remove, or the host named them on timeout.
 */

/** Reaction choice that lets the host pick the models itself (the timeout default). */
export const PICK_CASUALTIES_AUTO_CHOICE = 'auto-pick-casualties';
/** How long the owner has to pick. */
export const PICK_CASUALTIES_DURATION_MS = 30000;

/** One wound application on a unit, exactly the arguments the wound step takes (plain data). */
export interface WoundApplication {
  wounds: number;
  traumaRolls?: number[];
  fearBonus: number;
  deadlyValue: number;
}

/** A unit waiting for its owner's pick, with every wound application to replay on it. */
export interface CasualtyEntry {
  unitId: string;
  /** Models the owner must remove. */
  count: number;
  /** Wounds that carry over to the surviving model once the picked models are gone (informational). */
  remainingWounds: number;
  applications: WoundApplication[];
}

/** What the host does once the last pick of the interrupted action is in. */
export type CasualtyContinuation =
  | { kind: 'shoot'; attackerId: string }
  | { kind: 'fight'; attackerId: string; targetId: string }
  | { kind: 'charge-strike'; attackerId: string; targetId: string; weaponId?: string }
  | { kind: 'strike-back'; attackerId: string; targetId: string };

export interface PickCasualtiesData {
  /** The action that interrupted the flow, and which prompt of its queue this is (0-based). */
  actionId: string;
  index: number;
  entry: CasualtyEntry;
  /** Further units of the same action that still need a pick, in resolution order. */
  rest: CasualtyEntry[];
  after: CasualtyContinuation;
}

export interface PickCasualtiesPayload {
  unitId?: string;
  modelIds?: string[];
}

export type PickResult = { valid: true } | { valid: false; reason: string };

function living(unit: Unit) {
  return (unit.models ?? []).filter((m) => !m.isDestroyed);
}

/** A deep copy of a unit, taken before wounds are applied so the unit can be put back. */
export function snapshotUnit(unit: Unit): Unit {
  return JSON.parse(JSON.stringify(unit)) as Unit;
}

/** Put `unit` back exactly as `snapshot` (in place, so other references to it stay valid). */
export function restoreUnit(unit: Unit, snapshot: Unit): void {
  const copy = JSON.parse(JSON.stringify(snapshot)) as Unit;
  for (const key of Object.keys(unit)) {
    if (!(key in copy)) delete (unit as unknown as Record<string, unknown>)[key];
  }
  Object.assign(unit, copy);
}

export function createPickCasualtiesReaction(
  actionId: string,
  index: number,
  unit: Unit,
  sourceUnit: Unit,
  data: Omit<PickCasualtiesData, 'actionId' | 'index'>
): PendingReaction {
  const { count } = data.entry;
  return {
    id: `${actionId}-pick-casualties-${index}`,
    type: 'pick-casualties',
    promptingPlayerId: unit.ownerId,
    sourceUnitId: sourceUnit.id,
    targetUnitId: unit.id,
    title: 'Remove Casualties',
    description: `${unit.name} lost ${count} model${count === 1 ? '' : 's'}: choose which ${count === 1 ? 'one is' : 'ones are'} removed.`,
    options: [
      {
        id: PICK_CASUALTIES_AUTO_CHOICE,
        label: 'Auto pick',
        isDefault: true,
        style: 'primary',
      },
    ],
    expiresAt: Date.now() + PICK_CASUALTIES_DURATION_MS,
    durationMs: PICK_CASUALTIES_DURATION_MS,
    data: { actionId, index, ...data } as unknown as Record<string, any>,
  };
}

/**
 * Host check of a casualty pick: from the prompted owner, naming exactly `count` distinct living models of
 * the damaged unit. Any living models may be picked (no coherency limit, sight does not matter).
 */
export function validatePickCasualties(
  state: GameState,
  pending: PendingReaction,
  actorId: string,
  payload: PickCasualtiesPayload
): PickResult {
  if (pending.type !== 'pick-casualties') return { valid: false, reason: 'No pending casualty pick' };
  if (pending.promptingPlayerId !== actorId) return { valid: false, reason: 'Not your casualties to pick' };
  const data = pending.data as unknown as PickCasualtiesData;
  const unit = state.units.find((u) => u.id === data.entry.unitId);
  if (!unit || unit.isDestroyed) return { valid: false, reason: 'The damaged unit is gone' };
  if (unit.ownerId !== actorId) return { valid: false, reason: 'Unit does not belong to acting player' };
  if (payload.unitId !== undefined && payload.unitId !== unit.id) {
    return { valid: false, reason: 'Picks are for another unit' };
  }
  const ids = payload.modelIds;
  if (!Array.isArray(ids)) return { valid: false, reason: 'A casualty pick must list modelIds' };
  if (ids.length !== data.entry.count) {
    return {
      valid: false,
      reason: `Pick exactly ${data.entry.count} model${data.entry.count === 1 ? '' : 's'} (got ${ids.length})`,
    };
  }
  if (new Set(ids).size !== ids.length) return { valid: false, reason: 'Casualty picks must be distinct models' };
  const alive = living(unit);
  for (const id of ids) {
    if (!alive.some((m) => m.id === id)) {
      return { valid: false, reason: `Model ${id} is not a living model of ${unit.name}` };
    }
  }
  return { valid: true };
}

/**
 * The host's own pick (used when the owner runs out of time): one model at a time, the one whose removal
 * leaves the squad closest to coherent (a connected chain within the spread; zero shortfall = still coherent),
 * ties going to list order. Deterministic.
 */
export function autoPickCasualties(unit: Unit, count: number): string[] {
  const remaining = living(unit).map((m) => ({ id: m.id, p: m.position ?? unit.position }));
  const picked: string[] = [];
  for (let k = 0; k < count && remaining.length > 1; k++) {
    let best = 0;
    let bestShortfall = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const shortfall = coherencyShortfall(remaining.filter((_, j) => j !== i).map((m) => m.p));
      if (shortfall < bestShortfall - 1e-6) {
        bestShortfall = shortfall;
        best = i;
      }
    }
    picked.push(remaining[best].id);
    remaining.splice(best, 1);
  }
  return picked;
}
