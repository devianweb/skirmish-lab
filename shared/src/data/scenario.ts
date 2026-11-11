import { GameState, MatchSetup, Objective, SetupRolls, TerrainPiece, Unit } from '../gameTypes';
import {
  ARMY_FRONTIER_WARDENS,
  ARMY_RUST_RAIDERS,
  STARTER_ARMIES,
  createUnitFromFighter,
  createUnitsFromStarterArmy,
} from './armies';
import { CustomMapDefinition, DEFAULT_BOARD_SIZE } from './mapSchema';
import { settleSpawnPositions } from '../engine/activation';

/**
 * Default v1 scenario data: each player deploys a five-fighter force on
 * opposite edges of the board, with a scattering of terrain toward the
 * middle. Terrain types match the renderer's asset manifest (walls, crates,
 * columns). Pure data — the engine has no scenario-specific logic.
 *
 * Board: 48 x 48 by default (see DEFAULT_BOARD_SIZE), centered at the origin, with forces deployed 24" apart (z = ±12).
 */

const DEPLOYMENT_SPREAD = [-8, -4, 0, 4, 8];
const HOST_DEPLOYMENT_Z = -12;
const GUEST_DEPLOYMENT_Z = 12;

function deployArmy(
  army: typeof ARMY_FRONTIER_WARDENS,
  ownerId: string,
  z: number,
  facing: number
): Unit[] {
  return army.fighters.map((fighter, index) =>
    createUnitFromFighter(fighter, ownerId, army.id, {
      x: DEPLOYMENT_SPREAD[index],
      y: 0,
      z,
    }, {
      unitId: `${ownerId}-fighter-${index + 1}`,
      nameSuffix: String(index + 1),
    })
  ).map((unit) => ({ ...unit, rotation: { x: 0, y: facing, z: 0 } }));
}

/** Spawn the two default armies for host and guest. */
export function createDefaultScenarioUnits(hostId: string, guestId: string): Unit[] {
  // Host faces +z (toward the guest edge); guest faces -z.
  return [
    ...deployArmy(ARMY_FRONTIER_WARDENS, hostId, HOST_DEPLOYMENT_Z, 0),
    ...deployArmy(ARMY_RUST_RAIDERS, guestId, GUEST_DEPLOYMENT_Z, Math.PI),
  ];
}

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
  const hostStarter = options.hostArmyId && options.hostArmyId in STARTER_ARMIES
    ? STARTER_ARMIES[options.hostArmyId as keyof typeof STARTER_ARMIES]
    : null;
  const guestStarter = options.guestArmyId && options.guestArmyId in STARTER_ARMIES
    ? STARTER_ARMIES[options.guestArmyId as keyof typeof STARTER_ARMIES]
    : null;

  const setup: MatchSetup = {};
  if (options.hostArmyId !== undefined) setup.hostArmyId = options.hostArmyId;
  if (options.guestArmyId !== undefined) setup.guestArmyId = options.guestArmyId;
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
    const hostForce = hostStarter ?? STARTER_ARMIES['frontier-wardens-starter'];
    const guestForce = guestStarter ?? STARTER_ARMIES['rust-raiders-starter'];

    const hostUnits = createUnitsFromStarterArmy(hostForce, state.hostId, {
      startUndeployed: true,
      defaultZ: -12,
      facing: 0,
    });
    const guestUnits = createUnitsFromStarterArmy(guestForce, state.guestId, {
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

  if (hostStarter && guestStarter) {
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
  } else {
    state.units = createDefaultScenarioUnits(state.hostId, state.guestId);
  }

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
