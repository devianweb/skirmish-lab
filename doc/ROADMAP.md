# Roadmap

## Overview
Phased development plan for SkirmishLab, an unofficial OPR-compatible tabletop skirmish engine, with verifiable acceptance criteria. Focus on incremental, testable milestones.

## Phase 0: Project Setup & Documentation
**Goal:** Establish project structure and tooling

### Tasks
- [x] Create document structure (GDD, ARCHITECTURE, NETWORKING, DATA_MODEL, SYSTEMS, ROADMAP)
- [x] Write AGENTS.md with constraints
- [x] Initialize TypeScript projects (frontend + backend)
- [x] Set up build tools (Vite for frontend, tsx/nodemon for backend)
- [x] Set up monorepo structure with workspaces (client, server, shared)
- [x] Install dependencies (Node.js LTS via nvm, TypeScript 7, Vite, Three.js)
- [ ] Configure linting/formatting

### Acceptance Criteria
- [x] `package.json` files for frontend and backend
- [x] TypeScript compiles without errors
- [x] Dev servers can start
- [x] All documentation is in place and reviewed

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
**Goal:** Implement OPR-style skirmish mechanics from first principles

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
- [ ] Fix terrain blocker false positives: eliminate validation of the abstract straight-line path between squad centroids in `actions.ts`.
- [ ] Individual model pathfinding: each constituent squad model runs independent A* pathfinding from its own physical position to its target location in `GameHUD.ts`, navigating around intervening terrain.
- [ ] Enforce live coherency rings ($\le 2.0″$) centered on already-placed squad members during model placement.
- [ ] Validate clearance and movement allowance for each individual model's path in `actions.ts`.
- [ ] Unit and UI tests verifying squads flanking obstacles/cover navigate without triggering false "Move path is blocked by terrain" errors.

### Sub-phase 13.5G: Solid Triangular Ramp (Wedge) Collision & Ladder Deck Arrival (`shared/` & `client/`)
- [ ] Solid triangular ramp geometry: update stairs from passable phantom bounding boxes to solid right-angled triangular prisms (wedges).
- [ ] Update wireframe debug rendering in `MarkerRenderer.ts` (`F9` overlay) to render triangular prism wireframes showing the true incline profile from foot to head instead of an AABB cuboid.
- [ ] Impassable sides/risers with continuous sloped surface: stair sides and rear walls block movement, while the sloped hypotenuse surface calculates continuous height $y(t) = y_{\text{foot}} + t(y_{\text{head}} - y_{\text{foot}})$ without synthetic waypoint teleporters.
- [ ] Tabletop ladder rules enforcement: models scaling vertical ladders must have sufficient movement budget to reach the landing platform deck; if movement is insufficient, the model remains at the ladder foot rather than hanging suspended on rungs. Models traversing stair ramps may stop along the slope.
- [ ] Unit tests for wedge collision, continuous ramp elevation, and vertical ladder completion constraints.

### Sub-phase 13.5H: Consolidated Verification Checklist & End-to-End Validation
- [ ] Update `doc/manual-testing/PLAYTEST_VERIFICATION_CHECKLIST.md` with accurate force names (*Frontier Wardens* and *Rust Raiders*) and actual unit rosters.
- [ ] Create streamlined, step-by-step test cases for each 13.5 sub-phase mechanic (interactive consolidation, 3D objective cylinder, split fire, stair pathfinding, sequential squad movement, incremental movement budget, obstacle flanking, and triangular ramp traversal).
- [ ] Verify test suite passes locally across all workspaces.

### Acceptance Criteria
- [x] Wiping out an enemy in melee triggers an interactive 3.0″ consolidation move.
- [x] Ground crates cannot be seized by models on rooftops $> 3.0″$ vertically above them.
- [x] Objective marker uses Kenney `crate-medium.glb`.
- [x] Units with multiple ranged weapons can allocate weapons to different enemy targets with concentric range rings rendered.
- [x] Pathfinding to elevated platforms routes non-airborne units up stairs/ladders at 1:1 cost without sheer air climbs.
- [x] Multi-model squads can be moved model-by-model with visible 2.0″ coherency circles, and model count is shown in the HUD.
- [x] Units can make incremental micro-moves within their activation until movement budget (6.0″ move or 12.0″ rush) is exhausted, and shooting closes the movement window.
- [ ] Multi-model squad movement paths individual constituent models around obstacles without triggering centroid terrain blocking false positives.
- [ ] Stairs render as triangular prism wireframes and compute continuous sloped elevation without synthetic waypoint hacks, and vertical ladders require reaching the deck.
- [ ] Consolidated verification checklist accurately reflects actual armies and verified mechanics.

## Phase 14: Polish, Audio & Release Hardening
**Goal:** Final UX polish, audio effects, rematch flow, and release deployment.

> **Recommended AI Model:** **3.8** *(Web Audio triggers, rematch UI resets, CSS polish, and release profiling)*

