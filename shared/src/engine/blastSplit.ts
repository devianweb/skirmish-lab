import type { GameAction, GameState, PendingReaction } from '../gameTypes';
import type { DiceResult } from '../types';

/**
 * Blast split prompt. When a Blast shot has more than one eligible unit (the aimed-at target plus enemy units
 * within the spread), the host pauses before resolving it and the defending player chooses how the hits are
 * shared out. Any split is allowed as long as no unit takes more hits than it has living models and every hit
 * that can be assigned is assigned ("as even as possible" is only what the Auto split does). The shot's dice
 * are already rolled and travel in the reaction data, so the shot resolves with them once the choice is in.
 * A shot with several Blast weapons gets one combined prompt: one split per weapon.
 */

/** Reaction choice that lets the host split the hits itself (the timeout default). */
export const BLAST_SPLIT_AUTO_CHOICE = 'auto-blast-split';
/** How long the defender has to choose. */
export const BLAST_SPLIT_DURATION_MS = 30000;

/** One Blast weapon of the shot that needs a split. */
export interface BlastSplitPrompt {
  /** Index of the weapon allocation within the shoot action. */
  allocIndex: number;
  weaponId: string;
  weaponName: string;
  /** Hits to share out (to-hit successes and bonus hits, times X). */
  totalHits: number;
  /** The eligible units, the aimed-at target first. `cap` is the most hits the unit can take (living models). */
  participants: { unitId: string; unitName: string; cap: number }[];
  /** The host's Auto split, same order as `participants`. */
  auto: number[];
}

/** Reaction data of a `blast-split` prompt (plain serializable data). */
export interface BlastSplitData {
  /** The interrupted shoot action; it resolves again with the chosen split. */
  shoot: GameAction;
  /** The shoot action's server-rolled dice. */
  dice: DiceResult[];
  /** One entry per Blast weapon that needs a split, in resolution order. */
  blasts: BlastSplitPrompt[];
}

export interface BlastSplitPayload {
  /** One row per entry of the prompt's `blasts`, one count per participant. */
  splits?: number[][];
}

export type BlastSplitResult = { valid: true } | { valid: false; reason: string };

/** The most hits that can be assigned: all of them, or as many as the units' caps allow. */
export function assignableBlastHits(prompt: Pick<BlastSplitPrompt, 'totalHits' | 'participants'>): number {
  return Math.min(
    prompt.totalHits,
    prompt.participants.reduce((sum, p) => sum + p.cap, 0)
  );
}

/** Host check of a split for one weapon: whole numbers within each unit's cap that assign every assignable hit. */
export function validateBlastRow(prompt: BlastSplitPrompt, row: unknown): BlastSplitResult {
  if (!Array.isArray(row) || row.length !== prompt.participants.length) {
    return { valid: false, reason: `Give one count for each unit hit by ${prompt.weaponName}` };
  }
  let sum = 0;
  for (let i = 0; i < row.length; i++) {
    const n = row[i];
    const p = prompt.participants[i];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      return { valid: false, reason: 'Hits must be whole numbers, zero or more' };
    }
    if (n > p.cap) {
      return { valid: false, reason: `${p.unitName} can take at most ${p.cap} hit${p.cap === 1 ? '' : 's'} (one per model)` };
    }
    sum += n;
  }
  const required = assignableBlastHits(prompt);
  if (sum !== required) {
    return { valid: false, reason: `Assign all ${required} hit${required === 1 ? '' : 's'} (got ${sum})` };
  }
  return { valid: true };
}

/** Host check of a Blast split from the prompted defender. */
export function validateBlastSplit(
  _state: GameState,
  pending: PendingReaction,
  actorId: string,
  payload: BlastSplitPayload
): BlastSplitResult {
  if (pending.type !== 'blast-split') return { valid: false, reason: 'No pending Blast split' };
  if (pending.promptingPlayerId !== actorId) return { valid: false, reason: 'Not your Blast split' };
  const data = pending.data as unknown as BlastSplitData;
  if (!Array.isArray(payload.splits) || payload.splits.length !== data.blasts.length) {
    return { valid: false, reason: 'Give a split for each Blast weapon' };
  }
  for (let i = 0; i < data.blasts.length; i++) {
    const row = validateBlastRow(data.blasts[i], payload.splits[i]);
    if (!row.valid) return row;
  }
  return { valid: true };
}

export function createBlastSplitReaction(
  actionId: string,
  defenderId: string,
  sourceUnitId: string,
  targetUnitId: string,
  data: BlastSplitData
): PendingReaction {
  const names = data.blasts.map((b) => b.weaponName).join(', ');
  return {
    id: `${actionId}-blast-split`,
    type: 'blast-split',
    promptingPlayerId: defenderId,
    sourceUnitId,
    targetUnitId,
    title: 'Split Blast Hits',
    description: `${names} hits more than one of your units: choose how the hits are shared out.`,
    options: [{ id: BLAST_SPLIT_AUTO_CHOICE, label: 'Auto split', isDefault: true, style: 'primary' }],
    expiresAt: Date.now() + BLAST_SPLIT_DURATION_MS,
    durationMs: BLAST_SPLIT_DURATION_MS,
    data: data as unknown as Record<string, any>,
  };
}
