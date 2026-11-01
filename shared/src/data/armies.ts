import { resolveWeapons } from './weapons';
import { Unit, UnitStatus } from '../gameTypes';
import { Vector3 } from '../types';
import { createSquadPositions } from '../engine/spatial';

/**
 * Fighter definitions for the two v1 armies — original, generic names and
 * first-principles stats (no proprietary factions or catalogs). Armies are
 * pure data; the engine never hardcodes them.
 */

export interface FighterDefinition {
  id: string;
  name: string;
  faction: string;
  points: number;
  quality: number;        // To-hit target (3+)
  defense: number;       // Block target (4+)
  wounds: number;
  speed: number;          // Movement in board units (inches)
  /** Unit type used by the renderer for model selection. */
  modelType: 'leader' | 'trooper' | 'specialist' | 'heavy';
  /** Number of models in the unit/squad (defaults to 1). */
  modelCount?: number;
  weapons: string[];      // Weapon profile IDs
  specialRules: string[];
}

export interface ArmyDefinition {
  id: string;
  name: string;
  factionTheme: string;
  fighters: FighterDefinition[];
}

export const ARMY_FRONTIER_WARDENS: ArmyDefinition = {
  id: 'frontier-wardens',
  name: 'Frontier Wardens',
  factionTheme: 'Disciplined outpost defenders in reinforced plate',
  fighters: [
    {
      id: 'warden-captain',
      name: 'Warden Captain',
      faction: 'frontier-wardens',
      points: 120,
      quality: 3,
      defense: 4,
      wounds: 3,
      speed: 6,
      modelType: 'leader',
      weapons: ['handcannon', 'blade'],
      specialRules: ['commander', 'steadfast', 'resilient(3)'],
    },
    {
      id: 'warden-trooper',
      name: 'Warden Trooper',
      faction: 'frontier-wardens',
      points: 60,
      quality: 4,
      defense: 5,
      wounds: 1,
      speed: 6,
      modelType: 'trooper',
      weapons: ['rifle'],
      specialRules: ['steadfast'],
    },
    {
      id: 'warden-marksman',
      name: 'Warden Marksman',
      faction: 'frontier-wardens',
      points: 75,
      quality: 4,
      defense: 5,
      wounds: 1,
      speed: 6,
      modelType: 'specialist',
      weapons: ['rifle', 'sidearm'],
      specialRules: ['steadfast', 'marksman', 'camouflaged'],
    },
    {
      id: 'warden-breacher',
      name: 'Warden Breacher',
      faction: 'frontier-wardens',
      points: 70,
      quality: 4,
      defense: 5,
      wounds: 1,
      speed: 6,
      modelType: 'specialist',
      weapons: ['scattergun', 'sidearm', 'fists'],
      specialRules: ['steadfast', 'sustained'],
    },
    {
      id: 'warden-gun-crew',
      name: 'Warden Gun Crew',
      faction: 'frontier-wardens',
      points: 110,
      quality: 4,
      defense: 4,
      wounds: 2,
      speed: 6,
      modelType: 'heavy',
      weapons: ['cannon'],
      specialRules: ['steadfast', 'resilient(2)'],
    },
  ],
};

export const ARMY_RUST_RAIDERS: ArmyDefinition = {
  id: 'rust-raiders',
  name: 'Rust Raiders',
  factionTheme: 'Scavenging raiders in patchwork armor',
  fighters: [
    {
      id: 'raider-boss',
      name: 'Raid Boss',
      faction: 'rust-raiders',
      points: 115,
      quality: 3,
      defense: 4,
      wounds: 3,
      speed: 6,
      modelType: 'leader',
      weapons: ['handcannon', 'blade'],
      specialRules: ['commander', 'frenzy', 'resilient(3)'],
    },
    {
      id: 'raider-trooper',
      name: 'Rust Runner',
      faction: 'rust-raiders',
      points: 55,
      quality: 4,
      defense: 5,
      wounds: 1,
      speed: 6,
      modelType: 'trooper',
      weapons: ['rifle'],
      specialRules: ['frenzy'],
    },
    {
      id: 'raider-skirmisher',
      name: 'Rust Skirmisher',
      faction: 'rust-raiders',
      points: 70,
      quality: 4,
      defense: 5,
      wounds: 1,
      speed: 6,
      modelType: 'specialist',
      weapons: ['rifle', 'sidearm'],
      specialRules: ['marksman', 'camouflaged'],
    },
    {
      id: 'raider-sapper',
      name: 'Rust Sapper',
      faction: 'rust-raiders',
      points: 70,
      quality: 4,
      defense: 5,
      wounds: 1,
      speed: 6,
      modelType: 'specialist',
      weapons: ['scattergun', 'sidearm', 'fists'],
      specialRules: ['sustained'],
    },
    {
      id: 'raider-bruiser',
      name: 'Rust Bruiser',
      faction: 'rust-raiders',
      points: 105,
      quality: 4,
      defense: 4,
      wounds: 2,
      speed: 6,
      modelType: 'heavy',
      weapons: ['cannon'],
      specialRules: ['stoic', 'frenzy', 'resilient(2)'],
    },
  ],
};

export const DEFAULT_ARMIES: ArmyDefinition[] = [ARMY_FRONTIER_WARDENS, ARMY_RUST_RAIDERS];

let unitCounter = 0;

