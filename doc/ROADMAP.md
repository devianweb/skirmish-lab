# Roadmap

## Overview
Phased development plan for SkirmishLab, an unofficial OPR-compatible tabletop skirmish engine, with verifiable acceptance criteria. Focus on incremental, testable milestones.

## Phase 1: Signaling Server
**Goal:** Build minimal WebSocket signaling server with room management

### Tasks
- [x] Implement RoomManager with XXX-XXX code generation
- [x] Implement SignalingServer for WebSocket connections
- [x] Room creation/joining logic
- [x] SDP/ICE message relay
- [x] DiceRoller with server-side RNG
- [x] Room expiration and cleanup
- [x] Basic error handling
- [x] Add unit and integration tests

### Acceptance Criteria
- [x] Server can generate unique XXX-XXX room codes
- [x] Host can create room, guest can join with code
- [x] SDP offers/answers relayed correctly
- [x] ICE candidates relayed correctly
- [x] Dice rolls generated server-side and broadcast to both peers simultaneously
- [x] Rooms expire after inactivity
- [x] Server handles disconnections gracefully
- [x] All tests passing (22/22)

## Phase 2: WebRTC P2P Connection
**Goal:** Establish peer-to-peer connection between clients

### Tasks
- [x] SignalingClient (WebSocket to signaling server)
- [x] WebRTCClient (RTCPeerConnection, data channel)
- [x] Connection flow implementation
- [x] Message serialization/deserialization
- [x] Heartbeat/ping-pong system
- [x] Connection state management
- [x] Basic UI for lobby (create/join room)

### Acceptance Criteria
- [x] Host can create room and see code
- [x] Guest can enter code and join
- [x] WebRTC connection establishes successfully
- [x] Data channel opens
- [x] Heartbeats work, disconnection detected
- [x] Signaling server no longer needed after connection
- [x] Connection works on desktop browsers

## Phase 3: Core Game State & Host Authority
**Goal:** Implement game state model and host-authoritative architecture

### Tasks
- [x] Implement GameState types (from DATA_MODEL.md)
- [x] GameEngine with validation framework (basic)
- [x] Action log implementation
- [x] State transition logic (basic)
- [x] Host: validate actions, apply to state, broadcast updates
- [x] Guest: send action requests, apply state updates
- [x] Snapshot system (guest caches state)
- [x] Action serialization

### Acceptance Criteria
- [x] Game state is fully serializable
- [x] No Three.js objects in game state
- [x] Host validates all actions
- [x] Guest cannot apply actions directly
- [x] State updates flow correctly host → guest
- [x] Action log tracks all confirmed actions
- [x] Guest caches snapshots after state updates
- [x] State round-trips through JSON correctly

## Phase 3.5: CI/CD & Deployment
**Goal:** Enable automated testing and deployment for demos

### Tasks
- [x] Create GitHub Actions workflow for PR checks (build + test on all workspaces) - no deploy
- [x] Create GitHub Actions workflow for `release` branch (build + test + deploy client to Pages & server to Azure App Service)
- [x] Configure signaling server with HTTP health probe (`GET /healthz`) for Azure App Service
- [x] Package self-contained server bundle in deploy workflow for Azure App Service
- [x] Deploy signaling server to Azure App Service (Linux, Node 24 LTS, Free F1 tier) tracking the `release` branch
- [x] Configure GitHub Pages for client deployment
- [x] Add environment variable configuration for client to use deployed server URL (`VITE_SIGNALING_URL`)
- [x] Set up WSS endpoint for production (`wss://skirmish-lab-signaling.azurewebsites.net`)
- [x] Configure Vite `base` for GitHub Pages
- [x] Add deployment status badges to README
- [x] Document deployment process in `doc/DEPLOYMENT.md`

### Acceptance Criteria
- [x] PRs to main/master run build and tests without deploying
- [x] Merged PRs into `release` trigger build, test, and deploy to GitHub Pages (direct pushes do not deploy)
- [x] Signaling server auto-deploys from `release` branch to Azure App Service with WSS support
- [x] Client deploys to GitHub Pages successfully
- [x] Deployed client can connect to deployed signaling server over WSS
- [x] Can demo lobby/connection flow from deployed GitHub Pages URL
- [x] CI workflows pass on a clean checkout
- [x] Release flow is intentional (PR `master` → `release`, merged when ready)

## Phase 4: Three.js Rendering Foundation
**Goal:** Set up 3D rendering decoupled from game state

### Tasks
- [x] SceneManager setup
- [x] CameraController (desktop controls)
- [x] BoardRenderer
- [x] UnitRenderer (syncs from game state)
- [x] ModelLoader for low-poly models
- [x] Lighting setup
- [x] Basic board/terrain rendering
- [x] State-driven rendering (game state → renderer)

> **Implementation notes:** `GameView` is the state-driven entry point — it diffs a
> board/terrain signature (rebuilding the board only on change) and syncs unit
> meshes every call. Renderer components are injectable for tests (no WebGL
> needed). Until real GLTF assets exist, `ModelLoader` resolves unit types to
> procedural low-poly fighters; the GLTF path is tested with a stub loader.
> `GameManager.onStateUpdate` is the app-level hook that feeds confirmed state
> to `GameView` (Phase 5 wires the full game-start flow).

### Acceptance Criteria
- [x] Three.js scene renders
- [x] Camera can be controlled
- [x] Units rendered from game state data
- [x] Renderer reads from game state only
- [x] Game state never modified by renderer (covered by renderer tests)
- [x] Low-poly models load correctly (procedural low-poly path; GLTF assets land with the .STL pipeline)
- [x] Performance acceptable for desktop (verified manually in browser at `npm run dev` — steady 60fps, no memory growth)

## Phase 5: Basic Gameplay & UI (Alternating Activations)
**Goal:** Implement alternating-activation gameplay flow

### Tasks
- [x] Lobby UI
- [x] Game HUD (round, current activator, unit info)
- [x] Action selection UI
- [x] Unit selection
- [x] Action confirmation (no real-time dragging)
- [x] Alternating activation management (activate one unit, pass initiative)
- [x] Round management (all units activated → cleanup → new round)
- [x] Dice result display
- [x] Basic action types (activate, move, shoot, charge, fight, hold, end activation)
- [x] Replace procedural placeholders with curated Kenney prototype-kit GLBs (CC0, staged in `assets-src/`): figurines for unit roles, walls/crates/columns for terrain, `indicator-*`/`target-*`/`number-*` models for movement/attack/dice UI markers

> **Implementation notes:** The shared engine (`shared/src/engine/`) owns
> activation/round management and Q/D combat resolution as pure functions;
> the host `GameManager` validates, requests server dice via
> `SignalingDiceProvider`, applies deterministically, and broadcasts —
> both peers' HUDs render everything (including dice) from confirmed state
> only. Every action requires explicit confirmation before submission; the
> host processes one action at a time. Hold is a one-step activation
> (spends the activation clearing stun). Engaged units can't move, shoot,
> or charge — they fight. Charge ends at engagement distance 1 and consumes
> all movement. Rounds end automatically when all units activated; the
> starting player alternates. v1 win condition: elimination. Signaling
> keep-alive pings keep rooms alive for mid-game dice requests. Curated
> Kenney GLBs live in `client/public/models/` with mappings in the asset
> manifest; unregistered types fall back to procedural placeholders.

### Acceptance Criteria
- [x] Players can connect and start game (automated: GameManager host↔guest integration over a simulated channel)
- [x] Players alternate activating units (automated: engine activation tests)
- [x] When one player runs out of units, other activates remaining (automated: engine activation tests)
- [x] Round ends when all units activated; new round starts with alternating first player (automated: engine round-management tests)
- [x] Actions require confirmation (automated: GameHUD tests)
- [x] Only confirmed actions sent to host (automated: GameHUD + GameManager tests)
- [x] Dice results displayed to both players (automated: state-driven dice panel renders for either player; server broadcast covered by signaling integration tests)
- [x] UI reflects current game state (automated: GameHUD renders purely from confirmed state)
- [x] Stunned/routed units cannot activate (automated: engine validation tests — routed rejected; stunned may activate, spending the activation clearing the stun)

### Manual Test Checklist (browser, `npm run dev` — two windows)
- [x] Host creates room, guest joins, both reach the game without errors
- [x] Starting armies deploy (figurines, terrain) and HUD shows round 1
- [x] Host activates a unit, moves it (distance summary + confirm), turn passes
- [x] Guest activates, shoots the host unit in range — both windows show the same dice panel and wound token
- [x] Charge + fight across an engagement (both marked ENGAGED, fight-only)
- [x] Hold on a stunned unit clears the stun
- [x] Exhausting one side's units lets the other activate their remaining units
- [x] Round increments and the other player starts round 2
- [x] Illegal submissions surface a rejection toast (e.g., out-of-range shot)
- [x] Final unit destroyed → game-over banner on both windows
- [x] GLB models render at sensible sizes (Kenney figurines/terrain/markers — visual scale check; adjust `assetManifest` scales if needed)

## Phase 6: OPR Skirmish Rules Engine
**Goal:** Implement OPR-style skirmish mechanics

> **Specification:** See **[RULES_SPECIFICATION.md](./RULES_SPECIFICATION.md)** for the complete mathematical definition, action maneuvers, casualty/trauma tables, and the 29-trait special rules engine matrix.
>
> **Status:** The OPR pivot's rebrand (R1), docs re-spec (R2), and schema refactor (R3) are
> complete — the first two tasks below landed with the schema refactor (state schema
> v2.0.0, see `doc/DATA_MODEL.md`). The remaining pivot-plan work (army data schema +
> two hardcoded armies, and the Q/D rules engine) is folded into this phase; it is
> tracked here only, in ROADMAP order (after Phases 3.5–5).
> Army data must use original/generic faction names until any OPR endorsement
> discussion clarifies acceptable data use.

