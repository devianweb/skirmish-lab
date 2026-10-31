# Phases 8–12 Manual Validation Checklist

Run `npm run dev` to launch the dev servers, then test with two desktop browser tabs connected over WebRTC (Host and Guest):
- **Tab 1 (Host):** `http://localhost:5173/`
- **Tab 2 (Guest):** `http://localhost:5173/`

---

## Part 1: Phase 8 — Combat Enhancements: All-Weapon Firing & Split Fire

### 1.1 Multi-Weapon Selection & Targeting Chips
- [ ] **Equipped Weapons Display:**
  - In a new match, activate a Host or Guest unit equipped with multiple ranged weapons:
    - **Frontier Wardens (Host):** *Warden Scout Marksman* (equipped with **Rifle** `24"` and **Sidearm** `12"`), or *Warden Breacher* (equipped with **Scattergun** `12"` and **Sidearm** `12"`).
    - **Rust Raiders (Guest):** *Rust Infiltrator* (equipped with **Rifle** `24"` and **Sidearm** `12"`), or *Rust Sapper* (equipped with **Scattergun** `12"` and **Sidearm** `12"`).
  - Click the **Shoot** action button in the action menu.
  - **Verify:** The bottom targeting panel renders individual weapon chips for every equipped ranged weapon.
  - **Verify:** Each chip displays the weapon name, range, Quality/To-Hit requirement, and attack dice count.

### 1.2 Split Fire Allocation (Up to Two Distinct Targets)
- [ ] **Assigning Multiple Enemy Targets:**
  - Select Target A (e.g., Scavenger Raider 1) by clicking on its 3D model or targeting token.
  - Assign Weapon 1 (Rifle) to Target A.
  - Select Target B (e.g., Scavenger Raider 2) and assign Weapon 2 (Sidearm) to Target B.
  - **Verify:** Weapon chips clearly display their designated target names or icons.
  - **Verify:** The system prevents selecting a 3rd distinct target (split fire is restricted to at most two enemy targets per tabletop skirmish rules).
  - Attempting to select a 3rd target either disables additional target clicks or shows a notification.

### 1.3 Out-of-Range & Line-of-Sight Filtering
- [ ] **Individual Weapon Range Checks:**
  - Move to a position where Target A is 18″ away (within Rifle 24″ range, but outside Sidearm 12″ range).
  - **Verify:** The Sidearm chip is disabled or highlighted in red as "Out of Range" for Target A, while the Rifle chip remains enabled.
- [ ] **Partial Line-of-Sight Obscuration:**
  - Position an enemy target behind cover or terrain.
  - **Verify:** Line-of-sight raycast marker shows cover modifiers (+1 Defense) applied specifically to obstructed targets.

### 1.4 Unified Server Roll Request & Dice Panel Grouping
- [ ] **Single Batch Execution:**
  - Click **Fire Weapons** to submit the multi-weapon action.
  - **Verify:** Only one unified network request is sent to the signaling server for dice.
  - **Verify:** The dice panel groups rolls by target and weapon:
    - Target A section shows attack rolls, hit successes, and Target A's defense saves.
    - Target B section shows attack rolls, hit successes, and Target B's defense saves.
  - **Verify:** 3D wound tokens appear over wounded targets, and damage is applied accurately without desync between Host and Guest.

---

## Part 2: Phase 9 — Multi-Model Squads & Coherency Engine
- The models seem to be three meshes crammed into one. It might as well be one unit. I think this is entirely broken.

### 2.1 Multi-Model Squad Rendering & Selection
- [ ] **Squad Group Mesh & Base Rings:**
  - Observe a multi-model squad on the battlefield (e.g., Rust Raider Scavenger Pack with 3 models).
  - Click on any model within the squad.
  - **Verify:** The entire squad is selected; all constituent models highlight with squad base selection rings.
  - **Verify:** The bottom-left data card shows the squad name, total model count (e.g., `3/3 Models Alive`), Quality, Defense, and squad loadout.

### 2.2 Sub-Model Movement & Formation Controls
- [ ] **Individual Sub-Model Moving:**
  - With the squad selected, click **Move** or **Rush**.
  - Click on an individual model in the squad and drag/click to place its destination.
  - **Verify:** The individual model's movement path and remaining movement radius appear.
  - Move the remaining models in the squad one by one.
  - **Verify:** Each model cannot exceed its individual movement limit (e.g., 6″ for Advance, 12″ for Rush).

### 2.3 Squad Coherency Validation (1″ Model / 6″ Squad)
- [ ] **Coherency Range Indicators:**
  - While positioning squad models, observe the visual coherency link lines between models.
  - **Verify:** While all models are within 1″ horizontally of at least one other model (or within the 6″ maximum formation boundary), the coherency indicator glows green.
  - Move one model beyond the allowed coherency distance (> 2″ from the nearest squad member).
  - **Verify:** The coherency link turns warning red / orange.
  - **Verify:** The action confirmation button is disabled with an explanatory tooltip: `"Unit broken: Models must remain in coherency"`.
  - Reposition the rogue model within 1″ of its squadmate; verify the confirmation button re-enables.

