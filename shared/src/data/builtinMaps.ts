import { TerrainPiece } from '../gameTypes';
import { CustomMapDefinition, DEFAULT_BOARD_SIZE, TERRAIN_PALETTE_CATALOG } from './mapSchema';
import { createBalancedObjectives } from './scenario';

/**
 * Built-in maps: ready-made tables shipped as code. They are copied when chosen, never edited in place.
 *
 * The Standard Battlefield is a 48"x48" table made only of catalog pieces at their default sizes. The
 * layout is point-symmetric about the board centre: each piece placed at (x, z, yaw) has a twin at
 * (-x, -z, yaw + pi), so both players face the same table.
 */

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

interface Placement {
  type: string;
  x: number;
  z: number;
  yaw?: number;
  /** Override for fittings that snap to a deck (ladders): the rise to the deck top. */
  scaleY?: number;
}

/** Piece from the catalog at its default scale and flags (the same fields the editor writes on placement). */
function buildPiece(id: string, placement: Placement): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[placement.type];
  if (!meta) throw new Error(`Built-in map uses unknown terrain type '${placement.type}'`);
  const piece: TerrainPiece = {
    id,
    terrainType: placement.type,
    position: { x: placement.x, y: 0, z: placement.z },
    rotation: { x: 0, y: placement.yaw ?? 0, z: 0 },
    scale: { ...meta.defaultScale, ...(placement.scaleY !== undefined ? { y: placement.scaleY } : {}) },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: meta.isWalkable ?? false,
  };
  if (meta.climbType) piece.climbType = meta.climbType;
  if (meta.isDifficult !== undefined) piece.isDifficult = meta.isDifficult;
  if (meta.isDangerous !== undefined) piece.isDangerous = meta.isDangerous;
  return piece;
}

/**
 * Ladder on the west face of the platform centred at (platformX, platformZ): the same maths as the editor's
 * face snap. The face centre is the ladder position, local +Z points into the floor (yaw = atan2(-nx, -nz)
 * for the outward normal (-1, 0)), and the rise equals the deck height.
 */
function ladderOnWestFace(platformX: number, platformZ: number): Placement {
  const platform = TERRAIN_PALETTE_CATALOG['platform-small'].defaultScale;
  return {
    type: 'ladder',
    x: platformX - platform.x / 2,
    z: platformZ,
    yaw: Math.atan2(1, 0),
    scaleY: platform.y,
  };
}

/** Half of the table (piece A of each pair). The catwalk spans the centre and is its own twin. */
const HALF_LAYOUT: Placement[] = [
  { type: 'platform-small', x: -5, z: 0 },
  ladderOnWestFace(-5, 0),
  { type: 'stairs', x: -5, z: -4 },
  { type: 'ruin-l', x: -14, z: 2 },
  { type: 'shipping-container', x: -16, z: -7, yaw: QUARTER_TURN },
  { type: 'rubble-field', x: 4, z: -10 },
  { type: 'rubble-field', x: 20, z: -12 },
  { type: 'rubble-field', x: -10, z: -4 },
  { type: 'rubble-field', x: -20, z: -18 },
  { type: 'rubble-field', x: -22, z: -10, yaw: QUARTER_TURN },
  { type: 'hazard-pool', x: 0, z: -5 },
  { type: 'wall-window', x: -20, z: -2, yaw: QUARTER_TURN },
  { type: 'wall-long', x: 8, z: -16 },
  { type: 'wall', x: -10, z: -12 },
  { type: 'column', x: -3, z: -12 },
  { type: 'barricade', x: -12, z: 6 },
  { type: 'wall-short', x: 21, z: -8, yaw: QUARTER_TURN },
  { type: 'rubble-field', x: -2, z: -17 },
];

export function createStandardBattlefieldMap(): CustomMapDefinition {
  const counts: Record<string, number> = {};
  const nextId = (type: string) => {
    counts[type] = (counts[type] ?? 0) + 1;
    return `std-${type}-${counts[type]}`;
  };

  const placements: Placement[] = [{ type: 'catwalk', x: 0, z: 0 }];
  for (const a of HALF_LAYOUT) {
    placements.push(a);
    placements.push({ ...a, x: -a.x, z: -a.z, yaw: (a.yaw ?? 0) + HALF_TURN });
  }

  return {
    id: 'standard-battlefield',
    name: 'Standard Battlefield',
    version: 1,
    description:
      'A symmetric 48"x48" table of catalog terrain: two decks joined by a catwalk, ruins, walls, rubble and hazard pools.',
    board: { width: DEFAULT_BOARD_SIZE, height: DEFAULT_BOARD_SIZE },
    terrain: placements.map((p) => buildPiece(nextId(p.type), p)),
    objectives: createBalancedObjectives({ width: DEFAULT_BOARD_SIZE, height: DEFAULT_BOARD_SIZE }),
  };
}

/** Built-in maps by id. Each call returns a fresh copy. */
export const BUILTIN_MAPS: Record<string, () => CustomMapDefinition> = {
  'standard-battlefield': createStandardBattlefieldMap,
};
