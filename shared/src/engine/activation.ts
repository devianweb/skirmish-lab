import { GameState, Unit } from '../gameTypes';

/**
 * Alternating-activation turn management (pure functions over GameState).
 *
 * Flow per round:
 *   1. The starting player activates one unit (activate-unit), acts with it
 *      (move / shoot / charge / fight), then ends the activation.
 *   2. The right to activate then passes to the other player.
 *   3. If one player has no unactivated units left, the other player
 *      activates their remaining units one after another.
 *   4. When every unit has activated, the round ends: activations reset and
 *      the new round starts with the other player as the starting player.
 *
 * A stunned unit may still be activated — spending the activation is what
 * clears the stun. Routed units cannot activate at all.
 */

/** Units a player may still activate this round: alive, not yet activated, not routed. */
export function getActivatableUnits(state: GameState, playerId: string): Unit[] {
  return state.units.filter(
    (u) => u.ownerId === playerId && !u.isDestroyed && !u.isActivated && !u.status.includes('routed')
  );
}

/** True when the player has at least one unit they may still activate. */
export function hasActivatableUnits(state: GameState, playerId: string): boolean {
  return getActivatableUnits(state, playerId).length > 0;
}

/** The opposing player's ID for the given player. */
export function getOpponentId(state: GameState, playerId: string): string {
  return playerId === state.hostId ? state.guestId : state.hostId;
}

/** True when every unit on both sides has activated this round. */
export function isRoundComplete(state: GameState): boolean {
  return !hasActivatableUnits(state, state.hostId) && !hasActivatableUnits(state, state.guestId);
}

/**
 * Pass the right to activate after the current player's activation ends:
 *   - opponent activates next if they still have units;
 *   - otherwise the current player keeps activating their remaining units;
 *   - if nobody has units left, the round ends and a new one begins.
 */
export function advanceActivation(state: GameState): void {
  const current = state.turnState.currentPlayerId;
  const opponent = getOpponentId(state, current);

  if (hasActivatableUnits(state, opponent)) {
    state.turnState.currentPlayerId = opponent;
  }
  // If the opponent is out, the current player simply keeps activating.
  // When both sides are out the round is over.

  if (isRoundComplete(state)) {
    endRound(state);
  }
}

/**
 * End-of-round cleanup: reset per-round unit flags and start a new round
 * with the other player as the starting player. Engagements persist across
 * rounds (melees carry over); stun clears only via a unit's own activation.
 */
export function endRound(state: GameState): void {
  state.turnState.roundNumber += 1;
  state.turnState.startingPlayerId = getOpponentId(state, state.turnState.startingPlayerId);
  state.turnState.currentPlayerId = state.turnState.startingPlayerId;
  state.turnState.unitsActivatedThisRound = [];
  state.turnState.activeUnitId = null;

  for (const unit of state.units) {
    if (unit.isDestroyed) continue;
    unit.isActivated = false;
    unit.hasMoved = false;
    unit.hasAttacked = false;
    unit.remainingMovement = unit.speed;
  }
}
