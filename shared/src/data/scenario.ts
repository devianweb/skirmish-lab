import { GameState, MatchSetup, Objective, SetupRolls, TerrainPiece } from '../gameTypes';
import { STARTER_ARMIES, createUnitsFromStarterArmy, isKnownArmyId } from './armies';
import { CustomMapDefinition, DEFAULT_BOARD_SIZE } from './mapSchema';
import { settleSpawnPositions } from '../engine/activation';

/**
 * Default scenario data: each player deploys a ready-made force on opposite edges of the board (host Human
 * Defense Force vs guest Orc Marauders unless the lobby picked others). Pure data — the engine has no
 * scenario-specific logic.
 *
 * Board: 48 x 48 by default (see DEFAULT_BOARD_SIZE), centered at the origin, with forces deployed 24" apart (z = ±12).
 */

/** Default matchup when a side has no (known) army chosen: host Human Defense Force vs guest Orc Marauders. */
export const DEFAULT_HOST_ARMY_ID = 'hdf';
export const DEFAULT_GUEST_ARMY_ID = 'orc-marauders';

export interface ScenarioOptions {
  hostArmyId?: string;
  guestArmyId?: string;
  useDeploymentPhase?: boolean;
  customMap?: CustomMapDefinition;
  /**
   * A rematch replays the same game: the objectives already placed and both roll-off results are kept, so the
   * match starts straight in deployment (with the same player deploying first).
   */
  restoreSetup?: { objectives: Objective[]; setupRolls: SetupRolls };
}

/** Empty 48"x48" battlefield — the default when no custom map is chosen. */
export function createBlankMap(): CustomMapDefinition {
  return {
    id: 'blank',
    name: 'Empty Battlefield',
    version: 1,
    board: { width: DEFAULT_BOARD_SIZE, height: DEFAULT_BOARD_SIZE },
    terrain: [],
  };
}

/** Apply the default scenario to a fresh game state (host-side, at start). */
export function applyDefaultScenario(state: GameState, options: ScenarioOptions = {}): void {
  const hostStarter =
    (isKnownArmyId(options.hostArmyId) ? STARTER_ARMIES[options.hostArmyId] : undefined) ??
    STARTER_ARMIES[DEFAULT_HOST_ARMY_ID];
  const guestStarter =
    (isKnownArmyId(options.guestArmyId) ? STARTER_ARMIES[options.guestArmyId] : undefined) ??
    STARTER_ARMIES[DEFAULT_GUEST_ARMY_ID];

  const setup: MatchSetup = {};
  if (options.hostArmyId !== undefined) setup.hostArmyId = hostStarter.id;
  if (options.guestArmyId !== undefined) setup.guestArmyId = guestStarter.id;
  if (options.useDeploymentPhase !== undefined) setup.useDeploymentPhase = options.useDeploymentPhase;
  if (Object.keys(setup).length > 0) state.setup = setup;

  const selectedMap: CustomMapDefinition =
    options.customMap ??
    createBlankMap();

  // The game board takes the map's size (the editor builds on the same width/height).
  if (selectedMap.board) {
    state.board.width = selectedMap.board.width;
    state.board.height = selectedMap.board.height;
  }

  const mapTerrain: TerrainPiece[] = selectedMap.terrain.map((t) => ({
    ...t,
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  }));
  if (options.useDeploymentPhase) {
    const hostUnits = createUnitsFromStarterArmy(hostStarter, state.hostId, {
      startUndeployed: true,
      defaultZ: -12,
      facing: 0,
    });
    const guestUnits = createUnitsFromStarterArmy(guestStarter, state.guestId, {
      startUndeployed: true,
      defaultZ: 12,
      facing: Math.PI,
    });

    state.units = [...hostUnits, ...guestUnits];
    state.terrain = mapTerrain;
    state.markers = [];
    state.status = 'in-progress';
    state.turnState.roundNumber = 0;
    const restored = options.restoreSetup;
    const firstDeployer = restored?.setupRolls.deploymentRollOff?.winnerId;
    if (restored && firstDeployer) {
      // Rematch: same objectives and roll-offs, no objectives phase
      state.objectives = restored.objectives.map((o) => ({
        ...o,
        position: { ...o.position },
        controllingPlayerId: null,
        isContested: false,
      }));
      state.setupRolls = JSON.parse(JSON.stringify(restored.setupRolls));
      state.turnState.phase = 'deployment';
      state.turnState.startingPlayerId = firstDeployer;
      state.turnState.currentPlayerId = firstDeployer;
    } else {
      // The players roll for the objective count and place the markers before anyone deploys
      state.objectives = [];
      state.turnState.phase = 'objectives';
      state.turnState.startingPlayerId = state.hostId;
      state.turnState.currentPlayerId = state.hostId;
    }
    state.turnState.activeUnitId = null;
    state.turnState.unitsActivatedThisRound = [];
    return;
  }

  const hostUnits = createUnitsFromStarterArmy(hostStarter, state.hostId, {
    startUndeployed: false,
    defaultZ: -12,
    facing: 0,
  });
  const guestUnits = createUnitsFromStarterArmy(guestStarter, state.guestId, {
    startUndeployed: false,
    defaultZ: 12,
    facing: Math.PI,
  });
  state.units = [...hostUnits, ...guestUnits];
  // No deployment phase: move any unit whose spawn spot collides with the map's terrain to the nearest clear spot
  state.terrain = mapTerrain;
  settleSpawnPositions(state, state.units);

  state.terrain = mapTerrain;
  state.markers = [];
  state.status = 'in-progress';
  // Without a deployment phase the units keep their automatic positions, but the objectives phase still runs.
  const restored = options.restoreSetup;
  const firstPlayer = restored?.setupRolls.deploymentRollOff?.winnerId;
  if (restored && firstPlayer) {
    // Rematch: same objectives and roll-offs, straight to round 1 with the same player first
    state.objectives = restored.objectives.map((o) => ({
      ...o,
      position: { ...o.position },
      controllingPlayerId: null,
      isContested: false,
    }));
    state.setupRolls = JSON.parse(JSON.stringify(restored.setupRolls));
    state.turnState.phase = 'activation';
    state.turnState.roundNumber = 1;
    state.turnState.startingPlayerId = firstPlayer;
    state.turnState.currentPlayerId = firstPlayer;
  } else {
    state.objectives = [];
    state.turnState.phase = 'objectives';
    state.turnState.roundNumber = 0;
    state.turnState.startingPlayerId = state.hostId;
    state.turnState.currentPlayerId = state.hostId;
  }
  state.turnState.activeUnitId = null;
  state.turnState.unitsActivatedThisRound = [];
}
