import { TerrainAperture, TerrainGroup, TerrainSolid } from '../gameTypes';

/**
 * Terrain structure definitions (data pack): every building-like piece is a group of solids and
 * apertures. Bounds are fractions of the piece's scale (x/z in [-0.5, 0.5], y in [0, 1]), the same
 * unit box the procedural meshes are built in, so the renderer and the rules engine share one
 * description and cannot drift apart.
 *
 * Only two primitives exist:
 *  - solids: walls, jambs, sills, lintels, columns (they block movement and/or sight by box height)
 *  - apertures: firing ports (not walkable; sight passes only while the port is manned)
 * Doorways have no aperture: the gap between jambs is open air.
 */

type Range = [min: number, max: number];

const solid = (x: Range, y: Range, z: Range, id: string, extra: Partial<TerrainSolid> = {}): TerrainSolid => ({
  id,
  minX: x[0],
  maxX: x[1],
  minY: y[0],
  maxY: y[1],
  minZ: z[0],
  maxZ: z[1],
  ...extra,
});

const aperture = (x: Range, y: Range, z: Range, id: string): TerrainAperture => ({
  id,
  minX: x[0],
  maxX: x[1],
  minY: y[0],
  maxY: y[1],
  minZ: z[0],
  maxZ: z[1],
  providesCover: true,
});

/** Wall with a port, running along local X (thickness on Z). Heights are fractions of scale.y. */
function portWallAlongX(
  id: string,
  z: Range,
  portHalf: number,
  wallTop: number,
  sillTop: number,
  lintelBottom: number
): TerrainGroup {
  return {
    id,
    solids: [
      solid([-0.5, -portHalf], [0, wallTop], z, `${id}-jamb-left`),
      solid([portHalf, 0.5], [0, wallTop], z, `${id}-jamb-right`),
      solid([-portHalf, portHalf], [0, sillTop], z, `${id}-sill`),
      solid([-portHalf, portHalf], [lintelBottom, wallTop], z, `${id}-lintel`),
    ],
    apertures: [aperture([-portHalf, portHalf], [sillTop, lintelBottom], z, `${id}-port`)],
  };
}

/** Wall with a port, running along local Z (thickness on X). */
function portWallAlongZ(
  id: string,
  x: Range,
  portHalf: number,
  wallTop: number,
  sillTop: number,
  lintelBottom: number
): TerrainGroup {
  return {
    id,
    solids: [
      solid(x, [0, wallTop], [-0.5, -portHalf], `${id}-jamb-back`),
      solid(x, [0, wallTop], [portHalf, 0.5], `${id}-jamb-front`),
      solid(x, [0, sillTop], [-portHalf, portHalf], `${id}-sill`),
      solid(x, [lintelBottom, wallTop], [-portHalf, portHalf], `${id}-lintel`),
    ],
    apertures: [aperture(x, [sillTop, lintelBottom], [-portHalf, portHalf], `${id}-port`)],
  };
}

const FULL: Range = [-0.5, 0.5];
/** L-corner ruin wall thickness: 0.25" on a 4" footprint. */
const RUIN_T = 0.0625;

/** Doorway opening width as a fraction of the wall length (1.4" on a 4" wall). */
export const DOORWAY_OPENING_FRACTION = 0.35;
const DOOR_HALF = DOORWAY_OPENING_FRACTION / 2;

const SOLID_WALL: TerrainGroup = { id: 'wall', solids: [solid(FULL, [0, 1], FULL, 'wall-body')] };

export const TERRAIN_STRUCTURES: Record<string, TerrainGroup> = {
  wall: SOLID_WALL,
  'wall-long': SOLID_WALL,
  column: { id: 'column', solids: [solid(FULL, [0, 1], FULL, 'column-body')] },

  // Window wall: full-height jambs either side of a port, a sill beneath it and a lintel above it.
  'wall-window': portWallAlongX('wall-window', FULL, 0.3, 1, 0.4, 0.9),

  // Doorway wall: two jambs and a lintel; no sill and no aperture (open air, free to walk and see).
  'wall-doorway': {
    id: 'wall-doorway',
    solids: [
      solid([-0.5, -DOOR_HALF], [0, 1], FULL, 'jamb-left'),
      solid([DOOR_HALF, 0.5], [0, 1], FULL, 'jamb-right'),
      solid([-DOOR_HALF, DOOR_HALF], [0.88, 1], FULL, 'lintel'),
    ],
  },
};

// L-corner ruin: a group of two port walls (north and west). The courtyard is empty space.
// The second-floor ledge is deferred to 13.6C.
const RUIN: TerrainGroup = {
  id: 'ruin-l',
  groups: [
    portWallAlongX('north-wall', [0.5 - RUIN_T, 0.5], 0.1, 0.75, 0.3, 0.5),
    portWallAlongZ('west-wall', [-0.5, -0.5 + RUIN_T], 0.1, 0.75, 0.3, 0.5),
  ],
};
TERRAIN_STRUCTURES.ruin = RUIN;
TERRAIN_STRUCTURES['ruin-l'] = RUIN;
