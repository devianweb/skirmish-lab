# SkirmishLab Consolidated Playtest Verification Checklist

This consolidated checklist guides comprehensive manual validation of SkirmishLab gameplay systems across two browser sessions (Host and Guest).

---

## Prerequisites
- Run two separate browser windows (Chrome, Edge, Firefox, or Brave):
  - **Window A:** Host
  - **Window B:** Guest
- Local dev server (`npm run dev`) or deployed release URL.

---

## 1. Pre-Game Lobby & Deployment (Phase 10)

- [ ] **Lobby Army Selection:**
  - [ ] Host selects **Human Crusaders** (or custom force); Guest selects **Cult of the Machine**.
  - [ ] Both forces feature units with single weapons and units with multiple weapons (e.g. *Heavy Exo-Trooper* with Plasma Rifle & Frag Grenades; *Heavy Assault Marine* with Heavy Plasma Cannon & Bolt Pistol).
  - [ ] Check `Enable Deployment Phase` checkbox.
  - [ ] Host clicks **Create Match**; copy room code (e.g. `ABC-DEF`).
  - [ ] Guest enters code and clicks **Join Match**.
- [ ] **Deployment Zone Overlays:**
  - [ ] Both players enter the deployment phase.
  - [ ] South deployment zone (Host) is highlighted in blue ($z \le -12″$).
  - [ ] North deployment zone (Guest) is highlighted in red ($z \ge 12″$).
  - [ ] Camera initializes at each player's deployment corner (Host at South corner looking $+z$; Guest at North corner looking $-z$).
- [ ] **Alternating Deployment:**
  - [ ] Host deploys first unit inside blue zone; verify deployment preview ring and confirmation bar.
  - [ ] Guest deploys first unit inside red zone.
  - [ ] Attempt to deploy outside friendly zone; verify error toast rejects placement.
  - [ ] Once all units are deployed, match transitions to Round 1 Activation phase.

---

## 2. Objective Visuals & Inspection (Phase 7 Polish)

- [ ] **Objective Styling:**
  - [ ] Inspect scenario objectives (Alpha, Bravo, Charlie, Delta).
  - [ ] Ground base is a low-poly wooden crate (`crate.glb`).
  - [ ] Verify there is **no vertical light beam cylinder** obstructing the 3D battlefield view.
  - [ ] Outer 3.0″ control radius ground ring renders with softened opacity (`0.45`) and clean flat style.
- [ ] **Hover Inspection & Live Unit Presence:**
  - [ ] Select an active friendly unit.
  - [ ] Without deselecting or cancelling the unit, hover the mouse cursor over an objective crate.
  - [ ] Verify the bottom-left DataCard temporarily previews the objective details (Name, Controller, Status).
  - [ ] Verify the DataCard displays the live unit presence: `Unit Presence: Host: X · Guest: Y` within 3.0″ radius.
  - [ ] Move the mouse away from the objective; verify the DataCard returns immediately to the active unit.

---

## 3. Multi-Model Squad Spacing & Coherency (Phase 9)

- [ ] **Visual Base Separation:**
  - [ ] Deploy or select a multi-model squad (e.g. 3-model *Conscript Riflemen*).
  - [ ] Verify the 3 models render as distinct physical miniatures with a visible $\sim 0.4″$ gap between bases ($1.4″$ center-to-center spacing).
  - [ ] Verify models do not clip into each other or appear as an overlapping blob.
- [ ] **Squad Coherency Validation:**
  - [ ] Move the squad across open ground.
  - [ ] Verify all constituent models move in rigid formation maintaining $1.4″$ spacing.
  - [ ] Coherency check allows models up to $2.0″$ center-to-center ($1.0″$ edge-to-edge gap).
- [ ] **Squad Casualties:**
  - [ ] When a multi-model squad suffers unsaved wounds or hazard casualties, verify individual models are eliminated one-by-one.
  - [ ] When a model is eliminated, its 3D mesh is removed from the board; surviving models maintain their positions.

---

## 4. 3D Vertical Movement & Terrain Navigation (Phase 11 Overhaul)

- [ ] **Moving onto Elevated Platforms:**
  - [ ] Select an active ground unit near an elevated platform or stairs ($y = 2.5″$).
  - [ ] Click or hover on the elevated platform surface.
  - [ ] Verify the movement path preview renders in 3D ascending from ground to the platform surface.
  - [ ] Confirm move: Unit ascends cleanly onto the platform surface; unit mesh renders firmly on the platform deck at $y = 2.5″$.
