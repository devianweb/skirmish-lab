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

/**
 * Grid rule: every height, thickness and opening is a multiple of 0.25" at the piece's default
 * scale (see TERRAIN_PALETTE_CATALOG). Bounds are stored as fractions of scale, so each piece
 * declares its default size and writes dimensions in inches via `fx` / `fy`; a test guards the grid.
 */
const fx = (inches: number, lengthInches: number): number => inches / lengthInches;

/** Wall pieces: 2.5" tall, 0.25" thick. */
const WALL_H = 2.5;
const WALL_LEN = 4;
const wallY = (inches: number): number => fx(inches, WALL_H);

/** L-corner ruin: 4" x 4" x 4"; walls 0.25" thick. */
const RUIN_SIZE = 4;
const ruinY = (inches: number): number => fx(inches, RUIN_SIZE);
const RUIN_T = fx(0.25, RUIN_SIZE);

/** Doorway opening: 1.5" wide, 2.25" tall, on a 4" wall. */
const DOOR_HALF = fx(0.75, WALL_LEN);
export const DOORWAY_OPENING_FRACTION = DOOR_HALF * 2;

/**
 * A solid wall made of `segments` equal 2" components laid end to end, so 2", 4" and 6" walls are
 * the same building block (and a custom wall is just more segments).
 */
function segmentedWall(id: string, segments: number): TerrainGroup {
  const solids: TerrainSolid[] = [];
  for (let i = 0; i < segments; i++) {
    solids.push(solid([-0.5 + i / segments, -0.5 + (i + 1) / segments], [0, 1], FULL, `${id}-segment-${i + 1}`));
  }
  return { id, solids };
}

export const TERRAIN_STRUCTURES: Record<string, TerrainGroup> = {
  'wall-short': segmentedWall('wall-short', 1),
  wall: segmentedWall('wall', 2),
  'wall-long': segmentedWall('wall-long', 3),
  column: { id: 'column', solids: [solid(FULL, [0, 1], FULL, 'column-body')] },

  // Window wall: full-height jambs either side of a 2.5" port, a 1.0" sill beneath it and a lintel above.
  'wall-window': portWallAlongX('wall-window', FULL, fx(1.25, WALL_LEN), 1, wallY(1.0), wallY(2.25)),

  // Doorway wall: two jambs and a lintel; no sill and no aperture (open air, free to walk and see).
  'wall-doorway': {
    id: 'wall-doorway',
    solids: [
      solid([-0.5, -DOOR_HALF], [0, 1], FULL, 'jamb-left'),
      solid([DOOR_HALF, 0.5], [0, 1], FULL, 'jamb-right'),
      solid([-DOOR_HALF, DOOR_HALF], [wallY(2.25), 1], FULL, 'lintel'),
    ],
  },
};

// --- Elevation (13.6C) ------------------------------------------------------------------------
/** Floor tier: deck tops sit at 3.0"; decks are 0.25" thick; supports are 0.5" square. */
const TIER = 3.0;
const DECK_T = 0.25;
const PILLAR = 0.5;
const PILLAR_INSET = 0.25;

/** One support pillar from the ground to the deck underside, centred at (cx, cz) (inches from centre). */
function pillar(id: string, cxIn: number, czIn: number, lenX: number, lenZ: number): TerrainSolid {
  return solid(
    [(cxIn - PILLAR / 2) / lenX, (cxIn + PILLAR / 2) / lenX],
    [0, (TIER - DECK_T) / TIER],
    [(czIn - PILLAR / 2) / lenZ, (czIn + PILLAR / 2) / lenZ],
    id
  );
}

/** Walkable deck filling the footprint, its top face at the floor tier. */
const deckSolid = (id: string): TerrainSolid =>
  solid(FULL, [(TIER - DECK_T) / TIER, 1], FULL, id, { walkable: true });

/** Platform: a deck on four corner support pillars (the same pillar as the standalone piece). */
function platform(id: string, lenX: number, lenZ: number): TerrainGroup {
  const ox = lenX / 2 - PILLAR_INSET - PILLAR / 2;
  const oz = lenZ / 2 - PILLAR_INSET - PILLAR / 2;
  return {
    id,
    solids: [
      deckSolid(`${id}-deck`),
      pillar(`${id}-pillar-1`, -ox, -oz, lenX, lenZ),
      pillar(`${id}-pillar-2`, ox, -oz, lenX, lenZ),
      pillar(`${id}-pillar-3`, -ox, oz, lenX, lenZ),
      pillar(`${id}-pillar-4`, ox, oz, lenX, lenZ),
    ],
  };
}

TERRAIN_STRUCTURES['platform-small'] = platform('platform-small', 4, 4);
TERRAIN_STRUCTURES['platform-large'] = platform('platform-large', 6, 4);
/** Catwalk: a bare walkable deck (no legs) that spans between platforms. */
TERRAIN_STRUCTURES.catwalk = { id: 'catwalk', solids: [deckSolid('catwalk-deck')] };
/** Standalone support pillar (2.75" tall: ground to deck underside). */
TERRAIN_STRUCTURES['support-pillar'] = { id: 'support-pillar', solids: [solid(FULL, [0, 1], FULL, 'pillar-body')] };
/** Deck railing (1.0" tall, low cover: set blocksLineOfSight false on the piece) and parapet wall (1.5"). */
TERRAIN_STRUCTURES['deck-railing'] = { id: 'deck-railing', solids: [solid(FULL, [0, 1], FULL, 'railing-body')] };
TERRAIN_STRUCTURES['deck-parapet'] = { id: 'deck-parapet', solids: [solid(FULL, [0, 1], FULL, 'parapet-body')] };

// L-corner ruin: a group of two port walls (north and west). The courtyard is empty space.

const LEDGE_DEPTH = 1.25;
const LEDGE_Y: Range = [(TIER - DECK_T) / RUIN_SIZE, TIER / RUIN_SIZE];
const RUIN: TerrainGroup = {
  id: 'ruin-l',
  groups: [
    // Second-floor L-ledge at the floor tier, running along the inside faces of the north and west walls
    {
      id: 'ledge',
      solids: [
        solid(
          [-0.5 + RUIN_T, 0.5],
          LEDGE_Y,
          [0.5 - RUIN_T - LEDGE_DEPTH / RUIN_SIZE, 0.5 - RUIN_T],
          'ledge-north',
          { walkable: true }
        ),
        solid(
          [-0.5 + RUIN_T, -0.5 + RUIN_T + LEDGE_DEPTH / RUIN_SIZE],
          LEDGE_Y,
          [-0.5, 0.5 - RUIN_T - LEDGE_DEPTH / RUIN_SIZE],
          'ledge-west',
          { walkable: true }
        ),
      ],
    },
    portWallAlongX('north-wall', [0.5 - RUIN_T, 0.5], fx(0.5, RUIN_SIZE), 1, ruinY(1.0), ruinY(2.25)),
    portWallAlongZ('west-wall', [-0.5, -0.5 + RUIN_T], fx(0.5, RUIN_SIZE), 1, ruinY(1.0), ruinY(2.25)),
  ],
};
TERRAIN_STRUCTURES.ruin = RUIN;
TERRAIN_STRUCTURES['ruin-l'] = RUIN;
