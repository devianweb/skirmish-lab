# SkirmishLab Phase 13.5 Consolidated Playtest Verification Checklist

**Scope:** Tactical Combat & Movement Refinements (Sub-phases 13.5A through 13.5I), including 3D Vertical Traversal, Solid Triangular Ramps, Tabletop Ladder Rules, Multi-Weapon Split Targeting, Incremental Movement Budgeting, and Arbitrary-Order 4-Model Squad Maneuvers.

---

## Starter Armies Overview

Both armies are data-pack driven, clean-room skirmish rosters with balanced profiles:

### 1. Frontier Wardens (Host / Blue)
- **Warden Captain:** Q3+ D4+ · Tough(3) · Leader · Steadfast · Resilient(3) · Hand Cannon (12", A1, Pierce(1)), Blade (1", A2)
- **Warden Patrol Squad:** Q4+ D5+ · Tough(1) · **4 Models** · 4× Patrol Carbines (18", A1)
- **Warden Marksman:** Q4+ D5+ · Tough(1) · Marksman · Precision Rifle (24", A1, AP(1)), Sidearm (12", A1)
- **Warden Breacher:** Q4+ D5+ · Tough(1) · Scattergun (12", A3, Pierce(1)), Sidearm (12", A1), Fists (1", A1)
- **Warden Gun Crew:** Q4+ D4+ · Tough(2) · Heavy Field Cannon (30", A3, Pierce(1), Rupture)

### 2. Rust Raiders (Guest / Red)
- **Raid Boss:** Q3+ D4+ · Tough(3) · Leader · Ferocious · Heavy Riveter (12", A2), Scrap Cleaver (1", A3)
- **Rust Runner Mob:** Q4+ D5+ · Tough(1) · **4 Models** · 4× Scrap Carbines (18", A1)
- **Rust Skirmisher:** Q4+ D5+ · Tough(1) · Scout · Assault Blaster (18", A2), Dagger (1", A1)
- **Rust Sapper:** Q4+ D5+ · Tough(1) · Demolitionist · Trench Gun (12", A2, Pierce(1)), Spud Wrench (1", A2)
- **Rust Bruiser:** Q4+ D4+ · Tough(2) · Relentless · Heavy Spiker (24", A3, Pierce(1))

---

## Test Environment Setup
- **Window A (Host):** Open app, click **Create Room**, select **Frontier Wardens**, copy the 6-character room code.
- **Window B (Guest):** Open app, click **Join Room**, enter code, select **Rust Raiders**.
- Both peers connect direct P2P via WebRTC with authoritative server dice rolling.

---

## 1. Multi-Model Squad Movement & User-Selected Model Order (13.5D, 13.5F & Ordered Moves)

### 1.1 Squad Roster & DataCard Counters
- [ ] Inspect the unit roster on both screens:
  - [ ] **Warden Patrol Squad** displays `Models: 4/4`.
  - [ ] **Rust Runner Mob** displays `Models: 4/4`.
- [ ] Hover over the squad to inspect the DataCard:
  - [ ] Subtitle reads `Models: 4/4`.
  - [ ] Stats table has a dedicated **Models** column displaying `4/4`.

### 1.2 User-Chosen Model Movement Order (Chips & 3D Picking)
- [ ] Activate **Warden Patrol Squad** in Window A.
- [ ] Click **Move** (or **Rush**):
  - [ ] Bottom dock displays model selection chips: `[Model 1 (Selected)] [Model 2] [Model 3] [Model 4]`.
  - [ ] Movement range ring is centered on Model 1.
- [ ] **Direct Model Chip Selection:** Click the `[Model 3]` chip:
  - [ ] Verify `[Model 3]` is now active/highlighted in cyan.
  - [ ] Verify the movement range ring shifts to center on Model 3's physical starting position.
  - [ ] Verify the dock prompt reads: `Place Model 3 of 4 (Warden Patrol Squad) within 6"`.
- [ ] Click on the board within 6.0" to place Model 3:
  - [ ] Model 3's destination is staged with a checkmark `[✓ Model 3]`.
  - [ ] The next unplaced model (`Model 1`) auto-selects.
- [ ] **Direct 3D Board Model Picking:** Click directly on **Model 4**'s 3D figurine on the battlefield:
  - [ ] Verify selection immediately switches to Model 4 (`[Model 4 (Selected)]`).
  - [ ] Range ring centers on Model 4.
  - [ ] Click the board to place Model 4.
- [ ] **Repositioning Staged Models:**
  - [ ] Click `[✓ Model 3]` to reactivate Model 3.
  - [ ] Click a new destination on the board to adjust Model 3's position.
  - [ ] Verify Model 3's destination is seamlessly updated.

### 1.3 Tabletop Coherency: Buddy Pairs (1" Pair Distance, 6" Total Spread)
- [ ] Place all 4 squad models in two distinct buddy pairs:
  - [ ] Pair 1: Model 1 and Model 2 placed within 1.0" of each other (2.0" center-to-center).
  - [ ] Pair 2: Model 3 and Model 4 placed within 1.0" of each other.
  - [ ] Distance between Pair 1 and Pair 2 is ~4.0" (greater than 1", but well within 6.0" total squad spread).
- [ ] Verify full squad coherency passes without errors and transitions to Move Confirmation.
- [ ] **Coherency Violation Test:**
  - [ ] Try placing Model 4 more than 6.0" away from Model 1: verify toast warns that spread exceeds 6.0" max coherency limit.
  - [ ] Try placing Model 4 isolated without any buddy within 1.0" (e.g. 3.0" away from all other members): verify toast warns that each model must be within 1.0" of at least one other squad member.

### 1.4 Dynamic Target Facing on Shooting
- [ ] After confirming squad movement, target an enemy unit with **Shoot**.
- [ ] Confirm shooting:
  - [ ] Verify each constituent model figurine in the squad rotates to face directly toward the targeted enemy unit.

---

## 2. Solid Triangular Ramp Collision & Tabletop Ladder Deck Arrival (13.5H)

### 2.1 Continuous Sloped Hypotenuse Traversal
- [ ] Move a unit toward a staircase/ramp terrain piece.
- [ ] Click a destination at the head of the stairs or on the elevated platform deck:
  - [ ] Verify the unit auto-paths along the sloped hypotenuse surface.
  - [ ] Verify elevation continuously increases along the slope $y(t) = y_{\text{foot}} + t(y_{\text{head}} - y_{\text{foot}})$.
  - [ ] Verify movement along stairs incurs no Difficult Terrain penalty.
- [ ] Intermediate stops: click midway up the stairs — verify the model is permitted to pause and end its move on the ramp slope.

### 2.2 Solid Wedge Collision (Impassable Risers & Rear Wall)
- [ ] Attempt to move a ground model horizontally across the stairs from the side (passing through the side riser) or through the back wall at ground height ($y = 0$).
- [ ] Verify the move is blocked by the solid triangular wedge with toast: `Move path is blocked by stairs`.

### 2.3 F9 Terrain Debug Overlay (Triangular Prism Wireframe)
- [ ] Press **F9** to toggle the terrain debug inspection overlay.
- [ ] Inspect the wireframe for stair pieces:
  - [ ] Verify stairs render as a true **right-angled triangular prism** (wedge) wireframe showing the sloped hypotenuse, vertical back wall, flat base, and triangular side risers (instead of an AABB cuboid).

### 2.4 Vertical Ladder Deck Arrival Rule
- [ ] Move a unit toward a vertical ladder piece leading to a 2.5" high platform.
- [ ] **Insufficient Movement Budget Test:**
  - [ ] Move the unit so it only has 1.5" movement remaining (insufficient to reach the 2.5" platform head).
  - [ ] Attempt to climb the ladder:
  - [ ] Verify the path automatically stops at the **ladder foot** ($y = 0$) rather than suspending the model mid-air on ladder rungs.
- [ ] **Sufficient Movement Budget Test:**
  - [ ] With full movement budget ($6.0"$), click the platform deck:
  - [ ] Verify the unit scales the ladder and arrives safely on the platform deck ($y = 2.5"$).

---

## 3. Rush Range Visual Indicator & Dynamic Movement Budgeting (13.5G & 13.5E)

### 3.1 Rush Range Visualization
- [ ] Select an active unengaged unit with base speed $6.0"$.
- [ ] Hover over **Rush**:
  - [ ] Verify the on-board range circle expands to the full **12.0"** ($2 \times \text{speed}$).
  - [ ] Verify the ring renders in a distinct **gold/amber** tint (`#ffb74d`).
- [ ] Click **Rush**: verify the 12.0" amber ring persists during destination selection.

### 3.2 Incremental Micro-Moves within Activation
- [ ] Select **Move** with a unit having speed $6.0"$.
- [ ] Make a short micro-move of $2.0"$:
  - [ ] Verify the unit walks $2.0"$.
  - [ ] Verify the unit remains activated with `hasMovementLeft = true`.
  - [ ] Verify remaining movement displays $4.0"$ on the unit card and range ring.
- [ ] Make a second micro-move of $2.5"$:
  - [ ] Unit walks $2.5"$, leaving $1.5"$ remaining budget.
- [ ] Select **Shoot** and fire weapons:
  - [ ] Verify firing completes the activation and closes any remaining movement window.

---

## 4. Multi-Weapon Split Targeting & Concentric Range Rings (13.5B)

### 4.1 Concentric Weapon Range Indicators
- [ ] Activate **Warden Marksman** (equipped with 24" Precision Rifle and 12" Sidearm).
- [ ] Click **Shoot**:
  - [ ] Verify two concentric range rings appear on the board:
    - Inner 12.0" ring for the Sidearm.
    - Outer 24.0" ring for the Precision Rifle.

### 4.2 Independent Weapon Allocation Chips
- [ ] Ensure multiple enemy targets are in range (one within 12", one within 24").
- [ ] In the bottom Shoot dock, verify separate chips are displayed for each equipped ranged weapon:
  - `[Precision Rifle (24")]`
  - `[Sidearm (12")]`
- [ ] Click `[Precision Rifle]` chip -> click enemy target A.
- [ ] Click `[Sidearm]` chip -> click enemy target B.
- [ ] Click **Confirm Attack**:
  - [ ] Verify authoritative server rolls separate attack tests for Target A and Target B.
  - [ ] Verify each target rolls appropriate defense tests and applies casualties independently.

---

## 5. Melee Consolidation & Vertical Objective Cylinder (13.5A)

### 5.1 Interactive 3.0" Melee Consolidation Move
- [ ] Charge an enemy unit with low wounds and destroy it in the melee strike.
- [ ] Upon enemy elimination:
  - [ ] Verify a reaction prompt appears: `Consolidate: Move up to 3.0" in any direction`.
  - [ ] Click a destination within 3.0" (e.g. toward cover or an objective).
  - [ ] Click **Confirm**: verify the victorious fighter consolidates to the chosen location.

### 5.2 3.0" Vertical Cylinder Objective Bounds
- [ ] Position an objective crate on the ground level ($y = 0$).
- [ ] Move a fighter onto a high rooftop directly above the objective ($y \ge 3.5"$, $\Delta y > 3.0"$).
- [ ] At round end, verify the rooftop model does **NOT** contest or capture the ground objective.
- [ ] Move a model on the ground within 3.0" horizontal distance: verify the objective is captured normally.

---

## Summary of Completed Sub-phases in 13.5
- [x] **13.5A:** Core Rules Alignment, Melee Consolidation & 3D Objective Cylinder
- [x] **13.5B:** Ranged Combat & Split-Fire System
- [x] **13.5C:** 3D Surface-Constrained Navigation & Stair Traversal
- [x] **13.5D:** Multi-Model Squad Sequential Movement & UI
- [x] **13.5E:** Incremental Movement Budget & Action Phasing
- [x] **13.5F:** Multi-Model Squad Obstacle Collision Flanking
- [x] **13.5G:** Rush Range Visual Indicator & Budget Alignment
- [x] **13.5H:** Solid Triangular Ramp (Wedge) Collision & Ladder Deck Arrival
- [x] **13.5I:** Consolidated Verification Checklist & End-to-End Validation
- [x] **User Feature:** Arbitrary User-Selected Squad Model Movement Order (via HUD Chips & 3D Picking)
