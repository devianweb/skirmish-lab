import { GameState, Unit } from '../gameTypes';
import { hasTrait } from '../rules/traits';
import { MoraleTestOutcome, resolveMoraleTest } from './combat';

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
 * End-of-round cleanup: reset per-round unit flags and start a new round.
 *
 * The player who finished activating all of their units first in the previous
 * round (i.e. the opponent of whichever player took the final activation of
 * the round, `currentPlayerId`) activates first in the new round. This matches
 * OPR skirmish rules and prevents the last player of round N from also taking
 * the first activation of round N+1.
 *
 * Engagements persist across rounds (melees carry over); stun clears only via
 * a unit's own activation.
 */
export function endRound(state: GameState): void {
  const lastActivatingPlayer = state.turnState.currentPlayerId;
  state.turnState.roundNumber += 1;
  state.turnState.startingPlayerId = getOpponentId(state, lastActivatingPlayer);
  state.turnState.currentPlayerId = state.turnState.startingPlayerId;
  state.turnState.unitsActivatedThisRound = [];
  state.turnState.activeUnitId = null;

  for (const unit of state.units) {
    if (unit.isDestroyed) continue;
    unit.isActivated = false;
    unit.hasMoved = false;
    unit.hasAttacked = false;
    unit.remainingMovement = unit.speed;
    unit.status = unit.status.filter((s) => s !== 'fatigued');
  }
}

/**
 * True when `playerId`'s surviving non-routed units are at or below 50% of
 * their starting unit count (triggers Round-End Army Morale tests).
 */
export function isArmyBroken(state: GameState, playerId: string): boolean {
  const allUnits = state.units.filter((u) => u.ownerId === playerId);
  if (allUnits.length === 0) return false;
  const surviving = allUnits.filter(
    (u) => !u.isDestroyed && !u.status.includes('routed')
  );
  return surviving.length > 0 && surviving.length * 2 <= allUnits.length;
}

/**
 * Return all surviving units across both players that must take a Round-End
 * Morale test because their army is Broken (<= 50% starting units).
 */
export function getUnitsRequiringRoundMorale(state: GameState): Unit[] {
  const result: Unit[] = [];
  for (const playerId of [state.hostId, state.guestId]) {
    if (!isArmyBroken(state, playerId)) continue;
    for (const unit of state.units) {
      if (
        unit.ownerId === playerId &&
        !unit.isDestroyed &&
        !unit.status.includes('routed')
      ) {
        result.push(unit);
      }
    }
  }
  return result;
}

/**
 * Apply Round-End Morale tests to all units in broken armies using pre-rolled
 * server morale dice (`purpose: 'morale'`, plus optional `purpose: 'stoic'`).
 */
export function applyRoundEndMorale(
  state: GameState,
  moraleRolls: number[],
  stoicRolls: number[] = []
): Array<{ unitId: string; outcome: MoraleTestOutcome }> {
  const unitsToTest = getUnitsRequiringRoundMorale(state);
  const outcomes: Array<{ unitId: string; outcome: MoraleTestOutcome }> = [];
  let rollIdx = 0;
  let stoicIdx = 0;

  for (const unit of unitsToTest) {
    if (rollIdx >= moraleRolls.length) break;
    const roll = moraleRolls[rollIdx++];
    const alreadyShaken =
      unit.status.includes('shaken') || unit.status.includes('stunned');

    // Check for friendly Commander (Hero) within 12" who is not shaken/routed.
    const commanders = state.units.filter(
      (c) =>
        c.ownerId === unit.ownerId &&
        !c.isDestroyed &&
        !c.status.includes('shaken') &&
        !c.status.includes('stunned') &&
        !c.status.includes('routed') &&
        hasTrait(c.specialRules, 'commander') &&
        Math.hypot(c.position.x - unit.position.x, c.position.z - unit.position.z) <= 12.01
    );
    const commanderQuality =
      commanders.length > 0
        ? Math.min(...commanders.map((c) => c.quality))
        : undefined;

    const stoicRoll =
      hasTrait(unit.specialRules, 'stoic') && stoicIdx < stoicRolls.length
        ? stoicRolls[stoicIdx++]
        : undefined;

    const testOutcome = resolveMoraleTest({
      quality: unit.quality,
      roll,
      specialRules: unit.specialRules,
      alreadyShaken,
      commanderQuality,
      stoicRoll,
    });

    // Consume one-shot morale-debuff if present.
    if (hasTrait(unit.specialRules, 'morale-debuff')) {
      unit.specialRules = unit.specialRules.filter((r) => r !== 'morale-debuff');
    }

    if (testOutcome.outcome === 'shaken') {
      if (!unit.status.includes('shaken')) unit.status.push('shaken');
      if (!unit.status.includes('stunned')) unit.status.push('stunned');
    } else if (testOutcome.outcome === 'routed') {
      if (!unit.status.includes('routed')) unit.status.push('routed');
      unit.isDestroyed = true;
      unit.wounds = 0;
      unit.status = unit.status.filter((s) => s !== 'engaged');
    }

    outcomes.push({ unitId: unit.id, outcome: testOutcome });
  }

  return outcomes;
}
