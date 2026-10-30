# Phase 7 Manual Validation Checklist

Run `npm run dev` to launch the dev servers, then test with two browser tabs connected over WebRTC (Host and Guest):

### 1. Objective 3D Beacon Visuals & Board Placement

- [ ] **Objective Markers Render on Board:**
  - Launch a new game and connect Host and Guest tabs.
  - **Verify:** 4 distinct objective beacons (Alpha, Bravo, Charlie, Delta) are visible on the battlefield.
  - **Verify:** All 4 markers are placed in open areas outside both deployment zones (between $z = -12$ and $z = 12$) and spaced well apart (> 9″ from one another).
- [ ] **3D Beacon Visual Elements:**
  - Zoom in on any objective marker.
  - **Verify:** Each objective consists of:
    - A sharp 3.0″ radius circular ground boundary ring (`RingGeometry`).
    - A semi-transparent ground capture zone disc.
    - A central metallic pedestal base.
    - A vertical translucent light pillar / energy beam rising into the air.
    - A hovering diamond crystal (`OctahedronGeometry`) suspended in the beam.
  - **Verify:** All markers initially glow in Neutral Gold (`#ffd54f`).

---

### 2. Objective Hover & RTS Data Card Inspection

- [ ] **Hovering Objective Beacon:**
  - Move the mouse cursor directly over an objective beacon or within its 3.0″ radius on the ground.
  - **Verify:** The bottom-left HUD data card slot immediately switches to display the **Objective Data Card**.
  - **Verify:** The card displays:
    - Objective Name (e.g., `OBJECTIVE ALPHA`).
    - Status badge (initially `NEUTRAL` in gold).
    - `3.0" Control Radius` specification.
    - Unit presence counter: `Host: 0 | Guest: 0`.
- [ ] **Moving Cursor Away:**
  - Move the cursor to empty terrain far away from any objective or unit.
  - **Verify:** The objective data card closes cleanly.

---

### 3. Round-End Control Evaluation (Friendly Capture)

- [ ] **Moving into 3.0″ Capture Radius:**
  - Host activates a unit (e.g., Warden Scout) and moves it inside the 3.0″ ground boundary ring of Objective Alpha.
  - Guest activates a unit elsewhere, keeping all Guest units > 3.0″ away from Objective Alpha.
  - Hover over Objective Alpha.
  - **Verify:** The objective data card now reflects `Host: 1 | Guest: 0`, but the status badge remains `NEUTRAL` (control resolves at round end, not mid-round).
- [ ] **Round End Seizure:**
  - Complete all unit activations for Round 1 to trigger the round-end evaluation.
  - **Verify:**
    - Objective Alpha transitions to Host control.
    - 3D beacon visual (light pillar, ground boundary ring, crystal) changes from gold to Host Blue (`#29b6f6`).
    - Top HUD header updates live objective score: `Objectives: Host 1 — Guest 0`.
    - Hovering Objective Alpha shows status badge `CONTROLLED BY HOST`.

---

### 4. Persistent Objective Control (Leaving the Objective)

- [ ] **Vacating the Controlled Objective:**
  - In Round 2, activate the Host unit that captured Objective Alpha and move/rush it completely outside the 3.0″ boundary ring.
  - Ensure no Guest models enter within 3.0″ of Objective Alpha during Round 2.
  - Complete all unit activations to end Round 2.
  - **Verify:**
    - Objective Alpha *retains* Host control despite 0 friendly models remaining within 3.0″.
    - 3D beacon remains Host Blue (`#29b6f6`).
    - Top HUD score remains `Objectives: Host 1 — Guest 0`.

---

### 5. Contested Objectives (Simultaneous Enemy Presence)

- [ ] **Opposing Forces Within 3.0″:**
  - Move a Host model within 3.0″ of Objective Bravo.
  - Move a Guest model within 3.0″ of Objective Bravo.
  - Complete remaining activations to trigger round end.
  - **Verify:**
    - Objective Bravo transitions to `CONTESTED`.
    - 3D beacon visual shifts to bright warning Orange (`#ff9800`).
    - Hovering Objective Bravo shows status badge `CONTESTED` with presence `Host: 1 | Guest: 1`.
    - Neither player receives credit for Objective Bravo in the top HUD score tracker.

---

### 6. Hostile Recapture

- [ ] **Flipping an Enemy-Held Objective:**
  - Move a Guest model within 3.0″ of Host-controlled Objective Alpha.
  - Ensure all Host models are > 3.0″ away from Objective Alpha.
  - End the round.
  - **Verify:**
    - Objective Alpha flips directly from Host control to Guest control.
    - 3D beacon visual shifts from Host Blue (`#29b6f6`) to Guest Red (`#ef5350`).
    - Top HUD score decrements Host and increments Guest (e.g., `Objectives: Host 0 — Guest 1`).

---

### 7. Shaken Units Cannot Capture or Contest

- [ ] **Shaken Unit Exclusion:**
  - Shoot or wound an enemy model until it is **Shaken** (fails morale test, pinned/shaken status).
  - Move the Shaken enemy model within 3.0″ of an objective.
  - Have a friendly non-shaken model within 3.0″ of the same objective.
  - End the round.
  - **Verify:**
    - The Shaken enemy model is ignored during control evaluation.
    - The objective is *not* contested; the friendly player successfully captures or retains control.

---

### 8. 4-Round Match Clock & Automatic Game Over

- [ ] **Round Counter Display:**
  - Observe the top HUD header throughout the game.
  - **Verify:** The header displays the match progression: `Round 1 / 4`, `Round 2 / 4`, `Round 3 / 4`, and `Round 4 / 4`.
- [ ] **Match Termination at End of Round 4:**
  - Play through activations in Round 4 until the final model activates and Round 4 concludes.
  - **Verify:**
    - Game status transitions to `game-over`.
    - Further moves or activations are locked.
    - A celebratory/defeat Game Over Modal appears on both player screens.
    - Modal announces the winning player based on who controls the most objectives (or `DRAW / STALEMATE` if scores are tied).
    - Modal displays the final objective score: `Final Objectives: Host X — Guest Y`.
    - Modal displays an itemized per-objective breakdown (e.g., `Alpha: Controlled by Host`, `Bravo: Contested`, etc.).

---

### 9. Immediate Army Elimination Fallback

- [ ] **Total Army Elimination Before Round 4:**
  - In Round 1, 2, or 3, completely eliminate all opposing fighters with ranged or melee attacks before Round 4 ends.
  - **Verify:**
    - Game ends immediately upon the destruction of the final enemy unit.
    - Game Over Modal declares immediate victory via army elimination without waiting for Round 4.
