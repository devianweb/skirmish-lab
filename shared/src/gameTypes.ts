import { DiceSpec, DiceResult, Vector3 } from './types';
import type { DeclaredTraversal } from './engine/traversal';

// Alternating-activation round phases
export type TurnPhase =
  | 'setup'
  | 'objectives'      // Players roll for the objective count and place the markers
  | 'deployment'
  | 'activation'      // Players alternate activating units
  | 'round-cleanup'   // Morale, end-of-round effects
  | 'game-over';

export interface ReactionOption {
  id: string;               // e.g. 'strike-back' | 'decline'
  label: string;            // Button text: "Strike Back (Blade 2d6)"
  isDefault?: boolean;      // Fallback if timeout expires (e.g. true for strike-back)
  style?: 'primary' | 'secondary' | 'danger';
}

export interface PendingReaction {
  id: string;
  type: 'melee-retaliation' | 'melee-consolidation' | 'pile-in' | 'pick-casualties' | 'push' | 'blast-split' | string;
  promptingPlayerId: string; // The player who must choose (defender)
  sourceUnitId: string;      // The attacker/charger
  targetUnitId: string;      // The defender making the decision
  title: string;             // e.g. "Melee Retaliation"
  description: string;       // e.g. "Warden Captain charged Raid Boss! Strike back with Blade?"
  warning?: string;          // e.g. "Striking back will make this unit Fatigued."
  options: ReactionOption[];
  expiresAt: number;         // Timestamp for countdown timer
  durationMs?: number;       // Duration in milliseconds (e.g. 15000) for clock-skew independent timer
  data?: Record<string, any>;
}

export interface TurnState {
  currentPlayerId: string;             // Who activates next
  roundNumber: number;
  phase: TurnPhase;
  unitsActivatedThisRound: string[];   // Unit IDs already activated
  startingPlayerId: string;           // Who started this round (alternates each round)
  roundStartTime?: number;
  /** Unit currently mid-activation (set by activate-unit, cleared by end-activation). */
  activeUnitId?: string | null;
  /** An active prompt awaiting a reaction choice from promptingPlayerId. */
  pendingReaction?: PendingReaction | null;
  /**
   * A declared charge in progress (set by begin-charge, cleared by the final charge, a fall, or the end of
   * the activation). While set, the active unit may only make charge legs, the final charge on the locked
   * target, or end its activation (which abandons the charge: no melee). The charge budget lives in the
   * unit's `remainingMovement`.
   */
  charge?: ChargeState | null;
  /**
   * Wounds each living unit had left when the active unit's activation began (unit id -> total wounds across
   * living models). At the end of the activation any unit below its baseline "took a wound" and may owe a
   * Morale Test. Cleared when the activation ends.
   */
  woundBaseline?: Record<string, number>;
  /** Units that were in melee during the current activation (they skip the wound-based Morale Test). */
  meleeUnitIds?: string[];
  /** Pairs of units that fought each other during the current activation (their melee result is compared at its end). */
  meleePairs?: [string, string][];
  /**
   * Deployment: true once every unit that deploys normally is down and only Scouts held back remain to be placed
   * (alternating, starting with the player who activates first in round 1).
   */
  scoutStage?: boolean;
  /**
   * From round 2: set while players place their Ambush units before the round's first activation. Placement
   * alternates (starting with the player who activates first); `currentPlayerId` is the player placing.
   */
  ambushStep?: AmbushStep | null;
}

/** The pre-activation Ambush placement step of a round. */
export interface AmbushStep {
  /** Players who declined to place their remaining Ambush units this round. */
  skippedPlayerIds: string[];
}

/** A charge declared on a target and made in legs. Plain data: it is part of the game state. */
export interface ChargeState {
  /** The charging unit (the active unit). */
  unitId: string;
  /** The locked charge target; the final contact must be with this unit. */
  targetId: string;
  /** Legs made so far (each a safe walk or a declared jump). */
  legs: number;
}

export type UnitStatus =
  | 'shaken'          // Failed a Morale Test: may only end its activation idle (then recovers), always fails Morale Tests, strikes back as Fatigued
  | 'fatigued'        // Exhausted in melee for the rest of the round (hits only on unmodified 6s)
  | 'routed'          // Removed as destroyed by a failed melee Morale Test
  | 'engaged'         // In melee engagement range
  | 'in-cover'        // Benefit from cover (+1 Defense roll against shooting)
  | { type: 'custom', name: string, data?: any };

export interface Model {
  id: string;
  name?: string;
  wounds: number;
  maxWounds: number;
  isDestroyed: boolean;
  position?: Vector3;
  rotation?: Vector3;
}

