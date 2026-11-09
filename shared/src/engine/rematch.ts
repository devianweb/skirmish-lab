import { GameState } from '../gameTypes';
import { createInitialGameState } from '../gameState';
import { applyDefaultScenario } from '../data/scenario';
import { CustomMapDefinition } from '../data/mapSchema';

/**
 * Rebuilds the starting state of a finished match: same ids, player names, board, terrain, objectives (control
 * reset), armies and deployment mode. Pure function of the previous state, so it also works after a host reload.
 * Only gameId / createdAt differ from the original start (and the action log is empty).
 */
export function createRematchState(previous: GameState): GameState {
  const host = previous.players.find((p) => p.id === previous.hostId);
  const guest = previous.players.find((p) => p.id === previous.guestId);
  const state = createInitialGameState(previous.hostId, previous.guestId, host?.name, guest?.name);

  const map: CustomMapDefinition = {
    id: 'rematch',
    name: 'Rematch',
    version: 1,
    board: { width: previous.board.width, height: previous.board.height },
    terrain: JSON.parse(JSON.stringify(previous.terrain)),
    objectives: (previous.objectives ?? []).map((o) => ({
      ...o,
      position: { ...o.position },
      controllingPlayerId: null,
      isContested: false,
    })),
  };

  applyDefaultScenario(state, { ...(previous.setup ?? {}), customMap: map });
  return state;
}
