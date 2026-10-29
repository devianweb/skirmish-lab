# Systems Document

## Overview
This document specifies the concrete implementation details for the rules engine, game systems, combat math, validation, and mechanics. The engine implements OPR-style skirmish rules (Quality/Defense d6 resolution, alternating activations, wound/stun tracking) **from first principles**. No rulebook text is copied; all descriptions here are original.

## Turn Structure: Alternating Activations

Instead of per-player phases, the game uses **alternating unit activations**:

1. The round begins; both players' units are unactivated.
2. The starting player activates one of their units.
3. Players alternate: each activation, the other player then activates one of their own units.
4. When one player has no unactivated units left, the other player activates their remaining units one after another.
5. When all units on both sides have activated, the round ends: cleanup, morale checks, then a new round begins with the player who finished activating all of their units first in the previous round (the opponent of the player who took the final activation).

### Activation State
```typescript
interface ActivationState {
  currentPlayerId: string;      // Who activates next
  roundNumber: number;
  unitsActivatedThisRound: string[];   // Unit IDs
  startingPlayerId: string;     // Who started this round (alternates)
  phase: 'setup' | 'deployment' | 'activation' | 'round-cleanup' | 'game-over';
}
```

### Activation Options
An activated unit may typically:
- **Move and/or act** (shoot or fight), in either order or only one
- **Hold** (stay put, no action)
Movement allowances and action restrictions come from unit data and special rules (e.g., some units may not shoot after moving).

### Phase 5 Implementation (as shipped)
The basic action set is live in the shared engine (`shared/src/engine/`):

- **`activate-unit`** marks the unit activated, clears `stunned`, and sets
  `turnState.activeUnitId`. A `hold` is a one-step activation: the unit
  activates, does nothing, and the activation ends immediately.
- **`move-unit`** spends `remainingMovement` by straight-line path length;
  every path point must stay inside the board. Engaged units cannot move
  away. (Pathfinding around obstacles is Phase 6.)
- **`shoot`** requires a ranged weapon, an enemy target in range, and the
  attacker not engaged. Resolution needs server-rolled dice (below).
- **`charge`** moves the charger to engagement distance 1 of the target
  (path end must match), consumes all remaining movement, and marks both
  units `engaged`. Already-engaged units must fight instead.
- **`fight`** requires the attacker `engaged`, the target within 1.5 board
  units, and a melee weapon.
- **`end-activation`** passes initiative: the opponent activates next if
  they still have units; otherwise the current player keeps activating
  their remaining units; when all units have activated, the round ends and
  a new one begins with the other player starting.
- **`end-round`** is only legal when the round is complete (normally
  rounds end automatically via `end-activation`).
- Engagements persist across rounds; stun clears only via the unit's own
  activation. Win condition (v1): elimination — the game ends when a player
  has no living units.

## Combat Resolution (Quality / Defense)

All rolls are d6 checks against a target number, where **lower is better** for both stats:

### 1. To-Hit Roll (Quality)
- For each attack, roll one d6.
- A result **equal to or greater than the attacker's Quality (Q)** scores a hit.
- Example: a fighter with Q 3+ hits on a roll of 3, 4, 5, or 6.

### 2. Defense Roll
- For each hit, the defender rolls one d6.
- A result **equal to or greater than the defender's Defense (D)** blocks the hit.
- Example: a fighter with D 4+ blocks the hit on a roll of 4, 5, or 6.
- Cover and special rules may modify the effective D value.

### 3. Apply Results
- Each unblocked hit causes a **wound** (or, where specified, a **stun**) on the target fighter.
- Fighters removed from play when their wounds are depleted.

### Resolution Table
```
Attacker: roll d6 >= attacker Q  -> hit
Defender: roll d6 >= defender D -> hit blocked
Unblocked hit                    -> wound (or stun)
Fighter wounds <= 0              -> casualty (removed)
```

## Wounds & Stun
- Each fighter has a wound count (usually 1 in skirmish-scale play, more for heroes/monsters).
- **Wounds:** reduce the fighter's wound count; at zero the fighter is removed.
- **Stunned:** a stunned fighter's state flag; stunned fighters typically cannot act on their next activation and the stun clears at the start of that activation. Used where a ruleset calls for non-lethal suppression effects.

## Morale
At the end of each round (or when triggered by casualties), units check morale:
- Roll d6 against the unit's Quality (Q) or a flat morale target.
- Failure applies a morale state (e.g., shaken/routed per ruleset data).
- Morale states affect future activations (restrictions, forced moves) as defined by ruleset data.

## Weapon Profiles
Weapons are data-driven profiles:

```typescript
interface WeaponProfile {
  id: string;
  name: string;
  type: 'ranged' | 'melee';
  range: number;              // Inches; melee typically 1 (engagement range)
  attacks: number | string;   // Flat number or dice expression ('D3', '2D6')
  specialRules: string[];     // Special rule IDs from the ruleset data
}
```

Hit and wound capability come from the **fighter's Q**, and the target's survival from its **D** — weapons primarily vary by range, attack count, and special rules (e.g., armor-piercing modifications to the Defense roll, extra damage, blast effects).

### Range Brackets
- Weapons are usable up to their listed range.
- Range brackets (e.g., long-range penalties) are defined as special rules in ruleset data where applicable.

## Special Rules Framework
Special rules are data definitions, not hardcoded logic where possible:

```typescript
interface SpecialRuleDefinition {
  id: string;                 // e.g., 'ap1', 'relentless', 'impact'
  name: string;              // Original short label
  description: string;       // Our own words (never rulebook text)
  modifiers?: RollModifier[];
  hooks?: RuleHook[];        // e.g., 'on-hit', 'on-charge', 'before-activation'
}
```

- **Roll modifiers** adjust Q/D checks (e.g., AP reduces the target's effective D).
- **Rule hooks** attach effects to engine events (charge, hit, casualty, round start).
- The engine ships with a core set of generic special rules; rulesets select from them and may define more.

## Army & Unit Data

Armies are **data packs**, never hardcoded engine logic:

```typescript
interface FighterDefinition {
  id: string;
  name: string;               // Original/generic names
  faction: string;
  points: number;
  quality: number;           // e.g., 3 (means 3+)
  defense: number;           // e.g., 4 (means 4+)
  wounds: number;
  speed: number;             // Movement in inches
  weapons: string[];         // Weapon profile IDs
  specialRules: string[];    // Special rule IDs
}
interface ArmyDefinition {
  id: string;
  name: string;
  factionTheme: string;
  fighters: FighterDefinition[];
}
```

> **Phase 5 note:** the shipped `FighterDefinition` (in
> `shared/src/data/armies.ts`) adds a `modelType` field
> (`leader | trooper | specialist | heavy`) that the renderer maps to a
> curated model. The v1 pack ships two original armies — **Frontier
> Wardens** (defensive) and **Rust Raiders** (fast) — each with five
> fighters, plus a default scenario (`shared/src/data/scenario.ts`):
> edge deployment, five units per side, and a central terrain layout.

- **v1 ships two hardcoded armies** as data files with original faction names and fighters.
- The schema is intentionally shaped so external roster formats (e.g., Army Forge) can be ingested later as a data-layer feature without engine changes.

## Action Validation (Host-Side)

All actions are validated by the host. The guest never trusts its own validation for legality — it's only for UX.

### Validation Checks
```typescript
interface ValidationContext {
  state: GameState;
  action: GameAction;
  actorId: string;
}

function validateAction(ctx: ValidationContext): ValidationResult {
  // 1. Activation legality (is it the actor's turn to activate)
  // 2. Actor ownership (unit belongs to acting player)
  // 3. Unit not yet activated this round
  // 4. Unit not stunned/routed (or per special rules)
  // 5. Movement distance vs speed allowance, terrain, obstacles
  // 6. Line of sight and range (for shooting)
  // 7. Engagement rules (melee range, who can fight)
  // 8. Weapon availability on the fighter
  // 9. Game state prerequisites (phase, round state)
  return { valid: boolean, reason?: string };
}
```

### Common Validation Rules
- **Turn Ownership:** Action actor must be the currently-activating player
- **Unit Ownership:** Unit must be owned by acting player
- **Activation:** Unit must not already be activated this round
- **Line of Sight:** Check LOS where required (shooting)
- **Range:** Check weapon range for shooting
- **Movement:** Validate distance, terrain, obstacles
- **Engagement:** Respect engagement/fight rules

## Dice System

### Server-Rolled Dice Flow
1. Host needs dice rolls for resolution
2. Host requests rolls from the signaling server with a unique rollId
3. Signaling server generates results using its RNG
4. Server broadcasts results to both peers simultaneously
5. Both peers receive results; host applies resolution deterministically
6. Results are part of the resolution and included in the state update

```typescript
interface DiceResolution {
  rollId: string;
  purpose: string;           // 'to-hit', 'defense', 'morale'
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

### Dice Modifiers
Track all modifiers to rolls:
- Quality modifiers (to-hit)
- Defense modifiers (cover, AP)
- Re-rolls where special rules provide them

### Phase 5 Implementation (as shipped)
- Dice specs are computed by the host (`getDiceSpecs` in
  `shared/src/engine/actions.ts`): `attacks` to-hit dice plus `attacks`
  defense dice, all d6. Dice-expression attack counts (e.g. `D3`) are
  rules-engine territory (Phase 6) and rejected in Phase 5.
- Defense dice pair with **hits** in order: the 1st hit uses the 1st
  defense die, the 2nd hit the 2nd, etc. Defense dice beyond the number of
  hits are unused. Both peers see the full roll, so this is transparent.
- **Cover:** a defender with `in-cover` status imposes +1 on the effective
  Quality needed to hit them (cover makes targets harder to hit).
- The host validates an action *before* requesting dice, so illegal actions
  never spend a server roll. The resolution (`DiceResolution`, including
  the derived outcome) is attached to the action log entry and broadcast in
  the state — both players' dice displays read from state, never from
  local rolls.
- **Resilient Dice Roll Requests:** `SignalingDiceProvider` retries roll
  requests every 2 seconds (up to 3 retries) and reconnects on demand
  (`ensureConnected()`). The signaling server caches recent roll results by
  `rollId` (`room.rollCache`), ensuring retries are strictly idempotent.

## Line of Sight, Cover & Apertures

### LOS Rules
- **Standard Checks:** Line of sight is drawn directly between attacker and target on the board plane.
- **Sight-Blockers:** Blocked by solid terrain with `blocksLineOfSight: true` (e.g. solid walls, columns) and by other living fighters (`LOS_UNIT_RADIUS = 0.4`).
- **Apertures (Windows & Doorways):**
  - **Doorways (`wall-doorway`):** The central 1.0" opening allows unobstructed Line of Sight and model movement. Models within 1.0" of the door frame claim Cover (+1 Defense) against shots passing through the door.
  - **Windows / Firing Ports (`wall-window`):** Windows block model movement. Line of Sight can be drawn through the central 1.0" window aperture if at least one model (shooter or target) is within 1.0" of the opening ("manning the port" / peeking). A model within 1.0" of a window receiving fire through it gains +1 Defense (Cover). If both models are >1.0" from the window, the wall blocks sight entirely (preventing distant geometric keyholing).

### Cover Determination
- **In-Cover Status:** Targets with `in-cover` status always receive +1 Defense.
- **Low Cover Proximity Rule:** Intervening low cover (crates, low barricades) only grants +1 Defense if the defending target is within **1.0"** of the terrain piece along the line of fire (and the terrain is not adjacent to the shooter, i.e. `projDist > 1.0"`). Distant low crates in the middle of no-man's-land do not grant cover to targets standing in the open downrange, matching tabletop True-Line-of-Sight conventions.
- **Sight-Blocking Partial Cover:** For walls and columns, the target must be within 1.0" of the piece and partially obscured (at least one ray to the model's flanks blocked while center LoS remains open).

### Targeting Restrictions
- Must be in range
- Must have LOS (for shooting; ignored by weapons with `lobbed`)
- Engagement restrictions apply (engaged fighters typically fight rather than shoot)

## Game State Transitions

### State Machine
```typescript
class GameStateMachine {
  // Host-only
  validate(action: GameAction): ValidationResult;
  apply(state: GameState, action: GameAction): GameState;
  canTransition(from: GamePhase, action: ActionType): boolean;
}
```

### Applying Actions
When host applies a valid action:
1. Clone current state (immutable updates)
2. Apply action changes
3. Add to action log
4. Update activation state if needed
5. Check win conditions
6. Return new state

## Win Conditions
Victory conditions are mission data. v1 ships a simple elimination mission; objective-based missions come later as data packs.

## Balance & Validation
- Host enforces all rules strictly
- No client-side shortcuts
- All random elements go through the server
- Action history preserved for debugging

## Implementation Notes

### Data-Driven Design
- Fighter/weapon/special-rule definitions are data files (JSON/TS)
- Rules are implemented as pure functions
- Ruleset differences (Firefight vs future packs) are data, not code

### Testing Considerations
- Pure functions are easy to test
- Game state transitions are deterministic given the same inputs and dice results
- Dice results come from the server but resolution logic is deterministic

### Performance
- Keep validation fast
- State copies are efficient enough for turn-based play
- Action log grows over game length but remains reasonable

## Rules Reference
This document defines the engine's mechanics as implemented. Where OPR mechanics are the target, they are re-derived from first principles — never copied from published text.

For the exhaustive mathematical and procedural specification of the tabletop skirmish engine (including full trait schemas, activation maneuvers, trauma/casualty tables, and dynamic terrain rules), see **[RULES_SPECIFICATION.md](./RULES_SPECIFICATION.md)**.