### 2.4 Melee Consolidation Step
- [ ] **3″ Melee Engagement Consolidation:**
  - Declare a **Charge** with a multi-model squad against an enemy unit.
  - Lead model makes contact with the enemy target.
  - **Verify:** Remaining squad models execute the 3″ consolidation movement to close into base-to-base contact or within 2″ engagement distance.
  - **Verify:** Melee retaliation prompt triggers if the defending unit survives.

### 2.5 Multi-Model Casualty Cascades
- [ ] **Non-Overkill Damage Allocation:**
  - Shoot at a 3-model squad where each model has 1 Toughness (Wound).
  - Score 2 unsaved wounds.
  - **Verify:** Exactly 2 models are eliminated; 1 model remains alive.
  - **Verify:** The eliminated models are removed from the 3D scene smoothly, and the remaining model remains active.
  - Shoot with a high-damage weapon (e.g., Damage 3) against a 1-wound model squad.
  - **Verify:** Excess damage from a single attack does not spill over to kill multiple 1-wound models unless the weapon has special area/splash rules.

---

## Part 3: Phase 10 — Interactive Deployment & Pre-Canned Starter Armies

### 3.1 Pre-Canned Army Selection in Lobby
- [ ] **Starter Force Pickers:**
  - In the Lobby screen, observe the **Match Forces (Starter Armies)** configuration section.
  - **Verify:** Host Force defaults to `Frontier Wardens (300 pts) — Outpost Defenders`.
  - **Verify:** Guest Force defaults to `Rust Raiders (300 pts) — Scavenger Incursion`.
  - Change the dropdown selections (e.g., switch Host to Rust Raiders and Guest to Frontier Wardens).
  - **Verify:** Dropdown values persist into the match initialization.

### 3.2 Deployment Phase Toggle
- [ ] **Interactive Pre-Match Deployment Checkbox:**
  - Verify the checkbox `Interactive Pre-Match Deployment (12" Zones)` is checked by default.
  - When unchecked, launching a match immediately spawns forces at pre-canned starting positions.
  - When checked, launching a match transitions both players into the interactive deployment phase.

### 3.3 12″ Deployment Zone Boundaries
- [ ] **Visual Zone Highlights:**
  - Launch match with deployment enabled.
  - **Verify:** The battlefield renders two distinct semi-transparent 12″ deployment zone overlays:
    - **Host (South):** $z \le -12″$ highlighted in blue.
    - **Guest (North):** $z \ge 12″$ highlighted in red.
    - Neutral No-Man's-Land: Central 20″ zone between $z = -12″$ and $z = +12″$ is clear of deployment zones.

### 3.4 Alternating Unit Placement Loop
- [ ] **Deployment Turn Sequence:**
  - Observe the top HUD banner displaying `Deployment Phase: Host's Turn to Place Unit`.
  - Host selects a unit from their un-deployed unit tray.
  - Click a valid ground location inside the South deployment zone ($z \le -12″$).
  - **Verify:** Unit model renders at the selected coordinate.
  - **Verify:** Turn alternates to Guest: HUD banner updates to `Deployment Phase: Guest's Turn to Place Unit`.
  - Guest selects a unit and attempts to click inside the Host's South zone ($z \le -12″$).
  - **Verify:** Placement is rejected; Guest can only place units in the North zone ($z \ge 12″$).
  - Alternate until all units from both armies are deployed.
  - **Verify:** Game smoothly transitions to `Round 1: Activation Phase` with priority roll.

---

## Part 4: Phase 11 — Environmental Terrain Dynamics & Verticality

### 4.1 3D Elevation Platforms & Catwalks
- [ ] **Multi-Level Elevation Picking:**
  - Select an active unit and click **Move** or **Rush**.
  - Hover the cursor over an elevated catwalk or platform (e.g., $y = 3.0″$ or $y = 6.0″$).
  - **Verify:** The cursor raycaster accurately snaps to the top surface of the platform ($y > 0$), not the ground underneath.
  - **Verify:** The movement path line displays true 3D elevation rising from the ground onto the platform.

### 4.2 Ladder & Stair Traversal
- [ ] **Climbing Vertical Access Points:**
  - Move a unit toward a designated ladder or stair piece.
  - Click on the top landing of the ladder.
  - **Verify:** The unit ascends the ladder smoothly; vertical distance climbed is deducted from the unit's remaining movement budget.
  - **Verify:** Units cannot climb vertical walls that lack a ladder or stairs unless they possess the `Climber` or `Flying` trait.

