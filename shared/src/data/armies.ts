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
      specialRules: ['hero', 'steadfast', 'tough(3)'],
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
      specialRules: ['steadfast', 'marksman', 'stealth'],
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
      specialRules: ['steadfast', 'relentless'],
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
      specialRules: ['steadfast', 'tough(2)'],
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
      specialRules: ['hero', 'furious', 'tough(3)'],
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
      specialRules: ['furious'],
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
      specialRules: ['marksman', 'stealth'],
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
      specialRules: ['relentless'],
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
      specialRules: ['fearless', 'furious', 'tough(2)'],
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
  /**
   * TEST force for playtesting movement and terrain: one fast single-model fighter. Not a balanced army.
   * Speed 24" (Advance 24", Rush/Charge 48") so a model can reach any terrain on the board in one activation.
   */
  /**
   * TEST force for playtesting squads: one 4-model squad per side (per-model shooting, cover majority,
   * coherency, squad jumps and per-model charges). Not a balanced army. Speed 12" so it can cross the board.
   */
  'test-squad-army': {
    id: 'test-squad-army',
    name: 'TEST: Single Squad (4 models, speed 12")',
    factionId: 'test',
    theme: 'Playtesting only: one 4-model squad per side for squad rules checks',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-squad',
        name: 'Test Squad',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 12,
        modelType: 'trooper',
        modelCount: 4,
        weapons: ['rifle', 'blade'],
        specialRules: [],
      },
    ],
  },
  /**
   * TEST force for checking the v3.6 rules by hand: a Hero, two squads that start within 3" of each other
   * (Blast spill), and a heavy gunner carrying a Blast weapon, an Indirect Blast weapon and two weapons named
   * "Rifle" (two-target cap, same-name grouping, Indirect only after a Hold). Mirror it on both sides.
   * Not a balanced army.
   */
  'test-rules-army': {
    id: 'test-rules-army',
    name: 'TEST: Rules Check (Hero, Blast, Indirect, multi-weapon)',
    factionId: 'test',
    theme: 'Playtesting only: Hero morale, Blast spill, Indirect fire and the two-target cap',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-hero',
        name: 'Test Hero',
        faction: 'test',
        points: 0,
        quality: 3,
        defense: 4,
        wounds: 3,
        speed: 12,
        modelType: 'leader',
        weapons: ['rifle', 'blade'],
        specialRules: ['hero', 'tough(3)'],
      },
      {
        id: 'test-rules-squad-a',
        name: 'Test Squad A',
        faction: 'test',
        points: 0,
        quality: 6,
        defense: 5,
        wounds: 1,
        speed: 12,
        modelType: 'trooper',
        modelCount: 4,
        weapons: ['rifle', 'blade'],
        specialRules: [],
      },
      {
        id: 'test-rules-squad-b',
        name: 'Test Squad B',
        faction: 'test',
        points: 0,
        quality: 6,
        defense: 5,
        wounds: 1,
        speed: 12,
        modelType: 'trooper',
        modelCount: 4,
        weapons: ['rifle', 'blade'],
        specialRules: [],
      },
      {
        id: 'test-heavy-gunner',
        name: 'Test Heavy Gunner',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 4,
        wounds: 3,
        speed: 12,
        modelType: 'heavy',
        weapons: ['frag-launcher', 'trench-mortar', 'rifle', 'rifle-twin', 'sidearm', 'fists'],
        specialRules: ['tough(3)'],
      },
    ],
  },
  'test-army': {
    id: 'test-army',
    name: 'TEST: Single Runner (speed 24")',
    factionId: 'test',
    theme: 'Playtesting only: one fast fighter per side for movement and terrain checks',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-runner',
        name: 'Test Runner',
        faction: 'test',
        points: 0,
        quality: 3,
        defense: 4,
        wounds: 1,
        speed: 24,
        modelType: 'trooper',
        weapons: ['rifle', 'blade'],
        specialRules: [],
      },
    ],
  },
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
        specialRules: ['hero', 'steadfast', 'tough(3)'],
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
        specialRules: ['steadfast', 'marksman', 'stealth', 'scout'],
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
        specialRules: ['steadfast', 'relentless'],
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
        modelCount: 4,
        weapons: ['rifle'],
        specialRules: ['steadfast', 'ambush'],
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
        specialRules: ['hero', 'furious', 'tough(3)'],
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
        specialRules: ['furious', 'marksman', 'stealth', 'scout'],
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
        specialRules: ['furious', 'relentless'],
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
        modelCount: 4,
        weapons: ['rifle'],
        specialRules: ['furious', 'ambush'],
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
  // 6" apart: two 4-model squads side by side still keep more than 1" between bases (their rings are ~3.4" wide).
  const spread = [-9, -3, 3, 9];
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
