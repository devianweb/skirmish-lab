# Roadmap

## Overview
Phased development plan for Trench Heresy browser game with verifiable acceptance criteria. Focus on incremental, testable milestones.

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
- [ ] Implement RoomManager with XXX-XXX code generation
- [ ] Implement SignalingServer for WebSocket connections
- [ ] Room creation/joining logic
- [ ] SDP/ICE message relay
- [ ] DiceRoller with server-side RNG
- [ ] Room expiration and cleanup
- [ ] Basic error handling

### Acceptance Criteria
- [ ] Server can generate unique XXX-XXX room codes
- [ ] Host can create room, guest can join with code
- [ ] SDP offers/answers relayed correctly
- [ ] ICE candidates relayed correctly
- [ ] Dice rolls generated server-side and broadcast to both peers
- [ ] Rooms expire after inactivity
- [ ] Server handles disconnections gracefully

## Phase 2: WebRTC P2P Connection
**Goal:** Establish peer-to-peer connection between clients

### Tasks
- [ ] SignalingClient (WebSocket to signaling server)
- [ ] WebRTCClient (RTCPeerConnection, data channel)
- [ ] Connection flow implementation
- [ ] Message serialization/deserialization
- [ ] Heartbeat/ping-pong system
- [ ] Connection state management
- [ ] Basic UI for lobby (create/join room)

### Acceptance Criteria
- [ ] Host can create room and see code
- [ ] Guest can enter code and join
- [ ] WebRTC connection establishes successfully
- [ ] Data channel opens
- [ ] Heartbeats work, disconnection detected
- [ ] Signaling server no longer needed after connection
- [ ] Connection works on desktop browsers

## Phase 3: Core Game State & Host Authority
**Goal:** Implement game state model and host-authoritative architecture

### Tasks
- [ ] Implement GameState types (from DATA_MODEL.md)
- [ ] GameEngine with validation framework
- [ ] Action log implementation
- [ ] State transition logic
- [ ] Host: validate actions, apply to state, broadcast updates
- [ ] Guest: send action requests, apply state updates
- [ ] Snapshot system (guest caches state)
- [ ] Action serialization

### Acceptance Criteria
- [ ] Game state is fully serializable
- [ ] No Three.js objects in game state
- [ ] Host validates all actions
- [ ] Guest cannot apply actions directly
- [ ] State updates flow correctly host → guest
- [ ] Action log tracks all confirmed actions
- [ ] Guest caches snapshots after state updates
- [ ] State round-trips through JSON correctly

## Phase 4: Three.js Rendering Foundation
**Goal:** Set up 3D rendering decoupled from game state

### Tasks
- [ ] SceneManager setup
- [ ] CameraController (desktop controls)
- [ ] BoardRenderer
- [ ] UnitRenderer (syncs from game state)
- [ ] ModelLoader for low-poly models
- [ ] Lighting setup
- [ ] Basic board/terrain rendering
- [ ] State-driven rendering (game state → renderer)

### Acceptance Criteria
- [ ] Three.js scene renders
- [ ] Camera can be controlled
- [ ] Units rendered from game state data
- [ ] Renderer reads from game state only
- [ ] Game state never modified by renderer
- [ ] Low-poly models load correctly
- [ ] Performance acceptable for desktop

## Phase 5: Basic Gameplay & UI
**Goal:** Implement turn-based gameplay flow

### Tasks
- [ ] Lobby UI
- [ ] Game HUD (turn, phase, player info)
- [ ] Action selection UI
- [ ] Unit selection
- [ ] Action confirmation (no real-time dragging)
- [ ] Turn/phase management
- [ ] Dice result display
- [ ] Basic action types (move, end turn, end phase)

### Acceptance Criteria
- [ ] Players can connect and start game
- [ ] Turn-based flow works
- [ ] Actions require confirmation
- [ ] Only confirmed actions sent to host
- [ ] Dice results displayed to both players
- [ ] UI reflects current game state
- [ ] Phase transitions work

## Phase 6: Trench Heresy Rules Implementation
**Goal:** Implement core rules as faithfully as possible

### Tasks
- [ ] Movement rules and validation
- [ ] Shooting rules (to-hit, to-wound, save, damage)
- [ ] Fight/melee rules
- [ ] Phase-specific rules
- [ ] Unit activation
- [ ] Line of sight and targeting
- [ ] Special rules framework
- [ ] Weapon profiles
- [ ] Army/unit data structures

### Acceptance Criteria
- [ ] Movement validated correctly by host
- [ ] Shooting combat resolved correctly
- [ ] Melee combat resolved correctly
- [ ] Dice rolls go through server
- [ ] All rolls visible to both players
- [ ] Rules enforced by host validation
- [ ] Combat follows Trench Heresy mechanics
- [ ] Game follows proper phase order

## Phase 7: Reconnection & Resilience
**Goal:** Handle disconnections and reconnection

### Tasks
- [ ] Heartbeat timeout detection
- [ ] Disconnect UI/handling
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
- [ ] UI/UX polish
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
- **Faithfulness:** Rules implemented as accurately as possible
- **Stability:** No desyncs in normal play
- **Usability:** Easy to connect via invite code
- **Performance:** Runs well on desktop browsers
- **Architecture:** Clean separation of concerns maintained throughout
