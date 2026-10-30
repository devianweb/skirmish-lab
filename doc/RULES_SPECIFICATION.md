# SkirmishLab Rules Engine Specification

> **Clean-Room Mechanical Specification**
> This document specifies the complete first-principles mathematical model, state machine, and trait resolution engine for SkirmishLab tabletop skirmish simulation. It aligns 1:1 mechanically with standard 3.5 skirmish rules (Grimdark Future: Firefight compatible) using distinct, independent terminology and schemas.

---

## 1. Core Mathematical Axioms

### 1.1 Competence Tests (D6 Metric)
All unit capabilities test against a six-sided die (1d6) relative to an intrinsic Quality threshold ($Q \in [2, 6]$):
$$\text{Success} \iff \text{Roll} \ge Q$$

- **Natural 6 (Critical Success):** An unmodified roll of 6 always succeeds, regardless of negative situational modifiers.
- **Natural 1 (Critical Failure):** An unmodified roll of 1 always fails, regardless of positive situational modifiers.

### 1.2 Armor & Protection Tests (Defense)
Defense tests are rolled by defending units per incoming hit against an Armor/Defense threshold ($D \in [2, 6]$):
$$\text{Blocked} \iff (\text{Roll} + \text{CoverMod} - \text{AP}) \ge D$$
- An unblocked hit causes exactly **1 wound** (unless modified by damage traits like `Deadly(X)`).

---

## 2. Battlefield Geometry & Setup

### 2.1 Spatial Dimensions & Coherency
- **Table Dimensions:** Standard $48" \times 48"$ ($4' \times 4'$) playing area, or compact custom formats with at least **24" separation** between opposing deployment lines.
- **Deployment Zones:** Opposing table edges up to **12" depth**.
- **Model Coherency:**
  - Every model in a squad must remain within **1" horizontal** of at least one other squad member.
  - Every model in a squad must remain within **6" horizontal** of all squad members.
- **Proximity Exclusion Zone:** Models may not enter within **1"** of an opposing model unless executing an Assault/Charge maneuver.

### 2.2 Objective Placement & Control
- **Quantity:** $N = \lfloor\text{d}3\rfloor + 2$ objectives (3 to 5 markers).
- **Placement Rules:** Placed alternately by players outside deployment zones and $> 9"$ apart from each other.
- **Seizure & Contest Rules:**
  - Evaluated at the **end of each round**.
  - A marker is **controlled** by a player if they have at least one friendly model within **3" horizontal** and zero enemy models within 3".
  - Markers remain under a player's control even after leaving the radius.
  - If opposing units are simultaneously within 3", the objective becomes **contested** and reverts to neutral.
  - Suppressed / Shaken units cannot seize or contest objectives.
- **Match Duration:** Exactly **4 rounds**. The player controlling the most objectives at the end of round 4 wins.

---

## 3. Turn & Activation Flow

```mermaid
stateDiagram-v2
    [*] --> RoundStart
    RoundStart --> InitiativeCheck
    InitiativeCheck --> PlayerActivation
    PlayerActivation --> UnitTurn
    UnitTurn --> CheckNextPlayer
    CheckNextPlayer --> PlayerActivation: More unactivated units
    CheckNextPlayer --> EndOfRoundUpkeep: All units activated
    EndOfRoundUpkeep --> RoundStart: Round < 4
    EndOfRoundUpkeep --> GameEnd: Round == 4
```

### 3.1 Initiative Progression
1. **Round 1:** Player who won the pre-game deployment roll-off takes the first activation.
2. **Subsequent Rounds (2–4):** The player who finished activating all of their units first in the preceding round takes the first activation.

### 3.2 Activation Maneuvers
A player selects one ready unit that has not yet activated this round. The unit chooses exactly **one** of the following four maneuvers:

