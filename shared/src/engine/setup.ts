import { DiceSpec, Vector3 } from '../types';
import { GameState, Objective, RollOffRecord } from '../gameTypes';
import { getDeploymentZoneBounds } from './activation';
import {
  collectWalkableSurfaces,
  findEndOverlap,
  findTerrainAtPosition,
  findWalkableSurfaceIn,
  isBaseOverhanging,
  isLadderPiece,
  isStairPiece,
} from './spatial';
import { centreDistance } from './unitGeometry';

/**
 * Pre-game setup (pure functions over GameState): the objective count roll, the two roll-offs and the legality
 * of objective markers. Dice are always rolled by the server; these helpers only interpret the results.
 */

/** A new objective marker must be more than this far (horizontally) from every marker already placed. */
export const OBJECTIVE_MIN_SPACING = 9;
/** A roll-off is this many pairs of d6 (host die, guest die). */
export const ROLL_OFF_PAIRS = 10;
/** Tolerance for "the marker sits on the surface" (inches). */
const SURFACE_TOLERANCE = 0.05;

export const OBJECTIVE_COUNT_PURPOSE = 'objective-count';
export const MISSION_ROLL_OFF_PURPOSE = 'mission-roll-off';
export const DEPLOYMENT_ROLL_OFF_PURPOSE = 'deployment-roll-off';

/** 1-2 gives 3 objectives, 3-4 gives 4, 5-6 gives 5 (one d6, halved and rounded up, plus two). */
export function objectiveCountFromRoll(roll: number): number {
  return Math.ceil(roll / 2) + 2;
}

/** The dice a roll-off needs: one spec of 10 pairs, interleaved host die then guest die. */
export function rollOffSpec(purpose: string): DiceSpec {
  return { count: ROLL_OFF_PAIRS * 2, sides: 6, purpose };
}

/**
 * Settle a roll-off from its dice (host die, guest die, host die, ...). The first unequal pair decides and the
 * higher die wins; if all pairs tie the host wins.
 */
export function resolveRollOff(
  kind: RollOffRecord['kind'],
  rolls: number[],
  hostId: string,
  guestId: string
): RollOffRecord {
  const hostRolls: number[] = [];
  const guestRolls: number[] = [];
  for (let i = 0; i + 1 < rolls.length; i += 2) {
    hostRolls.push(rolls[i]);
    guestRolls.push(rolls[i + 1]);
  }
  const decidingPair = hostRolls.findIndex((h, i) => h !== guestRolls[i]);
  if (decidingPair === -1) return { kind, hostRolls, guestRolls, winnerId: hostId, decidingPair: null };
  return {
    kind,
    hostRolls,
    guestRolls,
    winnerId: hostRolls[decidingPair] > guestRolls[decidingPair] ? hostId : guestId,
    decidingPair,
  };
}

/** How many objectives the players have to place (undefined until the objectives phase roll is made). */
export function objectivesToPlace(state: GameState): number | undefined {
  return state.setupRolls?.objectiveCount;
}

/**
 * Why an objective marker can't go at `position`, or null when it can. Legal: on the board, outside both
 * deployment zones, more than 9" (horizontally) from every placed marker, and at a spot a model could stand:
 * the ground (y = 0) or the top of a walkable surface (y = that surface), clear of terrain solids, stairs and
 * ladders.
 */
export function objectivePlacementProblem(state: GameState, position: Vector3): string | null {
  const halfW = (state.board.width * state.board.gridSize) / 2;
  const halfH = (state.board.height * state.board.gridSize) / 2;
  if (position.x < -halfW || position.x > halfW || position.z < -halfH || position.z > halfH) {
    return 'Objective must be placed on the board';
  }

  for (const playerId of [state.hostId, state.guestId]) {
    const zone = getDeploymentZoneBounds(state, playerId);
    if (position.x >= zone.minX && position.x <= zone.maxX && position.z >= zone.minZ && position.z <= zone.maxZ) {
      return 'Objective cannot be placed inside a deployment zone';
    }
  }

  for (const other of state.objectives ?? []) {
    if (centreDistance(position, other.position) <= OBJECTIVE_MIN_SPACING) {
      return `Objective must be more than ${OBJECTIVE_MIN_SPACING}" from every other objective`;
    }
  }

  // Stairs and ladders are routes, not places to stand; solids are judged at the model's height below, so a deck
  // top is fine even though the deck piece is an obstacle at ground level.
  const piece = findTerrainAtPosition(state, position);
  if (piece && (isStairPiece(piece) || isLadderPiece(piece))) {
    return 'Objective cannot be placed inside terrain';
  }
  if (findEndOverlap(state, '', position)?.kind === 'terrain') {
    return 'Objective cannot be placed inside terrain';
  }

  const y = position.y ?? 0;
  if (Math.abs(y) > SURFACE_TOLERANCE) {
    const surfaces = collectWalkableSurfaces(state);
    const surface = findWalkableSurfaceIn(surfaces, { x: position.x, z: position.z, y }, 0);
    if (!surface || Math.abs(y - surface.topY) > SURFACE_TOLERANCE) {
      return 'Objective must sit on the ground or on a walkable surface';
    }
    if (isBaseOverhanging(state, position, surfaces)) {
      return 'Objective must sit where a model could stand';
    }
  }
  return null;
}

/** The marker created by the n-th `place-objective` (1-based). */
export function createObjectiveMarker(index: number, position: Vector3): Objective {
  return {
    id: `objective-${index}`,
    name: `Objective ${index}`,
    position: { x: position.x, y: position.y ?? 0, z: position.z },
    controllingPlayerId: null,
    isContested: false,
  };
}
