# Release 0.0.7 Playtest Fixes Validation Checklist

Run `npm run dev` to launch the dev servers, then test with two browser tabs connected over WebRTC (Host and Guest):

---

### 1. Host Reconnection via Lobby Code ("Room not found or full" fix)

- [ ] **Host Rejoin with Guest Waiting in Room:**
  - In Tab 1, click "Create Room" to generate a room code (e.g. `ABC-123`).
  - In Tab 2, enter `ABC-123` and click "Join Room". Verify both tabs connect.
  - Close Tab 1 (Host disconnects; 5-minute grace window activates on server while Guest remains in room).
  - Open a fresh browser tab at `http://localhost:5173`.
  - Enter the code `ABC-123` in the code input and click "Join Room".
  - **Verify:** The room does *not* error with `"Room not found or full"`.
  - **Verify:** The server recognizes the vacant host slot, Tab 1 joins as `host`, sends an offer to the waiting guest, and WebRTC reconnects.

---

### 2. Rupture & AP Combat Clarity

- [ ] **Rupture (+2 AP on 6) Visibility:**
  - Fire or strike with a weapon possessing the `rupture` trait (e.g. Warden Gun Crew cannon or Rust Bruiser heavy weapon).
  - When an unmodified `6` is rolled on a to-hit die:
    - **Verify:** The to-hit die renders with a small `RUP` badge and hover tooltip notes `Rupture (+2 AP)`.
    - **Verify:** The defense section header shows the adjusted AP requirement (e.g., `Defense (need D5+ · D7+ vs Rupture)`).
  - **Authoritative Per-Die Block Status:**
    - If a defender rolls `5 5` where Hit 1 had Rupture (AP 3, needing D7+) and Hit 2 had standard Pierce (AP 1, needing D5+):
    - **Verify:** Die 1 renders red (`def-fail`) and Die 2 renders green (`def-pass`).
    - **Verify:** Summary accurately reports `1 blocked · 1 unsaved wound`.

---

### 3. Unit Data Card Table Stats

- [ ] **Toughness, Move, and Charge Columns:**
  - Click or hover any friendly or enemy unit on the board.
  - Inspect the RTS Data Card table at the bottom left:
    - **Verify:** The table header reads: `Quality | Defense | Toughness | Move | Charge`.
    - **Verify:** Under **Move**, the stat displays `6"` cleanly (no fractional `6.0" / 6"` remaining movement).
    - **Verify:** Under **Charge**, the stat displays double speed: `12"` (not `6"`).
    - **Verify:** Under **Toughness**, multi-wound units display `3` (e.g. Warden Captain, Raid Boss) and standard units display `1` (or `2` for heavy troopers).
  - **Unit Roster List:**
    - **Verify:** The unit roster does not display redundant `· 6.0"` movement text.

---

### 4. Charge Range Fan Radius

- [ ] **Charge Range Fan Boundary:**
  - Select a ready unit with speed 6" and click the **Charge** button.
  - **Verify:** The visual range circle drawn around the unit has a radius of exactly **12.0"** (double speed), not 13.0".

---

### 5. Wound Effect Progression & Clean-Room Badges

- [ ] **Progressive WT Badges on Multi-Wound Models:**
  - Inflict 1 wound on a Toughness 3 model (e.g. Warden Captain).
  - **Verify:** Status badge reads `1/3 WT` (1 of 3 wound tokens before check). No roll is triggered.
  - Inflict a 2nd wound on the model.
  - **Verify:** Status badge reads `2/3 WT`. No roll is triggered.
- [ ] **Wound Effect Check Threshold (Knockout on $5 + X$):**
  - Inflict a 3rd wound on the Toughness 3 model.
  - **Verify:** Reaching 3 wounds triggers the Wound Effect roll.
  - **Verify:** Dice log displays:
    `Wound Effect (roll X + 3 wound tokens = Y — need 8+ to KO)`
  - **Verify:** On total $\ge 8$ ($5 + 3$), the unit is `KNOCKED OUT`. On total $< 8$, the unit survives and becomes `SHAKEN`.
  - **Verify:** No user-facing text references "trauma".

---

### 6. Reaction Timer Clock-Skew Synchronization

- [ ] **Countdown Timer Sync Across Physical Devices:**
  - Execute a Charge into melee contact with an enemy model that has an equipped melee weapon.
  - When the defender receives the Melee Retaliation prompt:
  - **Verify:** Both tabs start the countdown smoothly at `15s` and count down in tandem.
  - **Verify:** Any physical system clock difference between the two peers does not clip or advance the guest's visual timer.

---

### 7. Turn & Reaction Audio Notifications

- [ ] **Audio Initialization:**
  - Click anywhere in the browser tab to unlock Web Audio API.
- [ ] **Turn Chime:**
  - When opponent completes their unit activation and priority switches to you:
  - **Verify:** A distinct two-tone bell chime plays automatically.
- [ ] **Reaction Alert:**
  - When an enemy charges your unit and the Melee Retaliation prompt appears:
  - **Verify:** A distinct harmonic alert tone sounds to notify you of the reaction choice.
