import { GameState, MAX_ROUNDS, Unit } from '../gameTypes';

/** Unit and model losses for one side. */
export interface SideLosses {
  /** Units destroyed or routed. */
  unitsLost: number;
  unitsTotal: number;
  /** Models destroyed (a routed unit's surviving models are not counted). */
  modelsLost: number;
  modelsTotal: number;
}

/** Plain, JSON-serializable snapshot of how a match stands or ended. Keys of the maps are player ids. */
export interface MatchSummary {
  /** Absent for a draw or while the match is still running. */
  winnerId?: string;
  endReason?: string;
  /** Rounds started so far (0 before the first activation round), capped at the match length. */
  roundsPlayed: number;
  /** Objectives currently held per player. */
  objectiveScore: Record<string, number>;
  losses: Record<string, SideLosses>;
}

function modelCounts(unit: Unit): { total: number; lost: number } {
  if (!unit.models || unit.models.length === 0) {
    return { total: 1, lost: unit.isDestroyed ? 1 : 0 };
  }
  return {
    total: unit.models.length,
    lost: unit.models.filter((m) => m.isDestroyed).length,
  };
}

function sideLosses(state: GameState, playerId: string): SideLosses {
  const losses: SideLosses = { unitsLost: 0, unitsTotal: 0, modelsLost: 0, modelsTotal: 0 };
  for (const unit of state.units) {
    if (unit.ownerId !== playerId) continue;
    losses.unitsTotal += 1;
    if (unit.isDestroyed || unit.status.includes('routed')) losses.unitsLost += 1;
    const m = modelCounts(unit);
    losses.modelsTotal += m.total;
    losses.modelsLost += m.lost;
  }
  return losses;
}

/** Pure summary of the match for the results screen. Does not mutate `state`. */
export function summarizeMatch(state: GameState): MatchSummary {
  const phase = state.turnState.phase;
  // A concede during deployment flips the phase to game-over, so an unfinished deployment also counts as "not started".
  const notStarted =
    phase === 'setup' ||
    phase === 'deployment' ||
    (state.status === 'game-over' && state.units.some((u) => !u.isDestroyed && u.isDeployed === false));
  const roundsPlayed = notStarted ? 0 : Math.min(MAX_ROUNDS, Math.max(0, state.turnState.roundNumber));
  const objectives = state.objectives ?? [];
  const score = (id: string) => objectives.filter((o) => o.controllingPlayerId === id).length;

  const summary: MatchSummary = {
    roundsPlayed,
    objectiveScore: { [state.hostId]: score(state.hostId), [state.guestId]: score(state.guestId) },
    losses: { [state.hostId]: sideLosses(state, state.hostId), [state.guestId]: sideLosses(state, state.guestId) },
  };
  if (state.winner) summary.winnerId = state.winner;
  if (state.endReason) summary.endReason = state.endReason;
  return summary;
}
