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
  roundStartTime?: number;
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
  | 'shoot'
  | 'charge'
  | 'fight'
  | 'use-ability'
  | 'hold'
  | 'end-activation'   // Finish current unit's activation
  | 'end-round';      // Finish the round (cleanup/morale)
```

### Action Payloads
```typescript
type ActionPayload =
  | { type: 'activate-unit', unitId: string }
  | { type: 'move-unit', unitId: string, path: Vector3[], finalPosition: Vector3 }
  | { type: 'shoot', attackerId: string, targetId: string, weaponId: string }
  | { type: 'charge', attackerId: string, targetId: string, path: Vector3[] }
  | { type: 'fight', attackerId: string, targetId: string, weaponId: string }
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
