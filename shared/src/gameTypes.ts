import { DiceSpec, DiceResult, Vector3 } from './types';

// Alternating-activation round phases
export type TurnPhase =
  | 'setup'
  | 'deployment'
  | 'activation'      // Players alternate activating units
  | 'round-cleanup'   // Morale, end-of-round effects
  | 'game-over';

export interface TurnState {
  currentPlayerId: string;             // Who activates next
  roundNumber: number;
  phase: TurnPhase;
  unitsActivatedThisRound: string[];   // Unit IDs already activated
  startingPlayerId: string;           // Who started this round (alternates each round)
  roundStartTime?: number;
  /** Unit currently mid-activation (set by activate-unit, cleared by end-activation). */
  activeUnitId?: string | null;
}

export type UnitStatus =
  | 'stunned'         // Cannot act on next activation; clears at activation start
  | 'shaken'          // Morale failure state (restrictions per ruleset data)
  | 'routed'          // Fleeing / forced move state
  | 'engaged'         // In melee engagement range
  | 'in-cover'        // Benefit from cover (defense modifier)
  | { type: 'custom', name: string, data?: any };

export interface Model {
  id: string;
  wounds: number;
  maxWounds: number;
  isDestroyed: boolean;
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

  // Game State
  models: Model[];
  weapons: Weapon[];
  specialRules: string[];

  // Movement/Action State
  hasMoved: boolean;
  hasAttacked?: boolean;
  remainingMovement: number;
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
  data?: Record<string, any>;
}

export interface GameMarker {
  id: string;
  type: 'objective' | 'marker' | 'template';
  position: Vector3;
  data?: Record<string, any>;
}

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

export type ActionType =
  | 'activate-unit'
  | 'move-unit'
  | 'shoot'
  | 'charge'
  | 'fight'
  | 'use-ability'
  | 'hold'
  | 'end-activation'   // Finish current unit's activation
  | 'end-round';       // Finish the round (cleanup/morale)

export type ActionPayload =
  | { type: 'activate-unit', unitId: string }
  | { type: 'move-unit', unitId: string, path: Vector3[], finalPosition: Vector3 }
  | { type: 'shoot', attackerId: string, targetId: string, weaponId: string }
  | { type: 'charge', attackerId: string, targetId: string, path: Vector3[] }
  | { type: 'fight', attackerId: string, targetId: string, weaponId: string }
  | { type: 'use-ability', unitId: string, abilityId: string, targetIds?: string[] }
  | { type: 'hold', unitId: string }
  | { type: 'end-activation' }
  | { type: 'end-round' };

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

/**
 * A dice resolution attached to an accepted action: the server-rolled results
 * plus the deterministic combat outcome the host derived from them. Both
 * peers render dice displays from this data — never from local rolls.
 */
export interface DiceResolution {
  rollId: string;
  specs: DiceSpec[];
  results: DiceResult[];
  context: {
    attackerId: string;
    targetId: string;
    weaponId?: string;
    actionId: string;
  };
  outcome: {
    attackCount: number;
    hitCount: number;
    blockedCount: number;
    wounds: number;
    targetDestroyed: boolean;
  };
}

export type GameStatus =
  | 'lobby'
  | 'setting-up'
  | 'in-progress'
  | 'paused'
  | 'game-over';

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
  actionLog: ActionLogEntry[];
  status: GameStatus;
  winner?: string;
  endReason?: string;
}
