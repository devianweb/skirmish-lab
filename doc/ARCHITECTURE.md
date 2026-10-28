# Architecture Document

## Overview
This project is split into two main components: a frontend (browser-based Three.js client) and a backend (Node.js + TypeScript + ws signaling server). All gameplay is conducted over P2P WebRTC with the signaling server only used for initial connection establishment.

## High-Level Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Host Client   │         │ Signaling Server │         │  Guest Client   │
│   (Three.js)    │◄───ws──►│  (Node + ws)     │◄───ws──►│   (Three.js)    │
└─────────┬───────┘         └──────────────────┘         └─────────┬───────┘
          │                                                           │
          │                    WebRTC Data Channel                   │
          └───────────────────────────◄──►───────────────────────────┘
                        (Game State, Actions, Dice Results)
```

## Core Principles

- **Separation of Concerns:** Game state and game logic are completely decoupled from Three.js rendering. The renderer is purely a view layer.
- **Host Authoritative:** The host is the single source of truth. All actions are sent to the host, validated, and only confirmed state is broadcast.
- **Serializable State:** All game state must be JSON serializable. No Three.js objects, classes with methods, or non-serializable data in the game state.
- **Signaling Only:** The WebSocket server has no knowledge of game rules. It only facilitates WebRTC negotiation and server-rolled dice.
- **Turn-Based:** Confirmed actions only. No real-time synchronization of dragging/movement.

## Frontend Architecture

### Folder Structure (as of Phase 5)
```
shared/src/
├── engine/                    # Pure rules logic (host-authoritative)
│   ├── activation.ts          # Alternating activations & round management
│   ├── combat.ts              # Q/D d6 resolution from server dice
│   └── actions.ts             # Action validation + application
├── data/                      # Data packs (no engine logic)
│   ├── weapons.ts             # Weapon profiles
│   ├── armies.ts              # Fighter definitions, two original armies
│   └── scenario.ts            # Default deployment + terrain layout

src/                           # client/src
├── core/
│   └── GameManager.ts        # Host authority, engine application, dice orchestration
├── network/
│   ├── SignalingClient.ts     # WebSocket connection to signaling server (+ keep-alive)
│   ├── SignalingDiceProvider.ts # Server-rolled dice for the host
│   ├── WebRTCClient.ts        # WebRTC peer connection & data channel
│   └── Protocol.ts            # Message types & serialization
├── renderer/
│   ├── SceneManager.ts        # Three.js scene setup
│   ├── CameraController.ts    # Desktop camera controls
│   ├── ModelLoader.ts         # Asset loading + GLB registry with placeholder swap
│   ├── assetManifest.ts       # Curated CC0 (Kenney) asset mappings
│   ├── BoardRenderer.ts       # Terrain/board visualization
│   ├── UnitRenderer.ts        # Unit models (syncs from game state) + raycast picking
│   ├── MarkerRenderer.ts      # Selection/target/range markers, outcome tokens
│   └── GameView.ts            # State-driven facade + click picking
├── ui/
│   ├── Lobby.ts               # Invite code creation/joining, peer-ready handoff
│   └── GameHUD.ts             # Turn info, action selection, confirmation, dice display
└── main.ts                    # Entry point: wires Lobby → GameManager → GameView + HUD
```

### Data Flow

1. **User Input** → UI captures action intent
2. **Action Creation** → Create action object, send to host (if guest) or validate locally (if host)
3. **Host Validation** → Host validates against rules, phase legality, range, etc.
4. **State Transition** → If valid, apply to authoritative game state, add to action log
5. **State Broadcast** → Host broadcasts confirmed new state to guest
6. **State Application** → Both peers apply confirmed state to their local game state copies
7. **Render Sync** → Renderer reads from game state and updates Three.js objects to match (one-way binding)

**Critical:** the renderer MUST read from game state. Game state MUST NOT read from Three.js objects.

### Phase 5 Flow (as shipped)
```
Lobby (onPeerReady) ─► GameManager ── GameHUD (submit confirmed actions)
        │                   │   ▲               │
        │            (host) validate ──► shared engine (validateAction)
        │            (host) dice ──► SignalingDiceProvider ──► signaling server
        │            (host) applyAction ──► new state ──► broadcast + emit
        ▼                   ▼
  SignalingClient    GameManager.onStateUpdate ──► GameView.syncFromState
  (keep-alive ping)                                     │
                                                  scene + markers
  GameView.onPick(board click) ──► GameHUD.handleBoardPick (selection/targeting)
