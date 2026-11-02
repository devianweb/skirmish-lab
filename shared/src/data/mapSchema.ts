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
  description?: string;
}

/**
 * Terrain palette. Only pieces with a procedural model (see ModelLoader) are listed;
 * dimensions are in inches (1.0 unit = 1").
 */
export const TERRAIN_PALETTE_CATALOG: Record<string, TerrainTypeMetadata> = {
  'ruin-l': {
    type: 'ruin-l',
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
  'deck-railing': {
    type: 'deck-railing',
    displayName: 'Deck Railing (3")',
    category: 'platforms',
    defaultScale: { x: 3, y: 1, z: 0.25 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Low 1.0" rail: low cover that does not block sight. Stacks on a deck.',
  },
  'deck-parapet': {
    type: 'deck-parapet',
    displayName: 'Deck Parapet (4")',
    category: 'platforms',
    defaultScale: { x: 4, y: 1.5, z: 0.25 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Solid 1.5" parapet wall that hides a crouching model. Stacks on a deck.',
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

export interface MapValidationNotice {
  severity: 'warning' | 'info';
  message: string;
  pieceId?: string;
}

/**
 * Validates custom map layout for tactical playability and standard tabletop rules.
 * Generates advisory warnings without hard-blocking sandbox creativity.
 */
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

  // Check objective spacing and placement relative to deployment zones (z = ±12)
  const hostSouthZ = map.deploymentZones?.hostSouthMinZ ?? -12;
  const guestNorthZ = map.deploymentZones?.guestNorthMaxZ ?? 12;

  for (let i = 0; i < objectives.length; i++) {
    const objA = objectives[i];
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
