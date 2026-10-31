# Sub-Phase 13.5A Manual Verification Checklist

**Scope:** Core Rules Alignment, Interactive Melee Consolidation & Objective 3D Cylinder.

---

## Prerequisites
- Two browser windows:
  - **Window A:** Host (Faction: *Frontier Wardens*)
  - **Window B:** Guest (Faction: *Rust Raiders*)
- Local dev server (`npm run dev`) or deployed release URL.

---

## 1. Objective Base Visuals & Kenney Crate Model
- [ ] Inspect the scenario objective markers on the battlefield (Alpha, Bravo, Charlie, Delta).
- [ ] Verify each objective base uses the Kenney blaster-kit `crate-medium.glb` model.
- [ ] Verify the floating crystal diamond marker floats cleanly above the crate.
- [ ] Verify the outer 3.0″ ground ring renders with softened opacity (`0.45`) and team-reactive colors (Blue for Host, Red for Guest, Orange for Contested, Gold for Neutral).

---

## 2. Objective 3.0″ Vertical Cylinder Constraint
- [ ] **Ground-Level Presence:**
  - [ ] Move a friendly ground unit within 3.0″ horizontally of an objective crate at $y = 0″$.
  - [ ] Hover cursor over the objective crate: DataCard confirms `Unit Presence: Host: 1 · Guest: 0` (or `Guest: 1`).
- [ ] **High Vertical Rooftop Exclusion (> 3.0″):**
  - [ ] Move a fighter onto a rooftop $> 3.0″$ vertically above a ground objective (e.g., $y \ge 3.5″$).
  - [ ] Hover cursor over the ground objective: Verify the elevated fighter does **NOT** count toward unit presence (`Unit Presence: 0`).
  - [ ] At round end, verify the high-rooftop unit cannot seize or contest the ground objective.
- [ ] **Low Elevation Tier Inclusion (≤ 3.0″):**
  - [ ] Move a fighter onto a low platform or stairs at $y = 2.5″$ within 3.0″ horizontally of the objective.
  - [ ] Hover cursor over the objective: Verify the fighter **DOES** count toward unit presence because vertical separation is $\le 3.0″$.

---

## 3. Interactive Melee Consolidation Move (Wipeout)
- [ ] **Consolidation Prompt Trigger:**
  - [ ] Initiate melee combat (via **Charge**, **Fight**, or **Melee Retaliation**) and completely destroy the defender/opponent unit.
  - [ ] Verify the victorious unit is **NOT** pushed back and does **NOT** freeze in place.
  - [ ] Verify an interactive prompt appears at the bottom of the screen:
    - **Header:** `Victory Consolidation` with a 15-second countdown timer.
    - **Description:** `[Unit Name] wiped out [Enemy Name]! Move up to 3.0" in any direction, or stay put.`
    - **Action Button:** `Stay Put`.
- [ ] **Interactive 3.0″ Repositioning:**
  - [ ] With the consolidation prompt active, move your mouse over the board.
  - [ ] Verify a 3.0″ maximum range ring and live path preview appear centered on the victorious fighter.
  - [ ] Click a valid destination on the board within 3.0″ (toward an objective, into cover, or advancing toward another enemy).
  - [ ] Verify the confirmation bar appears: `Consolidate [Unit Name] X.X" (max 3.0")` with **Confirm** and **Cancel** buttons.
  - [ ] Click **Confirm**:
    - [ ] The victorious unit (and constituent models if a squad) moves smoothly to the chosen destination.
    - [ ] The consolidation prompt closes and combat completes cleanly.
- [ ] **Stay Put Option:**
  - [ ] In another melee wipeout, click **Stay Put** (or let the 15-second timer expire).
  - [ ] Verify the consolidation prompt dismisses and the unit remains in place without moving.
