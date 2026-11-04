import { Objective, TerrainPiece } from '../gameTypes';
import { Vector3 } from '../types';

export type TerrainCategory =
  | 'structures'
  | 'walls'
  | 'platforms'
  | 'stairs-ladders'
  | 'scatter';

export interface TerrainTypeMetadata {
  type: string;
  displayName: string;
  category: TerrainCategory;
  defaultScale: Vector3;
  blocksLineOfSight: boolean;
  providesCover: boolean;
  isObstacle: boolean;
  isWalkable?: boolean;
  elevation?: number;
  climbType?: 'ladder' | 'stairs';
  climbSlope?: number;
  /** Default for "models may climb onto this piece's floor (rise up to 3\") without a ladder". Pieces can override it. */
  climbable?: boolean;
  description?: string;
}

/**
 * Terrain palette. Only pieces with a procedural model (see ModelLoader) are listed;
 * dimensions are in inches (1.0 unit = 1").
 */
export const TERRAIN_PALETTE_CATALOG: Record<string, TerrainTypeMetadata> = {
  'ruin-l': {
    type: 'ruin-l',
    climbable: true,
    displayName: 'L-Corner Ruin',
    category: 'structures',
    defaultScale: { x: 4, y: 4, z: 4 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Two perpendicular ruined walls with firing ports around an open courtyard.',
  },
  'wall-short': {
    type: 'wall-short',
    displayName: 'Solid Wall (2")',
    category: 'walls',
    defaultScale: { x: 2, y: 2.5, z: 0.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Short 2" wall component; place several end to end to build longer walls.',
  },
  wall: {
    type: 'wall',
    displayName: 'Solid Wall (4")',
    category: 'walls',
    defaultScale: { x: 4, y: 2.5, z: 0.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Solid wall blocking line-of-sight and movement.',
  },
  'wall-long': {
    type: 'wall-long',
    displayName: 'Solid Wall (6")',
    category: 'walls',
    defaultScale: { x: 6, y: 2.5, z: 0.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Long solid wall blocking line-of-sight and movement.',
  },
  'wall-window': {
    type: 'wall-window',
    displayName: 'Window Wall',
    category: 'walls',
    defaultScale: { x: 4, y: 2.5, z: 0.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Wall with solid lower breastwork and an open upper window.',
  },
  'wall-doorway': {
    type: 'wall-doorway',
    displayName: 'Doorway Wall',
    category: 'walls',
    defaultScale: { x: 4, y: 2.5, z: 0.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Wall with a central doorway opening.',
  },
  column: {
    type: 'column',
    displayName: 'Structural Column',
    category: 'structures',
    defaultScale: { x: 1.25, y: 3, z: 1.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Square pillar with plinth and cap.',
  },

  // Elevation (13.6C): platforms, catwalks, supports and deck furniture
  'platform-small': {
    type: 'platform-small',
    climbable: false,
    displayName: 'Platform (4"×4")',
    category: 'platforms',
    defaultScale: { x: 4, y: 3, z: 4 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    description: 'Walkable deck at 3.0" on four support pillars; models can stand and walk beneath it.',
  },
  'platform-large': {
    type: 'platform-large',
    climbable: false,
    displayName: 'Platform (6"×4")',
    category: 'platforms',
    defaultScale: { x: 6, y: 3, z: 4 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    description: 'Large walkable deck at 3.0" on four support pillars.',
  },
  catwalk: {
    type: 'catwalk',
    climbable: false,
    displayName: 'Catwalk (6"×2")',
    category: 'platforms',
    defaultScale: { x: 6, y: 3, z: 2 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    description: 'Suspended walkway at 3.0" spanning gaps between platforms (no legs).',
  },
  'support-pillar': {
    type: 'support-pillar',
    displayName: 'Support Pillar',
    category: 'platforms',
    defaultScale: { x: 0.5, y: 2.75, z: 0.5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Thin 0.5" support from the ground to a deck underside; place extra supports under catwalks.',
  },
  // Low cover & scatter (13.6D)
  barricade: {
    type: 'barricade',
    displayName: 'Barricade (3")',
    category: 'scatter',
    defaultScale: { x: 3, y: 0.5, z: 0.25 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Low 0.5" barricade: low cover that does not block sight. Stacks on decks.',
  },
  crate: {
    type: 'crate',
    displayName: 'Supply Crate',
    category: 'scatter',
    defaultScale: { x: 1, y: 0.75, z: 1 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Low 0.75" crate: low cover that does not block sight. Stacks on decks.',
  },
  'industrial-pipe': {
    type: 'industrial-pipe',
    displayName: 'Industrial Pipe (4")',
    category: 'scatter',
    defaultScale: { x: 4, y: 0.75, z: 0.75 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Low 0.75" conduit: low cover that does not block sight.',
  },
  'shipping-container': {
    type: 'shipping-container',
    climbable: true,
    displayName: 'Shipping Container (5")',
    category: 'scatter',
    defaultScale: { x: 5, y: 2.25, z: 2.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    description: 'Solid 2.25" container that blocks sight; its flat roof is a walkable floor.',
  },
  stairs: {
    type: 'stairs',
    displayName: 'Stairs (2"×4")',
    category: 'stairs-ladders',
    defaultScale: { x: 2, y: 3, z: 4 },
    blocksLineOfSight: false,
    providesCover: false,
    isObstacle: false,
    climbType: 'stairs',
    climbSlope: 37,
    description: 'Continuous ramp from the ground up to the 3.0" floor tier.',
  },
  ladder: {
    type: 'ladder',
    displayName: 'Wall Ladder',
    category: 'stairs-ladders',
    defaultScale: { x: 0.5, y: 3, z: 0.25 },
    blocksLineOfSight: false,
    providesCover: false,
    isObstacle: false,
    climbType: 'ladder',
    description: 'Vertical ladder up to the 3.0" floor tier; snaps to wall and deck faces in the editor.',
  },
};

export interface CustomMapDefinition {
  id: string;
  name: string;
  author?: string;
  version?: number;
  description?: string;
  board?: {
    width: number;
    height: number;
    theme?: string;
  };
  terrain: TerrainPiece[];
  objectives?: Objective[];
  deploymentZones?: {
    hostSouthMinZ: number;
    guestNorthMaxZ: number;
  };
}

/** Default board edge (inches) for new maps and fresh game states. */
export const DEFAULT_BOARD_SIZE = 48;
/** Smallest / largest allowed board edge (whole inches). */
export const MIN_BOARD_SIZE = 24;
export const MAX_BOARD_SIZE = 72;
/** Deployment zones are at most this deep, and the two zones must stay at least this far apart. */
export const MAX_DEPLOYMENT_ZONE_DEPTH = 12;
export const MIN_ZONE_SEPARATION = 24;
/** Board depth under which zones shrink below the standard 6" (warning), and below which no zone fits (error). */
export const MIN_COMFORTABLE_BOARD_DEPTH = 36;
export const MIN_VALID_BOARD_DEPTH = MIN_ZONE_SEPARATION + 2;

/**
 * Depth (inches) of each player's deployment zone on a board of the given depth (z extent): up to 12", but never
 * so deep that the zones end up less than 24" apart. At least 1".
 */
export function getDeploymentZoneDepth(boardDepth: number): number {
  return Math.max(1, Math.min(MAX_DEPLOYMENT_ZONE_DEPTH, boardDepth / 2 - MIN_ZONE_SEPARATION / 2));
}

export interface MapValidationNotice {
  severity: 'error' | 'warning' | 'info';
  message: string;
  pieceId?: string;
}

/**
 * Validates custom map layout for tactical playability and standard tabletop rules.
 * Generates advisory warnings without hard-blocking sandbox creativity.
 */
/** Types outside the catalog that still count as climbable by default (older saved maps). */
const LEGACY_CLIMBABLE_TYPES: readonly string[] = ['ruin'];

/**
 * Whether models may climb onto this piece's floor without a ladder or stairs (rise up to 3"):
 * the piece's own `climbable` override, else its catalog default, else no.
 */
export function isClimbable(piece: Pick<TerrainPiece, 'terrainType' | 'climbable'>): boolean {
  if (piece.climbable !== undefined) return piece.climbable;
  const meta = TERRAIN_PALETTE_CATALOG[piece.terrainType];
  if (meta?.climbable !== undefined) return meta.climbable;
  return LEGACY_CLIMBABLE_TYPES.includes(piece.terrainType);
}

export function validateMapDefinition(map: CustomMapDefinition): MapValidationNotice[] {
  const notices: MapValidationNotice[] = [];

  if (!map.terrain || map.terrain.length === 0) {
    notices.push({
      severity: 'warning',
      message: 'The battlefield currently contains 0 terrain pieces. Matches may become open shooting galleries.',
    });
  }

  const objectives = map.objectives ?? [];
  if (objectives.length > 0 && objectives.length < 3) {
    notices.push({
      severity: 'warning',
      message: `Only ${objectives.length} objective marker(s) defined. Standard skirmish rules recommend at least 3 objectives.`,
    });
  }

  // Board size
  const boardW = map.board?.width ?? DEFAULT_BOARD_SIZE;
  const boardH = map.board?.height ?? DEFAULT_BOARD_SIZE;
  const isValidEdge = (v: number) => Number.isInteger(v) && v >= MIN_BOARD_SIZE && v <= MAX_BOARD_SIZE;
  if (!isValidEdge(boardW)) {
    notices.push({
      severity: 'error',
      message: `Board width ${boardW}" must be a whole number of inches between ${MIN_BOARD_SIZE}" and ${MAX_BOARD_SIZE}".`,
    });
  }
  if (!isValidEdge(boardH)) {
    notices.push({
      severity: 'error',
      message: `Board height ${boardH}" must be a whole number of inches between ${MIN_BOARD_SIZE}" and ${MAX_BOARD_SIZE}".`,
    });
  }
  if (boardH < MIN_VALID_BOARD_DEPTH) {
    notices.push({
      severity: 'error',
      message: `Board depth ${boardH}" is too shallow: the two armies cannot deploy ${MIN_ZONE_SEPARATION}" apart (minimum ${MIN_VALID_BOARD_DEPTH}").`,
    });
  } else if (boardH < MIN_COMFORTABLE_BOARD_DEPTH) {
    notices.push({
      severity: 'warning',
      message: `Board depth ${boardH}" gives deployment zones only ${getDeploymentZoneDepth(boardH).toFixed(1)}" deep (under 6"). ${MIN_COMFORTABLE_BOARD_DEPTH}" or more is recommended.`,
    });
  }

  // Deployment zones for this board (same maths as getDeploymentZoneBounds), unless the map overrides them
  const zoneDepth = getDeploymentZoneDepth(boardH);
  const hostSouthZ = map.deploymentZones?.hostSouthMinZ ?? -boardH / 2 + zoneDepth;
  const guestNorthZ = map.deploymentZones?.guestNorthMaxZ ?? boardH / 2 - zoneDepth;

  for (const t of map.terrain ?? []) {
    if (Math.abs(t.position.x) > boardW / 2 || Math.abs(t.position.z) > boardH / 2) {
      notices.push({
        severity: 'warning',
        message: `Terrain piece "${t.id}" is outside the ${boardW}" x ${boardH}" board.`,
        pieceId: t.id,
      });
    }
  }

  for (let i = 0; i < objectives.length; i++) {
    const objA = objectives[i];
    if (Math.abs(objA.position.x) > boardW / 2 || Math.abs(objA.position.z) > boardH / 2) {
      notices.push({
        severity: 'warning',
        message: `Objective "${objA.name}" is outside the ${boardW}" x ${boardH}" board.`,
        pieceId: objA.id,
      });
    }
    if (objA.position.z <= hostSouthZ) {
      notices.push({
        severity: 'warning',
        message: `Objective "${objA.name}" is positioned inside the Host deployment zone (z: ${objA.position.z.toFixed(1)}).`,
        pieceId: objA.id,
      });
    } else if (objA.position.z >= guestNorthZ) {
      notices.push({
        severity: 'warning',
        message: `Objective "${objA.name}" is positioned inside the Guest deployment zone (z: ${objA.position.z.toFixed(1)}).`,
        pieceId: objA.id,
      });
    }

    // Pairwise distance check (> 9" recommended)
    for (let j = i + 1; j < objectives.length; j++) {
      const objB = objectives[j];
      const dx = objA.position.x - objB.position.x;
      const dz = objA.position.z - objB.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 9.0) {
        notices.push({
          severity: 'warning',
          message: `Objectives "${objA.name}" and "${objB.name}" are only ${dist.toFixed(1)}" apart (recommended > 9.0").`,
        });
      }
    }

    // Check if an objective is placed inside an obstacle/solid wall
    for (const t of map.terrain) {
      if (t.isObstacle && t.scale) {
        // If the piece is elevated and walkable and the objective is placed on its surface, this is valid
        if (t.isWalkable && t.elevation && objA.position.y >= t.elevation - 0.1) {
          continue;
        }
        const halfX = t.scale.x / 2;
        const halfZ = t.scale.z / 2;
        if (
          Math.abs(objA.position.x - t.position.x) < halfX &&
          Math.abs(objA.position.z - t.position.z) < halfZ
        ) {
          notices.push({
            severity: 'warning',
            message: `Objective "${objA.name}" appears inside obstacle terrain piece "${t.id}".`,
            pieceId: objA.id,
          });
        }
      }
    }
  }

  return notices;
}
