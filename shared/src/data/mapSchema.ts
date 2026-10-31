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

export const TERRAIN_PALETTE_CATALOG: Record<string, TerrainTypeMetadata> = {
  // Heavy Industrial Buildings & Structures
  'building-a': {
    type: 'building-a',
    displayName: 'Industrial Warehouse',
    category: 'structures',
    defaultScale: { x: 6, y: 3.5, z: 6 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    elevation: 3.5,
    description: 'Large enclosed industrial warehouse block with flat walkable roof.',
  },
  'building-c': {
    type: 'building-c',
    displayName: 'Refinery Facility',
    category: 'structures',
    defaultScale: { x: 5, y: 3.0, z: 5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    elevation: 3.0,
    description: 'Refinery facility with roof access for snipers and overwatch fire.',
  },
  'building-f': {
    type: 'building-f',
    displayName: 'Chemical Silo',
    category: 'structures',
    defaultScale: { x: 4, y: 4.0, z: 4 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: false,
    description: 'Heavy cylindrical industrial storage tank completely blocking LOS.',
  },
  'building-h': {
    type: 'building-h',
    displayName: 'Service Workshop',
    category: 'structures',
    defaultScale: { x: 3.5, y: 2.5, z: 3.5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    elevation: 2.5,
    description: 'Compact workshop building providing heavy cover and roof elevation.',
  },
  'building-l': {
    type: 'building-l',
    displayName: 'Two-Story Factory',
    category: 'structures',
    defaultScale: { x: 6, y: 4.5, z: 5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    isWalkable: true,
    elevation: 4.5,
    description: 'Multi-tiered industrial complex offering strong high-ground positions.',
  },

  // Modular Walls, Doorways & Windows
  wall: {
    type: 'wall',
    displayName: 'Solid Wall',
    category: 'walls',
    defaultScale: { x: 3, y: 1.5, z: 0.5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Standard solid defense wall blocking line-of-sight and movement.',
  },
  'wall-doorway': {
    type: 'wall-doorway',
    displayName: 'Wall with Doorway',
    category: 'walls',
    defaultScale: { x: 3, y: 1.5, z: 0.5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Tactical breach wall with open doorway passage for infantry.',
  },
  'wall-doorway-square': {
    type: 'wall-doorway-square',
    displayName: 'Reinforced Doorway',
    category: 'walls',
    defaultScale: { x: 3, y: 1.5, z: 0.5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Heavy square industrial frame doorway.',
  },
  'wall-window': {
    type: 'wall-window',
    displayName: 'Windowed Wall',
    category: 'walls',
    defaultScale: { x: 3, y: 1.5, z: 0.5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Wall with viewing aperture providing light cover and line-of-sight.',
  },
  'wall-corner': {
    type: 'wall-corner',
    displayName: 'Corner Wall',
    category: 'walls',
    defaultScale: { x: 2, y: 1.5, z: 2 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: '90-degree corner wall junction for building defensive redoubts.',
  },
  'wall-half': {
    type: 'wall-half',
    displayName: 'Short Wall Segment',
    category: 'walls',
    defaultScale: { x: 1.5, y: 1.5, z: 0.5 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Half-length modular wall piece for precise perimeter gaps.',
  },
  'wall-low': {
    type: 'wall-low',
    displayName: 'Low Parapet / Sandbag',
    category: 'walls',
    defaultScale: { x: 2, y: 0.8, z: 0.3 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Low chest-height barricade granting cover without blocking visibility.',
  },

  // Platforms, Catwalks & Roofs
  platform: {
    type: 'platform',
    displayName: 'Elevated Platform',
    category: 'platforms',
    defaultScale: { x: 3, y: 0.3, z: 3 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    isWalkable: true,
    elevation: 2.5,
    description: 'Modular metal platform elevated above the battlefield.',
  },
  'roof-flat-patch-large': {
    type: 'roof-flat-patch-large',
    displayName: 'Large Catwalk Deck',
    category: 'platforms',
    defaultScale: { x: 4, y: 0.3, z: 4 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    isWalkable: true,
    elevation: 3.0,
    description: 'Spacious industrial catwalk deck for squad positioning.',
  },
  'roof-flat-side': {
    type: 'roof-flat-side',
    displayName: 'Walkway Bridge',
    category: 'platforms',
    defaultScale: { x: 3, y: 0.2, z: 1.5 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    isWalkable: true,
    elevation: 2.5,
    description: 'Connecting catwalk bridge span between adjacent platforms.',
  },
  'roof-flat-corner': {
    type: 'roof-flat-corner',
    displayName: 'Catwalk Corner Deck',
    category: 'platforms',
    defaultScale: { x: 2, y: 0.2, z: 2 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    isWalkable: true,
    elevation: 2.5,
    description: 'L-corner junction platform piece.',
  },

  // Stairs & Ladders (Vertical Traversal)
  stairs: {
    type: 'stairs',
    displayName: 'Metal Stairs',
    category: 'stairs-ladders',
    defaultScale: { x: 1.5, y: 2.5, z: 1.0 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    climbType: 'stairs',
    climbSlope: 45,
    description: 'Standard access stairs connecting ground level to 2.5" platforms.',
  },
  'stairs-open': {
    type: 'stairs-open',
    displayName: 'Open Industrial Stairs',
    category: 'stairs-ladders',
    defaultScale: { x: 1.5, y: 3.0, z: 1.2 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    climbType: 'stairs',
    climbSlope: 45,
    description: 'Open industrial staircase climbing to 3.0" platforms.',
  },
  'stairs-closed-short': {
    type: 'stairs-closed-short',
    displayName: 'Compact Stair Steps',
    category: 'stairs-ladders',
    defaultScale: { x: 1.2, y: 1.5, z: 1.0 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    climbType: 'stairs',
    climbSlope: 45,
    description: 'Short rise staircase for slight elevation transitions.',
  },
  'stairs-sides': {
    type: 'stairs-sides',
    displayName: 'Railed High Stairs',
    category: 'stairs-ladders',
    defaultScale: { x: 1.5, y: 3.5, z: 1.2 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    climbType: 'stairs',
    climbSlope: 45,
    description: 'Steep railed industrial stairway ascending to high catwalks.',
  },
  ladder: {
    type: 'ladder',
    displayName: 'Access Ladder',
    category: 'stairs-ladders',
    defaultScale: { x: 0.5, y: 2.5, z: 1.0 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    climbType: 'ladder',
    climbSlope: 90,
    description: 'Vertical wall-mounted ladder for direct high-ground ascension.',
  },

  // Scatter & Cover Elements
  crate: {
    type: 'crate',
    displayName: 'Supply Crate',
    category: 'scatter',
    defaultScale: { x: 1, y: 1, z: 1 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Cargo container providing light chest-height cover.',
  },
  'column-wide': {
    type: 'column-wide',
    displayName: 'Heavy Pillar',
    category: 'scatter',
    defaultScale: { x: 1.2, y: 3.0, z: 1.2 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Heavy structural pillar blocking vision and movement.',
  },
  column: {
    type: 'column',
    displayName: 'Support Column',
    category: 'scatter',
    defaultScale: { x: 1, y: 2.5, z: 1 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    description: 'Vertical column offering solid directional cover.',
  },
  pipe: {
    type: 'pipe',
    displayName: 'Industrial Conduit',
    category: 'scatter',
    defaultScale: { x: 3, y: 0.8, z: 0.8 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Low horizontal conduit pipe segment offering directional cover.',
  },
  'detail-pipe': {
    type: 'detail-pipe',
    displayName: 'Surface Pipe Run',
    category: 'scatter',
    defaultScale: { x: 2, y: 0.5, z: 0.5 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Compact surface conduit pipeline.',
  },
  'barricade-doorway': {
    type: 'barricade-doorway',
    displayName: 'Doorway Barricade',
    category: 'scatter',
    defaultScale: { x: 1.5, y: 1.0, z: 0.4 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Improvised debris barricade blocking passage through doors.',
  },
  'barricade-window': {
    type: 'barricade-window',
    displayName: 'Window Barricade',
    category: 'scatter',
    defaultScale: { x: 1.2, y: 0.8, z: 0.3 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
    description: 'Reinforced window shutters granting defense against incoming fire.',
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