### 4.3 High Drops & Falling Damage
- [ ] **Dropping Down from Heights:**
  - Position a unit on a platform $y = 4.0″$ above ground.
  - Move the unit to step off the ledge onto the ground below.
  - **Verify:** Vertical drop $> 3.0″$ prompts a falling test notification.
  - **Verify:** A server d6 roll is executed: on a roll of 1, the unit suffers a falling wound / stun check; on 2+, the unit lands safely.
  - **Verify:** Safe drops ($\le 3.0″$) do not trigger falling damage tests.

### 4.4 Gap Jumping Between Platforms
- [ ] **Horizontal Leaps:**
  - Position a unit near the edge of an elevated platform facing an adjacent platform separated by a 2″ gap.
  - Click on the adjacent platform.
  - **Verify:** The unit leaps across the horizontal gap if the distance is within remaining movement, rendering an arc trajectory marker.

### 4.5 3D Line-of-Sight & Parapet Cover
- [ ] **Partial Cover Behind Parapets & Barricades:**
  - Position a target unit on an elevated platform behind a low chest-height parapet/railing.
  - Select an attacking unit on the ground below and declare a **Shoot** action.
  - Inspect the line-of-sight debug ray (`LOS Debug`).
  - **Verify:** The raycaster detects the parapet intersecting the lower half of the target model.
  - **Verify:** The target receives the Cover bonus (+1 Defense save modifier) in the dice resolution panel.

---

## Part 5: Phase 12 — Reconnection & Network Resilience

### 5.1 DataChannel Heartbeat & Disconnect Detection
- [ ] **Simulated Peer Disconnection:**
  - With Host and Guest in an active match, disconnect the network or close the Guest tab.
  - **Verify:** After 6 seconds (2 consecutive missed 3-second heartbeat pings), the Host detects peer silence.
  - **Verify:** A prominent top banner appears on the Host screen:
    `"⚠️ Opponent disconnected — waiting for peer to reconnect... (Grace period: 5m)"`
  - **Verify:** Network status indicator in the top header shifts to disconnected.

### 5.2 Timer Suspension During Disconnection
- [ ] **Freezing Reaction & Turn Timers:**
  - Trigger a charge reaction prompt (Strike Back / Decline with a 15-second countdown timer).
  - Disconnect the defending player's tab while the countdown is at 10 seconds.
  - **Verify:** The 15-second countdown timer immediately pauses and freezes (it does not auto-resolve or time out while disconnected).
  - Reconnect the peer tab.
  - **Verify:** The countdown timer resumes exactly from where it was paused (e.g., 10 seconds remaining).

### 5.3 Active Session & GameState Snapshot Persistence
- [ ] **LocalStorage Snapshot Verification:**
  - In browser Developer Tools (F12) -> Application -> Local Storage:
  - **Verify:** Key `skirmish_lab_active_session` is present and contains:
    `{ roomCode, role, playerId, playerName, armyId, timestamp }`.
  - **Verify:** Key `skirmish_lab_snapshot_XXX-XXX` is present and contains the complete serialized `GameState` object.
  - Perform any in-game action (move, shoot, end activation).
  - **Verify:** The snapshot JSON updates synchronously with the new confirmed game state.

### 5.4 Lobby Resume Match Banner & URL Deep-Linking
- [ ] **Lobby Resume Match Notification:**
  - While a match is in progress, reload the browser tab (F5) to return to the Lobby.
  - **Verify:** The URL bar displays `?room=XXX-XXX`.
  - **Verify:** The Lobby renders a prominent alert banner:
    - `"⚠️ Active Game Detected (Room XXX-XXX)"`
    - `"You have an ongoing match as HOST / GUEST. Reconnect within the 5-minute grace window to resume."`
    - Action buttons: `[Resume Match]` and `[Abandon Game]`.
- [ ] **Resume Match Flow:**
  - Click `[Resume Match]`.
  - **Verify:** The client immediately reconnects to signaling, reoccupies the vacant role slot, re-establishes WebRTC P2P DataChannel, and restores the 3D battlefield and HUD to the exact state before reload.
- [ ] **Abandon Game Flow:**
  - In a new reload, click `[Abandon Game]`.
  - **Verify:** `skirmish_lab_active_session` and snapshot keys are deleted from LocalStorage.
  - **Verify:** The banner disappears, the URL search parameter `?room=` is cleared, and the lobby returns to standard Create/Join inputs.

### 5.5 Peer Fallback State Recovery (Host Storage Wiped)
- [ ] **Host Reconnects with Cleared Cache:**
  - In an active match, Host clears browser LocalStorage completely (or opens an incognito window with the same room code via URL `?room=XXX-XXX`).
  - Host joins the room.
  - **Verify:** Signaling server assigns role `'host'`.
  - **Verify:** Because Host local storage is empty, Host sends a `request-state-sync` message over WebRTC.
  - **Verify:** Guest receives the request and transmits its verified local snapshot via `state-sync`.
  - **Verify:** Host adopts the state, restores the 3D scene and HUD, saves the snapshot, and resumes authoritative match hosting.
  - Execute a subsequent activation.
  - **Verify:** Both Host and Guest process the action without desync.
