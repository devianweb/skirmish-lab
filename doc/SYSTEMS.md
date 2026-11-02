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

### Tabletop Maneuver Actions (Phase 6 Engine)
Each activated unit executes one of the tabletop maneuvers:

- **`hold`**: The unit holds its position (or clears a `stunned` token) without moving or attacking.
- **`move-unit` (Advance)**: Spends up to base `speed` (1×), automatically pathfinding around obstacles and other fighters (`findNavPath`). Eligible to shoot a ranged weapon after moving.
- **`rush`**: Rapid double-distance sprint (moves up to 2× `speed` via auto-pathfinding). Ineligible to shoot this activation. Cannot end in melee contact (use Charge instead).
- **`charge`**: Moves up to double `speed` (2×) via auto-pathfinding into melee engagement contact (≤ 1.0" of an enemy model) and **automatically resolves the full melee combat sequence**:
  1. **Attacker Strike:** Attacker attacks with equipped melee weapon using server-rolled dice, applying wounds and trauma/KO checks.
  2. **Defender Retaliation:** If the defender survives, it immediately strikes back with its equipped melee weapon. Shaken defenders strike back counting as Fatigued (hits on natural 6s only).
  3. **1" Separation Push-Back:** If both fighters survive, the charger automatically bounces back to create a ≥ 1.0" gap between models (to 2.0" center distance, using angular fan-out collision avoidance against obstacles).
  4. **No Locked Melee:** Both surviving models become `fatigued` and clear `engaged` status. In subsequent activations, models are never stuck in melee and may freely Hold, Move, Rush, Shoot, or Charge again.
- **`shoot`**: Fires an equipped ranged weapon at an enemy target within range and line of sight. Not available while engaged.
- **`end-activation`**: Deliberately concludes the activation, passing initiative to the opponent (or activating remaining fighters if the opponent has none left).

> [!NOTE]
> Following tabletop skirmish rules (OPR Grimdark Future: Firefight), melee combat occurs exclusively via **Charge** maneuvers. Models do not remain locked in base-to-base melee. The obsolete standalone "Fight" button has been removed from the player HUD; the 4 standard tabletop maneuvers are Hold, Move, Rush, and Charge.

### Interactive Reactions & Interruption Framework (Phase 6.5)
In Phase 6.5, the single-actor activation loop expands to support out-of-turn interactive decision prompts (reactions):
- **Melee Retaliation Choice:** Defending players can choose whether to strike back in melee (taking Fatigue) or decline (preserving their fighter's full Quality and fresh state for their upcoming activation).
- **Extensible Architecture:** Powered by `turnState.pendingReaction` in the pure serializable game state, featuring host-authoritative validation, a 15s visual countdown with automatic default fallback on expiration or disconnection, and waiting state feedback for the active player. Designed to support future out-of-turn mechanics (Overwatch, defensive stratagems, Brace, and casualty allocation).

### 2D Visibility-Graph Auto-Pathfinding (`findNavPath`)
Units automatically navigate around terrain obstacles and other fighters rather than halting prematurely:
- Generates clearance waypoints around all impassable obstacle bounding boxes (with unit base clearance `UNIT_COLLISION_RADIUS + 0.12"`).
- Accounts for doorway jambs (allowing passage through the 1.0" center opening of `wall-doorway`).
- Finds the shortest navigable path via visibility graph A* search.
- Applies string-pulling shortcutting and cumulative distance clamping to the unit's remaining movement or double speed allowance.

### Melee Engagement Contact Visualization
- When moving or charging into melee engagement (≤ 1.0"), the path line reflects contact in bright orange/crimson and renders a pulsing contact disc.
- A distinctive glowing double-ring melee marker (`0xff5252` and `0xffab40`) highlights the opposing enemy fighter under threat.

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
  - **Doorways (`wall-doorway`):** A doorway is open air between two jambs under a lintel (1.5" wide × 2.25" tall opening on a 4" wall). Line of Sight and movement pass freely; there is no port, so standing in a doorway gives no cover by itself. A model tucked behind a jamb gets ordinary sight-blocker cover.
  - **Windows / Firing Ports (`wall-window`, ruin ports):** Windows block model movement. A ray that goes through the aperture is allowed only if at least one model (shooter or target) has its base edge within 1.0" of the opening ("manning the port"). A defender manning a port that the shot passes through gains +1 Defense (Cover). If both models are further away, the aperture blocks sight (preventing distant keyholing); rays that clip the sill or lintel are blocked as ordinary solids.

### Terrain Structure: Solids + Apertures
Terrain pieces resolve to **solids** (walls, jambs, sills, lintels, columns) and **apertures** (window firing ports); see [DATA_MODEL.md](./DATA_MODEL.md). The engine reads only those boxes, with no per-building special cases:
- **Movement:** solids with `isObstacle` block, by their height range (a lintel above head height does not block walking beneath it). Doorway gaps and the open courtyard of an L-corner ruin are walkable; window sills and apertures are not.
- **Line of Sight (3D):** rays run from the attacker's eye (`EYE_HEIGHT` = 1.1" above its feet) to the target, sampled at head (1.1"), torso (0.6") and feet-top (0.1"). The target is visible if **any** sample ray is clear (one yes/no result). A ray is blocked by a solid it crosses at that height, or by an aperture it passes through unless the shooter or target is **manning** that port.
- **Manning:** any model's base edge within 1.0" of the port box (centre within `MANNING_REACH + UNIT_BASE_RADIUS` = 1.5"; squads are tested per model).
- **Elevation is geometry:** there are no "setback blind spot" or "parapet" special rules. A deck is a solid slab (top at 3.0"), so a close ground shooter cannot see a model standing back from the deck edge (the deck is in the way), while a distant shooter can see over the edge because the angle clears it. A model at the very edge is partly hidden by the slab and gets ordinary sight-blocker cover from it only when the shooter is close; cover on a deck edge comes from stacking low cover (a barricade or crate) or a wall on the deck. An elevated shooter cannot see a target hugging the base of the deck because the floor is in the way.
- **Drops, jumps and movement cost:** movement is measured along the board. A descent of more than 0.5" that is not a stair, ramp or ladder is a *drop* and costs only its horizontal distance (`pathMovementCost`); climbs, stairs, ramps and ladders cost their full length. Drops of 3" or less are regular movement (no test). Drops of 3-6" must be jumped: roll one die per full 3" plus one (`calculateJumpDice`), each needing 3+ (2+ for Pathfinder; Airborne auto-passes); if every die succeeds the model lands with no damage and the activation continues, otherwise it falls (Falling damage per full 3" fallen, activation ends). Drops above 6" cannot be jumped and always fall. Horizontal gaps use the identical test (`measureElevatedGap` finds the widest run of open air along an elevated path; touching decks are not a gap; over 6" the host rejects the move). Every jump, fall and dangerous-terrain roll is attached to the action's log entry (`DiceResolution.outcome.traversal`) and shown in the dice panel and log. A move never ends with the model hanging in mid-air: the nav path stops at the edge if the budget cannot finish a drop, and the host rejects any move that ends suspended (`isSuspendedInMidAir`). Stair orientation is data: the top (head) end is always local +Z, so the mesh, the F9 wireframe and the physics always agree. Ladder paths walk to the ladder foot, climb straight up its spine to the head, then continue.
- **Visibility fan:** a slice of the 3D world at the shooter's eye height; overhead parts (lintels) don't shadow it.

### Cover Determination
- **In-Cover Status:** Targets with `in-cover` status always receive +1 Defense.
- **Low Cover Proximity Rule:** Intervening low cover (crates, low barricades) only grants +1 Defense if the defending target is within **1.0"** of the terrain piece along the line of fire (and the terrain is not adjacent to the shooter, i.e. `projDist > 1.0"`). Distant low crates in the middle of no-man's-land do not grant cover to targets standing in the open downrange, matching tabletop True-Line-of-Sight conventions.
- **Sight-Blocking Partial Cover:** For walls, jambs, sills and columns, the target's base edge must be within 1.0" of the solid and partially obscured (a torso-height flank ray is blocked while LoS stays open).

### Targeting Restrictions
- Must be in range
- Must have LOS (for shooting; ignored by weapons with `lobbed`)
- Engagement restrictions apply (engaged fighters typically fight rather than shoot)

### LoS & Cover Debugger (F9)
Pressing `F9` in-game activates the real-time spatial debugger:
- **Shooting Ray Trace:** Renders the 3D trajectory from shooter eye level (1.1" above its feet) to the target's eye/aim point, color-coded by obstruction (Cyan = clear LoS, Amber = passing through cover, Red = blocked LoS).
- **Boundary Intersections:** 3D disc rings highlight exact entry and exit coordinates where the shooting line breaches terrain bounding boxes.
- **Flank Rays:** Shows left and right torso-height rays (±0.3" from target center, 0.6" up) to verify partial obscuration by walls, jambs and sills.
- **Cover Map Wireframes:** Renders one wireframe per terrain solid and aperture (Cyan = solid LoS blockers, Amber = low cover, Green = firing-port apertures, Gold highlight = piece actively granting cover to target).
- **HUD Analysis Card:** Displays real-time calculations: distance, Line of Sight status, cover reason, piece IDs, and coordinate breakdown of all intersected pieces.

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
