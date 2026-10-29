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
  - [x] Explicit Trauma Table math display (`roll X + Y tokens = Z — need 6+ to KO`) and unsaved wounds vs trauma tokens summary line.
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

## Phase 7: Reconnection & Resilience
**Goal:** Handle disconnections and reconnection

### Tasks
- [ ] Heartbeat timeout detection
- [x] Disconnect UI/handling (top-banner notification when opponent peer disconnects/reconnects or when signaling room connection drops)
- [ ] Snapshot storage and retrieval
- [ ] Reconnection flow
- [ ] State re-sync on reconnection
- [ ] Room rejoin logic
- [ ] Handle host reconnection

### Acceptance Criteria
- [ ] Disconnect detected via heartbeat timeout
- [ ] Guest has cached snapshot
- [ ] Host can reconnect to same room
- [ ] Game state re-synced after reconnection
- [ ] Play can resume from last confirmed state
- [ ] No state corruption on disconnect/reconnect
- [ ] Clear UI feedback during reconnection

## Phase 8: Polish & Testing
**Goal:** Testing, bug fixes, and polish

### Tasks
- [ ] End-to-end testing with two clients
- [ ] Test reconnection scenarios
- [ ] Test dice rolling fairness
- [ ] Test action validation
- [ ] Performance testing
- [ ] UI/UX polish (connection status indicators & top-banner alerts for peer/room disconnects)
- [ ] "Play Again" / rematch option on the game-over screen (reset game state over the existing peer connection without returning to the lobby)
- [ ] Bug fixes
- [ ] Documentation updates

### Acceptance Criteria
- [ ] Two players can complete a full game
- [ ] Reconnection works reliably
- [ ] No desyncs observed
- [ ] All actions properly validated
- [ ] Dice rolls are fair (server-side)
- [ ] Game is playable on desktop browsers
- [ ] Documentation is complete and accurate

## Future Considerations (Post-v1)
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