export interface WeaponProfile {
  type: 'ranged' | 'melee';
  range: number;             // Inches; melee is engagement range (1)
  attacks: number | string;  // Flat number or dice expression ('D3')
  specialRules: string[];    // Special rule IDs (AP, blast, etc.)
}

export interface Weapon {
  id: string;
  weaponType: string;
  name: string;
  profile: WeaponProfile;
  isEquipped: boolean;
}

export interface Unit {
  id: string;
  ownerId: string;           // Player ID
  armyId: string;
  unitType: string;          // Reference to fighter definition
  name: string;

  // OPR-style stats (copied from fighter definition at spawn; lower is better)
  quality: number;           // To-hit target: d6 roll >= quality scores a hit
  defense: number;           // Block target: d6 roll >= defense blocks a hit
  speed: number;             // Movement allowance in inches

  // Position & Orientation
  position: Vector3;         // {x, y, z}
  rotation: Vector3;         // {x, y, z} in radians

  // Status
  status: UnitStatus[];
  wounds: number;
  maxWounds: number;
  isActivated: boolean;      // Activated this round
  isDestroyed: boolean;
  /** Whether this unit has been deployed to the board (false during pre-match deployment / ambush). */
  isDeployed?: boolean;

  // Game State
  models: Model[];
  weapons: Weapon[];
  specialRules: string[];

  // Movement/Action State
  hasMoved: boolean;
  hasAttacked?: boolean;
  isRushing?: boolean;
  remainingMovement: number;
  /**
   * Squads only: how far each living model has walked in the current move, rush or charge (model id to
   * inches). `remainingMovement` is the budget minus the smallest of these. Absent until a squad leg is
   * made; cleared when the activation or charge starts.
   */
  modelMovementSpent?: Record<string, number>;
  /**
   * Ids of the dangerous terrain pieces this unit has already tested for in the current activation (it
   * activated in them, or crossed them). A piece tests at most once per activation.
   */
  hazardTestedPieceIds?: string[];
  /** Deployment: a Scout unit the player keeps back to place after all other units (see `scoutStage`). */
  heldAsScout?: boolean;
  /** The round an Ambush unit was placed in; it can't seize or contest objectives that round. */
  ambushArrivedRound?: number;
}

/**
 * Axis-aligned box in terrain-structure space. In a `TerrainGroup` the bounds are fractions of
 * the piece's scale (x/z in [-0.5, 0.5], y in [0, 1]); once resolved they are inches in the
 * piece's local frame (x/z centered on the piece, y measured up from the piece base).
 */
export interface TerrainBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * A physical box: wall section, jamb, sill, lintel, column. Lintels sit above head height, so
 * they block sight but not movement beneath them (the movement check honours box heights).
 */
export interface TerrainSolid extends TerrainBox {
  id?: string;
  /** Blocks model movement. Default true. */
  isObstacle?: boolean;
  /** Blocks line of sight. Default true. */
  blocksLineOfSight?: boolean;
  /** Provides partial (sight-blocker) cover to a model standing behind it. Default true. */
  providesCover?: boolean;
  /** Its top face is a standable floor (deck, catwalk, ledge, roof). Default false. */
  walkable?: boolean;
}

/**
 * A firing port / window opening. Not walkable. Sight passes through it only while the shooter
 * or the target is manning it (base edge within 1.0"). Grants Cover to a defender manning it.
 */
export interface TerrainAperture extends TerrainBox {
  id?: string;
  providesCover?: boolean;
}

/** A bundle of solids, apertures and nested groups, shifted by an optional offset (fractions of scale). */
export interface TerrainGroup {
  id?: string;
  offset?: { x: number; z: number };
  solids?: TerrainSolid[];
  apertures?: TerrainAperture[];
  groups?: TerrainGroup[];
}

export interface TerrainPiece {
  id: string;
  terrainType: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  blocksLineOfSight: boolean;
  providesCover: boolean;
  isObstacle: boolean;
  /** Whether moving through this piece caps total movement at 6" (Difficult Terrain). */
  isDifficult?: boolean;
  /** Whether entering or activating in this piece triggers 1d6 hazard tests on 1s (Dangerous Terrain). */
  isDangerous?: boolean;
  /** Height of elevated walkable surface (y coordinate in inches), e.g. 2.0 or 3.0. */
  elevation?: number;
  /** Whether this piece allows fighters to stand on top of its platform surface. */
  isWalkable?: boolean;
  /** Type of climb access: 'ladder' | 'stairs' | 'ramp' | 'sheer'. */
  climbType?: 'ladder' | 'stairs' | 'ramp' | 'sheer';
  /** Per-piece override of the type's climbable default: may models climb onto this piece's floor (rise up to 3") without a ladder? */
  climbable?: boolean;
  /** Optional structure override (solids, apertures, nested groups). Defaults to the catalog definition for `terrainType`. */
  structure?: TerrainGroup;
  data?: Record<string, any>;
}

