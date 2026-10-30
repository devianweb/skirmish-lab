# Phase 6 & Phase 6.5 Manual Validation Checklist

Run `npm run dev` to launch the dev servers, then test with two browser tabs connected over WebRTC (Host and Guest):

### 1. Auto-Pathfinding Around Obstacles

- [ ] **Moving Around Crates:**
  - Activate a fighter standing behind a crate. Click a ground destination on the far side of the crate.
  - **Verify:** The movement preview line bends around the crate's corners with waypoints instead of stopping at the front face.
- [ ] **Moving Around Other Fighters:**
  - Activate a fighter standing behind a friendly fighter. Click a destination past the friendly fighter.
  - **Verify:** The path routes cleanly around the friendly model's base to reach the destination.

---

### 2. Terrain Apertures (Doorways & Windows)

- [ ] **Walking Through Doorways (`wall-doorway`):**
  - Target a movement destination on the opposite side of the doorway through the central opening.
  - **Verify:** The path routes straight through the 1.0" opening without jamb collisions.
- [ ] **Doorway Collision:**
  - Try targeting a point directly into the wall jamb next to the doorway opening.
  - **Verify:** The model stops before the jamb and does not walk through solid wall.
- [ ] **Window Peeking vs Distant Blocking (`wall-window`):**
  - Press F9 to open the spatial debugger.
  - Position a shooter adjacent to the window (≤ 1.0") and target an enemy on the other side.
  - **Verify:** LoS is Clear through the window aperture, and debug ray passes through the window opening.
  - Move both shooter and target > 1.0" away from the window.
  - **Verify:** Window blocks Line of Sight entirely (LoS: Blocked), preventing distant geometric keyholing.
- [ ] **Window Blocks Movement:**
  - Try to move or rush a unit through a window.
  - **Verify:** Movement cannot pass through the window; the pathfinder routes around the outer wall ends.

---

### 3. Low Cover 1.0" Proximity Rule

- [ ] **Defender Close to Low Crate (≤ 1.0"):**
  - Target an enemy fighter standing within 1.0" behind a crate.
  - **Verify:** Confirmation bar and dice panel show D+1 In Cover / w/ cover.
- [ ] **Defender Far from Low Crate (> 1.0"):**
  - Target an enemy standing in the open 4" behind a low crate.
  - **Verify:** LoS is clear, and Cover shows Open (No Cover). The distant crate does not protect them.
- [ ] **Shooter Adjacent to Low Crate (≤ 1.0"):**
  - Have shooter lean over a crate to shoot a distant enemy in the open.
  - **Verify:** The shooter's adjacent crate is ignored and does not give the enemy cover.

---

### 4. Rush Maneuver

- [ ] **Rush Distance & Visual Range:**
  - Activate a ready fighter and click the Rush button.
  - **Verify:** The movement range ring expands to double speed (e.g., 12" for speed 6").
- [ ] **Rush Execution:**
  - Pick a destination 10" away in open ground and confirm.
  - **Verify:** The model rushes forward 10". The action bar disables Move, Shoot, Rush, and Charge, showing the green End Activation button.
- [ ] **Rush Cannot Enter Melee:**
  - Try clicking a Rush destination within 1.0" of an enemy fighter.
  - **Verify:** A toast notification alerts "Rush cannot end in melee contact — use Charge instead".

---

### 5. Charge Maneuver & Melee Contact Indicators

- [ ] **Charge Target Selection & Auto-Strike:**
  - Activate a fighter with a melee weapon who has an enemy within double speed (12").
  - Click Charge. Enemy targets within charge navigation range are highlighted with red target rings.
  - Hover over an enemy:
    - **Verify:** A glowing double-ring melee marker appears under the enemy model, and the charge path ends with an orange contact disc.
  - Click the enemy fighter:
    - **Verify:** The confirmation dock appears with charge distance and melee strike summary: `Charges [Target] ([X.X]" into melee) & strikes with [Weapon] · [Attacks]d6`.
  - Click Confirm:
    - **Verify:** The charger rushes into melee contact (≤ 1.0"), server rolls charge attack dice, and wounds are applied.
- [ ] **Charge Eliminating Defender (No Retaliation Prompt, Charger Holds Ground):**
  - Charge a 1-wound enemy with a high-damage weapon to destroy it on the initial strike.
  - **Verify:**
    - Defender is Knocked Out / Destroyed.
    - No reaction prompt appears for either player.
    - Charger stays at the contact position (no push-back).
    - Charger gains FATIGUED tag; charger is not engaged.

---

### 6. Interactive Reaction Framework & Melee Retaliation (Phase 6.5)

- [ ] **Interactive Prompt & Active Player Waiting State:**
  - Host charges Guest's surviving multi-wound model (e.g. Raid Boss or Rust Bruiser).
  - Charge attack completes and defender survives:
    - **Verify (Host Tab):** Action dock displays `Waiting for opponent: Melee Retaliation (Xs)…` with a countdown timer. Host cannot submit other actions.
    - **Verify (Guest Tab):** A reaction prompt card appears in the bottom dock with header `MELEE RETALIATION`, a live countdown badge (`15s`), descriptive text, Fatigue warning, and two buttons: `[Strike Back (Weapon attacks)]` and `[Decline (Avoid Fatigue)]`.
- [ ] **Defender Chooses "Strike Back":**
  - On Guest's tab, click `[Strike Back]`:
  - **Verify:**
    - Server rolls defender's attack dice.
    - Dice panel displays `Defender Retaliation: [Guest Unit] → [Host Charger]` showing hit and defense rolls.
    - Notice `Charger pushed back 1" — both units Fatigued` appears at the bottom of the dice panel.
    - Charger pushes back ≈ 1″ from defender.
    - Both models have the `FATIGUED` tag in their unit cards; neither model is `ENGAGED`.
- [ ] **Defender Chooses "Decline":**
  - In a new charge where defender survives, on the defending tab click `[Decline (Avoid Fatigue)]`:
  - **Verify:**
    - No retaliation dice are rolled.
    - Dice panel displays `Retaliation Declined: [Defender] held ground · 0 attacks · No fatigue applied`.
    - Notice `Charger pushed back 1" — Defender declined retaliation (no Fatigue)` appears.
    - Charger pushes back ≈ 1″ from defender.
    - Charger has the `FATIGUED` tag; defending unit DOES NOT have the `FATIGUED` tag.
- [ ] **15-Second Reaction Timeout Auto-Resolution:**
  - Initiate a charge against a surviving defender.
  - Do not click either button on the defending tab; let the 15-second timer expire.
  - **Verify:**
    - When the countdown reaches 0s, Host authoritatively auto-resolves with the default choice (`Strike Back`).
    - Retaliation dice resolve, push-back separation occurs, and the game proceeds normally without deadlocking.
- [ ] **Anti-Griefing Peer Disconnect Safety:**
  - Initiate a charge against a surviving defender so the reaction prompt is active.
  - Close or refresh the defender's browser tab while the prompt is active.
  - **Verify:**
    - Host detects the disconnect and immediately auto-resolves the reaction with the default option.
    - Host model pushes back 1", allowing the Host to end activation or continue the game.

---

### 7. Post-Separation Maneuvers (No Melee Lock)

- [ ] **Action Bar Validation (Standalone "Fight" Removed):**
  - Activate any ready fighter.
  - **Verify:** The action bar displays Move, Rush, Shoot, Charge, and Hold / End Activation. There is no standalone "Fight" button.
- [ ] **Subsequent Activation Freedom of Movement:**
  - After a charge has resolved and models separated (pushed back), pass turn to defender's owner.
  - Activate the defending fighter that was charged.
  - **Verify:** All standard maneuvers (Move, Rush, Shoot, Charge) are enabled; unit is not locked by "Engaged" rules.
- [ ] **Fatigue Melee Penalty:**
  - Activate a unit that has the `FATIGUED` tag and charge or strike with a melee weapon.
  - **Verify:** Confirmation summary and dice panel display `Fatigued (need 6)`. Only natural 6s count as hits.
