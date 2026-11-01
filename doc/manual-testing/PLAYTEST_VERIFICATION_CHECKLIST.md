# Sub-Phase 13.5C Manual Verification Checklist

**Scope:** 3D Surface-Constrained Navigation & Stair Traversal (carrying forward objective flat visual polish).

---

## Prerequisites
- Two browser windows / tabs:
  - **Window A:** Host (Faction: *Frontier Wardens*)
  - **Window B:** Guest (Faction: *Rust Raiders*)
- Local dev server (`npm run dev`) or deployed release URL.

---

## 1. Objective Marker Visual Polish (Flat Ground Circle)
- [ ] Inspect the scenario objective markers on the battlefield (Alpha, Bravo, Charlie, Delta).
- [ ] **Physical Crate Removal Check:** Verify the 3D supply crate model has been **completely removed** from all objective markers.
- [ ] Verify the objective marker consists solely of the clean 3.0″ radius team-colored ground ring, soft semi-transparent capture disc, and subtle center pip.
- [ ] Verify models can stand directly in the center of the objective circle without any 3D obstacle collision or visual clipping.

---

## 2. Sub-phase 13.5C: 3D Surface-Constrained Navigation & Stair Traversal

### 2.1 Ground-to-Platform Stair Traversal (1:1 Normal Speed)
- [ ] Activate a ground unit on the east side of the map (e.g. *Warden Trooper 2* near $x = 0, z = -2$).
- [ ] Click **Move** or **Rush**.
- [ ] Hover the mouse cursor over the elevated **East Catwalk / Platform East** ($x = 6.0, y = 2.5, z = -2.0$):
  - [ ] **Surface-Constrained Path Check:** Verify the yellow path preview line **does NOT fly diagonally through open air**.
  - [ ] Verify the path routes along the ground ($y = 0″$) to the foot of the East Stairs ($x \approx 3.8, z = -2$).
  - [ ] Verify the path ascends along the stair slope ($y = 0 \to 2.5″$).
  - [ ] Verify the path steps onto the platform deck and walks across the surface to the cursor position at $y = 2.5″$.
- [ ] **No Difficult Terrain Penalty:**
  - [ ] With **Rush** active (12.0″ movement allowance), verify the unit can traverse all the way up the stairs onto the platform in a single activation.
  - [ ] Verify the confirmation bar displays normal movement distance and does **NOT** show a `[Difficult Terrain 6.0" cap]` warning.
- [ ] Click **Confirm**:
  - [ ] Verify the fighter smoothly follows the path: running across the ground, climbing the stairs, and stepping onto the platform deck.

### 2.2 Ladder Ascension
- [ ] Activate a ground unit on the west side of the map (e.g. *Warden Captain 1* or *Rust Runner 2*).
- [ ] Click **Move** or **Rush**, and hover over **West Platform** ($x = -6.0, y = 2.5, z = 2.0$) near the West Ladder.
- [ ] Verify the path routes along the ground to the foot of the ladder ($x = -4.5, y = 0, z = 2$), climbs vertically up the ladder face to $y = 2.5″$, and steps onto the deck.
- [ ] Verify climbing the ladder does **NOT** trigger a Difficult Terrain penalty.

### 2.3 Sheer Wall Climbing Fallback (Difficult Terrain 6.0″ Cap)
- [ ] Activate a ground fighter and select a destination on an elevated building roof or platform with **NO** stairs or ladders reachable.
- [ ] Inspect the live path preview:
  - [ ] Verify the model navigates along the ground to the **base of the wall** directly in front of the platform.
  - [ ] Verify the path scales vertically straight up the wall face ($x, z$ constant, ascending to deck level) and steps onto the surface.
  - [ ] Verify the model **never flies diagonally through mid-air**.
- [ ] **Difficult Terrain Speed Cap Warning:**
  - [ ] Verify the confirmation bar warns: `[Difficult Terrain 6.0" cap]`.
  - [ ] If using **Rush** (nominal 12″), verify the maximum movement is capped at 6.0″.

### 2.4 Descending Stairs to Ground Level
- [ ] Select a fighter currently positioned on an elevated platform (e.g. East Platform at $y = 2.5″$).
- [ ] Click **Move** and click a destination on the open ground floor ($y = 0″$).
- [ ] Verify the path routes across the platform deck, descends cleanly down the stairs to the ground entrance, and walks to the ground destination.
- [ ] Verify descending via stairs is treated as a controlled ramp traversal and does **NOT** trigger a high drop / falling damage test.

---

## 3. Split-Fire System & Dice Log Check (Carried Forward Note)
- [ ] During split-fire attack resolution, check that both allocations report distinct hit/defense tests.
- [ ] If wounds are dealt to a split target, verify the wound effect / trauma badge appears in the dice log for that respective target block.
