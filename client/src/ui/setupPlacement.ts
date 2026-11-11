import type { GameState, RollOffRecord, Unit, Vector3 } from '@skirmish-lab/shared';
import {
  ambushFootprintProblem,
  ambushKeepOut,
  baseRadius,
  getAmbushReserves,
  getDeployableUnits,
  hasTrait,
  objectivePlacementProblem,
  OBJECTIVE_MIN_SPACING,
  SCOUT_ENEMY_MIN_DISTANCE,
  validateDeploymentPosition,
  livingModelPositions,
} from '@skirmish-lab/shared';
import type { PlacementCircleMarker } from '../renderer/MarkerRenderer';

/**
 * Pure helpers for the setup placement steps the HUD runs: placing objectives, normal deployment, the held-Scout
 * stage and the Ambush step. They only read state and ask the engine's own checks (the host re-validates every
 * action), so the preview can never promise a spot the host would refuse.
 */

export type PlacementKind = 'objective' | 'deploy' | 'scout' | 'ambush';

/** Which placement step the game is in right now (null outside setup and the Ambush step). */
export function currentPlacementKind(state: GameState): PlacementKind | null {
  if (state.status === 'game-over') return null;
  if (state.turnState.phase === 'objectives') return 'objective';
  if (state.turnState.ambushStep) return 'ambush';
  if (state.turnState.phase === 'deployment') return state.turnState.scoutStage ? 'scout' : 'deploy';
  return null;
}

/** Units the player may place now: Ambush reserves during the Ambush step, otherwise the deployable units. */
export function placeableUnits(state: GameState, playerId: string): Unit[] {
  if (state.turnState.ambushStep) return getAmbushReserves(state, playerId);
  if (state.turnState.phase === 'deployment') return getDeployableUnits(state, playerId);
  return [];
}

/** True for a Scout unit that is still waiting and has not been held back (it can deploy now or be held). */
export function canChooseScoutHold(state: GameState, unit: Unit): boolean {
  return (
    state.turnState.phase === 'deployment' &&
    !state.turnState.scoutStage &&
    unit.isDeployed === false &&
    !unit.isDestroyed &&
    !unit.heldAsScout &&
    hasTrait(unit.specialRules, 'scout') &&
    !hasTrait(unit.specialRules, 'ambush')
  );
}

/** Why `position` is not a legal spot for the current placement (null when it is). Same checks as the host. */
export function placementProblem(
  state: GameState,
  kind: PlacementKind,
  unit: Unit | null,
  position: Vector3
): string | null {
  if (kind === 'objective') return objectivePlacementProblem(state, position);
  if (!unit) return 'No unit left to place';
  if (kind === 'ambush') return ambushFootprintProblem(state, unit, position);
  const result = validateDeploymentPosition(state, unit, position);
  return result.valid ? null : result.reason ?? 'Invalid deployment position';
}

/** The 9" circles around the objectives already placed (a new marker's centre must be outside every one). */
export function objectiveSpacingCircles(state: GameState): PlacementCircleMarker[] {
  return (state.objectives ?? []).map((o) => ({
    x: o.position.x,
    y: o.position.y ?? 0,
    z: o.position.z,
    radius: OBJECTIVE_MIN_SPACING,
    kind: 'spacing' as const,
  }));
}

/**
 * Ground the unit may not use because of enemy units: around every enemy model for an Ambush arrival (9", or 12"
 * from Perimeter Watch) and, for a held Scout, around every enemy model that is not a Scout (9"). Radii are
 * centre distances (the limit plus both base radii), matching the host's base-edge gap.
 */
export function exclusionCircles(state: GameState, kind: PlacementKind, unit: Unit): PlacementCircleMarker[] {
  if (kind !== 'ambush' && kind !== 'scout') return [];
  const circles: PlacementCircleMarker[] = [];
  const moverRadius = baseRadius(unit);
  for (const enemy of state.units) {
    if (enemy.ownerId === unit.ownerId || enemy.isDestroyed || enemy.isDeployed === false) continue;
    let limit: number;
    if (kind === 'ambush') {
      limit = ambushKeepOut(enemy);
    } else {
      if (hasTrait(enemy.specialRules, 'scout')) continue;
      limit = SCOUT_ENEMY_MIN_DISTANCE;
    }
    for (const pos of livingModelPositions(enemy)) {
      circles.push({
        x: pos.x,
        y: pos.y ?? 0,
        z: pos.z,
        radius: limit + baseRadius(enemy) + moverRadius,
        kind: 'exclusion',
      });
    }
  }
  return circles;
}

/** "4 against 2" style text for the deciding pair, or the all-tied note. */
function decidingText(off: RollOffRecord): string {
  if (off.decidingPair === null) return 'all ten pairs tied, so the Host wins';
  return `pair ${off.decidingPair + 1} decided it: ${off.hostRolls[off.decidingPair]} against ${off.guestRolls[off.decidingPair]}`;
}

/**
 * The dice pairs of a roll-off up to the deciding one (later pairs never mattered), as "Host 3-3 · 5-2 Guest"
 * style text. The pairs are host die first, then guest die.
 */
export function rollOffPairsText(off: RollOffRecord): string {
  const last = off.decidingPair === null ? off.hostRolls.length - 1 : off.decidingPair;
  const pairs: string[] = [];
  for (let i = 0; i <= last; i++) pairs.push(`${off.hostRolls[i]}–${off.guestRolls[i]}`);
  return pairs.join(', ');
}

export interface SetupAnnouncement {
  id: 'objective-count' | 'mission' | 'deployment';
  title: string;
  detail: string;
}

/**
 * The pre-game rolls as announcements: the objective count, the mission roll-off (who places first) and the
 * deployment roll-off (who deploys and activates first). `nameOf` turns a player id into the name shown.
 */
export function setupAnnouncements(state: GameState, nameOf: (playerId: string) => string): SetupAnnouncement[] {
  const rolls = state.setupRolls;
  if (!rolls) return [];
  const out: SetupAnnouncement[] = [];
  if (rolls.objectiveCount !== undefined) {
    out.push({
      id: 'objective-count',
      title: `Objective roll: ${rolls.objectiveRoll ?? '?'} — ${rolls.objectiveCount} objectives`,
      detail: `${rolls.objectiveCount} markers will be placed, alternating`,
    });
  }
  if (rolls.missionRollOff) {
    const off = rolls.missionRollOff;
    out.push({
      id: 'mission',
      title: `Mission roll-off: ${nameOf(off.winnerId)} wins and places the first objective`,
      detail: `Host–Guest pairs ${rollOffPairsText(off)} (${decidingText(off)})`,
    });
  }
  if (rolls.deploymentRollOff) {
    const off = rolls.deploymentRollOff;
    out.push({
      id: 'deployment',
      title: `Deployment roll-off: ${nameOf(off.winnerId)} deploys first`,
      detail: `Host–Guest pairs ${rollOffPairsText(off)} (${decidingText(off)}). ${nameOf(off.winnerId)} also activates first in round 1`,
    });
  }
  return out;
}
