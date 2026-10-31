# Data Model Document

## Overview
This document defines the serializable game state schema. **All game state must be pure, JSON-serializable data structures with no Three.js objects, class instances with methods, or non-serializable references.**

## Core Principles
- **Pure Data:** Only plain objects, arrays, strings, numbers, booleans, null
- **Serializable:** Must be able to `JSON.stringify()` and `JSON.parse()` without data loss
- **Decoupled:** Completely separate from rendering layer
- **Host Authoritative:** Schema supports host validation and confirmed state sync
- **Snapshot Friendly:** Full state can be serialized for snapshots and reconnection

## Game State Schema

### Root GameState
```typescript
interface GameState {
  // Metadata
  version: string;           // Schema version for migration
  gameId: string;            // Unique game identifier
  createdAt: number;         // Timestamp
  lastActionId: string;      // ID of last confirmed action
  
  // Players
  hostId: string;            // Host player identifier
  guestId: string;           // Guest player identifier
  players: Player[];
  
  // Turn Management
  turnState: TurnState;
  
  // Board
  board: Board;
  
  // Game Objects
  units: Unit[];
  terrain: TerrainPiece[];
  markers: GameMarker[];
  objectives?: Objective[];  // 3-5 mission objectives across board (Phase 7)
  
  // Game History
  actionLog: ActionLogEntry[];
  
  // Game Status
  status: GameStatus;
  winner?: string;           // Player ID of winner
  endReason?: string;
}
```

## Player
```typescript
interface Player {
  id: string;
  name: string;
  role: 'host' | 'guest';
  armyId: string;
  isActive: boolean;
}
```

## Turn State (Alternating Activations)
```typescript
interface TurnState {
  currentPlayerId: string;      // Who activates next
  roundNumber: number;
  phase: TurnPhase;
  unitsActivatedThisRound: string[];   // Unit IDs already activated
  startingPlayerId: string;    // Who started this round (alternates each round)
  activeUnitId?: string | null; // Unit currently mid-activation (schema 2.1.0)
  roundStartTime?: number;
  pendingReaction?: PendingReaction | null; // Active reaction prompt awaiting player decision
}

interface PendingReaction {
  id: string;
  type: string;
  promptingPlayerId: string;   // The player who must choose (defender)
  sourceUnitId: string;        // The attacker/charger
  targetUnitId: string;        // The defender making the decision
  title: string;               // e.g. "Melee Retaliation"
  description: string;         // e.g. "Warden Captain charged Raid Boss! Strike back with Blade?"
  warning?: string;            // e.g. "Striking back will make this unit Fatigued."
  options: ReactionOption[];
  expiresAt: number;           // Host wall-clock timestamp for authoritative timeout
  durationMs?: number;         // Relative duration (15000ms) for clock-skew independent timer
  data?: Record<string, any>;
}

interface ReactionOption {
  id: string;                  // e.g. 'strike-back' | 'decline'
  label: string;
  isDefault?: boolean;
  style?: 'primary' | 'secondary' | 'danger';
}

type TurnPhase = 
  | 'setup'
  | 'deployment'
  | 'activation'      // Players alternate activating units
  | 'round-cleanup'   // Morale, end-of-round effects
  | 'game-over';
```

## Board
```typescript
interface Board {
  width: number;             // Board dimensions
  height: number;
  gridSize: number;          // Grid unit size if using grid
  scale: number;             // World scale
  terrain: string[];         // Terrain piece IDs
}
```

## Unit
```typescript
interface Unit {
  id: string;
  ownerId: string;           // Player ID
  armyId: string;
  unitType: string;          // Reference to fighter definition
  name: string;
  
  // OPR-style stats (copied from fighter definition at spawn)
  quality: number;          // To-hit target: d6 roll >= quality hits
  defense: number;          // Block target: d6 roll >= defense blocks
  speed: number;            // Movement allowance in inches
  
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
  remainingMovement: number;
}

interface Model {
  id: string;
  wounds: number;
  maxWounds: number;
  isDestroyed: boolean;
  position?: Vector3;
  rotation?: Vector3;
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}
```

## Unit Status
```typescript
type UnitStatus = 
  | 'stunned'         // Cannot act on next activation; clears at activation start
  | 'shaken'          // Morale failure state (restrictions per ruleset data)
  | 'routed'          // Fleeing / forced move state
  | 'engaged'         // In melee engagement range
  | 'in-cover'        // Benefit from cover (defense modifier)
  | { type: 'custom', name: string, data?: any };
```

## Weapon
```typescript
interface Weapon {
  id: string;
  weaponType: string;
  name: string;
  profile: WeaponProfile;
  isEquipped: boolean;
}

interface WeaponProfile {
  type: 'ranged' | 'melee';
  range: number;             // Inches; melee is engagement range (1)
  attacks: number | string;  // Flat number or dice expression ('D3')
  specialRules: string[];    // Special rule IDs (AP, blast, etc.)
}
```

Note: to-hit capability comes from the fighter's Quality stat and survival from the target's Defense stat — weapons vary by range, attacks, and special rules.

## Terrain
```typescript
interface TerrainPiece {
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
```

## Game Markers
```typescript
interface GameMarker {
  id: string;
  type: 'objective' | 'marker' | 'template';
  position: Vector3;
  data?: Record<string, any>;
}
```

## Actions

