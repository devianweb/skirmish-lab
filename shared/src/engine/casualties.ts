import { GameState, Model, PendingReaction, Unit } from '../gameTypes';
import { DiceResult } from '../types';
import { coherencyShortfall } from './spatial';

/**
 * Wounds assigned by the unit's owner. When an attack's wounds would remove models from a unit that
 * survives (two or more living models), the host leaves the unit untouched and sets a `pick-casualties`
 * reaction for the unit's owner. The wounds are replayed on the unit once the owner has named the models to remove, or the host named them on timeout.
 */

/** Reaction choice that lets the host pick the models itself (the timeout default). */
export const PICK_CASUALTIES_AUTO_CHOICE = 'auto-pick-casualties';
/** How long the owner has to pick. */
export const PICK_CASUALTIES_DURATION_MS = 30000;

/** One wound application on a unit, exactly the arguments the wound step takes (plain data). */
export interface WoundApplication {
  wounds: number;
  deadlyValue: number;
}

/** A unit waiting for its owner's pick, with every wound application to replay on it. */
export interface CasualtyEntry {
  unitId: string;
  /** Unhurt models the owner must pick, in the order they take wounds. */
  count: number;
  applications: WoundApplication[];
  /** Already-wounded living models that take wounds first, in order (empty when none). */
  lockedModelIds: string[];
  /** How many models the attack removes in total (locked and picked). */
  removed: number;
}

/** What the host does once the last pick of the interrupted action is in. */
export type CasualtyContinuation =
  | { kind: 'shoot'; attackerId: string }
  | { kind: 'fight'; attackerId: string; targetId: string }
  | { kind: 'charge-strike'; attackerId: string; targetId: string; weaponId?: string; counterStruck?: boolean }
  /**
   * A charge exchange that paused for a pick (Impact casualties before the Counter strikes, Counter casualties
   * before the charger strikes). `dice` are the charge's full server-rolled dice (an upper bound: later parts
   * use only what the survivors need); `stage` is the part to resolve next.
   */
  | {
      kind: 'charge-resume';
      stage: 'counter' | 'strike';
      attackerId: string;
      targetId: string;
      weaponId: string;
      chargeDistance: number;
      dice: DiceResult[];
      counterStruck?: boolean;
    }
  | { kind: 'strike-back'; attackerId: string; targetId: string }
  /**
   * The activation test in dangerous terrain. `attackerId` is the tested unit. A unit that activated by a
   * one-action `hold` finishes its activation after the pick, using the dice that action rolled.
   */
  | { kind: 'activation-hazard'; attackerId: string; finish?: { dice: DiceResult[] } };

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

const isUnhurt = (m: Model) => m.wounds >= m.maxWounds;

/** Living wounded models in the order they take wounds: most wounds taken first, ties by place in the list. */
export function lockedWoundedModels(unit: Unit): Model[] {
  const wounded = living(unit)
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !isUnhurt(m));
  wounded.sort((a, b) => b.m.maxWounds - b.m.wounds - (a.m.maxWounds - a.m.wounds) || a.i - b.i);
  return wounded.map(({ m }) => m);
}

export interface WoundAllocation {
  /** Times the wounds had to start on an unhurt model. */
  unhurtStarts: number;
  /** Unhurt living models at the first such moment (0 when it never happened). */
  unhurtAtFirstStart: number;
}

/**
 * Put `wounds` on `models` (mutated) in the tabletop order. A model keeps taking wounds until it is removed.
 * When a new model has to start: the living wounded model with the most wounds taken (ties by list order),
 * else the next usable id of `picks` (consumed; ids that are dead or already wounded are skipped), else the
 * first living model. With `stopWithoutPick`, the allocation ends instead of using the first-living fallback,
 * leaving the wounds that need a pick unassigned. Deadly(X) wounds come in chunks of X on one model: what is
 * left of a chunk once the model dies is lost.
 */
