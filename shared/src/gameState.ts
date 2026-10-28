import { GameState, GameAction, Player, TurnState, Board, Unit } from './gameTypes';

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

  const turnState: TurnState = {
    currentPlayerId: hostId,
    turnNumber: 1,
    phase: 'setup',
  };

  const board: Board = {
    width: 44,
    height: 60,
    gridSize: 1,
    scale: 1,
    terrain: [],
  };

  return {
    version: '1.0.0',
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

export function validateActionBasic(action: GameAction, state: GameState): { valid: boolean; reason?: string } {
  // Basic validation
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
  
  return { valid: true };
}
