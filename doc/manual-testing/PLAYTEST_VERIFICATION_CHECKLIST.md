# Sub-Phase 13.5B Manual Verification Checklist

**Scope:** Ranged Combat Concentric Range Rings & Split-Fire System (carrying forward 13.5A fixes).

---

## Prerequisites
- Two browser windows / tabs:
  - **Window A:** Host (Faction: *Frontier Wardens*)
  - **Window B:** Guest (Faction: *Rust Raiders*)
- Local dev server (`npm run dev`) or deployed release URL.

---

## 1. Carried Forward 13.5A Fixes: Objective Base Visuals & Kenney Crate
- [ ] Inspect the scenario objective markers on the battlefield (Alpha, Bravo, Charlie, Delta).
- [ ] Verify each objective base uses the Kenney blaster-kit `crate-medium.glb` model.
- [ ] Verify the outer 3.0″ ground ring renders with softened opacity (`0.45`) and team-reactive colors (Blue for Host, Red for Guest, Orange for Contested, Gold for Neutral).
- [ ] **Crystal Diamond Check:** Verify the floating crystal diamond marker has been **completely removed**, leaving only the clean grounded crate.

---

## 2. Carried Forward 13.5A Fixes: Objective 3.0″ Vertical Cylinder Constraint & F9 Debugger Bounds
- [ ] **F9 3D Volume Bounds Visualization:**
  - [ ] Press **F9** to toggle the debug overlay.
  - [ ] Verify a 3D wireframe cylinder (radius 3.0″, height 6.0″ extending $\pm 3.0″$ vertically) renders around each objective in warm amber/gold.
  - [ ] Verify rings render at top ($+3.0″$), middle ($0″$), and bottom ($-3.0″$) with 8 vertical connector struts.
- [ ] **Ground-Level Presence:**
  - [ ] Move a friendly ground unit within 3.0″ horizontally of an objective crate at $y = 0″$.
  - [ ] Hover cursor over the objective crate: DataCard confirms `Unit Presence: Host: 1 · Guest: 0` (or `Guest: 1`) and shows `Objective (3.0" control radius, ±3.0" vertical)`.
- [ ] **High Vertical Rooftop Exclusion (> 3.0″):**
  - [ ] Move a fighter onto a rooftop $> 3.0″$ vertically above a ground objective (e.g., $y \ge 3.5″$).
  - [ ] Visually verify against the F9 wireframe cylinder that the rooftop fighter sits above the top ring.
  - [ ] Hover cursor over the ground objective: Verify the elevated fighter does **NOT** count toward unit presence (`Unit Presence: 0`).
  - [ ] At round end, verify the high-rooftop unit cannot seize or contest the ground objective.
- [ ] **Low Elevation Tier Inclusion (≤ 3.0″):**
  - [ ] Move a fighter onto a low platform or stairs at $y = 2.5″$ within 3.0″ horizontally of the objective (inside the F9 wireframe cylinder).
  - [ ] Hover cursor over the objective: Verify the fighter **DOES** count toward unit presence because vertical separation is $\le 3.0″$.

---

## 3. Carried Forward 13.5A Fixes: Interactive Melee Consolidation Move (Wipeout)
- [ ] **Consolidation Prompt Trigger:**
  - [ ] Initiate melee combat (via **Charge**, **Fight**, or **Melee Retaliation**) and completely destroy the defender/opponent unit.
  - [ ] Verify the victorious unit is **NOT** pushed back and does **NOT** freeze in place.
  - [ ] Verify an interactive prompt appears at the bottom of the screen:
    - **Header:** `Victory Consolidation` with a 15-second countdown timer.
    - **Description:** `[Unit Name] wiped out [Enemy Name]! Move up to 3.0" in any direction, or stay put.`
    - **Action Button:** `Stay Put`.
