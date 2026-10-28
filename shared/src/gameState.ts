import { GameState, GameAction, Player, TurnState, Board, Unit, UnitStatus } from './gameTypes';

export const SCHEMA_VERSION = '2.0.0';

export function createInitialGameState(hostId: string, guestId: string, hostName: string = 'Host', guestName: string = 'Guest'): GameState {
  const now = Date.now();
  const gameId = `game-${now}-${Math.random().toString(36).substr(2, 9)}`;

  const players: Player[] = [
    {
      id: hostId,
      name: hostName,
      role: 'host',
      armyId: 'army-host',
      isActive: true,
    },
    {
      id: guestId,
      name: guestName,
      role: 'guest',
      armyId: 'army-guest',
      isActive: false,
    },
  ];

  // Alternating activations: host starts round 1, players then alternate
  // activating one unit each until every unit has activated.
  const turnState: TurnState = {
    currentPlayerId: hostId,
    roundNumber: 1,
    phase: 'setup',
    unitsActivatedThisRound: [],
    startingPlayerId: hostId,
  };

  const board: Board = {
    width: 44,
    height: 60,
    gridSize: 1,
    scale: 1,
    terrain: [],
  };

  return {
    version: SCHEMA_VERSION,
    gameId,
    createdAt: now,
    lastActionId: '',
    hostId,
    guestId,
    players,
    turnState,
    board,
    units: [],
    terrain: [],
    markers: [],
    actionLog: [],
    status: 'setting-up',
  };
}

export function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state));
}

export function isGameStateSerializable(state: GameState): boolean {
  try {
    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);
    return JSON.stringify(deserialized) === serialized;
  } catch {
    return false;
  }
}

export function createAction(
  actorId: string,
  type: GameAction['type'],
  payload: GameAction['payload']
): GameAction {
  return {
    id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    actorId,
    type,
    payload,
  };
}

/**
 * Extract the acting unit ID from an action payload, if any.
 * 'activate-unit', 'move-unit', 'use-ability', and 'hold' carry `unitId`;
 * 'shoot', 'charge', and 'fight' carry `attackerId`.
 */
function getActionUnitId(action: GameAction): string | null {
  const payload = action.payload as Partial<Record<'unitId' | 'attackerId', unknown>>;
  if (payload && typeof payload.unitId === 'string') return payload.unitId;
  if (payload && typeof payload.attackerId === 'string') return payload.attackerId;
  return null;
}

function unitHasStatus(unit: Unit, status: Exclude<UnitStatus, { type: 'custom' }>): boolean {
  return unit.status.includes(status);
}

/**
 * Basic host-side validation shared by host and guest (guest uses it for UX only).
 *
 * Covers the general legality checks that don't require rules-engine context:
 *   1. Known actor
 *   2. Game not over
 *   3. It is the actor's turn to act (activation order)
 *   4. For unit-targeting actions: unit exists, is owned by the actor, is not
 *      destroyed, and is not stunned/routed (except that a stunned unit may
 *      still be activated - its activation is spent clearing the stun).
 *
 * Full validation (movement allowance, LOS, range, engagement, sequencing
 * within an activation) is the rules engine's job and is not checked here.
 */
export function validateActionBasic(action: GameAction, state: GameState): { valid: boolean; reason?: string } {
  const actor = state.players.find(p => p.id === action.actorId);
  if (!actor) {
    return { valid: false, reason: 'Unknown actor' };
  }

  if (state.status === 'game-over') {
    return { valid: false, reason: 'Game is over' };
  }

  if (action.actorId !== state.turnState.currentPlayerId) {
    return { valid: false, reason: 'Not your turn' };
  }

  const unitId = getActionUnitId(action);
  if (unitId) {
    const unit = state.units.find(u => u.id === unitId);
    if (!unit) {
      return { valid: false, reason: 'Unknown unit' };
    }
    if (unit.ownerId !== action.actorId) {
      return { valid: false, reason: 'Unit does not belong to acting player' };
    }
    if (unit.isDestroyed) {
      return { valid: false, reason: 'Unit is destroyed' };
    }

    if (action.type === 'activate-unit') {
      // Starting an activation: unit must not have already activated this
      // round. A stunned unit may be activated (its activation is spent
      // clearing the stun), but a routed unit cannot activate at all.
      if (state.turnState.unitsActivatedThisRound.includes(unitId) || unit.isActivated) {
        return { valid: false, reason: 'Unit already activated this round' };
      }
      if (unitHasStatus(unit, 'routed')) {
        return { valid: false, reason: 'Unit is routed and cannot activate' };
      }
    } else {
      // Acting within an activation: stunned and routed units cannot act.
      if (unitHasStatus(unit, 'stunned') || unitHasStatus(unit, 'routed')) {
        return { valid: false, reason: 'Unit is stunned or routed and cannot act' };
      }
    }
  }

  return { valid: true };
}
