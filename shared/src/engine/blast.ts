import type { GameState, Unit } from '../gameTypes';
import { autoSplitBlastHits, type BlastCandidate } from './combat';
import { gateDistance } from '../rules/traits';
import { traitGateApplies } from './distanceGates';
import { livingModelPositions, unitDistance } from './unitGeometry';

/** Enemy units with a model this close (base edge to base edge) to the target share in a Blast. */
export const BLAST_SPREAD_RANGE = gateDistance('blast', 'blast-spread');

export interface BlastParticipant {
  unit: Unit;
  /** Living models: the most Blast hits the unit can take. */
  cap: number;
}

/**
 * The units a Blast shot aimed at `target` can hit, in priority order: the target first, then every other
 * enemy unit of the attacker with a model within 3" of any model of the target, nearest to farthest
 * (state order breaks ties). Destroyed, routed and undeployed units are skipped.
 */
export function getBlastParticipants(state: GameState, attacker: Unit, target: Unit): BlastParticipant[] {
  const alive = (u: Unit) => livingModelPositions(u).length > 0 && !u.isDestroyed;
  const capOf = (u: Unit) =>
    Math.max(1, (u.models ?? []).filter((m) => !m.isDestroyed).length || 1);
  const others = state.units
    .filter(
      (u) =>
        u.id !== target.id &&
        u.ownerId !== attacker.ownerId &&
        alive(u) &&
        !u.status.includes('routed') &&
        u.isDeployed !== false
    )
    .map((u) => ({ unit: u, gap: unitDistance(target, u) }))
    .filter((e) => traitGateApplies('blast', 'blast-spread', e.gap))
    .sort((a, b) => a.gap - b.gap);
  return [target, ...others.map((e) => e.unit)].map((unit) => ({ unit, cap: capOf(unit) }));
}

/** Auto split of `totalHits` over the participants (see `autoSplitBlastHits`); same order as `participants`. */
export function autoSplitForParticipants(totalHits: number, participants: BlastParticipant[]): number[] {
  const candidates: BlastCandidate[] = participants.map((p) => ({ unitId: p.unit.id, cap: p.cap }));
  return autoSplitBlastHits(totalHits, candidates);
}