- [ ] **Obstacle Clearance & Height-Aware Collision:**
  - [ ] On the elevated platform, move the unit along the platform deck.
  - [ ] If a crate or low barricade is on the ground ($y = 0$) directly beneath the platform, verify movement across the platform is **NOT** blocked by the ground obstacle.
  - [ ] Walkable platforms and roofs (`isWalkable: true`, `elevation: 2.5`) do not block units walking across their tops.
- [ ] **Elevation Tier Fighter Clearance:**
  - [ ] Position Unit A on the elevated platform ($y = 2.5″$) and Unit B on the ground ($y = 0″$) directly below or adjacent.
  - [ ] Move Unit A across the platform over Unit B; verify the movement is **NOT** blocked by Unit B because they are separated by $> 1.8″$ vertically.
- [ ] **Stairs & Ladders Traversal:**
  - [ ] Move a unit down from an elevated platform ($y = 2.5″$) using the stairs or ladder.
  - [ ] Verify the path routes smoothly down and does **NOT** trigger a high drop warning or falling damage.
- [ ] **High Ledge Drops & Falling Damage:**
  - [ ] Jump or drop a non-airborne unit off a ledge $> 3.0″$ tall onto open ground.
  - [ ] Verify confirmation bar displays `⚠️ HIGH DROP: Falling damage (AP 1) · ends activation immediately!`.
  - [ ] Confirm drop: Unit takes falling damage defense test (AP 1) and activation ends immediately upon landing.
- [ ] **Parapet Cover (+1 Defense):**
  - [ ] Position an elevated model on a platform within $1.0″$ of the edge facing an enemy on the ground.
  - [ ] Target the elevated model with a ground ranged attack; verify target receives $+1$ Defense (Parapet Cover).

---

## 5. Combat & Core Book Melee Rules Alignment (Phase 8 & Engine Fixes)

- [ ] **Multi-Weapon Split-Fire:**
  - [ ] Select a unit with multiple ranged weapons (e.g. *Heavy Exo-Trooper* with Plasma Rifle & Frag Grenades).
  - [ ] Click **Shoot**: targeting chips appear for each equipped weapon.
  - [ ] Assign Weapon 1 to Enemy A and Weapon 2 to Enemy B (within range and LoS).
  - [ ] Confirm attack: Verify both weapon attacks resolve simultaneously with authoritative server rolls.
- [ ] **Charge Base Contact:**
  - [ ] Select a unit and click **Charge** targeting an enemy within double speed.
  - [ ] Verify the movement path brings the charger directly into **base contact** ($1.0″$ center-to-center for $0.5″$ radius bases).
  - [ ] Confirm charge: Verify the charger mesh lands flush against the defender mesh without floating or drifting away from its registered position.
- [ ] **4.0″ Vertical Melee Reach:**
  - [ ] Position an enemy model on an elevated ledge $2.5″$ to $3.5″$ above ground level.
  - [ ] Charge or engage with a ground model directly below the ledge.
  - [ ] Verify melee engagement is permitted (core book: enemies within $2″$ horizontally and $4″$ vertically).
- [ ] **Melee Resolution & 1.0″ Pushback:**
  - [ ] Attacker strikes with all equipped melee weapons.
  - [ ] If defender survives, defender may strike back.
  - [ ] If both units survive: Charger is pushed back and separated by $1.0″$ ($2.0″$ center-to-center).
  - [ ] Verify charger models all push back together without desyncing.
- [ ] **Consolidation on Victory:**
  - [ ] If either unit is completely destroyed in melee, the victorious unit consolidates by moving up to $3.0″$.

---

## 6. Network Resilience & Disconnection Recovery (Phase 12)

- [ ] **Peer Disconnection Detection:**
  - [ ] In Window B (Guest), close the tab or disconnect network.
  - [ ] In Window A (Host), verify immediate visual notification:
    - [ ] Alert banner: `⚠️ Opponent disconnected — waiting for peer to reconnect... (Grace period: 5m)`.
    - [ ] Turn timer suspends; state is frozen without dropping the match.
- [ ] **Seamless Reconnection:**
  - [ ] Open a new tab in Window B, enter the lobby, and join using the existing room code.
  - [ ] Verify Guest re-enters the active match seamlessly.
  - [ ] Alert banner disappears; full game state and camera resume from the exact point of disconnection.

---

## 7. 3D Map Builder (Phase 13)
- [ ] For full verification of custom map editing, terrain palette placement, surface auto-stacking, and custom scenario multiplayer loading, follow [PHASE_13_CHECKLIST.md](./PHASE_13_CHECKLIST.md).