| Maneuver | Movement Distance | Action Capabilities |
| :--- | :--- | :--- |
| **Hold (Stationary)** | $0"$ | May fire ranged weapons. |
| **Advance (Standard Move)** | Up to Base Speed ($6"$) | May fire ranged weapons after completing move. |
| **Rush (Dash)** | Up to $2 \times$ Base Speed ($12"$) | Ineligible to shoot. |
| **Charge (Assault)** | Up to $2 \times$ Base Speed ($12"$) | Must reach base contact with enemy; initiates Melee. |

---

## 4. Ranged Combat Resolution

```mermaid
sequenceDiagram
    participant Attacker
    participant Server as Authoritative Engine
    participant Defender

    Attacker->>Server: Declare Target & Weapon Profiles
    Note over Server: Check Range & LOS
    Server->>Server: Roll Hit Dice (1d6 >= Quality)
    Server-->>Defender: Hits Scored (Passes to defender)
    Defender->>Server: Roll Defense Dice (1d6 >= Defense - AP + Cover)
    Server->>Server: Calculate Unblocked Wounds
    Server-->>Defender: Apply Wounds & Roll Wound Effects Table
```

1. **Targeting & Split Fire:**
   - Attacker must have line of sight and target within weapon range.
   - A squad may divide its fire among up to **two distinct targets**, provided each target is fired upon by distinct weapon profiles.
2. **Hit Allocation:**
   - Attacker rolls 1d6 per weapon attack count. Each roll $\ge Q$ scores 1 hit.
3. **Protection Test:**
   - Defender rolls 1d6 per hit scored. A roll $\ge D$ blocks the hit.
   - **Cover:** Grants $+1$ to Defense rolls if target is in cover terrain or partially obscured behind terrain:
     - *Low cover (crates, barricades):* Attack ray must pass through intervening cover between shooter and target. Terrain adjacent to the shooter (within 1.0") is ignored — shooting out of cover does not grant cover to open targets downrange. Defending targets must be within **1.0"** of the low cover piece along the line of fire (or inside area terrain) to receive the $+1$ Defense bonus, matching tabletop True-Line-of-Sight where low waist-high crates do not obscure open fighters downrange.
     - *Sight-blocking cover (solid walls, columns):* Target must be within 1.0" of the piece and partially obscured from the shooter's vantage point (at least one ray to the model's flanks is blocked while center LoS remains open). Terrain situated behind or beside the target without obscuring it grants no cover.
     - *Apertures (Windows & Doorways):*
       - *Doorways (`wall-doorway`):* The central 1.0" opening allows unobstructed Line of Sight and model movement. Models adjacent to the frame (within 1.0") receiving fire through the doorway gain $+1$ Defense (Cover).
       - *Windows / Firing Ports (`wall-window`):* Windows block model movement. Line of Sight can only be drawn through a window if at least one fighter (shooter or target) is within **1.0"** of the window aperture ("manning the port" / peeking). A model within 1.0" of a window receiving fire through it gains $+1$ Defense (Cover). If both models are $>1.0"$ from the window, the wall blocks sight entirely (preventing distant geometric keyholing).
   - **Armor Piercing (AP):** Subtracts $X$ from defender's roll.
4. **Wound Infliction:**
   - Each failed defense die inflicts 1 wound marker on the target. Proceed immediately to **Section 6 (Casualty & Wound Effects Table)**.

---

## 5. Close Quarters Combat (Melee)

1. **Charge Contact & Consolidation:**
   - Charging models must move into base contact with enemy models (or as close as geometry allows).
   - Defending models in the target unit consolidate up to **3"** toward the chargers into base contact.
2. **Striking Reach:**
   - All models within **2" horizontal** and **4" vertical** of an enemy model strike with all equipped melee weapons.
3. **Simultaneous Melee Resolution:**
   - Attackers roll hits (Quality test) and defenders roll saves (Defense test) following standard combat rules.
4. **Retaliatory Strike:**
   - If the defending unit survives, it may choose to strike back with its eligible models.
5. **Separation & Consolidation:**
   - If either unit is completely wiped out, the surviving unit may consolidate up to **3"**.
   - If both units survive, the charging unit must push back to create a **1" gap** between the units.
6. **Fatigue / Exhaustion:**
   - Once a unit has charged or retaliated in melee during a round, it becomes **Fatigued**.
   - For the rest of the round, fatigued units only hit in melee on **unmodified natural 6s**.

---

## 6. Casualty, Wound Effects & Squad Allocation

Whenever a model suffers wounds, place **1 wound token (WT)** per unsaved wound next to the model.

### 6.1 Multi-Model Squads
- For units containing multiple models, **each wound immediately eliminates one model** until only the final surviving model remains.
- Only the **final surviving model** in a squad accumulates wound tokens and rolls on the Wound Effects Table.

### 6.2 Resilient(X) (Toughness) Progression
- Standard models (Toughness 1) check wound effects immediately upon suffering their 1st wound ($1\text{d}6 + 1$ token; KO on 6+).
- Multi-wound models with **`resilient(X)`** accumulate wound tokens without rolling wound effects until they have accumulated at least $X$ wounds.
- While below threshold ($< X$), status badges display progress (e.g. `1/3 WT`, `2/3 WT`).
- Once reaching $X$ wounds or more, the model makes a Wound Effect Roll. To reflect toughness, the Knockout threshold scales to **$5 + X$**.
  - Example for `resilient(3)`: Upon taking its 3rd wound, rolls $1\text{d}6 + 3$ tokens; Knocked Out only on **8+** ($5 + 3$).

### 6.3 Wound Effects Table (1d6 + Wound Tokens)
The defender rolls 1d6 and adds the model's total accumulated wound tokens:

$$\text{Wound Effect Score} = \text{1d6 Roll} + \text{Total Accumulated Wound Tokens}$$

| Wound Effect Score | Status Effect | Gameplay Consequences |
| :---: | :--- | :--- |
| **$< 5 + X$** *(1 – 5 for Tough 1)* | **Shaken** | • Model remains in play.<br>• Must spend its entire next activation idle/recovering to clear suppression.<br>• May strike back in melee, but always counts as **Fatigued** (hits only on 6s).<br>• Automatically fails all morale checks.<br>• Cannot contest or seize objective markers. |
| **$\ge 5 + X$** *(6+ for Tough 1)* | **Knocked Out (Destroyed)** | • Model is eliminated and removed from play. |

---

## 7. Morale & Army Breaking

At the **end of each round**, evaluate total army strength:

1. **Threshold Check:**
   - If an army is reduced to **$\le 50\%$** of its initial starting unit count, the army enters a Broken state.
2. **Morale Test:**
   - Every surviving unit in the broken army must take a Morale Test: roll 1d6 $\ge$ Quality.
3. **Outcomes:**
   - **Pass ($\ge Q$):** Unit maintains composure and continues fighting.
   - **Fail ($< Q$):** Unit becomes **Shaken**.
   - **Critical Fail (Already Shaken):** If a unit is *already* Shaken when it fails a Morale Test, it immediately **Panics / Routs** and is removed from play as destroyed.

---

## 8. Environmental Obstacles & Terrain

| Terrain Type | Environmental Rule | Mechanical Implementation |
| :--- | :--- | :--- |
| **Cover Terrain** | Light foliage, low barricades, crates, visual obscuration, window sills. | Defenders receive **$+1$ to Defense rolls** against shooting attacks when positioned within cover, within 1.0" of intervening low cover along the line of fire, or within 1.0" of a window aperture being fired through. |
| **Aperture Walls** | Doorway passages and window firing ports. | Doorways allow both movement and Line of Sight through the central 1.0" gap. Windows allow Line of Sight when a model is within 1.0" (providing +1 Defense against incoming fire), but block movement. |
| **Difficult Terrain** | Mud, dense trenches, steep inclines, deep water. | Maximum movement distance across the entire activation is **capped at 6"** (negates speed bonuses for Rush and Charge). |
| **Dangerous Terrain** | Minefields, acid pools, barbed wire, electrified wire. | When moving through or activating inside dangerous terrain, roll 1d6 per model (or Tough value dice). Every **roll of 1 inflicts 1 wound**. |

---

## 9. Comprehensive Trait & Special Rules Matrix

Every special rule is modeled as a declarative modifier or state machine interceptor:

| Trait ID | Display Name | Mechanical Specification |
| :--- | :--- | :--- |
| **`drop-reserve`** | **Drop Reserve** | Unit is held in reserve. At the start of round 2, 3, or 4, deploys anywhere $>9"$ from enemy units. Cannot seize/contest objectives on deployment round. |
| **`pierce(X)`** | **Pierce(X)** | Subtracts $X$ from defender's Defense saving throws against this weapon. |
| **`hexed`** | **Hexed** | Ignores target's `ward`. Target must re-roll unmodified saving throw results of 6. |
| **`blast(X)`** | **Blast(X)** | Ignores cover. Multiplies hits by $X$ (up to maximum number of models in target / enemy models within $3"$). |
| **`channeler(X)`** | **Channeler(X)** | Generates $X$ tokens per round (cap 6). Spends tokens equal to power cost to cast; succeeds on 1d6 roll of 4+. Friendly/enemy channelers within 18" in LOS may spend tokens to grant $\pm 1$ modifier. |
| **`brace`** | **Brace** | Strikes first in melee when charged. Attacking charger suffers $-1$ Shock hit per model with Brace. |
| **`lethal(X)`** | **Lethal(X)** | Wounds from this weapon deal $X$ wounds each. Resolved first; extra wounds do not carry over to other models in squad. |
| **`swift`** | **Swift** | Increases movement: $+2"$ to Advance (Speed 8"), $+4"$ to Rush/Charge (Speed 16"). |
| **`dread(X)`** | **Dread(X)** | Model counts as having dealt $+X$ additional wounds when calculating Wound Effects roll in melee (requires at least 1 actual wound dealt). |
| **`stoic`** | **Stoic** | When failing a morale test, roll 1d6. On a 4+, the test is treated as passed. |
| **`airborne`** | **Airborne** | Ignores terrain effects and intervening models while moving. Automatically succeeds on jump checks. |
| **`frenzy`** | **Frenzy** | When charging, unmodified hit rolls of 6 in melee generate 1 additional hit (bonus hit does not trigger further 6s). |
| **`commander`** | **Commander** | Friendly units within 12" may test Morale using the Commander's Quality score (provided Commander is not Suppressed). |
| **`stationary`** | **Stationary** | Unit may only execute **Hold** actions. Cannot move, advance, or charge. |
| **`shock(X)`** | **Shock(X)** | On charging, rolls $X$ dice before normal attacks (unless fatigued). Each roll of 2+ inflicts 1 immediate hit. |
| **`lobbed`** | **Lobbed** | Fires without requiring line of sight and ignores cover from sight blockers. Suffers $-1$ to hit if firing after moving. |
| **`expendable`** | **Expendable** | Weapon profile or ability may only be used **once per match**. |
| **`ward`** | **Ward** | Whenever suffering wounds, roll 1d6 per wound. On a **5+**, the wound is ignored. |
| **`sustained`** | **Sustained** | When shooting at targets $>9"$ away, unmodified hit rolls of 6 generate 1 additional hit. |
| **`calibrated`** | **Calibrated** | Attacks made with this weapon always hit on a Quality test of **2+**, regardless of unit's base Quality. |
| **`shred`** | **Shred** | Ignores `ward`. Unmodified hit rolls of 6 gain **`pierce(4)`**. |
| **`vanguard`** | **Vanguard** | Infiltrates during deployment. Deployed after all standard units, placed anywhere fully within 12" of friendly deployment zone. |
| **`ponderous`** | **Ponderous** | Decreases movement: $-2"$ to Advance (Speed 4"), $-4"$ to Rush/Charge (Speed 8"). |
| **`camouflaged`** | **Camouflaged** | When targeted by ranged attacks from $>9"$ distance, enemy attack rolls suffer a **$-1$ penalty to hit**. |
| **`pathfinder`** | **Pathfinder** | Ignores Difficult Terrain speed cap. Automatically passes jump checks on 2+. |
| **`overload`** | **Overload** | Unmodified hit rolls of 6 deal 1 additional hit. |
| **`impale`** | **Impale** | When charging, attacks gain **$+1$ to hit** and **`pierce(+1)`** in melee. |
| **`resilient(X)`** | **Resilient(X)** | Accumulates wounds without rolling wound effects until reaching $X$ wounds. Only knocked out on wound effect rolls $\ge 5 + X$. |
| **`unerring`** | **Unerring** | Ignores target's `ward`, and ignores all negative modifiers applied to this weapon. |
| **`steadfast`** | **Steadfast** | Units where all models have this rule gain **$+1$ to morale test rolls** ($+2$ with `steadfast-boost`). |
| **`marksman`** | **Marksman** | Grants **$+1$ to hit rolls** when shooting. |
| **`rupture`** | **Rupture** | Unmodified hit rolls of 6 gain **`pierce(+2)`**. |
| **`riot-shield`** | **Riot Shield** | Grants **$+1$ to Defense rolls** against hits that are not from powers. |
| **`iron-will`** | **Iron Will** | Failed morale tests count as passed; roll dice equal to Tough/wounds needed for wound effects (min 1) and take 1 unignorable wound per roll of 1–3. |
| **`double-time`** | **Double Time** | Moves **$+4"$** when using Advance actions. |

