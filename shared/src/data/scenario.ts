import { GameState, Objective, TerrainPiece, Unit } from '../gameTypes';
import {
  ARMY_FRONTIER_WARDENS,
  ARMY_RUST_RAIDERS,
  STARTER_ARMIES,
  createUnitFromFighter,
  createUnitsFromStarterArmy,
} from './armies';

/**
 * Default v1 scenario data: each player deploys a five-fighter force on
 * opposite edges of the board, with a scattering of terrain toward the
 * middle. Terrain types match the renderer's asset manifest (walls, crates,
 * columns). Pure data — the engine has no scenario-specific logic.
 *
 * Board: 36 x 36 board units (standard skirmish size), centered at the origin
 * (x: -18..18, z: -18..18), with forces deployed 24" apart (z = ±12).
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

/** Central terrain layout — cover to fight over, nothing blocking deployment. */
export function createDefaultScenarioTerrain(): TerrainPiece[] {
  return [
    {
      id: 'terrain-wall-north',
      terrainType: 'wall',
      position: { x: 0, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-wall-south',
      terrainType: 'wall-window',
      position: { x: -6, y: 0, z: -5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-wall-east',
      terrainType: 'wall-doorway',
      position: { x: 8, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-crate-center-1',
      terrainType: 'crate',
      position: { x: 1, y: 0, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-crate-center-2',
      terrainType: 'crate',
      position: { x: 3, y: 0, z: -1 },
      rotation: { x: 0, y: Math.PI / 4, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-crate-west',
      terrainType: 'crate',
      position: { x: -8, y: 0, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-column-west',
      terrainType: 'column',
      position: { x: -7, y: 0, z: 7 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 2.5, z: 1 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-column-east',
      terrainType: 'column',
      position: { x: 7, y: 0, z: -7 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 2.5, z: 1 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    // Multi-level verticality & testing map features
    {
      id: 'terrain-platform-west',
      terrainType: 'platform',
      position: { x: -6, y: 2.5, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 0.3, z: 3 },
      elevation: 2.5,
      isWalkable: true,
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    {
      id: 'terrain-ladder-west',
      terrainType: 'ladder',
      climbType: 'ladder',
      position: { x: -4.5, y: 0, z: 2 },
      rotation: { x: 0, y: -Math.PI / 2, z: 0 },
      scale: { x: 0.5, y: 2.5, z: 1.0 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    {
      id: 'terrain-platform-east',
      terrainType: 'platform',
      position: { x: 6, y: 2.5, z: -2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 0.3, z: 3 },
      elevation: 2.5,
      isWalkable: true,
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    {
      id: 'terrain-stairs-east',
      terrainType: 'stairs',
      climbType: 'stairs',
      position: { x: 4.5, y: 0, z: -2 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1.5, y: 2.5, z: 1.0 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    {
      id: 'terrain-wall-low-north',
      terrainType: 'wall-low',
      position: { x: 4, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 0.8, z: 0.3 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-pipe-center',
      terrainType: 'pipe',
      position: { x: -2, y: 0, z: -3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 0.8, z: 0.8 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-toxic-sludge',
      terrainType: 'toxic',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2.5, y: 0.05, z: 2.5 },
      isDangerous: true,
      isDifficult: true,
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
    },
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
}

/** Apply the default scenario to a fresh game state (host-side, at start). */
export function applyDefaultScenario(state: GameState, options: ScenarioOptions = {}): void {
  const hostStarter = options.hostArmyId && options.hostArmyId in STARTER_ARMIES
    ? STARTER_ARMIES[options.hostArmyId as keyof typeof STARTER_ARMIES]
    : null;
  const guestStarter = options.guestArmyId && options.guestArmyId in STARTER_ARMIES
    ? STARTER_ARMIES[options.guestArmyId as keyof typeof STARTER_ARMIES]
    : null;

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
    state.terrain = createDefaultScenarioTerrain();
    state.markers = [];
    state.objectives = createDefaultScenarioObjectives();
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
  } else {
    state.units = createDefaultScenarioUnits(state.hostId, state.guestId);
  }

  state.terrain = createDefaultScenarioTerrain();
  state.markers = [];
  state.objectives = createDefaultScenarioObjectives();
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
}