export interface GameMarker {
  id: string;
  type: 'objective' | 'marker' | 'template';
  position: Vector3;
  data?: Record<string, any>;
}

export interface Objective {
  id: string;
  name: string;
  position: Vector3;
  controllingPlayerId?: string | null;
  isContested?: boolean;
}

export const MAX_ROUNDS = 4;
export const OBJECTIVE_CONTROL_RADIUS = 3.0;
export const OBJECTIVE_CONTROL_MAX_VERTICAL = 3.0;

export interface Board {
  width: number;
  height: number;
  gridSize: number;
  scale: number;
  terrain: string[];
}

export interface Player {
  id: string;
  name: string;
  role: 'host' | 'guest';
  armyId: string;
  isActive: boolean;
}

export interface WeaponAllocation {
  weaponId: string;
  targetId: string;
}

export type ActionType =
  | 'activate-unit'
  | 'roll-objectives'  // Objectives phase start: the server rolls the objective count and the mission roll-off
  | 'place-objective'
  | 'deploy-unit'
  | 'hold-scout'       // Keep a Scout unit back to be placed after every other unit is deployed
  | 'skip-ambush'      // Decline to place remaining Ambush units this round
  | 'advance'
  | 'rush'
  | 'shoot'
  | 'begin-charge'
  | 'charge-leg'
  | 'charge'
  | 'fight'
  | 'use-ability'
  | 'hold'
  | 'respond-reaction'
  | 'consolidate-move'
  | 'pile-in-move'
  | 'pick-casualties'
  | 'blast-split'
  | 'push-move'
  | 'end-activation'   // Finish current unit's activation
  | 'end-round'        // Finish the round (cleanup/morale)
  | 'concede'         // Forfeit the match (valid any time until game over)
  | 'request-rematch'; // Ask to replay the same game (valid only once the match is over)

export type ActionPayload =
  | { type: 'activate-unit', unitId: string }
  | { type: 'roll-objectives' }
  | { type: 'place-objective', position: Vector3 }
  | { type: 'deploy-unit', unitId: string, position: Vector3, rotation?: Vector3 }
  | { type: 'hold-scout', unitId: string }
  | { type: 'skip-ambush' }
  | { type: 'advance', jumpLeader?: number, crossers?: number[], unitId: string, path: Vector3[], finalPosition: Vector3, modelPositions?: Vector3[], modelPaths?: Vector3[][] }
  | { type: 'rush', jumpLeader?: number, crossers?: number[], unitId: string, path: Vector3[], finalPosition: Vector3, modelPositions?: Vector3[], modelPaths?: Vector3[][] }
  | {
      type: 'shoot';
      attackerId: string;
      targetId?: string;
      weaponId?: string;
      allocations?: WeaponAllocation[];
    }
  | { type: 'begin-charge', attackerId: string, targetId: string }
  | { type: 'charge-leg', jumpLeader?: number, crossers?: number[], attackerId: string, path: Vector3[], traversal?: DeclaredTraversal, modelPositions?: Vector3[], modelPaths?: Vector3[][], modelTraversals?: (DeclaredTraversal | null)[] }
  | { type: 'charge', jumpLeader?: number, crossers?: number[], attackerId: string, targetId: string, path: Vector3[], weaponId?: string, traversal?: DeclaredTraversal, modelPositions?: Vector3[], modelPaths?: Vector3[][], modelTraversals?: (DeclaredTraversal | null)[] }
  | { type: 'fight', attackerId: string, targetId: string, weaponId: string }
  | { type: 'use-ability', unitId: string, abilityId: string, targetIds?: string[] }
  | { type: 'hold', unitId: string }
  | { type: 'respond-reaction', reactionId: string, choiceId: string }
  | { type: 'consolidate-move', unitId: string, path: Vector3[], finalPosition?: Vector3 }
  | { type: 'pile-in-move', modelPositions: Vector3[], modelPaths?: Vector3[][] }
  | { type: 'pick-casualties', unitId: string, modelIds: string[] }
  | { type: 'blast-split', splits: number[][] }
  | { type: 'push-move', modelId: string, destination: Vector3 }
  | { type: 'end-activation' }
  | { type: 'end-round' }
  | { type: 'concede' }
  | { type: 'request-rematch' };

