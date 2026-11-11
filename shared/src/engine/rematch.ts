import { GameState } from '../gameTypes';
import { createInitialGameState } from '../gameState';
import { applyDefaultScenario } from '../data/scenario';
import { CustomMapDefinition } from '../data/mapSchema';

/**
 * Rebuilds the starting state of a finished match: same ids, player names, board, terrain, armies and deployment mode, plus the
 * objectives and roll-off results when the original match got that far (control reset). Pure function of the previous state, so it also works after a host reload.
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
  };

  // The placed objectives and both roll-offs carry over (the objectives phase is skipped) once they were all made
  const rolls = previous.setupRolls;
  const complete =
    !!rolls?.deploymentRollOff &&
    rolls.objectiveCount !== undefined &&
    (previous.objectives ?? []).length === rolls.objectiveCount;
  applyDefaultScenario(state, {
    ...(previous.setup ?? {}),
    customMap: map,
    ...(complete ? { restoreSetup: { objectives: previous.objectives ?? [], setupRolls: rolls } } : {}),
  });
  return state;
}