export function allocateWounds(
  models: Model[],
  wounds: number,
  deadlyValue: number,
  picks: string[],
  options: { stopWithoutPick?: boolean } = {}
): WoundAllocation {
  const stats: WoundAllocation = { unhurtStarts: 0, unhurtAtFirstStart: 0 };
  const step = Math.max(1, deadlyValue);
  let remaining = wounds;
  let victim: Model | undefined;
  while (remaining > 0) {
    const alive = models.filter((m) => !m.isDestroyed);
    if (alive.length === 0) break;
    if (!victim || victim.isDestroyed) {
      const wounded = alive
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => !isUnhurt(m))
        .sort((a, b) => b.m.maxWounds - b.m.wounds - (a.m.maxWounds - a.m.wounds) || a.i - b.i);
      if (wounded.length > 0) {
        victim = wounded[0].m;
      } else {
        let picked: Model | undefined;
        while (!picked && picks.length > 0) {
          const id = picks.shift();
          picked = alive.find((m) => m.id === id);
        }
        if (!picked && options.stopWithoutPick) break;
        if (stats.unhurtStarts === 0) stats.unhurtAtFirstStart = alive.length;
        stats.unhurtStarts++;
        victim = picked ?? alive[0];
      }
    }
    const chunk = Math.min(remaining, step);
    victim.wounds = Math.max(0, victim.wounds - chunk);
    remaining -= chunk;
    if (victim.wounds <= 0) victim.isDestroyed = true;
  }
  return stats;
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
  const tough = living(unit).some((m) => m.maxWounds > 1);
  const locked = (data.entry.lockedModelIds ?? []).length > 0;
  const title = tough ? 'Assign Wounds' : 'Remove Casualties';
  const description = tough
    ? `${unit.name} took wounds: ${locked ? 'the wounded model takes them first. Then ' : ''}pick ${count} model${count === 1 ? '' : 's'} in order. Each takes wounds until it is removed; the last one may survive wounded.`
    : `${unit.name} lost ${count} model${count === 1 ? '' : 's'}: choose which ${count === 1 ? 'one is' : 'ones are'} removed.`;
  return {
    id: `${actionId}-pick-casualties-${index}`,
    type: 'pick-casualties',
    promptingPlayerId: unit.ownerId,
    sourceUnitId: sourceUnit.id,
    targetUnitId: unit.id,
    title,
    description,
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
    if (!isUnhurt(alive.find((m) => m.id === id)!)) {
      return { valid: false, reason: `Model ${id} is already wounded: it takes wounds first` };
    }
  }
  return { valid: true };
}

/** What the wounds do to one model: wounds left and whether it is removed. */
export interface CasualtyPreviewEntry {
  modelId: string;
  wounds: number;
  destroyed: boolean;
}

/**
 * Where the wounds land, in the order models take them: the locked (already wounded) models, then the picked
 * ones. `modelIds` may be a partial list: wounds that need a pick not yet made stay unassigned. The unit is
 * not changed.
 */
export function previewCasualtyPick(unit: Unit, entry: CasualtyEntry, modelIds: string[]): CasualtyPreviewEntry[] {
  const models = (JSON.parse(JSON.stringify(unit.models ?? [])) as Model[]);
  const picks = [...modelIds];
  for (const app of entry.applications) {
    allocateWounds(models, app.wounds, app.deadlyValue, picks, { stopWithoutPick: true });
  }
  const out: CasualtyPreviewEntry[] = [];
  for (const id of [...(entry.lockedModelIds ?? []), ...modelIds]) {
    const m = models.find((x) => x.id === id);
    if (m && !out.some((o) => o.modelId === id)) out.push({ modelId: id, wounds: m.wounds, destroyed: m.isDestroyed });
  }
  return out;
}

/**
 * The host's own pick (used when the owner runs out of time): one model at a time, the one whose removal
 * leaves the squad closest to coherent (a connected chain within the spread; zero shortfall = still coherent),
 * ties going to list order. Deterministic. Given an entry, only unhurt models are picked and the squad starts
 * without the locked models that die; each pick counts as a removal. A bare count picks among all living models.
 */
export function autoPickCasualties(unit: Unit, countOrEntry: number | CasualtyEntry): string[] {
  const entry = typeof countOrEntry === 'number' ? undefined : countOrEntry;
  const count = entry ? entry.count : (countOrEntry as number);
  const gone = new Set<string>();
  if (entry) {
    for (const p of previewCasualtyPick(unit, entry, [])) if (p.destroyed) gone.add(p.modelId);
  }
  const remaining = living(unit)
    .filter((m) => !gone.has(m.id))
    .map((m) => ({ id: m.id, p: m.position ?? unit.position, ok: !entry || isUnhurt(m) }));
  const picked: string[] = [];
  for (let k = 0; k < count && remaining.length > 1; k++) {
    let best = -1;
    let bestShortfall = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      if (!remaining[i].ok) continue;
      const shortfall = coherencyShortfall(remaining.filter((_, j) => j !== i).map((m) => m.p));
      if (shortfall < bestShortfall - 1e-6) {
        bestShortfall = shortfall;
        best = i;
      }
    }
    if (best < 0) break;
    picked.push(remaining[best].id);
    remaining.splice(best, 1);
  }
  return picked;
}
