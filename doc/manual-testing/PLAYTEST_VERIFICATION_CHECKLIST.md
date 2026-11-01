# Sub-Phase 13.5D Manual Verification Checklist

**Scope:** Multi-Model Squad Sequential Movement, HUD Squad Model Counters, and Casualty Visual Preservation.

---

## Prerequisites
- Two browser windows / tabs:
  - **Window A:** Host (Faction: *Frontier Wardens* — select starter force in Lobby)
  - **Window B:** Guest (Faction: *Rust Raiders* — select starter force in Lobby)
- Local dev server (`npm run dev`) or deployed release URL.
- Both starter forces deploy multi-model squads:
  - *Frontier Wardens:* **Warden Patrol Squad** (2 models)
  - *Rust Raiders:* **Rust Runner Mob** (2 models)

---

## 1. Squad Model Count Indicators (Roster & DataCard)

### 1.1 Friendly & Enemy Roster Rows
- [ ] In Window A (Host), inspect the left-hand friendly unit roster:
  - [ ] Locate **Warden Patrol Squad**.
  - [ ] Verify the stats line displays: `Models: 2/2` (alongside `Q4+ D5+ · Tough(1)`).
- [ ] Inspect the right-hand enemy unit roster:
  - [ ] Locate **Rust Runner Mob**.
  - [ ] Verify the stats line displays: `Models: 2/2`.

### 1.2 DataCard Header Meta & Table
- [ ] Hover over **Warden Patrol Squad** to open its DataCard:
  - [ ] Verify the metadata subtitle includes: `· Models: 2/2`.
  - [ ] In the core stats table, verify a dedicated **Models** column exists between *Toughness* and *Move*, displaying `2/2`.

### 1.3 Casualty Reflection
- [ ] Once a multi-model squad takes 1 fatal casualty during combat:
  - [ ] Verify the roster stats line updates to: `Models: 1/2 (1 casualty)`.
  - [ ] Verify the DataCard metadata updates to: `· Models: 1/2 (1 casualty)`.
  - [ ] Verify the DataCard stats table updates to: `1/2`.

---

## 2. Model-by-Model Sequential Squad Movement

### 2.1 Model 1 Placement
- [ ] Activate **Warden Patrol Squad** (or **Rust Runner Mob**).
- [ ] Click **Move** (or **Rush**):
  - [ ] Verify the bottom dock instruction states: `Place Model 1 of 2 (Warden Patrol Squad) within 6"` (or `within 12"` if Rush).
  - [ ] Verify the movement range ring is centered on Model 1.
- [ ] Click a destination on the board within movement range:
  - [ ] Verify Model 1's position is recorded and marked with a placement pip.

### 2.2 Model 2 Coherency Circle & Legal Placement
- [ ] Immediately after placing Model 1:
  - [ ] Verify the bottom dock instruction transitions to: `Place Model 2 of 2 within 2.0" coherency of placed models`.
  - [ ] **Coherency Circle Check:** Verify a visible cyan/teal 2.0″ radius circle (annulus ring + subtle soft disc) is rendered centered on Model 1's placed location.
  - [ ] Verify the movement range ring is centered on Model 2's starting position.
- [ ] **Coherency Boundary Rejection Test:**
  - [ ] Attempt to click a destination outside the 2.0″ circle (> 2.0″ from Model 1).
  - [ ] Verify a toast notification warns: `Model ... exceeds 2" limit` or coherency violation.
  - [ ] Verify the action is rejected and the HUD remains in placement mode for Model 2.
- [ ] **Legal Placement Test:**
  - [ ] Click a destination within the 2.0″ coherency circle and within Model 2's movement allowance.
  - [ ] Verify Model 2 is accepted.

### 2.3 Squad Movement Confirmation
- [ ] Once both models are placed:
  - [ ] Verify the HUD enters the standard confirmation mode.
  - [ ] Verify the confirmation bar displays: `Move Warden Patrol Squad (2 models) · can shoot after moving`.
  - [ ] Click **Confirm**:
    - [ ] Verify both constituent 3D figurine models walk to their respective placed positions.
    - [ ] Verify the squad centroid is updated correctly between both models.

Notes: I think terrain is interacting weirdly with multi unit movement. It's saying it's blocking it? I think we need to move one unit, then do another proper movement with pathing for next etc etc until they've all moved within the coherency rules.

### 2.4 Restart Placement Control ("Reset Placement")
- [ ] In a new activation, start **Move** with a multi-model squad.
- [ ] Click to place Model 1.
- [ ] While prompted to place Model 2:
  - [ ] Verify a **Reset Placement** button is visible in the bottom dock next to **Cancel**.
  - [ ] Click **Reset Placement**:
    - [ ] Verify placement resets back to Model 1 (`Place Model 1 of 2`).
    - [ ] Verify the cyan 2.0″ coherency circle clears.
    - [ ] Place Model 1 at a new destination and proceed normally.

---

## 3. Squad Casualty Visual Removal & Survivor Preservation

- [ ] Engage a 2-model squad in combat (shoot or melee) until 1 model is destroyed:
  - [ ] **Visual Model Removal:** Verify the destroyed figurine mesh disappears cleanly from the battlefield without any lingering collision or visual artifacts.
  - [ ] **Survivor Position Preservation:** Verify the surviving figurine remains in its exact physical position on the board and does **NOT** pop or snap to default formation offsets or the squad centroid.
