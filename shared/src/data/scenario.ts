import { GameState, TerrainPiece, Unit } from '../gameTypes';
import {
  ARMY_FRONTIER_WARDENS,
  ARMY_RUST_RAIDERS,
  createUnitFromFighter,
} from './armies';

/**
 * Default v1 scenario data: each player deploys a five-fighter force on
 * opposite edges of the board, with a scattering of terrain toward the
 * middle. Terrain types match the renderer's asset manifest (walls, crates,
 * columns). Pure data — the engine has no scenario-specific logic.
 *
 * Board: 44 x 60 board units, centered at the origin (x: -22..22, z: -30..30).
 */

const DEPLOYMENT_SPREAD = [-8, -4, 0, 4, 8];
const HOST_DEPLOYMENT_Z = -26;
const GUEST_DEPLOYMENT_Z = 26;

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
      position: { x: 0, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-wall-south',
      terrainType: 'wall-window',
      position: { x: -6, y: 0, z: -10 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-wall-east',
      terrainType: 'wall-doorway',
      position: { x: 12, y: 0, z: 0 },
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
      position: { x: -12, y: 0, z: 6 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-column-west',
      terrainType: 'column',
      position: { x: -10, y: 0, z: 14 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 2.5, z: 1 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'terrain-column-east',
      terrainType: 'column',
      position: { x: 10, y: 0, z: -14 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 2.5, z: 1 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
  ];
}

/** Apply the default scenario to a fresh game state (host-side, at start). */
export function applyDefaultScenario(state: GameState): void {
  state.units = createDefaultScenarioUnits(state.hostId, state.guestId);
  state.terrain = createDefaultScenarioTerrain();
  state.markers = [];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
}
