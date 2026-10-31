import { CustomMapDefinition } from './mapSchema';
import {
  createDefaultScenarioObjectives,
  createDefaultScenarioTerrain,
} from './scenario';

/** Preset 1: The standard balanced skirmish battlefield. */
export function createFrontierOutpostPreset(): CustomMapDefinition {
  return {
    id: 'frontier-outpost',
    name: 'Frontier Outpost',
    author: 'SkirmishLab Official',
    version: 1,
    description: 'A fortified outpost featuring defensive perimeter walls, supply depots, access ladders, and central cover.',
    board: { width: 44, height: 30, theme: 'outpost' },
    terrain: createDefaultScenarioTerrain(),
    objectives: createDefaultScenarioObjectives(),
  };
}

export const MAP_PRESET_FRONTIER_OUTPOST: CustomMapDefinition = {
  id: 'frontier-outpost',
  name: 'Frontier Outpost',
  author: 'SkirmishLab Official',
  version: 1,
  description: 'A fortified outpost featuring defensive perimeter walls, supply depots, access ladders, and central cover.',
  board: { width: 44, height: 30, theme: 'outpost' },
  get terrain() {
    return createDefaultScenarioTerrain();
  },
  get objectives() {
    return createDefaultScenarioObjectives();
  },
};

/** Preset 2: Industrial Refinery featuring heavy buildings, silos, and pipe corridors. */
export const MAP_PRESET_INDUSTRIAL_REFINERY: CustomMapDefinition = {
  id: 'industrial-refinery',
  name: 'Industrial Refinery',
  author: 'SkirmishLab Official',
  version: 1,
  description: 'Dense industrial complex featuring elevated refinery roofs, chemical storage silos, and conduit trench lines.',
  board: { width: 44, height: 30, theme: 'industrial-ruins' },
  terrain: [
    // Central Refinery Facility (Walkable Roof at y = 3.0)
    {
      id: 'refinery-main-facility',
      terrainType: 'building-c',
      position: { x: 0, y: 0, z: -3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 5, y: 3.0, z: 5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
      isWalkable: true,
      elevation: 3.0,
    },
    // Open stairs ascending east face of refinery
    {
      id: 'refinery-stairs-east',
      terrainType: 'stairs-open',
      climbType: 'stairs',
      position: { x: 3.8, y: 0, z: -3 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1.5, y: 3.0, z: 1.2 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    // Access ladder ascending west face of refinery
    {
      id: 'refinery-ladder-west',
      terrainType: 'ladder',
      climbType: 'ladder',
      position: { x: -2.8, y: 0, z: -3 },
      rotation: { x: 0, y: -Math.PI / 2, z: 0 },
      scale: { x: 0.5, y: 3.0, z: 1.0 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    // Heavy Chemical Silo on Northeast flank
    {
      id: 'refinery-silo-northeast',
      terrainType: 'building-f',
      position: { x: 9, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 4.0, z: 4 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    // Workshop Facility on Southwest flank (Walkable Roof at y = 2.5)
    {
      id: 'refinery-workshop-southwest',
      terrainType: 'building-h',
      position: { x: -9, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3.5, y: 2.5, z: 3.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
      isWalkable: true,
      elevation: 2.5,
    },
    {
      id: 'refinery-workshop-stairs',
      terrainType: 'stairs-closed-short',
      climbType: 'stairs',
      position: { x: -9, y: 0, z: -0.5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.2, y: 2.5, z: 1.0 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    // Reinforced doorway and barricades creating chokepoints
    {
      id: 'refinery-wall-doorway',
      terrainType: 'wall-doorway-square',
      position: { x: 4, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'refinery-barricade-doorway',
      terrainType: 'barricade-doorway',
      position: { x: 4, y: 0, z: 2.3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.5, y: 1.0, z: 0.4 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    // Heavy support column
    {
      id: 'refinery-column-central',
      terrainType: 'column-wide',
      position: { x: -4, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.2, y: 3.0, z: 1.2 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    // Pipe networks running across ground level
    {
      id: 'refinery-pipe-run-1',
      terrainType: 'pipe',
      position: { x: -1, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 0.8, z: 0.8 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'refinery-pipe-detail-2',
      terrainType: 'detail-pipe',
      position: { x: 5, y: 0, z: -6 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 2.5, y: 0.5, z: 0.5 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    // Low chest-height parapets
    {
      id: 'refinery-parapet-south',
      terrainType: 'wall-low',
      position: { x: -5, y: 0, z: -5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 0.8, z: 0.3 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    // Supply crates
    {
      id: 'refinery-crate-1',
      terrainType: 'crate',
      position: { x: -7, y: 0, z: -3 },
      rotation: { x: 0, y: Math.PI / 4, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'refinery-crate-2',
      terrainType: 'crate',
      position: { x: 7, y: 0, z: -2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
  ],
  objectives: [
    {
      id: 'objective-refinery-alpha',
      name: 'Objective Alpha (Cooling Tower)',
      position: { x: -10, y: 0, z: -4 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-refinery-bravo',
      name: 'Objective Bravo (Fuel Terminal)',
      position: { x: 10, y: 0, z: -1 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-refinery-charlie',
      name: 'Objective Charlie (Pipeline Nexus)',
      position: { x: -5, y: 0, z: 6 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-refinery-delta',
      name: 'Objective Delta (Refinery Rooftop)',
      position: { x: 0, y: 3.0, z: -3 },
      controllingPlayerId: null,
      isContested: false,
    },
  ],
};

/** Preset 3: Sector 7 Catwalks featuring multi-level elevation platforms and bridges. */
export const MAP_PRESET_SECTOR_7_CATWALKS: CustomMapDefinition = {
  id: 'sector-7-catwalks',
  name: 'Sector 7 Catwalks',
  author: 'SkirmishLab Official',
  version: 1,
  description: 'High-elevation battlefield featuring suspended catwalks, sniper perches, multi-story buildings, and stair ascents.',
  board: { width: 44, height: 30, theme: 'industrial-ruins' },
  terrain: [
    // Two-Story Factory Complex on West flank (Walkable Roof at y = 4.5)
    {
      id: 'catwalks-factory-west',
      terrainType: 'building-l',
      position: { x: -8, y: 0, z: -3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 6, y: 4.5, z: 5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
      isWalkable: true,
      elevation: 4.5,
    },
    // Railed High Stairs ascending to west factory roof
    {
      id: 'catwalks-stairs-factory',
      terrainType: 'stairs-sides',
      climbType: 'stairs',
      position: { x: -4.2, y: 0, z: -3 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1.5, y: 4.5, z: 1.5 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    // Central High Catwalk Deck (Walkable at y = 3.0)
    {
      id: 'catwalks-deck-center',
      terrainType: 'roof-flat-patch-large',
      position: { x: 0, y: 3.0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.3, z: 4 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
      isWalkable: true,
      elevation: 3.0,
    },
    // Connecting Bridge Span (Walkable at y = 3.0)
    {
      id: 'catwalks-bridge-east',
      terrainType: 'roof-flat-side',
      position: { x: 4.5, y: 3.0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 0.2, z: 1.5 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
      isWalkable: true,
      elevation: 3.0,
    },
    // East platform landing (Walkable at y = 3.0)
    {
      id: 'catwalks-platform-east',
      terrainType: 'platform',
      position: { x: 8, y: 3.0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 0.3, z: 3 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
      isWalkable: true,
      elevation: 3.0,
    },
    // Open stairs ascending from ground to central catwalk deck
    {
      id: 'catwalks-stairs-center-south',
      terrainType: 'stairs-open',
      climbType: 'stairs',
      position: { x: 0, y: 0, z: -3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.5, y: 3.0, z: 1.2 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    // Access ladder ascending east platform
    {
      id: 'catwalks-ladder-east',
      terrainType: 'ladder',
      climbType: 'ladder',
      position: { x: 9.8, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 0.5, y: 3.0, z: 1.0 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    },
    // Parapets providing sniper cover on the central catwalk
    {
      id: 'catwalks-parapet-north',
      terrainType: 'wall-low',
      position: { x: 0, y: 3.1, z: 1.9 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 0.8, z: 0.3 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'catwalks-parapet-south',
      terrainType: 'wall-low',
      position: { x: 0, y: 3.1, z: -1.9 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 0.8, z: 0.3 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
    // Ground level heavy warehouse structure on Southeast flank
    {
      id: 'catwalks-warehouse-southeast',
      terrainType: 'building-a',
      position: { x: 7, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 6, y: 3.5, z: 5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
      isWalkable: true,
      elevation: 3.5,
    },
    // Ground level cover: walls, pillars, crates
    {
      id: 'catwalks-wall-west',
      terrainType: 'wall',
      position: { x: -3, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'catwalks-column-center',
      terrainType: 'column-wide',
      position: { x: 0, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.2, y: 3.0, z: 1.2 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    },
    {
      id: 'catwalks-crate-south',
      terrainType: 'crate',
      position: { x: -4, y: 0, z: -6 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    },
  ],
  objectives: [
    {
      id: 'objective-catwalks-alpha',
      name: 'Objective Alpha (Ground Relay)',
      position: { x: -9, y: 0, z: 5 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-catwalks-bravo',
      name: 'Objective Bravo (East Staging Area)',
      position: { x: 9, y: 0, z: -5 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-catwalks-charlie',
      name: 'Objective Charlie (Catwalk Vantage)',
      position: { x: 0, y: 3.0, z: 0 },
      controllingPlayerId: null,
      isContested: false,
    },
    {
      id: 'objective-catwalks-delta',
      name: 'Objective Delta (Sub-Level Conduit)',
      position: { x: -4, y: 0, z: -8.5 },
      controllingPlayerId: null,
      isContested: false,
    },
  ],
};

export const STANDARD_MAP_PRESETS: Record<string, CustomMapDefinition> = {
  'frontier-outpost': MAP_PRESET_FRONTIER_OUTPOST,
  'industrial-refinery': MAP_PRESET_INDUSTRIAL_REFINERY,
  'sector-7-catwalks': MAP_PRESET_SECTOR_7_CATWALKS,
};