export interface GameAction {
  id: string;
  timestamp: number;
  actorId: string;
  type: ActionType;
  payload: ActionPayload;
  sequence?: number;
}

export interface ActionLogEntry {
  action: GameAction;
  result: 'accepted' | 'rejected';
  reason?: string;
  stateHash?: string;
  appliedAt: number;
  /** Server-rolled dice + deterministic outcome for attacks (shoot/fight). */
  dice?: DiceResolution;
}

export interface RetaliationOutcome {
  weaponId?: string;
  weaponName?: string;
  attackCount: number;
  hitCount: number;
  bonusHits?: number;
  blockedCount: number;
  blockedRolls?: boolean[];
  regenerationSavedCount?: number;
  wounds: number;
  targetDestroyed: boolean;
  targetShaken?: boolean;
  effectiveQuality?: number;
  effectiveDefense?: number;
  baseQuality?: number;
  hitModifiers?: string[];
  baseDefense?: number;
  defenseModifiers?: string[];
}

/** The share of a Blast shot that landed on a unit other than the aimed-at target (its own defense batch). */
export interface BlastSplashOutcome {
  weaponId: string;
  targetId: string;
  targetName?: string;
  hitCount: number;
  blockedCount: number;
  blockedRolls?: boolean[];
  regenerationSavedCount?: number;
  wounds: number;
  targetDestroyed: boolean;
  targetShaken?: boolean;
  effectiveDefense?: number;
  baseDefense?: number;
  defenseModifiers?: string[];
  /** The defense dice this unit rolled for its share (one per hit). */
  defenseRolls?: number[];
}

/** How one Blast weapon's hits were multiplied and shared out between the target and units near it. */
export interface BlastSplitRecord {
  weaponId: string;
  weaponName: string;
  /** The X of Blast(X). */
  multiplier: number;
  /** Hits after multiplying (to-hit successes and bonus hits, times X). */
  totalHits: number;
  /** One entry per eligible unit, the aimed-at target first: its share and its cap (living models). */
  shares: { targetId: string; targetName: string; hits: number; cap: number }[];
  /** Hits no unit could take (every unit at its cap). */
  lostHits: number;
}

export interface WeaponAttackOutcome {
  weaponId: string;
  weaponName?: string;
  targetId: string;
  targetName?: string;
  attackCount: number;
  hitCount: number;
  bonusHits?: number;
  blockedCount: number;
  blockedRolls?: boolean[];
  regenerationSavedCount?: number;
  wounds: number;
  targetDestroyed: boolean;
  targetShaken?: boolean;
  effectiveQuality?: number;
  effectiveDefense?: number;
  coverApplied?: boolean;
  apApplied?: number;
  baseQuality?: number;
  hitModifiers?: string[];
  baseDefense?: number;
  defenseModifiers?: string[];
}

/**
 * A dice resolution attached to an accepted action: the server-rolled results
 * plus the deterministic combat outcome the host derived from them. Both
 * peers render dice displays from this data — never from local rolls.
 */
/** One traversal hazard resolved during a move: a jump, a fall or dangerous terrain (rolled with server dice). */
export interface TraversalEvent {
  type: 'gap-jump' | 'drop-jump' | 'fall' | 'hazard' | 'jump-skipped' | 'push';
  /** Human-readable result for the dice panel and log. */
  text: string;
  /** The dice rolled for this event (each d6). */
  rolls?: number[];
  /** Target number each die needed (jumps). */
  target?: number;
  passed?: boolean;
  wounds?: number;
}

/** One Morale Test, recorded so both peers can render it from state. */
export interface MoraleTestRecord {
  unitId: string;
  unitName: string;
  /** The d6 rolled; absent when the unit was already Shaken (it fails without a roll). */
  roll?: number;
  /** Quality the roll had to meet (the Hero's when better). */
  effectiveQuality: number;
  /** Fearless die, rolled after a failed test. */
  fearlessRoll?: number;
  /** The attacker's push die (4+ lets them move a model of the unit this test just made Shaken). */
  pushRoll?: number;
  passed: boolean;
  outcome: 'passed' | 'shaken' | 'routed';
}

/** One side of a melee result. */
export interface MeleeResultSide {
  unitId: string;
  unitName: string;
  /** Wounds this unit took during the activation. */
  wounds: number;
  /** Extra wounds counted against this unit because the enemy has Fear(X). */
  fearBonus?: number;
}

/** The outcome of a melee, compared at the end of the activation: the side with more wounds loses. */
export interface MeleeResultRecord {
  sides: [MeleeResultSide, MeleeResultSide];
  /** The unit that lost; absent on a tie (nobody tests). */
  loserId?: string;
}