### Tasks
- [x] Refactor stat schema to OPR standard (Quality Q, Defense D, speed, wounds)
- [x] Alternating activation turn state (replaces TC phase structure)
- [x] To-hit rolls vs Quality (d6 target number)
- [x] Defense rolls to block hits (cover modifiers)
- [x] Wound/stun application and tracking
- [x] Morale checks at round end
- [x] Line of sight and targeting
- [x] Weapon profiles (Range/Attacks/Special Rules)
- [x] Special rules framework (modifiers + hooks, data-driven)
- [x] Army data schema + two hardcoded armies (original faction names)
- [x] Simple elimination mission (v1 win condition)
- [x] **PR 6A.1: Playtest Fixes & Combat Clarity** (completed):
  - [x] Refined cover calculation: ignores adjacent shooter cover (shooting out of cover never grants cover to open targets), partial LoS flank rays for sight-blocking terrain, eliminates touching-wall false positives.
  - [x] Explicit combat modifier breakdowns in confirmation bar and dice panel (Base Q/D, Marksman, Camouflaged, Pierce, Cover, etc.).
  - [x] Explicit Wound Effects Table math display (`roll X + Y tokens = Z — need 6+ to KO`) and unsaved wounds vs wound tokens summary line.
  - [x] Unit facing rotation on move, shoot, and charge.
  - [x] Floating 3D "0" wound outcome marker for zero-damage attack feedback.
  - [x] Trait tooltips on hover (`describeTrait`) across unit lists, weapons, and data cards.
  - [x] Terminology cleanup: "Shaken" replaces "SUPPRESSED (SHAKEN)".
  - [x] Real team colors in UI: Host is Blue, Guest is Red for both players.
  - [x] Disconnect / reconnect top warning banners for WebRTC and Signaling status.
  - [x] Adjusted asset scales (crates lower to waist height, figurines larger to avoid teeny runners).
  - [x] F9 debugger unit wireframes showing LoS blocking cylinder bounds (`LOS_UNIT_RADIUS = 0.4`).
  - [x] F9 shooting targeting debug visualization: 3D ray from attacker to target/mouse cursor, terrain intersection entry/exit boundary rings, flank rays (±0.3") for partial cover, full-board terrain wireframes (cyan solid LoS blocker, amber low cover, gold active cover), and HUD shooting ray analysis card.
- [x] **PR 6B: Navigation & Full Maneuvers** (completed):
  - [x] Shortest-path auto-pathfinding around obstacles (visibility-graph A* around terrain and fighter bounds for move and charge).
  - [x] Full Tabletop Maneuver Actions: Hold (clear stun or hold), Advance (move up to speed + shoot), Rush (move up to 2× speed, no shoot), Charge (move up to 2× speed into melee contact and resolve melee strike).
  - [x] Melee consolidation: fold Fight directly into Charge (charge resolves melee strike automatically).
  - [x] Melee engagement visual contact highlights (highlight opposing model in bright contact ring/indicator when in 1" engagement range).
  - [x] **Low Cover Proximity Check (The 1" Intervening Rule):** Defending targets must be within 1.0" of low cover (crates, barricades) along the line of fire to receive the +1 Defense bonus, aligning with physical tabletop True-Line-of-Sight and preventing distant mid-field crates from granting cover to open targets downrange.
  - [x] **Keep-away zones overlay (UI):** red 1" no-go discs round other units' models while a move, rush, charge, push or pile-in is planned (charge target green, other tiers faint) so detours and refused spots are explainable.
  - [x] **Terrain Apertures (Windows & Doorways):**
    - [x] **Doorways (`wall-doorway`):** Central 1.0" aperture is open to both model movement (passable) and unobstructed Line of Sight.
    - [x] **Windows (`wall-window`):** Central 1.0" aperture allows Line of Sight when at least one model (shooter or target) is within 1.0" of the window ("manning the firing port"); models within 1.0" receiving fire through the window gain +1 Defense (Cover), while movement through the window remains blocked.
- [x] **PR 6C: Tabletop Melee Push-Back Separation & Defender Retaliation** (completed):
  - [x] **Defender Retaliation Strike:** If the defender survives the initial charge strike, it immediately strikes back with equipped melee weapons. Shaken defenders strike back counting as Fatigued (hits on natural 6s only per Section 6.2).
  - [x] **Automatic 1" Separation Push-Back:** Tabletop skirmish models do not remain locked in base-to-base melee. When both units survive, the charging unit automatically pushes back to create a ≥ 1.0" gap (2.0" center distance, using angular fan-out collision avoidance against obstacles).
  - [x] **No Locked Melee:** Both surviving units are marked `fatigued` and clear `engaged` status. In subsequent activations, units are free to execute any maneuver (Hold, Move, Rush, Shoot, or Charge again).
  - [x] **HUD Melee Streamlining:** Removed obsolete standalone "Fight" button from the action bar; all melee combat initiates via Charge.
  - [x] **Retaliation & Separation Dice Panel Feedback:** Added defender retaliation strike rolls and green 1" push-back separation notice to the authoritative dice panel.

### Acceptance Criteria
- [x] Movement validated correctly by host
- [x] To-hit resolved as d6 vs Quality
- [x] Defense rolls block hits (cover applies accurately)
- [x] Wounds/stun tracked and applied correctly
- [x] Morale checks work at round end
- [x] Alternating activation enforced by host validation
- [x] Dice rolls go through server
- [x] All rolls visible to both players
- [x] Rules enforced by host validation
- [x] Two armies playable as data packs
- [x] Ruleset data is swappable (engine reads stats from data, not code)

## Phase 6.5: Interactive Reactions & Interruption Framework
**Goal:** Enable out-of-turn player prompts, reactions, and decision-making during action resolution without locking up multiplayer flow or opening griefing vectors.

> **Recommended AI Model:** **4.0** *(Asynchronous P2P state machine, timing synchronization, and host validation)*
>
> **Architecture:** Transitions the game engine from a purely sequential "single-actor" turn loop to an extensible reaction state machine. `turnState.pendingReaction` serializes cleanly into `GameState`, synchronizing across WebRTC data channels with host-authoritative validation, timeout countdown safety, and reactive HUD prompts.

### Tasks
- [x] **State Schema & Protocol (`shared`):**
  - [x] Add `ReactionOption` and `PendingReaction` interfaces to `gameTypes.ts`.
  - [x] Add `pendingReaction?: PendingReaction | null` to `TurnState`.
  - [x] Define `'respond-reaction'` action type in `gameTypes.ts` with actor ownership validation.
  - [x] Host-authoritative timer & anti-griefing timeout fallback (auto-resolves default option after 15s or on player disconnect).
- [x] **Melee Retaliation Choice:**
  - [x] Update `case 'charge'` to defer retaliation strike and push-back into a `pendingReaction` when the defender survives with equipped melee weapons.
  - [x] Add `case 'respond-reaction'` resolver:
    - `strike-back`: Requests server retaliation dice, applies wounds, inflicts Fatigue, and executes 1" push-back separation.
    - `decline`: Skips retaliation dice, avoids Fatigue (preserving defender's full Quality for its own upcoming activation), and executes 1" push-back separation.
- [x] **Interactive Reaction UI (`client`):**
  - [x] Dedicated reaction prompt card in the reacting player's bottom HUD dock with title, description, Fatigue warning, action buttons, and live 15s visual countdown badge.
  - [x] Non-reacting active player waiting state ("Waiting for opponent to choose...").
  - [x] Visual notification when a reaction prompt appears for the defending player.
- [x] **Future Reaction Capability Hooks:**
  - [x] Design framework to support future out-of-turn abilities: Overwatch/reactive fire, defensive stratagems (Smokescreen/Take Cover), Brace, and multi-model casualty allocation.

### Acceptance Criteria
- [x] Charging an enemy with melee weapons creates a `pendingReaction` if the defender survives.
- [x] Defending player receives an interactive prompt with Strike Back and Decline buttons.
- [x] Choosing Decline skips attacks and avoids Fatigue (defender remains un-fatigued).
- [x] Choosing Strike Back rolls retaliation attacks and applies Fatigue to both models.
- [x] Charger automatically pushes back 1" in both branches.
- [x] 15-second timeout automatically chooses the default option if the player is idle or disconnects.
- [x] Non-defending player cannot submit a reaction for their opponent.
- [x] Full P2P test suite passes with simulated network delays and reaction choices.

## Phase 7: Objectives & 4-Round Mission Engine
**Goal:** Implement the standard tabletop skirmish win condition, match clock, and objective control mechanics (replacing pure elimination deathmatch).

> **Recommended AI Model:** **3.8** *(Additive game rules, 2D distance checks, and 3D visual beacon)*
>
> **Specification:** See **[RULES_SPECIFICATION.md Section 2.2](./RULES_SPECIFICATION.md#22-objective-placement--control)**.

### Tasks
- [x] **Objective Markers Data & State (`shared`):**
  - [x] Add `Objective` schema to `GameState` (ID, name, position, controllingPlayerId, isContested).
  - [x] Scenario generator places 3 to 5 objective markers across the battlefield (> 9" apart, outside deployment zones).
- [x] **Round-End Control Evaluation:**
  - [x] Evaluate 3" horizontal radius around each objective at round end.
  - [x] Marker controlled if friendly model is within 3" and 0 enemy models are within 3".
  - [x] Contested if opposing models are simultaneously within 3" (reverts to neutral).
  - [x] Shaken units cannot seize or contest objectives.
  - [x] Persistent control: markers remain controlled even if a unit moves away, until an enemy seizes or contests them.
- [x] **Match Duration Clock & Scoring:**
  - [x] Match concludes after exactly **4 rounds**.
  - [x] The player controlling the most objectives at the end of Round 4 wins.
  - [x] Army elimination remains an immediate fallback win condition.
- [x] **Objective Visuals & UI (`client`):**
  - [x] 3D objective beacon rendering in Three.js (glowing radius ring, vertical light beam, team color flag/marker when captured).
  - [x] HUD round/score header tracking objective counts for Host and Guest.
  - [x] End-of-game victory screen showing final objective score breakdown.

### Acceptance Criteria
- [x] 3 to 5 objectives render on the board with visible 3" control boundaries.
- [x] Non-shaken units within 3" capture objectives at the end of each round.
- [x] Contested objectives revert to neutral when opposing units are within 3".
- [x] Match terminates after 4 rounds and crowns the winner based on objective control.
- [x] Complete elimination still results in an immediate victory.

## Phase 8: Combat Enhancements: All-Weapon Firing & Split Fire
**Goal:** Fire all equipped ranged weapons during a shoot action matching physical tabletop skirmish rules.

> **Atomic Sub-Phases:**
> - **Sub-phase 8A (Engine & Data Schema — `shared/`):** Multi-weapon firing loop, split fire target allocation (up to 2 targets), aggregated server roll request, and pure unit tests.
> - **Sub-phase 8B (HUD & Controls — `client/src/ui`):** Targeting chips per weapon, per-target breakdown in dice panel, and firing audio.

### Sub-phase 8A: Shared Engine & All-Weapon Batching
- [x] Support `{ attackerId, allocations: Array<{ weaponId: string, targetId: string }> }` in shoot action payload (backwards-compatible with single weapon/target).
- [x] Validate range, line-of-sight, and weapon eligibility across all assigned weapons.
- [x] Enforce split fire constraint: weapons can be divided between at most **two distinct enemy targets**.
- [x] Aggregate attack dice for all firing weapons into a single unified server roll request.
- [x] Pure engine unit tests in `shared/tests/engine/actions.test.ts`.

### Sub-phase 8B: HUD Multi-Target Chips & Dice Log
- [x] Weapon allocation chips in targeting HUD allowing players to assign each equipped ranged weapon to eligible targets.
- [x] Confirmation bar showing combined attack summary.
- [x] Authoritative dice panel grouping rolls, defense saves, and wound effects per weapon and target.

### Acceptance Criteria
- [x] A unit with multiple ranged weapons fires all of them during a single shoot action.
- [x] Units can divide weapons between up to two distinct targets.
- [x] Server requests and resolves defense rolls for each target accurately in one unified round-trip.

## Phase 9: Multi-Model Squads & Coherency Engine
**Goal:** Support multi-model squads (e.g. 3-model infantry squads) alongside single-model specialists and leaders.

> **Atomic Sub-Phases:**
> - **Sub-phase 9A (Spatial Schema & Coherency Engine — `shared/`):** Model position tracking, 1″ model / 6″ squad coherency validation pure functions, and unit tests.
> - **Sub-phase 9B (Casualty Cascade & Consolidation — `shared/`):** Outright non-leader casualty elimination, last-model trauma table rules, and 3″ melee consolidation math.
> - **Sub-phase 9C (3D Multi-Mesh Rendering & Centroid Markers — `client/src/scene`):** Three.js `UnitRenderer` multi-mesh lifecycle and squad centroid status tracking.

### Sub-phase 9A: Spatial Schema & Coherency Engine (`shared/`)
- [x] Update `Model` interface to track individual `position: Vector3` and `rotation: Vector3`.
- [x] Coherency validation pure functions: every model must remain within **1"** of at least one other squad member, and all squad models within **6"** of the entire squad.
- [x] Path movement validation ensuring entire formation maintains coherency at destination.
- [x] Unit tests for coherency geometry in `shared/tests/engine/spatial.test.ts`.

### Sub-phase 9B: Casualty Cascade & Melee Consolidation (`shared/`)
- [x] Unsaved wounds eliminate individual squad models outright without rolling wound effects.
- [x] Only the **final surviving model** in a squad accumulates wound tokens and rolls on the Wound Effects Table.
- [x] Melee consolidation: surviving models consolidate up to **3"** into base contact when charged or upon wiping out opposing units.
- [x] Unit tests in `shared/tests/engine/actions.test.ts`.

### Sub-phase 9C: 3D Multi-Mesh Rendering & Centroid Badges (`client/`)
- [x] `UnitRenderer` instantiates, updates, and disposes multiple 3D meshes per squad.
- [x] Status badges and wound markers follow the squad centroid.
- [x] Interactive selection highlights the entire squad.

### Acceptance Criteria
- [x] Squads render and move with multiple 3D models while adhering to 1" coherency.
- [x] Unsaved wounds remove individual squad models until 1 remains.
- [x] Wound Effects table is only rolled for the last surviving model in a squad.
- [x] Melee 3" consolidation pulls squad members into contact.

## Phase 10: Interactive Deployment & Pre-Canned Starter Armies
**Goal:** Provide quickplay point-balanced starter forces for instant match play and an alternating pre-match deployment phase.

> **Atomic Sub-Phases:**
> - **Sub-phase 10A (Pre-Canned Armies — `shared/data`):** Point-balanced starter army rosters for Frontier Wardens and Rust Raiders, with special rules definitions (`vanguard`, `drop-reserve`).
> - **Sub-phase 10B (Deployment Engine — `shared/`):** Deployment turn phase, 12″ deployment zone validation, alternating placement, and initiative roll-off.
> - **Sub-phase 10C (Deployment HUD & Lobby Picker — `client/src/ui`):** Lobby army selection and 3D deployment zone placement interaction.

### Sub-phase 10A: Pre-Canned Quickplay Starter Armies (`shared/data`)
- [x] 1-click ready-to-play, point-balanced starter forces for each faction in `shared/data/armies.ts`.
- [x] Balanced unit composition (e.g. 250pts / 300pts for Frontier Wardens and Rust Raiders).
- [x] Special rules data attributes: `vanguard` and `drop-reserve`.

### Sub-phase 10B: Pre-Match Deployment Engine (`shared/`)
- [x] Deployment phase state machine (`TurnPhase = 'deployment'`).
- [x] Pre-game roll-off for deployment initiative.
- [x] Alternating placement validation: units placed within friendly 12" zone, outside obstacles, > 1" from enemy models.
- [x] Special deployment handling: `vanguard` places after standard units; `drop-reserve` held for Round 2+.

### Sub-phase 10C: Deployment HUD & Lobby Selection (`client/`)
- [x] Lobby UI army selector allowing players to pick their faction force before connecting.
- [x] 3D deployment zone boundaries visualizer.
- [x] Alternating placement HUD prompt and placement confirmation.

### Acceptance Criteria
- [x] Players can start a match instantly by selecting a pre-canned army per faction in the lobby.
- [x] Interactive deployment lets players alternate placing units within 12" zones before Round 1 begins.
- [x] Vanguard units deploy after standard units; Drop Reserve units hold back for Round 2+.

## Phase 11: Environmental Terrain Dynamics & Verticality
**Goal:** Implement full tabletop terrain hazard tests, 3D multi-level vertical movement, and an expanded test battlefield using curated Kenney prototype models.

> **Specification:** See **[RULES_SPECIFICATION.md Section 8 & 10](./RULES_SPECIFICATION.md#8-environmental-obstacles--terrain)** and **[phase-11-spec.md](../.gemini/antigravity-cli/brain/af5e2845-3bb4-4667-aef8-633145239fb8/phase-11-spec.md)**.
>
> **Atomic Sub-Phases:**
> - **Sub-phase 11A (Shared Traversal Engine & Hazard Rules — `shared/`):** Difficult terrain 6″ movement speed cap, dangerous terrain 1d6 hazard tests per model, vertical 3D movement distance math, safe drops ($\le 3″$), falling damage ($> 3″$, AP 1 per 3″ fallen), gap jump checks, strict vertical melee reach ($\le 1″$), and ledge knockback displacement with pure unit tests.
> - **Sub-phase 11B (Elevation Geometry, 3D Line of Sight & Expanded Testing Map — `shared/` & `client/`):** Walkable elevation platform schema (`y > 0`), ladders, stairs, 3D LoS raycasting with parapet cover (+1 Defense within 1″ of ledge) and floor blind spots, plunging fire over ground crates, and an upgraded multi-level default scenario map using Kenney models (`ladder.glb`, `stairs-small.glb`, `floor-square.glb`, `wall-low.glb`, `pipe.glb`).
> - **Sub-phase 11C (HUD Traversal Controls, Hazard Modals & 3D Visual Rendering — `client/`):** HUD gap jump risk warnings in movement confirmation bar, interactive player choice modal for multi-model squad hazard casualties, 3D platform rendering, vertical movement path preview lines, and falling damage feedback tokens.

### Sub-phase 11A: Shared Traversal Engine & Hazard Rules (`shared/`)
- [x] Difficult terrain movement speed cap: caps total activation movement at **6.0″ maximum** (negates speed bonuses for Rush and Charge).
- [x] Dangerous terrain hazard checks: roll 1d6 per model entering or activating inside; rolls of 1 inflict 1 unsaved wound.
- [x] 3D movement distance math: ladders/stairs traverse at 1:1 cost; free-climbing sheer walls classifies move as Difficult Terrain (caps at 6.0″).
- [x] Elevation drop thresholds: safe drops $\le 3.0″$ consume normal vertical distance; voluntary or involuntary drops $> 3.0″$ inflict Falling Damage (1 automatic hit with AP 1 per full 3.0″ fallen) and terminate activation immediately.
- [x] Horizontal gap jumping: gaps $\le 1.0″$ step across freely; gaps $> 1.0″$ up to 6.0″ require a Jump test (Quality $Q$+) with failed checks falling to the bottom with falling damage.
- [x] Strict vertical melee reach: models cannot initiate melee contact or strike across a vertical difference $> 1.0″$ without climbing to base contact.
- [x] Ledge knockback: pushing models over ledges $> 3.0″$ causes them to plummet to the ground with falling damage.
- [x] Pure engine unit tests in `shared/tests/engine/`.

### Sub-phase 11B: Elevation Geometry, 3D Line of Sight & Expanded Testing Map (`shared/` & `client/`)
- [x] Extend `TerrainPiece` schema with elevation attributes: `isDifficult`, `isDangerous`, `elevation`, `walkable`, and climb access points.
- [x] 3D Line of Sight raycasting updates:
  - [x] Models on elevated platforms within 1.0″ of edge facing the shooter receive +1 Defense (Parapet Cover).
  - [x] Models set back $> 1.0″$ from roof edges are visually blocked by floor polygons (floor blind spots).
  - [x] Plunging fire looks over ground-level low cover ($\le 1.0″$) along the line of fire.
- [x] Expanded default testing scenario map (`createDefaultScenarioTerrain`):
  - [x] Multi-level platforms, walkways, industrial pipes, ladders, stairs, low barricades, and dangerous terrain hazard zones (toxic sludge / acid pool).
  - [x] Curate and register new Kenney Prototype Kit models in `client/public/models/`: `ladder.glb`, `stairs-small.glb`, `floor-square.glb`, `wall-low.glb`, `pipe.glb`.
  - [x] Update `doc/ASSETS.md` asset mapping table with footprints and mechanical roles.
- [x] Unit tests for 3D elevation geometry and line of sight.

### Sub-phase 11C: HUD Traversal Controls, Hazard Modals & 3D Visual Rendering (`client/`)
- [x] HUD movement confirmation bar shows Jump Test risk warning (Quality target) when moving across horizontal gaps $> 1.0″$.
- [x] Interactive Player Choice Modal prompting the controlling player to allocate hazard test casualties across squad members.
- [x] Three.js 3D rendering for multi-level platforms, ladders, stairs, industrial pipes, and hazardous terrain textures.
- [x] 3D vertical movement path preview lines & falling damage outcome tokens.
- [x] Client integration tests.

### Acceptance Criteria
- [x] Difficult terrain caps total activation movement at 6.0″.
- [x] Dangerous terrain rolls 1d6 per model; 1s inflict wounds with interactive squad casualty selection.
- [x] Climbing ladders costs 1:1; climbing sheer walls applies Difficult Terrain 6.0″ cap.
- [x] Drops $\le 3.0″$ are safe; drops $> 3.0″$ inflict AP(1) falling damage per full 3″ fallen and end activation.
- [x] Gaps $\le 1.0″$ step freely; gaps $> 1.0″$ prompt Jump test (Quality $Q$+) with falling risk.
- [x] Ledge models within 1.0″ of edge gain +1 Defense; setback models create blind spots.
- [x] Ground models cannot melee targets on ledges $> 1.0″$ without climbing into base contact.
- [x] Default scenario battlefield features rich multi-level Kenney terrain models (platforms, catwalks, stairs, ladders, pipes, hazard pools).

## Phase 12: Reconnection & Network Resilience
**Goal:** Handle disconnections, socket recoveries, and snapshot re-syncing without dropping matches.

> **Specification:** See **[phase-12-spec.md](../.gemini/antigravity-cli/brain/af5e2845-3bb4-4667-aef8-633145239fb8/phase-12-spec.md)**.
>
> **Atomic Sub-Phases:**
> - **Sub-phase 12A (DataChannel Heartbeats, P2P Ping/Pong & Timer Suspension — `client/`):** P2P heartbeat ping every 3s over WebRTC DataChannel, 6s timeout threshold detecting peer silence, top-banner disconnect warnings, and pausing/resuming reaction and turn timers while disconnected.
> - **Sub-phase 12B (Snapshot Persistence, Storage Management & Cleanup — `client/`):** `SessionStore` utility managing `localStorage` for `skirmish_lab_active_session` and `skirmish_lab_snapshot_{roomCode}`, auto-saving confirmed `GameState` after every action, corruption safety checks, and auto-cleanup on Game Over or match abandon.
> - **Sub-phase 12C (Reconnection Handshake, Peer Fallback State Sync & Lobby Resume UI — `client/` & `server/`):** Reconnection flow during the 5-minute grace window, Host-authoritative `state-sync` broadcast, peer fallback (`request-state-sync` if Host storage was wiped), URL query parameters (`?room=XXX-XXX`), and Lobby "Resume Match" banner.

### Sub-phase 12A: DataChannel Heartbeat & Timer Suspension (`client/`)
- [x] Application-level P2P heartbeat ping/pong protocol over WebRTC DataChannel (3s ping interval, 6s silence timeout).
- [x] Top-banner disconnect notification when peer connection is unstable or lost (`"⚠️ Opponent disconnected — waiting for peer to reconnect... (Grace period: 5m)"`).
- [x] Pause reaction countdown timers (e.g. Overwatch, Counter-charge) and turn timers while disconnected; resume smoothly once reconnected.
- [x] Vitest integration tests for heartbeat timeouts, disconnect state transitions, and timer suspension.

### Sub-phase 12B: Snapshot Persistence & SessionStore Management (`client/`)
- [x] Implement `SessionStore` helper in `client/src/storage/SessionStore.ts` wrapping `localStorage`.
- [x] Save active session metadata (`roomCode`, `role`, `playerId`, `playerName`, `armyId`, timestamp) and latest confirmed `GameState`.
- [x] Auto-save state on both Host and Guest after every confirmed action execution.
- [x] Auto-cleanup session data when game reaches `status: 'game-over'` or when player clicks "Leave Room".
- [x] Unit tests for storage operations, versioning, error handling, and quota safety.

### Sub-phase 12C: Reconnection Handshake, Peer Fallback & Lobby Resume UI (`client/` & `server/`)
- [x] URL query parameter support: automatically append `?room=XXX-XXX` to URL and read it on launch.
- [x] Lobby "Resume Match" banner when an active unexpired room session is detected.
- [x] Reconnection handshake: Host broadcasts authoritative `state-sync` to reconnected Guest.
- [x] Peer fallback: If Host reconnects with empty storage, Host requests snapshot from Guest (`request-state-sync`), verifies it, and resumes authority.
- [x] End-to-end integration tests verifying reconnection and state restoration across drops.

### Acceptance Criteria
- [x] Disconnect detected via DataChannel heartbeat timeout (6s silence) or ICE disconnect.
- [x] Reaction and turn timers freeze while disconnected and resume upon reconnection.
- [x] Both Host and Guest maintain cached snapshots in `localStorage`.
- [x] Host and Guest can reconnect to the same room during the 5-minute grace window.
- [x] Game state re-synced after reconnection without state corruption.
- [x] Play resumes seamlessly from the last confirmed state.

## Phase 13: 3D Map Builder & Battlefield Editor
**Goal:** In-browser 3D terrain editor allowing players to design, customize, save, and share custom tabletop battlefields using modular assets.

> **Atomic Sub-Phases:**
> - **Sub-phase 13A (Schema, Asset Ingestion & Map Presets — `shared/` & `client/`):** Define `CustomMapDefinition`, terrain catalog metadata, validation utilities, import curated Kenney assets, and create standard presets.
> - **Sub-phase 13B (Editor View, Palette & Grid Snapping — `client/`):** 3D editor overlay, ghost mesh placement, 0.5"/1.0" grid snapping, raycast surface auto-stacking, and hotkeys.
> - **Sub-phase 13C (Inspector, Map Storage & Lobby Integration — `client/`):** Trait inspector, objective placement/preview, `localStorage` library with JSON import/export, and Lobby map selection synced over WebRTC.

### Sub-phase 13A: Schema, Asset Ingestion & Map Presets (`shared/` & `client/`)
- [x] Define `CustomMapDefinition`, `TerrainTypeMetadata`, and `TERRAIN_PALETTE_CATALOG` in `shared/src/data/mapSchema.ts`.
- [x] Implement `validateMapDefinition` verifying playability, objective spacing (> 9"), deployment zone boundaries, and obstacle collisions.
- [x] Ingest curated modular models from `assets-src/` into `client/public/models/` (industrial buildings, walls, doors, stairs, roofs, barricades).
- [x] Register new terrain GLBs in `client/src/renderer/assetManifest.ts` with unscaled containers.
- [x] Create balanced presets: `frontier-outpost`, `industrial-refinery`, and `sector-7-catwalks` in `shared/src/data/mapPresets.ts`.
- [x] Update `applyDefaultScenario` in `shared/src/data/scenario.ts` to accept `mapId` and `customMap`.
- [x] Unit tests in `shared/tests/data/scenario.test.ts` for schema, presets, and validation rules.

### Sub-phase 13B: Editor View, Palette & Grid Snapping (`client/`)
- [x] Dedicated `MapEditor` overlay mode accessible from Lobby with return controls.
- [x] Interactive 3D scene with 44" x 30" battlefield grid and OrbitControls.
- [x] Category palette toolbar (Structures, Walls, Platforms, Stairs/Ladders, Scatter).
- [x] Ghost preview placement with 0.5" and 1.0" grid snapping.
- [x] Raycast surface auto-stacking on elevated platforms and rooftops.
- [x] Hotkeys: `R` (rotate 90°), `Q`/`E` (elevation adjust), `Delete`/`Backspace` (remove), `Ctrl+D` (duplicate).

### Sub-phase 13C: Inspector, Map Storage & Lobby Integration (`client/`)
- [x] Property inspector panel displaying selected piece traits and elevation with manual overrides.
- [x] Objective marker placement and 3.0" control radius preview rings with auto-distribute fallback.
- [x] Persistent map library in `localStorage` with JSON export/import.
- [x] Lobby map selector dropdown allowing Host to pick presets or custom maps.
- [x] P2P synchronization of custom terrain and objectives across WebRTC data channel.

### Sub-phase 13D: Configurable Board Size (`shared/` & `client/`) (plan: `doc/plans/batch-1g-board-size.md`)
- [x] Board size stored per map with validation (24–72", zones ≥ 24" apart), default 48" × 48" for new maps.
- [x] Objective auto-placement and deployment checks scale with the board.
- [x] Map builder board-size presets (48×48, 36×36, 24×36) and custom size; lobby shows each map's size.
- [x] Camera start positions scale with the board size.

### Acceptance Criteria
- [x] Map schema supports serializable terrain layouts and objective positions.
- [x] Curated terrain assets load cleanly in Three.js with correct scales and materials.
- [x] Creators can visually place, snap, rotate, and elevate terrain pieces in a 3D editor.
- [x] Maps save to browser storage and export/import cleanly to JSON.
- [x] Host can choose a custom map in the Lobby, and Guest receives and renders identical battlefield terrain.

## Phase 13.5: Tactical Combat & Movement Refinements
**Goal:** Address tabletop fidelity, 3D verticality pathfinding, multi-weapon split targeting, multi-model squad control, and core rule alignments in atomic sub-phases.

> **Recommended AI Model:** **4.0** *(3D pathfinding geometry, sequential squad movement state machines, multi-target combat allocations)*

### Sub-phase 13.5A: Core Rules Alignment, Melee Consolidation & Objectives
- [x] Fix melee consolidation bug: when an enemy unit is completely destroyed in melee, prompt the victorious player for an interactive 3.0″ move in any valid direction (advance toward next enemy, take cover, or seize an objective).
- [x] Enforce 3.0″ vertical cylinder constraint for objective presence and control ($|\Delta y| \le 3.0″$ and horizontal distance $\le 3.0″$) across rules engine (`activation.ts`) and HUD inspection (`GameHUD.ts`).
- [x] Asset correction: replace objective crate with the Kenney blaster-kit asset (`assets-src/kenney_blaster-kit_2.1/Models/GLB format/crate-medium.glb`) at `client/public/models/crate-medium.glb`, wired into `assetManifest.ts` and `ObjectiveRenderer.ts`.
- [x] Unit tests for 3.0″ vertical objective control bounds and interactive post-melee consolidation moves.

### Sub-phase 13.5B: Ranged Combat & Split-Fire System
- [x] Concentric weapon range indicators: render soft range rings for each equipped ranged weapon on the battlefield in `MarkerRenderer.ts` (e.g. 9″ sidearm ring, 24″ rifle ring) overlaid on the LoS shadow fan.
- [x] Interactive weapon targeting chips in HUD: display per-weapon chips in the bottom bar during Shoot mode, allowing players to assign each weapon independently to different enemy targets.
- [x] Split-fire engine resolution: execute multi-target shoot action in `actions.ts`, rolling combat tests per target and applying separate defense tests and wounds.
- [x] Unit and UI tests for split-targeting allocations and range ring rendering.

### Sub-phase 13.5C: 3D Surface-Constrained Navigation & Stair Traversal
- [x] Surface-constrained 3D pathfinding: prohibit non-airborne models from flying diagonally through open air.
- [x] Intelligent stair & ladder routing: generate accurate ground-foot entrance and platform-head exit waypoints so units cleanly climb stairs/ladders at 1:1 speed.
- [x] Wall-base ascent fallback: if no stair/ladder is reachable, units navigate along the ground to the wall base and scale vertically as Difficult Terrain (6.0″ speed cap).
- [x] Unit tests verifying ground units route via stairs/ladders when available and climb sheer walls at the base only when necessary.

### Sub-phase 13.5D: Multi-Model Squad Sequential Movement & UI
- [x] Squad model count indicators: display active and total model counts in the HUD roster list and DataCard header/tables (e.g., `Models: 2/2` or `1/2 (1 casualty)`).
- [x] Model-by-model sequential move interaction: clicking Move activates Model 1; clicking places Model 1 within movement range; Model 2 is then activated with a visible 2.0″ coherency circle relative to Model 1; confirm entire squad movement once all living models are placed.
- [x] Squad casualty visual cleanup: eliminate constituent model meshes one-by-one upon taking fatal damage while preserving survivor positions.
- [x] Unit and UI tests for sequential model placement and coherency validation.

### Sub-phase 13.5E: Incremental Movement & Movement Budgeting (`shared/` & `client/`)
- [x] Deduct movement distance from `unit.remainingMovement` instead of resetting directly to 0, enabling multiple micro-moves per activation within movement allowance.
- [x] Support Advance micro-movements (`move -> move -> shoot -> end`) up to base speed (6.0″), with shooting immediately closing the movement window (`remainingMovement = 0`).
- [x] Support Rush micro-movements (`rush -> move -> end`) up to double speed (12.0″), setting `hasAttacked = true` to prohibit shooting while allowing incremental movement until the budget is spent or activation ends.
- [x] Action bar UI updates: preserve Move and Shoot buttons while `remainingMovement > 0.05` and `!hasAttacked`.
- [x] Unit tests in `shared/tests/engine/actions.test.ts` and HUD integration tests for movement budget deductions, shooting lockouts, and multi-move validation.

### Sub-phase 13.5F: Multi-Model Squad Individual Pathing & Terrain Collision Resolution (`shared/` & `client/`)
- [x] Fix terrain blocker false positives: eliminate validation of the abstract straight-line path between squad centroids in `actions.ts`.
- [x] Individual model pathfinding: each constituent squad model runs independent A* pathfinding from its own physical position to its target location in `GameHUD.ts`, navigating around intervening terrain.
- [x] Decouple squad validation from single-unit centroid checks: bypass `path[0] == unit.position` and `path[end] == finalPosition` in `actions.ts` when constituent `modelPositions` are present, validating each mini independently.
- [x] Enforce live coherency rings ($\le 2.0″$) centered on already-placed squad members during model placement.
- [x] Validate clearance and movement allowance for each individual model's path in `actions.ts`, and deduct squad movement budget based on maximum constituent displacement.
- [x] Unit and UI tests verifying squads flanking obstacles/cover navigate without triggering false "Move path is blocked by terrain" or "Move path must start at unit position" errors.

### Sub-phase 13.5G: Rush Range Visual Indicator & Budget Alignment (`client/`)
- [x] Fix Rush range radius bug: resolve `GameHUD.ts` issue where `this.activeUnit.remainingMovement` (initialized to base speed $6.0″$) took precedence over the $2 \times$ Rush allowance ($12.0″$), causing Rush to erroneously show standard move distance.
- [x] Accurate remaining Rush budget calculation:
  - If unit is actively rushing (`unit.isRushing`), radius is `unit.remainingMovement`.
  - If unit has not yet rushed, radius is `unit.speed * 2 - (unit.hasMoved ? (unit.speed - unit.remainingMovement) : 0)`.
- [x] Distinctive Rush ring visualization: support distinct visual styling (e.g. golden/amber range ring `0xffb74d`) in `MarkerRenderer.ts` and `GameHUD.ts` to clearly distinguish Rush mode from Advance mode.
- [x] Unit & UI integration tests in `client/tests/ui/GameHUD.test.ts` verifying that hovering and selecting Rush displays the full 12.0″ radius for unhindered units with gold/amber tint.

### Sub-phase 13.5H: Solid Triangular Ramp (Wedge) Collision & Ladder Deck Arrival (`shared/` & `client/`)
- [x] Solid triangular ramp geometry: update stairs from passable phantom bounding boxes to solid right-angled triangular prisms (wedges).
- [x] Update wireframe debug rendering in `MarkerRenderer.ts` (`F9` overlay) to render triangular prism wireframes showing the true incline profile from foot to head instead of an AABB cuboid.
- [x] Impassable sides/risers with continuous sloped surface: stair sides and rear walls block movement, while the sloped hypotenuse surface calculates continuous height $y(t) = y_{\text{foot}} + t(y_{\text{head}} - y_{\text{foot}})$ without synthetic waypoint teleporters.
- [x] Tabletop ladder rules enforcement: models scaling vertical ladders must have sufficient movement budget to reach the landing platform deck; if movement is insufficient, the model remains at the ladder foot rather than hanging suspended on rungs. Models traversing stair ramps may stop along the slope.
- [x] Arbitrary squad model movement order: players can select and move models in any order using bottom dock HUD chips or direct 3D board clicks, with repositioning before move confirmation.
- [x] Unit tests for wedge collision, continuous ramp elevation, vertical ladder completion constraints, and arbitrary model movement order.

### Sub-phase 13.5I: Consolidated Verification Checklist & End-to-End Validation
- [x] Update the manual playtest checklist (now consolidated in `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`) with accurate force names (*Frontier Wardens* and *Rust Raiders*) and actual unit rosters.
- [x] Create streamlined, step-by-step test cases for each 13.5 sub-phase mechanic (interactive consolidation, 3D objective cylinder, split fire, stair pathfinding, arbitrary squad movement, user-chosen model order, incremental movement budget, obstacle flanking, triangular ramp traversal, and rush range indicator).
- [x] Verify test suite passes locally across all workspaces.

### Acceptance Criteria
- [x] Wiping out an enemy in melee triggers an interactive 3.0″ consolidation move.
- [x] Ground crates cannot be seized by models on rooftops $> 3.0″$ vertically above them.
- [x] Objective marker uses Kenney `crate-medium.glb`.
- [x] Units with multiple ranged weapons can allocate weapons to different enemy targets with concentric range rings rendered.
- [x] Pathfinding to elevated platforms routes non-airborne units up stairs/ladders at 1:1 cost without sheer air climbs.
- [x] Multi-model squads can be moved model-by-model with visible 2.0″ coherency circles, arbitrary model movement order via HUD chips or 3D clicks, and model count is shown in the HUD.
- [x] Units can make incremental micro-moves within their activation until movement budget (6.0″ move or 12.0″ rush) is exhausted, and shooting closes the movement window.
- [x] Multi-model squad movement paths individual constituent models around obstacles without triggering centroid terrain blocking false positives.
- [x] Rush range ring accurately renders up to 12.0″ (double speed) on the battlefield with distinct styling, adjusting dynamically for previous micro-moves.
- [x] Stairs render as triangular prism wireframes and compute continuous sloped elevation without synthetic waypoint hacks, and vertical ladders require reaching the deck.
- [x] Consolidated verification checklist accurately reflects actual armies and verified mechanics.

## Phase 13.6: Procedural Wargaming Terrain System (Replacing Kenney Assets)
**Goal:** Replace non-standard, inconsistent Kenney prototype terrain GLBs with a clean, mathematically exact procedural wargaming terrain library built to a 1:1 inch scale ($1.0\text{ unit} = 1.0\text{ inch}$).

> **Recommended AI Model:** **4.0** *(3D procedural BufferGeometry, collision parity, raycast bounds, and wargaming scale alignment)*

### Sub-phase 13.6A: Kenney Terrain Asset Removal & Baseline Procedural Foundation (`client/` & `doc/`)
- [x] Remove all 28 legacy Kenney terrain `.glb` files from `client/public/models/`, keeping only unit figurines (`figurine*.glb`), UI markers (`indicator*.glb`), outcome damage tokens (`number*.glb`), and objective beacon crate (`crate-medium.glb`).
- [x] Update `client/src/renderer/assetManifest.ts` to retire `TERRAIN_ASSETS`, removing GLB network load overhead for terrain.
- [x] Update `client/src/renderer/ModelLoader.ts` to provide clean, normalized procedural geometry for all terrain types without attempting to load retired GLBs.
- [x] Update `doc/ASSETS.md` asset inventory and terrain mapping tables to document procedural geometry and the clean separation from prototype GLBs.
- [x] Verify test suite passes across all workspaces (shared, server, client).

### Sub-phase 13.6B: High Sight-Blockers & Industrial Ruins (`client/` & `shared/`)
- [x] Procedural **L-Corner Ruin** ($4" \times 3" \times 4"$, wall thickness $0.25"$): classic wargaming tournament staple with modeled return wall, second-floor L-ledge ($y = 3.0"$), and firing apertures.
- [x] Procedural **Modular Solid Walls** ($4" \times 2.5" \times 0.3"$ and $6" \times 2.5" \times 0.3"$): beveled top coping and inset vertical panel seams.
- [x] Procedural **Window Walls** ($4" \times 2.5" \times 0.3"$): solid $1.0"$ lower breastwork (grants Cover) with open upper firing apertures.
- [x] Procedural **Doorway Walls** ($4" \times 2.5" \times 0.3"$): solid wall with central $1.2" \times 2.2"$ walk-through opening (allows infantry passage without climbing; opening widths in `getApertureProfile` match the meshes).
- [x] Procedural **Structural Columns / Pillars** ($1.2" \times 3.0" \times 1.2"$): square and octagonal beveled pillars supporting elevated platforms.

### Sub-phase 13.6C-0: Terrain Structure — Solids + Apertures (`shared/` & `client/`)
- [x] `TerrainSolid` / `TerrainAperture` / `TerrainGroup` types and a data-driven catalog (`shared/src/data/terrainStructures.ts`) for walls, window/doorway walls, columns and the L-corner ruin; nested groups with offsets. The second-floor ledge is deferred to 13.6C.
- [x] Engine reads only solids and apertures for movement, line of sight, cover, nav waypoints and the visibility fan (no per-building special cases). Fixes movement into `ruin-l` and window-port LoS on ruins.
- [x] 3D line of sight from a 1.1" eye to any visible part of the target (head/torso/feet); manning = base edge within 1.0" of the port; doorways are open air with no port cover.
- [x] Unit tests for ruin movement, manned/distant ports, lintel/sill heights, nested groups and the F9 debug trace.
- [x] Client: meshes built from the shared structure definitions, per-box F9 wireframes (solids/apertures) and eye-level rays; courtyard ground picks already resolve to the ground plane. Playtest checklist: `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`.

### Sub-phase 13.6C-1: Grid Compliance & Segmented Walls (`shared/` & `client/`)
- [x] All catalog heights, thicknesses and openings are multiples of 0.25" at default scale (test-guarded): wall/window/doorway thickness 0.25", window port 2.5" wide, doorway opening 1.5" × 2.25", column 1.25", ruin 4" × 4" × 4" with a 1.0" sill and 0.25" walls.
- [x] 2" wall component (`wall-short`); 4" and 6" walls are 2 and 3 flush segments (fixes the see-through seams in the 6" wall mesh).

### Sub-phase 13.6C-2: Elevation Engine (`shared/`)
- [x] `walkable` solids, `FLOOR_TIER` = 3.0", `getWalkableSurfaces` / `findWalkableSurfaceAt` (replace whole-footprint platform checks for structured pieces; legacy pieces still work).
- [x] Structures: `platform-small`, `platform-large`, `catwalk`, `support-pillar`; ruin gets its 3.0" L-ledge (ruin is 4"×4"×4").
- [x] Setback blind spot and parapet cover hacks removed in favour of 3D geometry.
- [x] Client: meshes with visual-only kick-plates/tread ridges, palette entries, auto-stacking on decks, ladder snapping to deck faces, ruin-ledge picking, F9 purple floors. Playtest checklist: `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`.

### Sub-phase 13.6C-3: Drops, Jumps & Stairs/Ladder Fixes (`shared/` & `client/`)
- [x] Drops cost horizontal distance only; drops of 3-6" need the X+1 dice (3+) jump test, otherwise a fall; drops above 6" always fall; no move ends in mid-air.
- [x] Stairs orientation is data (head = local +Z) and the editor snaps stairs to deck faces; ladder paths walk the spine (foot -> head).
- [x] Manual checklists consolidated into `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`.
- [x] Horizontal gap jumps use the same X+1 dice (3+) test; gaps measured as real open air; over 6" rejected; traversal dice shown in the dice panel and log.
- [x] Crate collision footprint is the full 1"×1"; saved maps with a stray `elevation` (e.g. 0 on a catwalk) no longer break picking or physics; clicking pillars/undersides picks the ground.

### Sub-phase 13.6C: Vertical Elevation & Walkable Catwalks ($y = 3.0"$) (`client/` & `shared/`)
- [x] Standardize floor elevation tier at $y = 3.0"$ (providing clearance for standard 28–32mm infantry models underneath).
- [x] Procedural **Walkable Platforms** ($4" \times 4"$ and $6" \times 4"$ decks, 0.25" thick, on four 0.5" corner pillars): industrial diamond-tread / grate floor, safety kick-plates, and pillar mounting sockets at $y = 3.0"$.
- [x] Procedural **Catwalks / Skybridges** ($6" \times 2" \times 0.2"$): suspended walkways spanning gaps between platforms.
- [x] Procedural **Wall Ladders** ($0.6" \times 3.0" \times 0.15"$): vertical side-rails with modeled horizontal rungs snapped to vertical wall/platform faces.
- [x] Enhanced procedural **Stair / Ramp Wedges** ($2" \times 3.0" \times 4"$): wargaming step risers and side stringers matching continuous ramp physics 1:1.

### Sub-phase 13.6D: Low Cover, Barricades & Scatter (`client/` & `shared/`)
- [x] Waist **Barricades** ($3.0" \times 0.5" \times 0.25"$): chamfered concrete jersey barriers / armored barricades providing low cover (+1 Defense).
- [x] **Supply Crates** ($1.0" \times 0.75" \times 1.0"$): reinforced corner brackets and hazard markings.
- [x] **Shipping Containers** ($5.0" \times 2.25" \times 2.25"$; walkable roof at $y = 2.25"$): corrugated steel side panels and walkable flat roof ($y \approx 2.2"$).
- [x] **Industrial Pipes** ($4.0" \times 0.75" \times 0.75"$; box collision): cylindrical pipelines with pipe-coupling flanges.

*(13.6D gameplay is done: pieces, structures, collision and cover. Visual dressing — chamfered barriers, hazard stripes, round pipes, per-type colours — is deferred.)*

### Sub-phase 13.6E: Default Scenario & Map Preset Standardization (`shared/`, `client/` & `doc/`)
- [x] Built-in **Standard Battlefield** (`shared/src/data/builtinMaps.ts`): a 48"x48" point-symmetric table of catalog pieces at their default sizes (the default selection stays the Empty Battlefield). The old off-catalog `createDefaultScenarioTerrain` moved to the test fixture `shared/tests/fixtures/legacyScenarioTerrain.ts`. (13.6E PR 4; lobby and editor entries in PR 5.)
- [x] Verify 1:1 collision parity, LoS calculations, cover grants, and traversal waypoints across all battlefield layouts. (Catalog parity sweep in PR 2; `builtinMaps.test.ts` checks the Standard Battlefield's mix, spacing, symmetry, reachability and line-of-sight symmetry.)
- [x] Update map editor palette to display the new procedural wargaming terrain catalog. (13.6E PR 3: "Area Terrain" category, Difficult/Dangerous inspector toggles.)

- [x] 13.6E PR 1 (`doc/plans/13.6E-default-scenario.md`): area terrain in the engine. New catalog pieces `rubble-field` (difficult, cover) and `hazard-pool` (dangerous), `isDifficultPiece` / `isDangerousPiece` helpers with legacy type lists, difficult/dangerous detection per path segment at the piece's level, cover for models inside area pieces, and the activation hazard test. Engine only (meshes, editor and the Standard Battlefield follow in PRs 2-5).

- [x] 13.6E PR 2: area terrain meshes. Procedural Rubble Field and Hazard Pool builders (flat, deterministic, within the unit box), F9 footprint outlines (yellow difficult, red dangerous), picks on area pieces resolve to the ground, a `crate` builder, and a parity sweep over every `TERRAIN_PALETTE_CATALOG` piece (procedural builder, mesh inside the unit box, mesh fills every collision solid).

- [x] 13.6E PR 4: Standard Battlefield data (`createStandardBattlefieldMap`, `BUILTIN_MAPS`) and the legacy terrain fixture. Layout invariants (terrain mix, 18% footprint, 1.5" obstacle spacing, objective clearance, point symmetry), ladder/stairs access, objective and ledge reachability, and a line-of-sight symmetry sweep are tested. No UI yet.

- [x] 13.6E PR 5: the Standard Battlefield is selectable in the lobby (a "Built-in maps" group, value `builtin:standard-battlefield`, sent to the game as `customMap`; Empty Battlefield stays the default) and loadable in the map editor (a "Built-in" Load group; loading makes a deep copy with a fresh `custom-<timestamp>` id named "Standard Battlefield (copy)", so saving never claims the built-in id). Entries are built from `BUILTIN_MAPS`. Sub-phase 13.6E is complete.

### 13.6 playtest fixes (bugfix batch 1, see `doc/plans/bugfix-playtest-batch-1.md`)
- [x] Fix (14A feedback, 2026-11-09): a toast shown while the "Opponent disconnected" banner is up now stacks under the banner instead of hiding behind it. The declared-charge dock's highlighted "End (no melee)" button is now a plain **Abandon charge** button, so it no longer reads as the way to finish a charge.
- [x] The casualty pick dock no longer has a "Let the host pick" button, and the pile-in dock no longer has "Let the host place them" (owner, 2026-11-09). **Auto pick** / **Auto place** then **Confirm** does the same, and the timeout still lets the host decide.
- [x] Fix: a Rush aimed past a rubble field at an angle (or at a rotated field) was capped at 6" out in open ground. The planner's stop point sat inside the 0.15" path-check margin, so the stopped path still counted as crossing difficult terrain. The stop point is now found against the grown footprint (any rotation), and the HUD shows "Rush stops at the edge of difficult terrain" whenever the cursor is inside or beyond the field (owner report, 2026-11-09).
- [x] Fix: a declared squad charge drew two range rings after a leg (the unit-wide red charge disc around the squad's middle plus the selected model's own ring). It now draws only the selected model's ring (owner report, 2026-11-05).
- [x] PR 36 (batch 1I): the owner picks casualties, HUD. The damaged squad's owner gets a "Remove N models from <unit>" dock with the countdown: click models on the board or chips to toggle them (orange rings in the scene, a "splits the squad" note on chips whose removal would break the chain, never blocking), **Auto pick** fills what the timeout would choose and can be adjusted, **Confirm** (enabled at exactly N) sends `pick-casualties` after a local `validateAction`, "Let the host pick" keeps the old immediate choice. The other player sees "Waiting for <name> to remove casualties". Queued prompts reset the selection.
- [x] PR 35 (batch 1I): the owner picks casualties (Decision 37), engine only. When shooting, the charge strike, strike-back or a fight would remove models from a squad that survives, the host holds the wounds and sets a 30 s `pick-casualties` reaction for the squad's owner (one prompt per damaged unit, in order); new action `pick-casualties { unitId, modelIds }` (exact count, distinct living models of the unit, any of them). Accepting removes them, puts the remaining wounds and the pre-rolled wound-effect roll on the survivor exactly as before, then continues (strike-back prompt, step back, consolidation). In melee the strike-back is counted after the defender's pick and the charger's owner picks after the strike-back. Timeout / "Auto pick" lets the host pick, preferring removals that keep the chain connected (`engine/casualties.ts`). Hazard casualties keep their picker. HUD log/dice labels for the new action and choice. No pick UI yet (PR 36): until then the generic reaction prompt's "Auto pick" button or the timeout resolves it.
- [x] PR 34 (batch 1I): defender pile-in prompt, HUD. The defending player gets a "Pile in" dock with the reaction countdown: pick a listed model, click a spot (3" ring, path preview, overlap and coherency toasts), **Auto place** fills unplaced models with the `closestApproach` suggestion (then any can be moved), **Confirm** runs the host check locally and sends `pile-in-move`. "Let the host place them" keeps the `auto-pile-in` choice. The charging player sees "Waiting for <name> to pile in". `engine/pileIn` is now exported from the shared barrel.
- [x] PR 33 (batch 1I): the defender places their own pile-in (Decision 35), engine only. A final charge that leaves target models out of base contact sets a 60 s `pile-in` reaction instead of piling them in automatically; new action `pile-in-move` (ordinary movement <= 3", contact or within 0.5" of `closestApproach`, coherent) then the charger's strike is rolled from the confirmed spots. Timeout / "Auto place" lets the host place the models with `closestApproach` (`engine/pileIn.ts`). The old straight-line `consolidateSquadToward` pile-in is gone. No HUD yet (PR 34): until then the generic reaction prompt's "Auto place" button or the timeout resolves it.
- [x] PR 32 (batch 1I): "as close as possible" for squad chargers (Decision 31). New pure `closestApproach` (ordinary movement only, own remaining distance, others' final spots, coherency kept). A final squad charge needs one model in base contact; every other model must end within 0.5" (base edge) of its best gap or the host rejects "Model N could get closer to the target". HUD: unplaced models in a final charge are filled in automatically and shown in the confirmation. The defenders' pile-in is unchanged (PR 33).
- [x] PR 31 (batch 1I): a failed squad jump stops the later jumpers (Decision 30). Walking models always finish; jumps resolve in model order; after the first jump that fails (or a fall) every later jumper stays at its declared take-off spot, its jump is not attempted and its rolls are ignored (log: "Model N: jump not attempted (activation ended)"). Dice are still requested up front, unchanged. New `TraversalEvent` type `jump-skipped`. Squad moves, rushes and charge legs; single jumpers unchanged.
- [x] PR 30 (batch 1I): per-model movement budgets across legs (Decisions 32, 39). New optional `Unit.modelMovementSpent` (model id to inches walked this action; helpers in `engine/modelMovement.ts`). In split moves, rushes and squad charges (legs and final) each model's path is checked against its own remaining distance and added to its own total; `remainingMovement` is the budget minus the smallest total. A passed jump stays free, the Difficult Terrain 6" cap applies per model, single-model units are unchanged. HUD: after the first leg of any move or rush the bar shows the distance left; while staging a squad the ring and the text show the selected model's own distance.
- [x] PR 29 (batch 1I): regrouping an out-of-coherency squad (Decisions 28, 29). New pure `coherencyShortfall(positions)` (minimum spanning tree of the missing link length plus the excess over the 6" spread; 0 exactly when `validateSquadCoherency` accepts). A squad that started a move, rush, charge or charge leg out of coherency may end it still apart if its shortfall dropped by more than 0.05"; a squad that started coherent must still end coherent. `shoot` without having moved is rejected for a squad that started its activation out of coherency (stunned exempt); Advance then shoot is fine. The HUD staging accepts regrouping placements and disables Shoot (like Hold) until the squad has moved.
- [x] PR 28 (batch 1I): coherency is one unbroken chain (Decision 34). `validateSquadCoherency` also requires the link graph (same level-aware limits) to be connected; a squad that is two separate pairs fails with "Squad is split into N groups". The 6" spread is unchanged. The HUD staging toast already shows the engine reason.
- [x] PR 27 (batch 1I): quick wins. The shooting preview aims each firing model at the clicked target model when it sees it in range (preview only; who fires and cover unchanged). The host rejects `charge` / `charge-leg` from a unit with 2+ living models that has no `modelPositions` (old block charges). The squad hover preview now offers jumps like a single model (path, floating label, chip), and hovering across a gap over 6" shows "Too far to jump (N\", max 6\")" (`findTooWideGap`), never offering the jump.
- [x] PR 11 (batch 1D): per-model charges (Decision 11). A squad's charge and charge legs carry `modelPositions` / `modelPaths` / `modelTraversals`; the host validates each model (own path within the charge budget, 1" keep-away except toward the target, never through a model, coherent end including the split-level rule, per-model declared jumps with `m<index>_` dice), needs at least one model in base contact for the final charge and lets the others end as close as they can (no farther than they started). Strikers (2" / 4"), the defenders' 3" pile-in and the winner's consolidation work on the new positions, and the step back after melee is per model (`pushBackChargerModels`: each charging model slides to a 1" gap, keeping coherency and clear of terrain, with a block-step fallback). HUD: declaring a charge with a squad then stages each model (chips, per-model paths, coherency toasts, **Confirm charge** early); clicking the target puts the selected model in contact; the confirmation is a final charge when a model touches, otherwise a leg.
- [x] PR 16 (batch 1D): split charges (Decisions 21-22), single-model units. New actions `begin-charge` (declare + lock the target; reach checked at the start) and `charge-leg` (a safe path or a declared jump, host-validated per leg, 1" keep-away against every other unit, jump dice per leg), then the final `charge` into contact or `end-activation` to abandon (no melee). The one charge budget lives in `remainingMovement`; a passed jump is free, a failed one falls and ends the activation with no melee; a declared charge can't switch to another action (`TurnState.charge`). The charge dice spec now shares the move's traversal-dice helper. HUD: when no single safe path reaches the target, clicking it offers to declare the charge, then legs work like split moves with the remaining-budget ring, "Charge declared: N" left" and an End (no melee) button; the one-click charge is unchanged. Squads join with PR 11.
- [x] PR 15 (batch 1D): squads can declare jumps. A squad move/rush carries `modelTraversals` aligned with `modelPaths`; the host validates each model's path, the jumping models roll their own `m<index>_` dice in model order, a failed jump or fall removes only that model (the last survivor takes the normal falling hit) and ends the activation. The HUD offers the jump chip to the model being placed and sends the declaration; a plain fall over 6" in a squad now removes the falling model instead of the first living one.
- [x] PR 10 (batch 1D): a squad move/rush can be confirmed as soon as one model is placed (**Confirm move**); unplaced models stay put (0" path) and the final set must still be coherent. A squad that starts its activation out of coherency can't Hold or end without moving (host check; HUD hint). Squad objective control checks each living model's base edge instead of the unit anchor (Decision 11).
- [x] PR 9c (batch 1D): squad shooting preview and F9 are per model. `squadAim` (engine) gives each attacker model its nearest visible in-range target model, plus the model the player pointed at when a firing model sees it; the targeting preview draws one aim line per attacker model (faint red when that model cannot fire), rings the aimed-at target model, and shows an "N of M models can fire" chip. `computeSquadShootingRayDebug` makes F9 draw a ray per attacker model and report the cover-by-majority result.
- [x] PR 9a (batch 1D): squad shooting is per model (engine + HUD pre-checks). `unitGeometry` gains `livingModelPositions`, `closestModelPair`, `unitDistance`, `firingModels`, `targetCoverByMajority`. A shot is valid when at least one attacker model sees, and has in range, some target model; only those models' attacks count; cover needs a strict majority of target models in cover; the `> 9"` rules use the closest models. Charges, engagement and the 1" rule are PR 9b, aim lines / F9 / "N of M can fire" are PR 9c.
- [x] PR 9b (batch 1D): charges, engagement and the 1" rule are per model. Charge reach/contact (`chargeContact`), melee engagement (`unitsInContact`, `refreshEngagements`, fight validation), the commander 12" aura and the deployment 1" gap measure to the closest model. **1" keep-away:** a move/rush path (and a charge toward anything but its target) may not come within 1" edge to edge of any model of another unit, friendly or enemy (`findMoveBlocker` `keepAway`, `findKeepAwayViolation`; `findNavPath({ keepAway })` stops short or routes around via an octagon of waypoints). **Who strikes:** only models within 2" / 4" of an enemy model roll melee attacks (charge, fight, strike-back). Defenders' pile-in measures to the closest charging model, never stacks on a model and keeps coherency; the nav waypoints and the charge pass-through check cover every model, not the anchor. Out-of-coherency-at-activation enforcement and per-model push-back stay with PR 11.
- [x] PR 14 (batch 1D): base-edge measuring (Decision 12). New `shared/src/engine/unitGeometry.ts` (`baseRadius`, `modelGap`, `markerGap`, `unitGap`). Shooting range and the `> 9"` rules, objective control (3" to the base edge), the 1" deployment gap, the 12" commander aura, the 6" squad spread (now 7.0" centre) and engagement/charge-end all measure between base edges; the HUD shooting range ring is weapon range plus one base radius. Path lengths stay centre-based.
- [x] PR 8 (batch 1C): split-level squad coherency (Decision 10). Models on different levels (height difference over 0.5") may be up to 3" apart edge to edge (4.0" centre) instead of 1"; the 6" spread is unchanged. `validateSquadCoherency` uses y; the host move/rush checks and the HUD staging toast use it.
- [x] PR 7 (batch 1C): terrain up to 1" tall is stepped over. `isStepOverPiece` (obstacle pieces with no floors whose solids all rise <= `STEP_OVER_MAX_HEIGHT` = 1.0" above the floor they stand on) is skipped by `findMoveBlocker`, `clampMoveDestinationWithObstacles` and the nav obstacle corners, so barricades, crates and pipes cost the straight-line distance with no detour; a model still can't end overlapping one (`findEndOverlap`), and cover / line of sight are unchanged.
- [x] PR 25 (batch 1H): a hop across more than 1" of open air is a gap jump even when it also drops (e.g. a 4.5" container stack to a 2.25" container over a 3.8" gap: 2 dice). `classifySegment` now measures the open-air run for descents, so the preview's jump chip and the host's Confirm check agree. Decision 24: every declared jump is measured as the straight-line 3D distance from take-off to landing (dice from it; a gap hop over 6" is blocked, a pure drop over 6" still falls); a property test runs every `findJumpOption` result on both fixtures through `validateAction` (move and rush).
- [x] PR 26 (batch 1H): removed the stale "sheer climb ... next turn" rush message. A rush preview that ends short now says why in one line ("Can't reach that height from here — use stairs or a ladder", "Out of movement", or "Rush stops at the edge of difficult terrain"); nothing promises a later turn.
- [x] Terrain picking ignores decorative lines (stair step lines) and `userData.decor` meshes, so the move target no longer snaps to the stairs' top corners.
- [x] Map editor: objectives from Auto Obj / loaded / imported maps can be selected by clicking near them (within 1") or from the Objectives tab list, and removed (PR 12).
- [x] PR 1: ladder foot/head are real standing spots (`LADDER_STANDOFF` 0.55" off/on the deck face; the step on/off is free), ladders onto the shipping container work, and the mid-air guard is no longer disabled on maps that contain a ladder.
- [x] PR 5: drops are collision-checked (fall column), so a model can no longer fall through a deck, the stair wedge or scatter; drop points sit `DROP_STANDOFF` (0.55") beyond the edge (the step counts as movement), and only segments that follow the slope count as "on the stairs".
- [x] PR 3b: terrain picking only accepts an upward-facing hit (world normal.y > 0.7) as "on a deck floor"; deck side faces and undersides fall through to the ground, and deck kick-plates / tread ridges are flagged `userData.decor` so they are never picked.
- [x] E1 (batch 1E): safe-only pathfinding and traversal classification. `classifySegment` is the single source of truth for walk/stairs/ladder/climb/drop/gap/jump/fall; `findNavPath` plans ordinary movement only (never a jump, fall or, until E2, a climb) and never ends mid-air or mid-climb; stairs are reachable from the side; a free edge drop beats a 3" ladder descent; ledge steps off the open end; rotated pieces' nav points use the collision convention. Jumps and falls are declared: `findJumpOption` offers them from a floor edge and the host requires a matching `traversal` on the move (recomputed and validated). A passed jump costs no movement. The jump preview UI is E3.
- [x] E2 (batch 1E): climbability is data. `TERRAIN_PALETTE_CATALOG` has a `climbable` default per type (container, ruin, ruin-l yes; platforms and catwalk no) and `TerrainPiece.climbable` overrides it (`isClimbable`). The pathfinder plans climbs of 3" or less onto climbable floors from the drop stand-off spot (cost: vertical + stand-off steps, all-or-nothing, not difficult); the host rejects climbs onto non-climbable pieces, over 3", or past a blocked column. The editor toggle and F9 outline are E4.
- [x] E3 (batch 1E): move preview shows declared jumps and traversal styling. `resolveMoveTarget` snaps the cursor to a floor edge within 0.5" and asks `findJumpOption`; an offered jump/fall previews as a single dashed red hop with a chip ("Jump gap 4.9" · 2 dice (3+)", "Jump down", or the red fall warning) and Confirm sends `payload.traversal`. Each leg of the previewed path is styled by `classifySegment` kind (climb orange, drop amber, jump dashed red) with a label and cost in the summary. The legacy `gapJump` payload field is removed. Squads get edge snapping and leg styling but no jump (the host does not accept a declared jump for a multi-model move yet).
- [x] E4 (batch 1E): F9 draws an orange outline around the walkable floors of climbable pieces, and the map editor shows it on the selected piece plus a **Climbable** checkbox (shown for pieces with a walkable floor, pre-set from `isClimbable`, writes `piece.climbable`, persists through Save/Export/Import).
- [x] PR 2: no move ends overlapping terrain or another model. `findEndOverlap` (base circle `UNIT_COLLISION_RADIUS` vs obstacle solids over the body span `[y+0.15, y+EYE_HEIGHT]`; other units' models within 0.9" at a similar height) is checked by the host for move, rush (single and squad models), charge and declared-jump landings; `settleEnd` / `settleMoveEnd` pull the nav end back along the path (0.05" steps, never forward), so the preview already shows the settled end.
- [x] PR 13: the "0" wound outcome marker now uses the same Kenney digit model as 1-5 (`number-0.glb`, tinted neutral grey) instead of a procedural torus.
- [x] PR 20: no move ends with its base overhanging an edge. `isBaseOverhanging` (union of walkable floors, 16 samples round the base) is checked by the host for move/rush/charge (single and squad) and declared-jump landings; `settleEnd` steps on past a climb's lip when the budget allows, else stays at the stand-off spot; deck-side cursor snap is inset by base radius + 0.05"; the step after a climb or before a drop is no longer labelled "gap".
- [x] PR 24: raised stairs (standing on a deck) work like ground stairs. A base resting on a slope is supported if its rim is within the slope's grade, so models can path onto and stop part-way up any stair slope (the base-overhang check used to reject every mid-slope end), and `isSegmentOnRampOrStairs` uses the stair's own base height instead of ground level.
- [x] Games use the custom map's board size (was always 36"×36"); deployment zones stay 24" apart on small boards; TEST army (one speed-24" fighter per side) for playtesting.
- [x] PR 17 (batch 1F): climbing and dropping between a deck and a piece stacked on it. The drop/climb "lower twin" in `findNavPath` now stands on the highest walkable floor below the stand-off spot (else the ground) instead of always `y: 0`, and is skipped if it would overhang; the 3" climb limit uses the real rise (a container on a 6" deck is a 2.25" climb). Fixture `testy-mctestface-2.json`.
- [x] PR 18 (batch 1F): a failed gap jump lands the model on the highest floor below the fall point (a lower deck, else the ground) at a clear, fully supported spot within 2" (`findFallLanding`), applies falling damage for any fall of 2" or more (AP(1) per full 3"; the dice are requested for jumps from 2" up), returns the real wound count (0 when saved), and in a squad only the jumping model falls (it is lost unless it is the last survivor).
- [x] PR 19 (batch 1F): floating 3D labels on the move preview. Each labelled leg (climb, drop, jump, fall) shows a `CSS2DObject` HTML label at its midpoint, rendered by a `CSS2DRenderer` overlay in `SceneManager` (pointer-transparent, resized with the window) and removed with the preview.

### Acceptance Criteria
- [x] Zero Kenney terrain `.glb` files loaded or downloaded in the client. (`client/public/models` holds only the crate beacon, indicators and outcome digits; terrain is procedural.)
- [x] Visual terrain matches mathematical collision geometry and F9 debug wireframes down to the millimeter across all pieces. (Owner-confirmed in playtesting, 2026-11-09; the catalog parity sweep checks every mesh stays inside its collision box and fills its solids. Platform kick-plates are visual-only decor above the deck.)
- [x] Standardized $1.0\text{ unit} = 1.0\text{ inch}$ wargaming dimensions across all platforms, ruins, barricades, and ramps. (Every catalog height, thickness and opening is a multiple of 0.25", test-guarded.)
- [x] All unit, integration, and renderer tests pass across all workspaces.

## Phase 14: MVP Polish & Release Hardening
**Goal:** Close out the MVP: clear match results, concede and rematch, alignment with One Page Rules, a rules audit and a full code review, performance, a playtest-and-polish pass, synced docs and the MVP release. Audio and other presentation work move to Phase 15, after the MVP. Each sub-phase gets its own plan in `doc/plans/` and small PRs; fixes found in 14D–14G are collected into **bugfix batch 2**.

**Owner decisions (2026-11-09):** a draw on objectives stays a draw (no tournament tie-break for now); Concede ends the match as a loss for the conceding player, who stays on the results screen (rematch offered there in 14B); a rematch replays the exact same game (same map, armies and sides).

### Sub-phases
- [x] **14A Match end, results and Concede.** *(PR 1 engine and PR 2 HUD done: `concede` action, `summarizeMatch`, Concede button, results screen.)* A clearer game-over screen (who won and why, objectives held, units lost per side). A draw on objectives stays a draw. New **Concede** action: the match ends as a loss for the conceding player; both players see the results screen (Defeat / Victory) and stay in the room, so 14B's rematch can be offered there.
- [x] **14B Rematch ("Play Again").** *(PR 2 done: Play Again button states on the results screen, per-match reset on a new `gameId`, session and snapshot re-save. PR 1 engine done: `request-rematch` action, `GameState.setup` / `rematchRequestedBy`, `createRematchState`.)* Both players agree on the game-over screen; the host resets the match over the existing P2P channel with the exact same setup (map, armies, sides), no new invite code. Saved snapshots for the old match are cleared so a reconnect can't restore it.
- [ ] **14C OPR alignment (v3.6).** Plan: `doc/plans/14C-opr-v3.6-alignment.md` (umbrella; sub-plans 14C-1 renames & housekeeping, 14C-2 core rules to v3.6, 14C-3 armies at 400 pts with strict Force Org). Owner (2026-11-09): drop the clean-room distinctness and line up with One Page Rules entirely; it is a non-commercial fan project. Keep the **SkirmishLab** name. Rename rules, stats, statuses, actions, weapons, units and armies to OPR's own names and match the mechanics one to one (the local term mapping is the rename list). Ship **4 pre-canned armies** matching the official v3.6 stats: Human Defense Force, Orc Marauders, Prime Brothers, Alien Hives. Keep the cheap safeguards: a one-line "Unofficial fan project, not affiliated with or endorsed by One Page Rules" disclaimer, no OPR logos or artwork, no copied rulebook text (short summaries in our own words plus a link to OPR's free rules), nothing from Patreon-only files. Rewrite AGENTS.md's IP section, the implementer agent's clean-room rule and the README to match; handle old saved sessions (compat mapping or a clean break, decided in the plan).
  - [x] 14C-1 PR 1: core special rules and the move action renamed to OPR terms (AP, Tough, Rending, Hero, Advance and so on; no aliases, faction traits unchanged). Older entries above keep the old names as history; `shared/tests/rules/renames.test.ts` lists the old-to-new mapping.
  - [x] 14C-1 PR 2: lobby footer disclaimer and "Full rules: onepagerules.com (free)" link, README section, data card "Tough" column, "KILLED" in trauma dice summaries, developer mode (F9 in the lobby; TEST armies hidden by default).
  - [x] 14C-2 PR 1: casualties, Tough and morale (plan `doc/plans/14C-2-core-rules-v3.6.md`). No wound-effect table, trauma roll or `stunned`: a model dies when its wounds reach Tough. Morale is a Quality test at the end of every activation for each unit that took a wound, was not in melee and is at half strength or less (Hero within 6" lends its Quality, Fearless 4+); a failure makes the unit Shaken, which may only end its activation idle. The round-end army morale is gone.
  - [x] 14C-2 PR 2: melee reaches 3" and melee results. A model strikes with its melee weapons when its base edge is within 3" of an enemy model. At the end of an activation the wounds each side took in the melee are compared (Fear adds X once per unit); the loser takes a Morale Test, a tie tests nobody, and a loser that fails at half strength or less Routs (removed) instead of becoming Shaken. The HUD log shows the result line.
  - [x] 14C-2 PR 3: shooting. Weapons with the same name must all shoot the same target (two distinct targets max, the HUD enforces both). Blast hits are split between the target and enemy units within 3" of it (even split, odd hit to the target, per-unit cap at living models, each unit rolling its own Defense; every wounded unit counts for end-of-activation morale). Indirect needs a Hold to fire without line of sight; the "-1 after moving" penalty is gone.
  - [x] 14C-2 PR 4: jumps, falls and pushing (engine). Jump dice are one per started inch (2+ each, Strider rolls half rounded up, Flying passes). A unit makes one `jump` roll per leg sized by its longest declared jump; on a failure that model falls from its take-off and the other declared jumpers stay at theirs (replaces "later jumpers stop"). A fall of 2" or more rolls one die per started inch, each 1-3 a wound (no Defense roll). Pushing replaces the ledge knockback: a unit made Shaken by an attacker's activation is pushed on a push die of 4+ (`push` reaction with an Auto button; the host applies Auto on timeout; the Confirm HUD is PR 5).
  - [x] 14C-2 PR 5: push prompt HUD. The push dock gets Auto / Confirm / Don't push (declining is a real choice; timeout stays Auto). Confirm picks one model of the Shaken unit, shows the 2" ring and a "falls N\"" preview, and sends `push-move`. A pushed model that falls with dice brings the rest of its unit down to within 1" of it.
  - [x] 14C-2 PR 6: dangerous terrain dice (plan `doc/plans/14C-2-core-rules-v3.6.md`, Decision 18). A unit whose models cross dangerous terrain, or which activates with any model in it, rolls one die per wound it would take to destroy it (living models' Tough minus wounds taken); each 1 is a wound. One test per piece per activation (`Unit.hazardTestedPieceIds`): the test on activating in a piece also covers moving out of it, a different piece crossed later tests again, and crossing the same piece again rolls nothing. Flying is immune. Dice are tagged `hazard_<piece id>`; the old one-die-per-model test and `activationHazardModelIds` are gone. Hand testing: built-in map `hazard-range` and dev-mode army `test-hazard-army`.
  - [x] 14C-2 PR 4B: squad follow-the-leader jumps. The jump roll is sized by the leader's declared crossing and the leader falls on a failure (owner decision 2026-11-10; replaces "longest jump falls"). Other moved models are routed to the same gap or drop (each walks to the take-off edge on its own move, crossing free); a model that cannot reach the edge stays behind and the host rejects a leg that would split the squad, naming it. The HUD auto-routes followers and marks those that cannot reach the edge. New dev-mode army `test-jump-army` and built-in map `jump-range` for hand testing.
  - [x] 14C-2 PR 4C: group crossing, option C (owner, 2026-11-10; replaces the 4B walk-to-the-edge routing). After the leader declares a jump at its take-off edge and the single roll passes, every other model may be placed on the far side within 1" (base edge) of a model already across, with no walk to the edge and no move spent. Auto placement keeps the squad's formation where it can and otherwise takes the nearest legal spot; the player can place models by hand. The host validates every placed model (new `crossers` payload field); the HUD preview and click use the same check. The follower router, its cannot-reach-the-edge crosses and its cost are removed.
  - [x] 14C-2 PR 7: special rules (plan `doc/plans/14C-2-core-rules-v3.6.md`, Decisions 19-24, 41-42). Fast / Slow are now real (the plan assumed they existed): `getEffectiveSpeed` adds 2" / takes 2" off the Advance, Rush and Charge are twice that, used by every host and HUD distance check. Impact(X) (new in the engine): X dice on a charge, each 2+ a hit that rolls Defense, none when the charger is Fatigued. Counter (new): the charged unit strikes first after the Impact hits and before the charger, unless Fatigued, and that strike replaces its strike back; the old "charger loses an Impact hit" idea is gone. Assault: a ranged weapon with `assault` also strikes in melee (`isMeleeWeapon` / `findMeleeWeapon`). Shred: each unmodified Defense 1 adds one wound (the 14C-1 renames test now allows `shred`). Registry descriptions rewritten in our own words. Decision 41: the HUD says `Dangerous terrain: N dice, each 1 is a wound` and the selector reads "Dangerous terrain wounds go first to:". Decision 42: a squad's activation test that removes models raises the casualty pick (a `hold` finishes its activation after the pick). Hand testing: dev-mode army `test-special-rules-army`, plus `hazard-range` + `test-hazard-army`.
  - [x] 14C-2 PR 7B: tabletop alignment fixes (Decisions 43-46). A Shaken unit makes no Counter strike but may strike back as Fatigued; every Counter weapon strikes first (one resolution each, `counterStrikes`), then the strike back is offered for the first non-Counter melee weapon (none if it has no such weapon); Counter casualties on a squad charger are picked before it strikes and Impact casualties before a Counter strike (new `charge-resume` continuation, dice carried in the reaction); Fear counts only the Fear unit's models within 3" of the compared enemy. Fixtures: the special-rules army gains a plain Blade on the Counter guard, a Twin Counter guard and Fear cultists.
  - [x] 14C-2 PR 8: objectives, roll-offs, Scout, Ambush engine (plan Decisions 25-33, 47). New `objectives` phase between setup and deployment: the host's `roll-objectives` action brings one server d6 (count = ceil(d6/2)+2, 3 to 5) and the mission roll-off (10 d6 pairs, first unequal pair wins, an all-tie goes to the host); players then alternate `place-objective` from the roll-off winner (outside both zones, more than 9" apart, on the ground or a walkable surface). The last marker carries the deployment roll-off, whose winner deploys and activates first in round 1. Maps and built-in maps no longer define objectives (`createDefaultScenarioObjectives` / `createBalancedObjectives` are gone, old maps' markers are ignored); a game without the deployment phase has no markers. A rematch keeps the placed objectives and both roll-offs and starts in deployment. Scouts may deploy normally or be held back (`hold-scout`) and placed after every other unit within 9" of their zone and more than 9" from non-Scout enemies. Ambush units are set aside and placed from round 2 in an alternating step before the first activation (`deploy-unit` / `skip-ambush`, more than 9" from enemy units, 12" from Perimeter Watch), and cannot seize or contest objectives in the round they arrive. The placement and roll-off screens came with PR 9. Decision 47: the melee result line names each unit's owner and spells out Fear ("+N Fear from <owner>'s M models in reach"), on its own indented log line.
  - [x] 14C-2 PR 9: objective placement and roll-off HUD, editor clean-up (plan Decisions 25-33, 36). The objectives phase is playable: the roll-off winner clicks the board to place each marker with a live green/red ring and the reason for a red spot, 9" circles around placed markers and both deployment zones shaded; the other player sees "waiting for X to place objective n of N". A panel states the objective roll, the mission roll-off pairs and the deployment roll-off ("X deploys first"). A Scout offers Deploy now / Hold as Scout; held Scouts are placed after normal deployment with the wider zone and 9" circles around non-Scout enemies. The Ambush step uses the same placement flow with 9" circles around every enemy and a Skip (wait for a later round) button; waiting Ambush units show as "In reserve (Ambush)". Objective markers render at the height they were placed (and are no longer rebuilt on every sync). The map editor loses its objective tool, no longer keeps, saves or exports `objectives` (old saves still load), and `validateMapDefinition` no longer warns about objectives. New dev-mode army `test-scout-ambush-army` for hand testing.
  - [x] 14C-2 PR 10: Blast split prompt (plan `doc/plans/14C-2-core-rules-v3.6.md`, Decisions 34-36). A Blast shot with more than one eligible unit pauses with a `blast-split` reaction for the target's owner: Auto split + Confirm (stepper rows per unit with its cap, a running "N of M hits assigned"); a custom split may be any split within the caps that assigns every hit that can land, validated by the host; timeout = Auto. A salvo with several Blast weapons gets one combined prompt. The shot's dice ride in the reaction data and the answer's log entry carries the dice panel. UI inventory entries added.
  - [x] 14C-3 PR 1A (plan `doc/plans/14C-3-armies.md`): Force Org test harness for every non-TEST army (legacy armies exempt by a named list that PR 4 deletes), Hold the Line (shared trait logic, distance kept in `turnState.attackedFrom`), `perimeter-watch` renamed `repel-ambushers` (carried by Test Guard in `test-scout-ambush-army`). Blast spill units count as shot. Per-model loadouts and the HDF list come in PR 1B-1D.
  - [x] 14C-3 PR 1B (plan `doc/plans/14C-3-armies.md`, Decisions 3 and 3b): per-model loadouts and all-weapons melee, engine only. `FighterDefinition.modelLoadouts` and `Model.weaponIds` (absent = carries all); shooting and melee scale each weapon by the living models that carry it and qualify; a shoot allocation for a weapon no living model carries is rejected. Melee strikes with every melee weapon incl. Assault (`fight`, charge strike, strike-back, pile-in strike), one dice batch per weapon (`w1-` purposes), with `outcome.meleeStrikes` per weapon. HUD gaps (unit panel counts, shoot panel firing counts, melee picker, dice panel lines) are PR 1C.
  - [x] 14C-3 PR 1C (plan `doc/plans/14C-3-armies.md`, Decisions 3 and 3b): loadouts and multi-weapon melee in the HUD. The unit list and data card show each weapon with the number of living models carrying it (`2× Rifle`; a weapon whose carriers all died is dropped, no count for a single model); the shoot panel offers only carried weapons and each weapon chip shows how many models fire it at the chosen target (shared `firingModels`); there is no melee weapon choice, the charge confirmation lists every melee weapon with its attacks (`weaponId` is still sent, it is the first melee weapon); the dice panel and log show one line per melee weapon from `outcome.meleeStrikes`. New dev-only TEST army `test-loadouts-army` ("TEST: Loadouts Check") as the manual fixture. HDF itself is PR 1D.
  - [x] 14C-3 PR 1D (plan `doc/plans/14C-3-armies.md`, Decisions 3c and 6): Deadly weapons put their wounds on first when one attack uses several weapons (shooting allocations, melee strikes, strike-back, Counter strikes; dice numbering and log order unchanged, the casualty pick replays in the same order), and the Human Defense Force list (`hdf`: Company Leader 100, Veterans 125, Infantry Squad 120, Sniper 55 = 400 pts, Tough 30) with per-model loadouts, in both lobby pickers (not dev-only; default matchup unchanged). New weapons: Strike, Hand Weapon, Sgt. Hand Weapon, Pistol, Plasma Pistol, Battle Rifle, Grenade Launcher, Sniper Rifle; Plasma Rifle corrected to 24" A4 AP(2). The Force Org harness checks HDF explicitly. **14C-3 PR 1 (1A-1D) is complete.**
  - [x] 14C-3 PR 1E (plan `doc/plans/14C-3-armies.md`, Decision 3d): fixes from the owner's PR 1 pass. Which model carries which weapon is shown (data card per-model list with fixed model numbers and "removed" for dead models, model hover, aim lines labelled with each model's weapons, casualty prompt; placement chips use the same fixed numbers). Squad-mates never block sight is pinned by a regression test (the reported blocking could not be reproduced in the engine paths, see SYSTEMS). New "Test Deadly Squad" in TEST: Loadouts Check (one Fusion Rifle, two Rifles, Tough 3) for the Deadly-first manual check.
  - [x] 14C-3 PR 1F (plan `doc/plans/14C-3-armies.md`): per-model weapons as table sub-headings. For units whose models carry different weapons, the data card's weapons table has a sub-heading row per model (fixed numbers; "Model N — removed" for a dead model) followed by that model's weapon rows; this replaces the "Model N: weapons" lines under the table. Hovering a model highlights its sub-heading and rows. Client UI only.
  - [x] 14C-3 PR 1G (plan `doc/plans/14C-3-armies.md`): data card model headings grouped by identical weapons ("Model 1 / Model 2" then one set of rows), per-model wounds ("Model 2 · 2/3 W") for Tough above 1, squads with identical weapons but Tough above 1 get one heading too, and the yellow header hover line is removed (hover highlights the model's name and its group's rows). New TEST fixture "Test Tough Squad". Client UI only.
  - [x] 14C-2 pathing bugfix (owner playtest): Flying moves are a straight line (`findMoveBlocker` ignores terrain and units along a Flying path and checks only the stop spot: base overlap and the 1" keep-away); `findNavPath`'s no-route fallback no longer returns a path that runs through terrain/stairs; a Rush that stops short of a higher spot because another unit's 1" zone closes the stairs now says "Blocked by another unit" instead of the misleading "Can't reach that height" (HUD hover, single-unit click and squad-model click).
  - [x] 14C-2 keep-away in 3D bugfix (owner, 2026-11-10): the 1" keep-away is the real 3D distance between bases (`keepAwayGap3D`), sampled along the mover's actual height on every path segment; used by move/rush/charge paths, end spots, Flying stops, deployment, group-crossing and push placements, and the red zones (models 1" or more above/below are faint). Melee reach and cross-level coherency unchanged.
  - [x] 14C-2 move preview: Flying indicator and stop note (owner, 2026-11-10; UI only, no rule change): Flying units get a "Flying · X\" · over terrain" chip and a dashed cyan path line; a path that ends short of the cursor says where and why ("Stopped: within 1\" of <unit> (keep-away)", out of movement, difficult terrain cap, can't climb, blocked by terrain) as the hover note and as a label at the stop point, for Advance, Rush, charge legs and squad model picks.
  - [x] 14G UX: squad follow-through (owner, 2026-11-10; no rule change). Place one model of a squad's Advance, Rush or charge and Confirm: the models not yet placed follow (formation kept, each on its own legal path within its own allowance, host validation unchanged). Pure `autoPlaceSquadFollowers` in `engine/squadFollow.ts`; the HUD shows the follower spots as rings from the first placement (memoised), hand-placed models are never moved, and a follower that cannot be placed legally is refused by name. Jump legs and group crossings keep their flow.
- [ ] **14D Rules audit.** Compare the engine, rule by rule, with the core rules and beginner's guide (findings in our own words, no copied rule text) and with `RULES_SPECIFICATION.md`; after 14C the names match one to one. Output: a findings list (match / deviation / missing / house rule), each deviation an owner decision. Known item: hazard tests roll one die per model, not Tough-value dice.
- [ ] **14E Full codebase review.** Review all workspaces for correctness bugs, architecture violations (game logic in scene/HUD, client-trusted values, hardcoded ruleset names), dead code, stale comments and test gaps. Output: a findings list, triaged into bugfix batch 2 or later. Known items: corner-graze line of sight is not symmetric on exact ties; stale crate-footprint comment in `terrainStructures.ts`.
- [ ] **14F Performance.** Profile a full game on the Standard Battlefield with squads, move preview, LoS fan and F9 running; hold 60 fps on standard desktop browsers; add timing guards to the tests for hot paths. (Profile note from the 14C-2 jump follow-ups: `findNavPath` costs about 30-150 ms per call on the Standard Battlefield and `planFollowerCrossing` about 250 ms, so the hover preview now memoises nav plans per 0.1" cell; speeding up `findNavPath` itself and caching follower routing remain open.)
- [ ] **14G Playtest & UX polish.** Full 4-round two-player matches on the Standard Battlefield and custom maps, plus the owner's list of rough edges (HUD clutter, toasts, lobby flow, a short controls / how-to-play card). Findings go into bugfix batch 2.
  - [ ] **Each player picks their own army** (owner, 2026-11-10): today the host chooses both armies in the lobby. Instead each lobby shows one army picker, "Your army": the host picks theirs when creating the room and the guest picks theirs when joining (or in the waiting room before the game starts). The guest's choice is sent to the host over the data channel before setup, and the host validates it (it must be a known army ID; TEST armies come from the guest's own developer mode, which is a convenience, not a lock) before building the game state; the host stays authoritative and both choices are recorded in `GameState.setup` (rematch reuses them). The waiting room shows both players' picks; changing a pick before start is allowed.
  - [ ] **Indicators for distance-gated rules** (owner, 2026-11-10; after 14C-3, when the armies bring Ferocious, Hold the Line, Hive Bond, Bad Shot and so on). Data-driven: each rule in the registry declares its threshold (distance, above/below, measured from the shooter/charger or the target), and the HUD draws them generically with no per-rule code. In order: (1) **target badges** while aiming or charging: the exact distance and which distance rules apply to that attack, e.g. "12.4" · Relentless ✓ (beyond 9") · Stealth −1 (beyond 9")"; (2) **threshold rings** on the range fan (dashed ring at each switch distance of the attacker's own rules, labelled) and the charge equivalent (6"); (3) **auras**: the Hero's 6" morale ring when selecting a nearby unit, and the 3" Blast spread outline when hovering a Blast target.
  - [ ] **Wake-up loading indicator** (owner, 2026-11-10): after a quiet spell the free-tier signaling server (Azure App Service F1) and the GitHub Pages site can take a while to wake up, and the lobby just looks stuck. Show a loading throbber with a short status line (e.g. "Waking up the server, this can take up to a minute…") while the first signaling connection or room create/join is pending, and keep it until the socket opens or a clear error/timeout message replaces it.
  - [x] 14C-2 PR 9B: setup fixes from the owner playtest (plan Decisions 48-49). `activate-unit` and `hold` are rejected for a unit that is not on the table (Ambush reserve, held Scout), and the HUD no longer offers such a unit or counts it in "N available". A game started without the deployment phase now runs the objectives phase too (units stay where they are placed automatically; the last marker records the deployment roll-off and starts round 1 with the winner first); a rematch keeps the objectives and roll-offs.
- [ ] **14G2 UI design pass** (owner, 2026-11-11). Redesign the HUD, lobby and Map Builder as one visual system before the MVP release. Start from the UI inventory in `doc/ux/inventory/index.html` (58 screenshots of every screen, panel and prompt as of 14C-2 PR 9, each with what it is and its purpose, plus 14 design observations; re-take the screenshots when the UI changes). Owner-led: the owner does the design pass and decides the direction; the plan (`doc/plans/14G2-ui-design.md`) then splits the work into small PRs (design tokens and shared components first, then the bottom dock and reaction docks, roster, dice/log, header and setup panel, lobby, Map Builder, results screen). No rule changes. Known items from the inventory: the Dice panel shows an empty attack template during setup; raw action names in the log ("Host concede", "Guest request-rematch"); "Defeat" in the "Your turn" green; long one-paragraph confirm summaries; the data card and prompt bar stacked over the board with the keep-away legend overlapping; enemy roster below the fold and small status tags (Shaken not prominent); toasts, setup panel and debugger pill sharing the top-centre slot; emoji used as icons in some prompts; reaction dock buttons in different orders and colours; units small at the default camera; crowded Map Builder toolbar; results modal over the live HUD; objective score and the "Round N started" toast during setup and before the Ambush step.
- [ ] **14H Docs sync.** Audit every doc in `doc/` against the code (known stale: the default-scenario table in `ASSETS.md`, the old doorway opening in `SYSTEMS.md`), record the 13.6E follow-ups, close `doc/plans/bugfix-playtest-batch-1.md`, and add a short player-facing README section.
- [ ] **14I MVP release.** Release checklist, version tag, deploy on the owner's command (`master` → `release`), and tick the acceptance criteria below.

### Acceptance Criteria
- [ ] Two players can complete full 4-round matches with custom/pre-canned armies and objectives.
- [ ] Either player can concede; the match ends cleanly for both sides.
- [x] Rematch resets the game smoothly without re-entering invite codes.
- [ ] The rules audit and code review findings are resolved or explicitly deferred by the owner.
- [ ] Production build passes all checks and deploys cleanly via GitHub Actions.

## Phase 15: Presentation (post-MVP)
**Goal:** Make the game look and sound finished once the MVP is out. Each item is its own sub-phase with its own plan in `doc/plans/`.

### Sub-phases (to be planned)
- [ ] 15A Audio & SFX: dice rattle/roll sounds, gunfire cues, melee impacts and victory stingers (procedural Web Audio, per AGENTS.md).
- [ ] 15B Texturing: materials and textures for terrain, board and models (low-poly art style).
- [ ] 15C Lighting: scene lighting, shadows and atmosphere.
- [ ] 15D Animations: model movement, attacks, casualties and UI transitions.
- [ ] 15E Terrain visual dressing deferred from 13.6D: chamfered barriers, hazard stripes, round pipes, per-type colours.

## Phase 16: Army Forge Support (post-MVP)
**Goal:** Players bring their own lists from Army Forge instead of only the 4 pre-canned armies. To be planned after the MVP.

### Sub-phases (to be planned)
- [ ] 16A Army Forge roster import (players' own lists), mapped onto the engine's data model.
- [ ] 16B Points budget validation and a simple list check in the lobby.
- [ ] 16C Import/export of rosters as JSON for sharing between players.

## Phase 17: Casters & Spells (post-MVP)
**Goal:** Caster(X), spell tokens, Spell Amplifier and each army's spells, so caster units can join the pre-canned and imported lists. Left out of the MVP (owner, 2026-11-10).

### Sub-phases (to be planned)
- [ ] 17A Spell tokens, casting rolls and the helper +1/-1 tokens within 18".
- [ ] 17B Spells for the four MVP armies, as data.
- [ ] 17C HUD: casting prompt, targeting and the dice log.

## Model Selection
Planning and research use **Opus** in the main session; implementation uses **Sonnet** `implementer` agents, one per PR section of an approved plan in `doc/plans/`. See [AGENTS.md](../AGENTS.md#planning--implementation-workflow-opus-plans-sonnet-implements) and [doc/plans/README.md](plans/README.md). The per-phase "Recommended AI Model" notes above (4.0 / 3.8) date from the earlier toolchain and are historical.

## Future Considerations (Post-v1)
- Optional "smart snap" for movement targets, with a toggle: destinations snap to a 0.5" grid, but rule spots win (edge and ladder stand-off spots, base contact for charges, in-cover positions, objective rings); movement is still measured as a straight line (no grid pathfinding), plus a ghost base showing exactly where the model will stand. Off by default, or user-selectable.
- Full host migration if needed
- Additional terrain types
- More special rules
- Scenario/mission support
- Model conversion pipeline from .STL
- Performance optimizations
- Additional unit types

## Success Metrics
- **Compatibility:** OPR-style skirmish mechanics implemented faithfully (Firefight v3.6 target)
- **Stability:** No desyncs in normal play
- **Usability:** Easy to connect via invite code
- **Performance:** Runs well on desktop browsers
- **Architecture:** Clean separation of concerns maintained throughout