- [ ] **Interactive 3.0″ Repositioning & Confirmation Path Pin:**
  - [ ] With the consolidation prompt active, move your mouse over the board.
  - [ ] Verify a 3.0″ maximum range ring and live path preview appear centered on the victorious fighter.
  - [ ] Click a valid destination on the board within 3.0″.
  - [ ] Verify the confirmation bar appears: `Consolidate [Unit Name] X.X" (max 3.0")` with **Confirm** and **Cancel** buttons.
  - [ ] **Cursor Hover Pinning Check:** Move the mouse across the screen toward the **Confirm** button: Verify the path preview line **stays pinned** to the clicked destination rather than following the mouse cursor.
  - [ ] Click **Confirm**:
    - [ ] The victorious unit moves smoothly to the chosen destination.
    - [ ] The consolidation prompt closes and combat completes cleanly.
- [ ] **Stay Put Option:**
  - [ ] In another melee wipeout, click **Stay Put** (or let the 15-second timer expire).
  - [ ] Verify the consolidation prompt dismisses and the unit remains in place without moving.

---

## 4. Sub-phase 13.5B: Concentric Weapon Range Indicators & Interactive Split-Fire System
- [ ] **Concentric Range Rings on LoS Fan:**
  - [ ] Activate a fighter with multiple ranged weapons of different ranges (e.g. *Warden Marksman 3* with Rifle 24" & Sidearm 12", or *Warden Breacher 4* with Scattergun 12" & Sidearm 12").
  - [ ] Click the **Shoot** action button.
  - [ ] Inspect the 3D battlefield:
    - [ ] Verify the shadow LoS fan extends to the maximum range of the fighter's longest weapon (e.g., 24″).
    - [ ] Verify soft concentric range rings render at the boundary of each weapon's maximum range (e.g., a 12″ ring inside the 24″ fan).
- [ ] **Interactive Weapon Targeting Chips in HUD:**
  - [ ] In **Shoot** mode, inspect the bottom action bar / dock:
    - [ ] Verify individual weapon chips render for each equipped ranged weapon (e.g. `[ Rifle (24") ]` and `[ Sidearm (12") ]`).
    - [ ] The first weapon is selected by default with a glowing gold highlight.
- [ ] **Default All-Weapons Target Assignment:**
  - [ ] Click an enemy fighter that is within range of all equipped ranged weapons.
  - [ ] Verify all weapon chips update to show `➔ [Enemy Name]`.
  - [ ] Verify the confirmation bar summarizes firing all weapons at the enemy (e.g. `[Unit] fires Rifle & Sidearm at [Enemy] (X.X")`).
- [ ] **Interactive Split-Fire Allocation:**
  - [ ] In the weapon chips dock, click on a specific weapon chip (e.g. `Sidearm (12")`) to select it.
  - [ ] Click a **different** eligible enemy fighter within range of that weapon.
  - [ ] Verify the weapon chips now reflect independent allocations:
    - Chip 1: `Rifle (24") ➔ [Target A]`
    - Chip 2: `Sidearm (12") ➔ [Target B]`
  - [ ] **Simultaneous Target Markers on Battlefield:** Inspect the 3D scene:
    - [ ] Verify bright red targeting rings are rendered around **both** Target A and Target B simultaneously.
  - [ ] **Confirmation Bar Summary:**
    - [ ] Verify the confirmation bar updates to: `[Attacker] split fires: Rifle at Target A (X.X") [1d6 ...] · Sidearm at Target B (Y.Y") [1d6 ...]`.
- [ ] **Split-Fire Combat Execution & Dice Log:**
  - [ ] Click **Confirm** to execute split-fire.
  - [ ] Verify in the **Dice Resolution Log**:
    - [ ] Separate hit tests are rolled and displayed for Target A and Target B.
    - [ ] Target A rolls defense against the Rifle hits.
    - [ ] Target B rolls defense against the Sidearm hits.
    - [ ] Wounds and status tokens (stunned/wound badges) are applied independently to Target A and Target B according to their respective defense results.