```

Only confirmed actions leave the HUD; the host processes one action at a
time (dice requests are awaited); rejections surface to both peers.

## Backend Architecture (Signaling Server)

### Folder Structure (Proposed)
```
server/
├── RoomManager.ts       # Room creation, lookup, cleanup, expiration
├── SignalingServer.ts   # WebSocket server, message routing
├── DiceRoller.ts        # Server-side RNG for dice rolls
├── Room.ts              # Room state (host/guest, timers)
└── index.ts             # Server entry point
```

### Responsibilities
- Create/join rooms with XXX-XXX codes
- Relay SDP offers/answers between peers
- Relay ICE candidates between peers
- Generate and broadcast dice rolls on request
- Handle room expiration (inactivity timeout, game end)
- Clean up disconnected rooms
- Heartbeat/health monitoring

**Not Responsible For:** Game rules, game state validation, move legality, storing full game state long-term (beyond room lifecycle).

## State Management Strategy

### Game State Structure
See [DATA_MODEL.md](./DATA_MODEL.md) for full schema. Key points:
- All data is plain objects/arrays/primitives
- No references to Three.js objects
- Includes turn state, phase, units, board, action log, etc.
- Fully serializable to JSON

### Snapshots
- Host maintains authoritative state at all times
- Guest caches a full serialized copy of game state after every confirmed action and phase change
- Snapshots are stored as plain JSON objects
- Used for potential rehosting if guest needs to take over (v1: just for recovery if host comes back)

### Action Log
- Array of all confirmed actions in order
- Each action has ID, timestamp, actor, type, payload
- Can be used to replay from snapshot for debugging/resilience
- Helps detect desyncs

## Three.js Integration

### Rendering Philosophy
- **One-way data flow:** `GameState` → `Renderer` (never reverse)
- **State-driven:** When game state changes, renderer diffs and updates scene
- **Separation:** Unit positions, rotations, etc. come from game state, not from mesh transforms as source of truth
- **Performance:** Use instancing where possible, low poly models

### Key Components
- **SceneManager:** Initializes Three.js scene, camera, lighting, renderer
- **CameraController:** Desktop camera controls for viewing the battlefield, with player-perspective positioning:
  - Host views from South isometric corner `(20, 20, -20)` looking north (+z) over friendly forces
  - Guest views from North isometric corner `(-20, 20, 20)` looking south (-z) over friendly forces
- **BoardRenderer:** Renders terrain, trenches, obstacles from game state (registered terrain types render as curated GLB models)
- **UnitRenderer:** Creates/updates/removes meshes based on units in game state; provides raycast picking for the unit layer
- **ModelLoader:** Loads and caches GLTF models; hosts a unit/terrain/marker asset registry — registered types get a procedural placeholder that swaps to the GLB clone once loaded (per-instance geometry/materials keep tinting and disposal safe)
- **assetManifest:** Maps fighter roles, terrain types, and UI markers to curated CC0 (Kenney prototype kit) GLBs in `client/public/models/`
- **MarkerRenderer:** Gameplay UI markers — selection and target indicators, movement-range ring, auto-clearing wound outcome tokens (GLB with procedural fallbacks)
- **GameView:** State-driven rendering facade — the single entry point that turns game state into a scene (board/terrain rebuilt only on change, units diffed every sync), plus click picking (units and ground positions, camera drags filtered out). The renderer layer is injectable for tests, so scene logic is testable without WebGL
- **GameHUD:** In-game overlay — round/turn info, unit list, action selection with explicit confirmation for every action, dice result and action log panels; driven purely by confirmed state

## Connection Lifecycle

1. **Host creates room:** Client connects to signaling server, requests room creation, gets XXX-XXX code
2. **Guest joins:** Client connects to signaling server, provides room code, joins room
3. **Signaling:** Peers exchange offers/answers and ICE candidates through signaling server
4. **Connection established:** WebRTC data channel opens; signaling WebSocket switches to 25s keep-alive mode for server dice requests
5. **Gameplay:** All game movements, selection, and turn events flow over P2P data channel; attacks request authoritative server dice rolls via signaling server
6. **Disconnect & Grace Window:** If signaling connection drops, server preserves room for a 5-minute grace window; client auto-reconnects with `reconnect-room`
7. **Reconnection & Idempotent Rolls:** Host and guest can reclaim room slots; dice rolls retry automatically and use server-cached roll results

## Error Handling & Resilience

- **Heartbeat/Timeout:** Ping/pong over data channel every N seconds, timeout after M missed pongs
- **Signaling Keep-Alive & Auto-Reconnect:** 25s ping interval beats Azure proxy timeouts; automatic client reconnection
- **Room Grace Period:** 5-minute server grace window protects against dropped connections, Wi-Fi blips, and reboots
- **Idempotent Dice Retries:** Combat actions retry server dice requests every 2s before timing out, backed by server roll caching
- **State validation:** Host validates all actions, rejects invalid actions with reason
- **Desync detection:** Action log + sequence numbers to detect if states diverge
- **Graceful degradation:** Clear UI feedback on connection issues
- **Room cleanup:** Server cleans up expired/inactive rooms

## Technology Decisions Rationale

| Decision | Rationale |
| --- | --- |
| Three.js | Full 3D control, good for viewing models on battlefield, widely used |
| Host-authoritative | Simpler than P2P consensus, prevents cheating, easier to validate against complex rules |
| Turn-based confirmed actions | Fits alternating-activation turn structure, easier to sync, less bandwidth, easier to animate |
| Server-rolled dice | Fair for friends without complex crypto, trivial with existing ws server |
| Signaling only server | Minimal attack surface, cheap to host, no game state on server |
| Separate game state from rendering | Critical for serialization, snapshots, reconnection, and maintainability |
| XXX-XXX invite codes | Simple, memorable, direct play without accounts |

## Phase 2 Implementation (Completed)
- Frontend WebRTC client implemented with RTCPeerConnection and data channel
- Signaling client connects to ws server for room creation/joining and SDP/ICE exchange
- Lobby UI for creating/joining rooms with XXX-XXX codes
- Heartbeat/ping-pong over data channel for connection monitoring
- Connection flow: host creates offer, guest answers, ICE candidates exchanged