---

## 10. Advanced Dynamic Traversal Rules

### 10.1 Knockback / Pushing
Whenever a target model receives a **Suppressed (Shaken)** result from an attack, the attacking player may roll 1d6. On a **4+**, the attacker displaces the target model by up to **2"** in any horizontal direction.

### 10.2 Gaps & Drops (Jumping)
- **Standard Clearance:** Models cross horizontal gaps $\le 1"$ and drop elevations $\le 3"$ without penalty or testing.
- **Extended Clearance ($\le 6"$):**
  - Requires a Jump test: Roll $X + 1$ dice testing for $3+$, where $X$ is 1 die per full 3" traversed.
  - If all dice succeed ($3+$), the model clears the distance without expending its normal movement allowance.
  - If any die fails, the model falls.

### 10.3 Falling Damage
- If a model falls or is pushed off an elevated surface $\ge 2"$ tall:
  - Takes 1 automatic hit with **AP(1) per full 3" of vertical fall**.
  - Model lands within 2" of the bottom edge and its activation terminates immediately.
  - In multi-model squads, a fall eliminates the individual model unless only the squad survivor remains.

---

## 11. Data Pack Architecture & Serialization Schema

```typescript
export interface UnitProfile {
  id: string;
  name: string;
  cost: number;
  quality: number;      // e.g. 4 for 4+
  defense: number;      // e.g. 5 for 5+
  speed: number;        // Standard base speed, default 6
  size: number;         // Model count in squad
  wounds: number;       // Current trauma count
  status: Array<'ready' | 'activated' | 'suppressed' | 'fatigued' | 'engaged' | 'destroyed'>;
  weapons: WeaponProfile[];
  traits: TraitInstance[];
}

export interface WeaponProfile {
  id: string;
  name: string;
  range: number;        // 0 for melee, >0 for ranged (inches)
  attacks: number;      // Attack dice count
  traits: TraitInstance[];
}

export interface TraitInstance {
  type: TraitType;
  value?: number;       // e.g. X for AP(X), Tough(X), Blast(X)
}
```