### GameAction
```typescript
interface GameAction {
  id: string;                // Unique action ID
  timestamp: number;
  actorId: string;           // Player who requested action
  type: ActionType;
  payload: ActionPayload;
  sequence?: number;         // Sequence number for ordering
}
```

### Action Types
```typescript
type ActionType =
  | 'activate-unit'
  | 'move-unit'
  | 'rush'
  | 'shoot'
  | 'charge'
  | 'fight'
  | 'respond-reaction' // Reaction choice submitted by player
  | 'use-ability'
  | 'hold'
  | 'end-activation'   // Finish current unit's activation
  | 'end-round';      // Finish the round (cleanup/morale)
```

### Action Payloads
```typescript
interface WeaponAllocation {
  weaponId: string;
  targetId: string;
}

type ActionPayload =
  | { type: 'activate-unit', unitId: string }
  | { type: 'move-unit', unitId: string, path: Vector3[], finalPosition: Vector3 }
  | { type: 'rush', unitId: string, path: Vector3[] }
  | {
      type: 'shoot';
      attackerId: string;
      targetId?: string;
      weaponId?: string;
      allocations?: WeaponAllocation[];
    }
  | { type: 'charge', attackerId: string, targetId: string, path: Vector3[] }
  | { type: 'fight', attackerId: string, targetId: string, weaponId: string }
  | { type: 'respond-reaction', reactionId: string, choiceId: string }
  | { type: 'use-ability', unitId: string, abilityId: string, targetIds?: string[] }
  | { type: 'hold', unitId: string }
  | { type: 'end-activation' }
  | { type: 'end-round' };
```

## Action Log
```typescript
interface ActionLogEntry {
  action: GameAction;
  result: 'accepted' | 'rejected';
  reason?: string;           // If rejected
  stateHash?: string;        // Optional hash for validation
  appliedAt: number;
  dice?: DiceResolution;     // Server-rolled dice + outcome (attacks, schema 2.1.0)
}
```

### Dice Resolution (schema 2.1.0)
Attack actions attach the full dice story so both peers render it from state:
```typescript
interface DiceResolution {
  rollId: string;            // Matches the signaling roll-dice-request
  specs: DiceSpec[];         // What was requested
  results: DiceResult[];     // Server-rolled results (both purposes)
  context: {
    attackerId: string;
    targetId: string;
    weaponId?: string;
    actionId: string;
  };
  outcome: {
    attackCount: number;
    hitCount: number;
    bonusHits?: number;
    blockedCount: number;
    blockedRolls?: boolean[];  // Authoritative per-hit block result (preserves Rupture/Shred AP)
    wardSavedCount?: number;
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
    traumaRoll?: number;
    traumaTokens?: number;
    traumaDreadBonus?: number;
    traumaTotal?: number;
    traumaOutcome?: 'shaken' | 'knocked-out';
    retaliation?: RetaliationOutcome;
    pushedBack?: boolean;
    pushBackPosition?: Vector3;
  };
}
```

## Game Status
```typescript
type GameStatus = 
  | 'lobby'
  | 'setting-up'
  | 'in-progress'
  | 'paused'
  | 'game-over';
```

## Dice Data

### Dice Spec & Results
```typescript
interface DiceSpec {
  count: number;
  sides: number;
  purpose?: string;          // e.g., 'to-hit', 'defense', 'morale'
  modifier?: number;
}

interface DiceResult {
  rolls: number[];           // Individual roll results
  total: number;
  modifier?: number;
  finalTotal: number;
  purpose?: string;
  success?: boolean;
  threshold?: number;
}
```

## Scenario Data Pack (Phase 5)

The v1 game ships a data pack in `shared/src/data/` — pure data, no engine logic:

- **`weapons.ts`** — weapon profiles by ID (`rifle`, `carbine`, `scattergun`,
  `handcannon`, `cannon`, `blade`, `fists`); originals with first-principles stats.
- **`armies.ts`** — two original armies (**Frontier Wardens**, **Rust Raiders**),
  five fighters each (`FighterDefinition` incl. a `modelType` for the renderer),
  and `createUnitFromFighter` which copies stats/weapons into spawned `Unit`s.
- **`scenario.ts`** — default deployment: both players' five fighters on
  opposite edges of the 36×36 skirmish board (deployed 24" apart, facing each
  other) plus a central terrain layout (walls, crates, columns) with cover/LOS
  flags.

Deterministic player IDs (`player-host` / `player-guest`) let both peers
identify the local player without negotiation.

## Serialization Rules
### Allowed Types
- `string`, `number`, `boolean`, `null`
- Plain objects `{}` 
- Arrays `[]`

### Forbidden
- `undefined` (use `null` or omit)
- Functions
- Dates (use timestamps as numbers)
- Class instances
- Three.js objects (Vector3, Mesh, Scene, etc.)
- `Map`, `Set`, `WeakMap`, `WeakSet`
- Circular references

### Vector3 Handling
We use plain `{x, y, z}` objects, not Three.js Vector3 instances. This ensures JSON serialization works correctly.

### Validation
All game state must pass serialization round-trip: `JSON.parse(JSON.stringify(state))` must produce equivalent state.

## Versioning
The `version` field allows for schema migrations if the data model changes between versions.

- **2.0.0** — alternating-activation schema (OPR pivot refactor).
- **2.1.0** — Phase 5: `TurnState.activeUnitId`, `ActionLogEntry.dice`
  (`DiceResolution`), and the scenario data pack. Additive and
  backward-compatible.