/** An Impact or Counter strike inside a charge (resolved before the charger's own strike). */
export interface SpecialStrikeOutcome {
  kind: 'impact' | 'counter';
  attackerId: string;
  targetId: string;
  weaponName?: string;
  /** Impact: dice rolled. Counter: attacks made. */
  attackCount: number;
  hitCount: number;
  blockedCount: number;
  wounds: number;
  targetDestroyed: boolean;
}

/** A roll-off: 10 pairs of d6 (host die, guest die); the first unequal pair decides, all tied means the host wins. */
export interface RollOffRecord {
  kind: 'mission' | 'deployment';
  hostRolls: number[];
  guestRolls: number[];
  winnerId: string;
  /** Index of the pair that decided it; null when all pairs tied (the host wins). */
  decidingPair: number | null;
}

/** Results of the pre-game rolls, kept in state so a rematch can replay them. */
export interface SetupRolls {
  /** The d6 rolled for the objective count. */
  objectiveRoll?: number;
  /** Objectives to place (3 to 5). */
  objectiveCount?: number;
  /** Decides who places the first objective. */
  missionRollOff?: RollOffRecord;
  /** Decides who deploys first and activates first in round 1. */
  deploymentRollOff?: RollOffRecord;
}

export interface DiceResolution {
  rollId: string;
  specs: DiceSpec[];
  results: DiceResult[];
  context: {
    attackerId: string;
    targetId: string;
    weaponId?: string;
    retaliationWeaponId?: string;
    actionId: string;
  };
  outcome: {
    attackCount: number;
    hitCount: number;
    bonusHits?: number;
    blockedCount: number;
    blockedRolls?: boolean[];
    regenerationSavedCount?: number;
    wounds: number;
    /** Of `wounds`, the extra ones Shred added. */
    shredWounds?: number;
    targetDestroyed: boolean;
    /** Impact(X) hits the charger landed before any strike. */
    impact?: SpecialStrikeOutcome;
    /** The charged unit's Counter strikes, one per Counter weapon (before the charger's own strike). */
    counterStrikes?: SpecialStrikeOutcome[];
    /** Objectives phase start: the d6 and the objective count it gave. */
    objectiveCount?: { roll: number; count: number };
    /** A roll-off resolved by this action (mission roll-off, or the deployment roll-off with the last objective). */
    rollOff?: RollOffRecord;
    /** Movement hazards resolved by this action (gap/drop jumps, falls, dangerous terrain). */
    traversal?: TraversalEvent[];
    targetShaken?: boolean;
    effectiveQuality?: number;
    effectiveDefense?: number;
    coverApplied?: boolean;
    apApplied?: number;
    baseQuality?: number;
    hitModifiers?: string[];
    baseDefense?: number;
    defenseModifiers?: string[];
    /** Morale Tests taken at the end of an activation (one per unit that took wounds and is at half or less). */
    moraleTests?: MoraleTestRecord[];
    /** Melee results compared at the end of an activation (the loser tests Morale; see `moraleTests`). */
    meleeResults?: MeleeResultRecord[];
    retaliation?: RetaliationOutcome;
    allocations?: WeaponAttackOutcome[];
    /** Blast hits that spilled onto other enemy units near the target (totals above count the target only). */
    blastSplash?: BlastSplashOutcome[];
    /** Per Blast weapon: the multiplication and the split between units (for the dice panel). */
    blastSplits?: BlastSplitRecord[];
    pushedBack?: boolean;
    pushBackPosition?: Vector3;
  };
}

export type GameStatus =
  | 'lobby'
  | 'setting-up'
  | 'in-progress'
  | 'paused'
  | 'game-over';

/** Scenario options a match was started with; lets the host rebuild the exact starting state for a rematch. */
export interface MatchSetup {
  hostArmyId?: string;
  guestArmyId?: string;
  useDeploymentPhase?: boolean;
}

export interface GameState {
  version: string;
  gameId: string;
  createdAt: number;
  lastActionId: string;
  hostId: string;
  guestId: string;
  players: Player[];
  turnState: TurnState;
  board: Board;
  units: Unit[];
  terrain: TerrainPiece[];
  markers: GameMarker[];
  objectives?: Objective[];
  /** Pre-game rolls (objective count, roll-offs). Absent when the match skips the objectives phase. */
  setupRolls?: SetupRolls;
  actionLog: ActionLogEntry[];
  status: GameStatus;
  winner?: string;
  endReason?: string;
  /** Options the scenario was started with (absent when none were given). */
  setup?: MatchSetup;
  /** Player ids who asked for a rematch while the game is over (de-duplicated). */
  rematchRequestedBy?: string[];
}
