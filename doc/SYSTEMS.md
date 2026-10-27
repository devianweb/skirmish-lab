# Systems Document

## Overview
This document specifies the concrete implementation details for Trench Crusade rules, game systems, combat math, validation, and mechanics. The goal is to follow Trench Crusade rules exactly as much as possible.

## Phase Structure
Trench Crusade follows a specific turn structure. The exact phases must be implemented per official rules.

```typescript
const TURN_PHASES: TurnPhase[] = [
  'initiative',    // Determine turn order (if applicable)
  'command',       // Command phase
  'movement',      // Movement phase
  'shooting',      // Shooting phase
  'fight',         // Fight phase
  'morale',        // Morale phase
  'end-turn'       // End turn cleanup
];
```

*Note: Phase order and details should be verified against official Trench Crusade ruleset and implemented faithfully.*

## Action Validation (Host-Side)

All actions are validated by the host. The guest never trusts its own validation for legality - it's only for UX.

### Validation Checks
```typescript
interface ValidationContext {
  state: GameState;
  action: GameAction;
  actorId: string;
}

function validateAction(ctx: ValidationContext): ValidationResult {
  // 1. Turn/phase legality
  // 2. Actor ownership
  // 3. Unit activation state
  // 4. Action type legality for current phase
  // 5. Range/movement validation
  // 6. Targeting rules
  // 7. Weapon availability
  // 8. Game state prerequisites
  return { valid: boolean, reason?: string };
}
```

### Common Validation Rules
- **Turn Ownership:** Action actor must be the active player
- **Phase Legality:** Action type must be legal in current phase
- **Unit Ownership:** Unit must be owned by acting player
- **Activation:** Unit must be activatable per phase rules
- **Line of Sight:** Check LOS where required (shooting)
- **Range:** Check weapon range for shooting
- **Movement:** Validate movement distance, terrain, obstacles
- **Engagement:** Respect engagement/fight rules

## Movement System

### Movement Types
```typescript
type MovementType = 
  | 'normal'      // Normal move
  | 'advance'     // Advance action
  | 'charge'      // Charge move
  | 'fall-back'   // Fall back
  | 'consolidate'; // Consolidate
```

### Movement Validation
- Calculate distance from path
- Check against unit's movement allowance
- Validate terrain traversal rules
- Check for engagement restrictions
- Prevent moving through impassable terrain
- Apply movement penalties as per rules

## Combat System

### Shooting
1. **Declare Target:** Attacker declares target and weapon
2. **Validate:** Range, LOS, target validity
3. **Roll To-Hit:** Server rolls dice, compare to to-hit value
4. **Roll To-Wound:** If hit, roll to wound vs target toughness
5. **Save:** Target rolls save if applicable (modified by AP)
6. **Damage:** Apply damage to models/wounds
7. **Apply Results:** Update unit state

### Fight (Melee)
1. **Charge/Engagement:** Determine who fights
2. **Attack Resolution:** Follow fight phase rules
3. **Hit/Wound/Save/Damage:** Similar to shooting but melee-specific
4. **Morale:** Check morale as needed

### Combat Math
All combat calculations must follow Trench Crusade rules exactly:
- **To Hit:** Roll >= to-hit value on d6 (modified by rules)
- **To Wound:** Compare strength vs toughness per wound table
- **Armor Save:** Roll >= save value (modified by AP)
- **Invulnerable Save:** If applicable, rolled separately
- **Feel No Pain:** If applicable
- **Damage:** Applied to models, remove when wounds depleted

## Dice System

### Dice Resolution
```typescript
interface DiceResolution {
  rollId: string;
  purpose: string;           // 'to-hit', 'to-wound', 'save', etc.
  specs: DiceSpec[];
  results: DiceResult[];
  context: {
    attackerId?: string;
    targetId?: string;
    weaponId?: string;
    actionId: string;
  };
}
```

### Server-Rolled Dice Flow
1. Host needs dice roll for resolution
2. Host requests roll from signaling server with unique rollId
3. Signaling server generates results using secure RNG
4. Server broadcasts results to both peers simultaneously
5. Both peers receive results and apply according to rules
6. Results are part of the resolution, included in state update

### Dice Modifiers
Track all modifiers to rolls:
- To-hit modifiers
- To-wound modifiers  
- Save modifiers (AP)
- Re-rolls (if any)

## Army & Unit Data

### Unit Definitions
Unit statistics should be data-driven where possible:
```typescript
interface UnitDefinition {
  id: string;
  name: string;
  faction: string;
  points: number;
  minSize?: number;
  maxSize?: number;
  stats: {
    movement: number;
    weaponSkill?: number;
    ballisticSkill?: number;
    strength: number;
    toughness: number;
    wounds: number;
    attacks?: number;
    leadership: number;
    save: number;
  };
  weapons: string[];         // Weapon definition IDs
  abilities: string[];
  keywords: string[];
}
```

### Weapon Definitions
```typescript
interface WeaponDefinition {
  id: string;
  name: string;
  type: 'ranged' | 'melee';
  range: number;
  attacks: string;           // Dice expression like 'D6', '2', '3D6'
  toHit: number;
  toWound: number;
  armorPierce: number;
  damage: string;
  specialRules: string[];
}
```

## Line of Sight & Targeting

### LOS Rules
- Check if target is visible from attacker
- Terrain can block LOS
- Models may block LOS
- Specific rules for different terrain types

### Targeting Restrictions
- Must be in range
- Must have LOS (for shooting)
- Cannot shoot certain targets in certain situations
- Engagement restrictions apply

## Special Rules & Abilities
Trench Crusade has many special rules. These need to be implemented as data-driven systems where possible:
- Keyword system
- Ability triggers
- Special rule effects
- Modifier application

## Game State Transitions

### State Machine
```typescript
class GameStateMachine {
  // Host-only
  validate(action: GameAction): ValidationResult;
  apply(state: GameState, action: GameAction): GameState;
  canTransition(from: TurnPhase, action: ActionType): boolean;
}
```

### Applying Actions
When host applies a valid action:
1. Clone current state (immutable updates)
2. Apply action changes
3. Add to action log
4. Update turn/phase if needed
5. Check win conditions
6. Return new state

## Win Conditions
Implement Trench Crusade victory conditions. Specific conditions depend on mission/scenario - need to support standard mission types.

## Balance & Validation
- Host enforces all rules strictly
- No client-side shortcuts
- All random elements go through server
- Action history preserved for debugging

## Implementation Notes

### Data-Driven Design
- Unit/weapon definitions should be data files (JSON/TS)
- Rules should be implemented as pure functions
- Easy to update when referencing rules

### Testing Considerations
- Pure functions are easy to test
- Game state transitions should be deterministic given same inputs
- Dice results come from server but resolution logic is deterministic

### Performance
- Keep validation fast
- State copies should be efficient enough for turn-based game
- Action log grows over time but game length is reasonable

## Rules Reference
This document will be expanded as rules are implemented. Always refer to official Trench Crusade ruleset for accuracy. The goal is to follow them exactly as much as possible.
