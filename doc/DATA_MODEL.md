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

## Turn State
```typescript
interface TurnState {
  currentPlayerId: string;   // Whose turn it is
  turnNumber: number;
  phase: TurnPhase;
  phaseStep?: string;
  activationIndex?: number;   // For activation-based phases
  turnStartTime?: number;
}

type TurnPhase = 
  | 'setup'
  | 'deployment'
  | 'initiative'
  | 'command'
  | 'movement'
  | 'shooting'
  | 'fight'
  | 'morale'
  | 'end-turn'
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
  unitType: string;          // Reference to unit definition
  name: string;
  
  // Position & Orientation
  position: Vector3;         // {x, y, z}
  rotation: Vector3;         // {x, y, z} in radians
  
  // Status
  status: UnitStatus[];
  wounds: number;
  maxWounds: number;
  isActivated: boolean;
  isDestroyed: boolean;
  
  // Game State
  models: Model[];
  weapons: Weapon[];
  abilities: string[];
  
  // Movement/Shooting State
  hasMoved: boolean;
  hasShot: boolean;
  hasFought: boolean;
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
  | 'pinned'
  | 'suppressed'
  | 'broken'
  | 'engaged'
  | 'in-cover'
  | 'hidden'
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
  range: number;
  attacks: number | string;   // Could be dice expression
  toHit: number;
  toWound: number;
  armorPierce: number;
  damage: number | string;
  special: string[];
}
```

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
  | 'move-unit'
  | 'advance-unit'
  | 'shoot'
  | 'charge'
  | 'fight'
  | 'use-ability'
  | 'activate-unit'
  | 'end-phase'
  | 'end-turn'
  | 'pass'
  | 'declare-action'
  | 'resolve-action';
```

### Action Payloads
```typescript
type ActionPayload =
  | { type: 'move-unit', unitId: string, path: Vector3[], finalPosition: Vector3 }
  | { type: 'advance-unit', unitId: string, path: Vector3[], finalPosition: Vector3 }
  | { type: 'shoot', attackerId: string, targetId: string, weaponId: string }
  | { type: 'charge', attackerId: string, targetId: string, path: Vector3[] }
  | { type: 'fight', attackerId: string, targetId: string, weaponId: string }
  | { type: 'use-ability', unitId: string, abilityId: string, targetIds?: string[] }
  | { type: 'activate-unit', unitId: string }
  | { type: 'end-phase' }
  | { type: 'end-turn' }
  | { type: 'pass' };
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
  purpose?: string;          // e.g., 'to-hit', 'to-wound', 'save'
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
