import { resolveWeapons } from './weapons';
import { Unit, UnitStatus } from '../gameTypes';
import { Vector3 } from '../types';
import { createSquadPositions } from '../engine/spatial';

/**
 * Fighter definitions and ready-made armies (Human Defense Force, Orc Marauders, plus the dev-only TEST
 * armies). Armies are pure data; the engine never hardcodes them.
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
  weapons: string[];      // Weapon profile IDs (the distinct weapons the unit carries)
  /**
   * Per-model weapon profile IDs, one list per model (length must equal `modelCount`). Absent = every model
   * carries all of `weapons`. When present, the spawned unit's weapons are the distinct IDs across the lists
   * and each model records its own in `Model.weaponIds`.
   */
  modelLoadouts?: string[][];
  specialRules: string[];
}

/** The distinct weapon IDs across a unit's per-model loadouts, in order of first appearance. */
export function distinctLoadoutWeapons(loadouts: string[][]): string[] {
  return [...new Set(loadouts.flat())];
}

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
  const loadouts = definition.modelLoadouts;
  if (loadouts && loadouts.length !== (definition.modelCount ?? 1)) {
    throw new Error(`${definition.id}: modelLoadouts has ${loadouts.length} entries for ${definition.modelCount ?? 1} models`);
  }
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
        ...(loadouts ? { weaponIds: [...loadouts[idx]] } : {}),
      }));
    })(),
    weapons: resolveWeapons(loadouts ? distinctLoadoutWeapons(loadouts) : definition.weapons),
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
  /**
   * TEST force for checking squad jumps by hand (14C-2 PR 4B): a plain 4-model squad, a Strider squad (half the
   * jump dice) and a Flying squad (never rolls). Use it on the Jump Range map. Not a balanced army.
   */
  'test-jump-army': {
    id: 'test-jump-army',
    name: 'TEST: Jump Check (squad, Strider squad, Flying squad)',
    factionId: 'test',
    theme: 'Playtesting only: squad jumps over gaps and drops, Strider and Flying',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-jump-squad',
        name: 'Test Jumpers',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 4,
        weapons: ['rifle', 'blade'],
        specialRules: [],
      },
      {
        id: 'test-strider-squad',
        name: 'Test Striders',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 4,
        weapons: ['rifle', 'blade'],
        specialRules: ['strider'],
      },
      {
        id: 'test-flying-squad',
        name: 'Test Flyers',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 4,
        weapons: ['rifle', 'blade'],
        specialRules: ['flying'],
      },
    ],
  },
  /**
   * TEST force for checking dangerous terrain dice by hand (14C-2 PR 6): a 5-model Tough 1 squad (5 dice), a
   * Tough 3 Hero (3 dice, 2 once it has taken a wound) and a Flying squad (never tests). Use it on the Hazard
   * Range map. Speed 12" so one Rush crosses both side-by-side pools and back. Not a balanced army.
   */
  'test-hazard-army': {
    id: 'test-hazard-army',
    name: 'TEST: Hazard Check (5-model squad, Tough 3 Hero, Flying squad)',
    factionId: 'test',
    theme: 'Playtesting only: dangerous terrain dice per unit, Tough and Flying',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-hazard-squad',
        name: 'Test Waders',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 12,
        modelType: 'trooper',
        modelCount: 5,
        weapons: ['rifle', 'blade'],
        specialRules: [],
      },
      {
        id: 'test-hazard-hero',
        name: 'Test Hazard Hero',
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
        id: 'test-hazard-flyers',
        name: 'Test Hazard Flyers',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 12,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade'],
        specialRules: ['flying'],
      },
    ],
  },
  /**
   * TEST force for checking the PR 7 special rules by hand (14C-2): Fast and Slow runners, an Impact(3) squad,
   * a Counter Blade squad, an Assault Rifle squad and a Shred Blade squad (all Quality 4+, Defense 5+). Use it
   * on any open map (Standard Battlefield). Not a balanced army.
   */
  'test-special-rules-army': {
    id: 'test-special-rules-army',
    name: 'TEST: Special Rules Check (Fast, Slow, Impact, Counter, Assault, Shred)',
    factionId: 'test',
    theme: 'Playtesting only: one squad for each special rule changed in 14C-2 PR 7',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-special-fast',
        name: 'Test Fast Runners',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade'],
        specialRules: ['fast'],
      },
      {
        id: 'test-special-slow',
        name: 'Test Slow Walkers',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade'],
        specialRules: ['slow'],
      },
      {
        id: 'test-special-impact',
        name: 'Test Impact Brutes',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 2,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade'],
        specialRules: ['impact(3)'],
      },
      {
        id: 'test-special-counter',
        name: 'Test Counter Guard',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'trooper',
        modelCount: 2,
        weapons: ['rifle', 'counter-blade', 'blade'],
        specialRules: [],
      },
      {
        id: 'test-special-twin-counter',
        name: 'Test Twin Counter Guard',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'trooper',
        modelCount: 2,
        weapons: ['counter-blade', 'counter-spear'],
        specialRules: [],
      },
      {
        id: 'test-special-fear',
        name: 'Test Fear Cultists',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 4,
        weapons: ['rifle', 'blade'],
        specialRules: ['fear(1)'],
      },
      {
        id: 'test-special-assault',
        name: 'Test Assault Troops',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['assault-rifle'],
        specialRules: [],
      },
      {
        id: 'test-special-shred',
        name: 'Test Shred Fighters',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'shred-blade'],
        specialRules: [],
      },
    ],
  },
  /**
   * TEST force for checking setup by hand (14C-2 PR 9): two ordinary squads (one, Test Guard, has Repel Ambushers and Hold the Line: enemy Ambush arrivals stay
   * 12" away), two Scout squads (deploy now or hold
   * back) and two Ambush squads (arrive from round 2). Use it with the same army on both sides on any open map
   * (Standard Battlefield). Not a balanced army.
   */
  'test-scout-ambush-army': {
    id: 'test-scout-ambush-army',
    name: 'TEST: Scout & Ambush Check',
    factionId: 'test',
    theme: 'Playtesting only: ordinary, Scout and Ambush units for checking deployment and the Ambush step',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-setup-line',
        name: 'Test Line Troops',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade'],
        specialRules: [],
      },
      {
        id: 'test-setup-guard',
        name: 'Test Guard',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 2,
        weapons: ['rifle', 'blade'],
        specialRules: ['repel-ambushers', 'hold-the-line'],
      },
      {
        id: 'test-setup-scouts',
        name: 'Test Scouts',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 2,
        weapons: ['rifle', 'blade'],
        specialRules: ['scout'],
      },
      {
        id: 'test-setup-outriders',
        name: 'Test Outriders',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 1,
        weapons: ['rifle', 'blade'],
        specialRules: ['scout'],
      },
      {
        id: 'test-setup-ambushers',
        name: 'Test Ambushers',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade'],
        specialRules: ['ambush'],
      },
      {
        id: 'test-setup-lurkers',
        name: 'Test Lurkers',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 1,
        weapons: ['rifle', 'blade'],
        specialRules: ['ambush'],
      },
    ],
  },
  /**
   * TEST force for checking per-model loadouts and all-weapons melee by hand (14C-3 PR 1C): a 3-model squad where
   * two models carry a Rifle and one a Frag Launcher (Blast), all three with a Blade, and one Leader-style model
   * with a Power Sword and an Assault Rifle (it strikes with both). Use the same army on both sides on any open
   * map (Standard Battlefield). Not a balanced army.
   */
  'test-loadouts-army': {
    id: 'test-loadouts-army',
    name: 'TEST: Loadouts Check',
    factionId: 'test',
    theme: 'Playtesting only: mixed per-model weapons and a model that strikes with two melee weapons',
    totalPoints: 0,
    fighters: [
      {
        id: 'test-loadout-squad',
        name: 'Test Mixed Squad',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 1,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade', 'frag-launcher'],
        modelLoadouts: [
          ['rifle', 'blade'],
          ['rifle', 'blade'],
          ['frag-launcher', 'blade'],
        ],
        specialRules: [],
      },
      {
        id: 'test-loadout-leader',
        name: 'Test Two-Weapon Leader',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'leader',
        modelCount: 1,
        weapons: ['power-sword', 'assault-rifle'],
        modelLoadouts: [['power-sword', 'assault-rifle']],
        specialRules: [],
      },
      {
        // Deadly-first check (14C-3 PR 1E): one Fusion Rifle (Deadly) fires together with two plain Rifles at a
        // Tough(3) squad, so the Deadly wound must kill an unhurt model before the plain wounds land.
        id: 'test-deadly-squad',
        name: 'Test Deadly Squad',
        faction: 'test',
        points: 0,
        quality: 3,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['fusion-rifle', 'rifle', 'blade'],
        modelLoadouts: [
          ['fusion-rifle', 'blade'],
          ['rifle', 'blade'],
          ['rifle', 'blade'],
        ],
        specialRules: ['tough(3)'],
      },
      {
        // Same weapons on every model but Tough(3) each (14C-3 PR 1G): the data card still lists models so each
        // model's wounds can be read.
        id: 'test-tough-squad',
        name: 'Test Tough Squad',
        faction: 'test',
        points: 0,
        quality: 4,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['rifle', 'blade'],
        modelLoadouts: [
          ['rifle', 'blade'],
          ['rifle', 'blade'],
          ['rifle', 'blade'],
        ],
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
  /**
   * Human Defense Force: the 400-pt Force Org list from the v3.6 army book (14C-3 PR 1D). Mixed squads carry
   * per-model loadouts. Tough is per model, so a [3] squad with Tough(3) has 3 models of 3 wounds each.
   */
  hdf: {
    id: 'hdf',
    name: 'Human Defense Force',
    factionId: 'hdf',
    theme: 'Citizen soldiers of the human colonies: disciplined line infantry backed by a sharpshooter',
    totalPoints: 400,
    fighters: [
      {
        id: 'hdf-company-leader',
        name: 'Company Leader',
        faction: 'hdf',
        points: 100,
        quality: 4,
        defense: 5,
        wounds: 9,
        speed: 6,
        modelType: 'leader',
        weapons: ['hand-weapon', 'pistol'],
        specialRules: ['hero', 'hold-the-line', 'tough(9)'],
      },
      {
        id: 'hdf-veterans',
        name: 'Veterans',
        faction: 'hdf',
        points: 125,
        quality: 4,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['strike', 'battle-rifle', 'grenade-launcher'],
        modelLoadouts: [
          ['strike', 'battle-rifle'],
          ['strike', 'battle-rifle'],
          ['strike', 'grenade-launcher'],
        ],
        specialRules: ['hold-the-line', 'tough(3)'],
      },
      {
        id: 'hdf-infantry-squad',
        name: 'Infantry Squad',
        faction: 'hdf',
        points: 120,
        quality: 5,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'trooper',
        modelCount: 3,
        weapons: ['strike', 'plasma-rifle', 'plasma-pistol', 'sgt-hand-weapon', 'battle-rifle'],
        modelLoadouts: [
          ['strike', 'plasma-rifle'],
          ['plasma-pistol', 'sgt-hand-weapon'],
          ['strike', 'battle-rifle'],
        ],
        specialRules: ['hold-the-line', 'tough(3)'],
      },
      {
        id: 'hdf-sniper',
        name: 'Sniper',
        faction: 'hdf',
        points: 55,
        quality: 5,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'specialist',
        weapons: ['strike', 'sniper-rifle'],
        specialRules: ['hold-the-line', 'scout', 'stealth', 'tough(3)'],
      },
    ],
  },
  /**
   * Orc Marauders: the 400-pt Force Org list from the v3.6 army book (14C-3 PR 2). Five single models; Tough is
   * per model. The Biker uses the `heavy` model role (there is no bike model yet).
   */
  'orc-marauders': {
    id: 'orc-marauders',
    name: 'Orc Marauders',
    factionId: 'orc-marauders',
    theme: 'Hulking clan raiders who trade precision for speed, numbers and ferocity',
    totalPoints: 400,
    fighters: [
      {
        id: 'orc-leader',
        name: 'Orc Leader',
        faction: 'orc-marauders',
        points: 95,
        quality: 4,
        defense: 5,
        wounds: 9,
        speed: 6,
        modelType: 'leader',
        weapons: ['orc-hand-weapon', 'heavy-flamer-mod', 'orc-carbine'],
        specialRules: ['bad-shot', 'ferocious', 'hero', 'tough(9)'],
      },
      {
        id: 'orc-biker',
        name: 'Orc Biker',
        faction: 'orc-marauders',
        points: 120,
        quality: 4,
        defense: 5,
        wounds: 9,
        speed: 6,
        modelType: 'heavy',
        weapons: ['orc-hand-weapon', 'pistol', 'bike-gun'],
        specialRules: ['bad-shot', 'fast', 'ferocious', 'tough(9)'],
      },
      {
        id: 'orc-veteran',
        name: 'Veteran',
        faction: 'orc-marauders',
        points: 60,
        quality: 3,
        defense: 4,
        wounds: 3,
        speed: 6,
        modelType: 'trooper',
        weapons: ['orc-hand-weapon', 'pistol'],
        specialRules: ['bad-shot', 'ferocious', 'tough(3)'],
      },
      {
        id: 'orc-infiltrator',
        name: 'Infiltrator',
        faction: 'orc-marauders',
        points: 60,
        quality: 4,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'specialist',
        weapons: ['orc-hand-weapon', 'pistol'],
        specialRules: ['bad-shot', 'ferocious', 'scout', 'stealth', 'strider', 'tough(3)'],
      },
      {
        id: 'orc-specialist',
        name: 'Specialist',
        faction: 'orc-marauders',
        points: 65,
        quality: 4,
        defense: 5,
        wounds: 3,
        speed: 6,
        modelType: 'specialist',
        weapons: ['strike', 'flamer'],
        specialRules: ['bad-shot', 'ferocious', 'relentless', 'tough(3)'],
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
  // 6" apart per column across up to 6 columns per row; additional rows step deeper into the player's zone.
  const perRow = 6;
  const spacing = 6;
  const rowStepZ = 6;
  const z = options.defaultZ ?? 0;
  const facing = options.facing ?? 0;
  const zSign = z < 0 ? -1 : 1;

  return starterArmy.fighters.map((fighter, index) => {
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const colsInRow = Math.min(perRow, starterArmy.fighters.length - row * perRow);
    const pos = {
      x: Math.round((col - (colsInRow - 1) / 2) * spacing * 100) / 100,
      y: 0,
      z: z + row * rowStepZ * zSign,
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