### Tasks
- [ ] Audio & SFX: Dice rattle/roll sounds, laser/gunfire audio cues, melee impact clangs, and victory stingers.
- [ ] "Play Again" / rematch flow on game-over screen (resets match over existing P2P channel).
- [ ] End-to-end playtesting with two clients across varied terrain layouts.
- [ ] Performance profiling: ensure 60fps on standard desktop browsers with full 3D terrain.
- [ ] Documentation updates (sync all docs with final feature set).
- [ ] Deployment to release branch (GitHub Pages client + Azure App Service server).

### Acceptance Criteria
- [ ] Two players can complete full 4-round matches with audio, custom/pre-canned armies, and objectives.
- [ ] Rematch resets the game smoothly without re-entering invite codes.
- [ ] Production build passes all checks and deploys cleanly via GitHub Actions.

## Recommended AI Model Selection by Phase

To optimize performance, reasoning depth, and token/quota usage across development:
- **Use 4.0** for **distributed networking, complex state machines, 3D spatial geometry, and formation math** where edge-case bugs cause multiplayer desyncs.
- **Use 3.8** for **standard game rules, data packs, UI views, straightforward event handling, and test expansion**, achieving faster turnaround while conserving 4.0 quota.

| Phase | Recommended Model | Primary Complexity Driver | Rationale |
| :--- | :---: | :--- | :--- |
| **Phase 6.5: Interactive Reactions & Interruption Framework** | **4.0** | Asynchronous P2P state machine, timing, anti-griefing | Shifting from a single-actor turn to an interrupted, bi-directional negotiation across WebRTC requires airtight state reconciliation, timeout edge cases, and host validation. |
| **Phase 7: Objectives & 4-Round Mission Engine** | **3.8** | Game state entity, 3″ distance checks, round clock, 3D beacon | The logic is clean and additive: placing 3–5 beacons, computing standard 2D distance checks at round end, and tracking integer victory points. |
| **Phase 8: All-Weapon Firing & Split Fire** | **3.8** | Multi-target dice loop & UI chips | Mostly refactoring `actions.ts` and HUD targeting chips to loop over an array of equipped weapons rather than a single weapon ID. |
| **Phase 9: Multi-Model Squads & Coherency Engine** | **4.0** | 3D multi-model formation pathfinding & coherency geometry | High mathematical complexity: multi-mesh group rendering in Three.js, maintaining 1″ model / 6″ squad coherency around clearance corners, and squad casualty cascades. |
| **Phase 10: Interactive Deployment & Pre-Canned Starter Armies** | **3.8** | Pre-canned data packs & deployment boundary checks | Writing point-balanced starter rosters is pure data; deployment is straightforward 2D boundary validation. |
| **Phase 11: Environmental Terrain Dynamics & Verticality** | **4.0** | 3D raycasting, elevation platforms, falling physics | Requires true 3D spatial math: multi-level elevation navigation, vertical drops, gap jumps, and falling damage calculations. |
| **Phase 12: Reconnection & Network Resilience** | **4.0** | WebRTC socket recovery, IndexedDB snapshots, state desync recovery | Critical networking & distributed state: recovering connection drops, re-syncing action logs, and snapshot handshakes without dropping the game room. |
| **Phase 13: Custom Map Editor & Presets** | **3.8** | Visual 3D scene editing, snap tools, localStorage | Drag-and-drop 3D asset placement, elevation stepping, and map schema serialization. |
| **Phase 13.5: Tactical Combat & Movement Refinements** | **4.0** | 3D surface pathfinding, sequential squad state machine, split-targeting UI, movement budgeting | Requires 3D spatial geometry for stairs/ramps, sequential model movement UX, multi-move budgeting, and multi-weapon target allocation. |
| **Phase 14: Polish, Audio & Release Hardening** | **3.8** | Web Audio / SFX, rematch UI reset, CSS styling, release CI/CD | Straightforward browser audio triggers, rematch state reset, visual polish, and performance profiling. |

> [!TIP]
> **Hybrid Workflow within a Phase:** For 4.0 phases (such as Phase 6.5 and Phase 9), kick off with 4.0 to design the shared state schema and core engine functions in `shared/`, then switch to 3.8 to build the Three.js visual rendering, HTML/CSS HUD components, and supplementary unit tests.

## Future Considerations (Post-v1)
- Custom army roster importer & builder (clean-room JSON import/export, points budget validation, and Army Forge plain-text roster parsing)
- Full host migration if needed
- Additional terrain types
- More special rules
- Scenario/mission support
- Model conversion pipeline from .STL
- Performance optimizations
- Additional unit types

## Success Metrics
- **Compatibility:** OPR-style skirmish mechanics implemented faithfully from first principles
- **Stability:** No desyncs in normal play
- **Usability:** Easy to connect via invite code
- **Performance:** Runs well on desktop browsers
- **Architecture:** Clean separation of concerns maintained throughout
