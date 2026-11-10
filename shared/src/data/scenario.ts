import { GameState, MatchSetup, Objective, TerrainPiece, Unit } from '../gameTypes';
import {
  ARMY_FRONTIER_WARDENS,
  ARMY_RUST_RAIDERS,
  STARTER_ARMIES,
  createUnitFromFighter,
  createUnitsFromStarterArmy,
} from './armies';
import { CustomMapDefinition, DEFAULT_BOARD_SIZE, getDeploymentZoneDepth } from './mapSchema';
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

/**
 * Create default scenario objective markers.
 * Standard skirmish rules place 3 to 5 objectives outside deployment zones
 * and > 9" apart from each other.
 *
 * Here we provide 4 balanced objectives in open ground:
 *   - Alpha:   x: -10, z: -4
 *   - Bravo:   x:  10, z:  4
 *   - Charlie: x:  -4, z:  5
 *   - Delta:   x:   4, z: -5
 *
 * Pairwise distances: min 10.82" (all > 9"), all within z: -5..5 (outside
 * deployment zones at z = ±12), and positioned with clearance from obstacles.
 */
export function createDefaultScenarioObjectives(): Objective[] {
  return [
    {
      id: 'objective-alpha',
      name: 'Objective Alpha',
      position: { x: -10, y: 0, z: -4 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-bravo',
      name: 'Objective Bravo',
      position: { x: 10, y: 0, z: 4 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-charlie',
      name: 'Objective Charlie',
      position: { x: -4, y: 0, z: 5 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-delta',
      name: 'Objective Delta',
      position: { x: 4, y: 0, z: -5 },
      controllingPlayerId: null,
      isContested: false,
    },
  ];
}

export interface ScenarioOptions {
  hostArmyId?: string;
  guestArmyId?: string;
  useDeploymentPhase?: boolean;
  customMap?: CustomMapDefinition;
}

/**
 * Balanced objectives for a board of the given size: four markers, one per quadrant, at +-25% of the width and
 * 3" inside each deployment zone's inner edge. Every marker is outside both zones and more than 9" from every other;
 * candidates that would break that (tiny boards) are dropped, so the result may have fewer markers.
 */
export function createBalancedObjectives(board: { width: number; height: number }): Objective[] {
  const innerEdge = board.height / 2 - getDeploymentZoneDepth(board.height); // |z| of the zone's inner edge
  const half = (v: number) => Math.round(v * 2) / 2;
  const zo = half(Math.max(0, innerEdge - 3));
  const xo = half(board.width / 4);
  const candidates = [
    { name: 'Objective Alpha', x: -xo, z: zo },
    { name: 'Objective Bravo', x: xo, z: -zo },
    { name: 'Objective Charlie', x: -xo, z: -zo },
    { name: 'Objective Delta', x: xo, z: zo },
  ];
  const chosen: typeof candidates = [];
  for (const c of candidates) {
    if (Math.abs(c.z) >= innerEdge || Math.abs(c.x) > board.width / 2) continue;
    if (chosen.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 9)) chosen.push(c);
  }
  return chosen.map((c) => ({
    id: `objective-${c.name.split(' ')[1].toLowerCase()}`,
    name: c.name,
    position: { x: c.x, y: 0, z: c.z },
    controllingPlayerId: null,
    isContested: false,
  }));
}

/** Empty 48"x48" battlefield with the standard objectives — the default when no custom map is chosen. */
export function createBlankMap(): CustomMapDefinition {
  return {
    id: 'blank',
    name: 'Empty Battlefield',
    version: 1,
    board: { width: DEFAULT_BOARD_SIZE, height: DEFAULT_BOARD_SIZE },
    terrain: [],
    objectives: createDefaultScenarioObjectives(),
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
  const mapObjectives = (selectedMap.objectives ?? createDefaultScenarioObjectives()).map((o) => ({
    ...o,
    position: { ...o.position },
    controllingPlayerId: o.controllingPlayerId ?? null,
    isContested: o.isContested ?? false,
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
    state.objectives = mapObjectives;
    state.status = 'in-progress';
    state.turnState.phase = 'deployment';
    state.turnState.roundNumber = 0;
    state.turnState.startingPlayerId = state.hostId;
    state.turnState.currentPlayerId = state.hostId;
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
  state.objectives = mapObjectives;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
}
