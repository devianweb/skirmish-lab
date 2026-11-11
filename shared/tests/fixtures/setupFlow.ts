import { createAction } from '../../src/gameState';
import { GameState } from '../../src/gameTypes';
import { DiceResult, Vector3 } from '../../src/types';
import { applyAction, getDiceSpecs } from '../../src/engine/actions';
import { objectivePlacementProblem } from '../../src/engine/setup';

/**
 * Helpers that drive the objectives phase with fixed dice, so engine tests can reach the deployment phase
 * (or place objectives directly) without caring about the rolls.
 */

/** A roll-off result whose first pair decides it: `winner` rolls a 6 against a 1. */
export function rollOffDice(winner: 'host' | 'guest' | 'tie', purpose: string): DiceResult {
  const rolls: number[] = [];
  for (let i = 0; i < 10; i++) {
    if (winner === 'tie') rolls.push(3, 3);
    else rolls.push(...(winner === 'host' ? [6, 1] : [1, 6]));
  }
  return { rolls, total: rolls.reduce((a, b) => a + b, 0), finalTotal: rolls.reduce((a, b) => a + b, 0), purpose };
}

export function d6(value: number, purpose: string): DiceResult {
  return { rolls: [value], total: value, finalTotal: value, purpose };
}

/** Candidate spots for objectives on any board (a legal subset is picked for the board at hand). */
const CANDIDATES: Vector3[] = [
  { x: -16, y: 0, z: 0 },
  { x: 16, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 10 },
  { x: 0, y: 0, z: -10 },
  { x: -10, y: 0, z: 10 },
  { x: 10, y: 0, z: -10 },
];

function apply(state: GameState, actorId: string, type: 'roll-objectives' | 'place-objective', payload: any, dice?: DiceResult[]): GameState {
  const action = createAction(actorId, type, payload);
  const out = applyAction(state, action, dice);
  if (!out.ok) throw new Error(`${type} rejected: ${out.reason}`);
  return out.state;
}

export interface SetupFlowOptions {
  /** The d6 for the objective count (default 3: four objectives). */
  countRoll?: number;
  missionWinner?: 'host' | 'guest';
  deploymentWinner?: 'host' | 'guest' | 'tie';
}

/** Plays `roll-objectives` and every `place-objective` with the given dice; returns the state in deployment. */
export function playObjectivesPhase(state: GameState, options: SetupFlowOptions = {}): GameState {
  let s = state;
  s = apply(s, s.hostId, 'roll-objectives', { type: 'roll-objectives' }, [
    d6(options.countRoll ?? 3, 'objective-count'),
    rollOffDice(options.missionWinner ?? 'host', 'mission-roll-off'),
  ]);
  const count = s.setupRolls!.objectiveCount!;
  for (let i = 0; i < count; i++) {
    const position = CANDIDATES.find((p) => !objectivePlacementProblem(s, p));
    if (!position) throw new Error('no legal objective spot left on this board');
    const action = createAction(s.turnState.currentPlayerId, 'place-objective', { type: 'place-objective', position });
    const specs = getDiceSpecs(s, action);
    const dice = specs ? [rollOffDice(options.deploymentWinner ?? 'host', 'deployment-roll-off')] : undefined;
    s = apply(s, s.turnState.currentPlayerId, 'place-objective', { type: 'place-objective', position }, dice);
  }
  return s;
}