/** Spawn a Unit from a fighter definition (stats and weapons copied). */
export function createUnitFromFighter(
  definition: FighterDefinition,
  ownerId: string,
  armyId: string,
  position: Vector3,
  options: { unitId?: string; nameSuffix?: string } = {}
): Unit {
  unitCounter += 1;
  const unitId = options.unitId ?? `unit-${unitCounter}`;
  const baseStatus: UnitStatus[] = [];

  return {
    id: unitId,
    ownerId,
    armyId,
    unitType: definition.modelType,
    name: options.nameSuffix ? `${definition.name} ${options.nameSuffix}` : definition.name,
    quality: definition.quality,
    defense: definition.defense,
    speed: definition.speed,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    status: baseStatus,
    wounds: definition.wounds,
    maxWounds: definition.wounds,
    isActivated: false,
    isDestroyed: false,
    models: (() => {
      const count = definition.modelCount ?? 1;
      const positions = createSquadPositions(position, count);
      return positions.map((pos, idx) => ({
        id: `${unitId}-model-${idx + 1}`,
        wounds: definition.wounds,
        maxWounds: definition.wounds,
        isDestroyed: false,
        position: { ...pos },
        rotation: { x: 0, y: 0, z: 0 },
      }));
    })(),
    weapons: resolveWeapons(definition.weapons),
    specialRules: [...definition.specialRules],
    hasMoved: false,
    hasAttacked: false,
    isRushing: false,
    remainingMovement: definition.speed,
    isDeployed: true,
  };
}

// ============================================================================
// Pre-Canned Point-Balanced Starter Forces (Phase 10A)
// ============================================================================

export interface StarterArmy {
  id: string;
  name: string;
  factionId: string;
  theme: string;
  totalPoints: number;
  fighters: FighterDefinition[];
}

export const STARTER_ARMIES: Record<string, StarterArmy> = {
  'frontier-wardens-starter': {
    id: 'frontier-wardens-starter',
    name: 'Frontier Wardens Vanguard Force',
    factionId: 'frontier-wardens',
    theme: 'Disciplined outpost vanguard equipped with precision marksmen, resilient defenders, and drop reserves',
    totalPoints: 300,
    fighters: [
      {
        id: 'warden-captain',
        name: 'Warden Captain',
        faction: 'frontier-wardens',
        points: 110,
        quality: 3,
        defense: 4,
        wounds: 3,
        speed: 6,
        modelType: 'leader',
        weapons: ['rifle', 'handcannon', 'blade'],
        specialRules: ['commander', 'steadfast', 'resilient(3)'],
      },
      {
        id: 'warden-marksman',
        name: 'Warden Scout Marksman',
        faction: 'frontier-wardens',
        points: 75,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'specialist',
        weapons: ['carbine', 'sidearm'],
        specialRules: ['steadfast', 'marksman', 'camouflaged', 'vanguard'],
      },
      {
        id: 'warden-breacher',
        name: 'Warden Breacher',
        faction: 'frontier-wardens',
        points: 65,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'specialist',
        weapons: ['scattergun', 'fists'],
        specialRules: ['steadfast', 'sustained'],
      },
      {
        id: 'warden-patrol-squad',
        name: 'Warden Patrol Squad',
        faction: 'frontier-wardens',
        points: 50,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 2,
        weapons: ['rifle'],
        specialRules: ['steadfast', 'drop-reserve'],
      },
    ],
  },
  'rust-raiders-starter': {
    id: 'rust-raiders-starter',
    name: 'Rust Raiders Incursion Mob',
    factionId: 'rust-raiders',
    theme: 'Aggressive scavenger incursion force featuring rapid infiltrators, combat sappers, and drop reserves',
    totalPoints: 300,
    fighters: [
      {
        id: 'raider-boss',
        name: 'Raid Boss',
        faction: 'rust-raiders',
        points: 110,
        quality: 3,
        defense: 4,
        wounds: 3,
        speed: 6,
        modelType: 'leader',
        weapons: ['rifle', 'handcannon', 'blade'],
        specialRules: ['commander', 'frenzy', 'resilient(3)'],
      },
      {
        id: 'raider-skirmisher',
        name: 'Rust Infiltrator',
        faction: 'rust-raiders',
        points: 75,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'specialist',
        weapons: ['carbine', 'sidearm'],
        specialRules: ['frenzy', 'marksman', 'camouflaged', 'vanguard'],
      },
      {
        id: 'raider-sapper',
        name: 'Rust Sapper',
        faction: 'rust-raiders',
        points: 65,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'specialist',
        weapons: ['scattergun', 'fists'],
        specialRules: ['frenzy', 'sustained'],
      },
      {
        id: 'raider-mob-squad',
        name: 'Rust Runner Mob',
        faction: 'rust-raiders',
        points: 50,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 2,
        weapons: ['rifle'],
        specialRules: ['frenzy', 'drop-reserve'],
      },
    ],
  },
};

/**
 * Creates full Unit instances from a StarterArmy definition for game setup or interactive deployment.
 */
export function createUnitsFromStarterArmy(
  starterArmy: StarterArmy,
  ownerId: string,
  options: {
    startUndeployed?: boolean;
    defaultZ?: number;
    facing?: number;
  } = {}
): Unit[] {
  const spread = [-6, -2, 2, 6];
  const z = options.defaultZ ?? 0;
  const facing = options.facing ?? 0;

  return starterArmy.fighters.map((fighter, index) => {
    const pos = {
      x: spread[index % spread.length],
      y: 0,
      z,
    };
    const unit = createUnitFromFighter(fighter, ownerId, starterArmy.factionId, pos, {
      unitId: `${ownerId}-${fighter.id}-${index + 1}`,
      nameSuffix: String(index + 1),
    });
    unit.rotation = { x: 0, y: facing, z: 0 };
    if (options.startUndeployed) {
      unit.isDeployed = false;
    }
    return unit;
  });
}
