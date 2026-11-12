import { DEFAULT_BOARD_SIZE } from './data/mapSchema';
import { GameState, GameAction, Player, TurnState, Board } from './gameTypes';

export const SCHEMA_VERSION = '2.1.0';

/**
 * Deterministic player IDs. Roles are fixed for v1 (one host, one guest), so
 * both peers can compute the local player's ID without extra negotiation.
 */
export const HOST_PLAYER_ID = 'player-host';
export const GUEST_PLAYER_ID = 'player-guest';

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
    width: DEFAULT_BOARD_SIZE,
    height: DEFAULT_BOARD_SIZE,
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
    objectives: [],
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

