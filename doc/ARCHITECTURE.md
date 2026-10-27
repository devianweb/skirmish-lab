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

### Folder Structure (Proposed)
```
src/
├── core/
│   ├── GameState.ts      # Pure, serializable game state types & utilities
│   ├── GameEngine.ts     # Host-side validation & state transitions
│   ├── ActionLog.ts      # Action log management
│   └── Rules.ts          # Trench Crusade rule implementations
├── network/
│   ├── SignalingClient.ts # WebSocket connection to signaling server
│   ├── WebRTCClient.ts   # WebRTC peer connection & data channel
│   ├── Protocol.ts       # Message types & serialization
│   └── Heartbeat.ts      # Connection monitoring
├── renderer/
│   ├── SceneManager.ts   # Three.js scene setup
│   ├── CameraController.ts # Camera controls
│   ├── ModelLoader.ts    # Asset loading (low poly)
│   ├── BoardRenderer.ts  # Terrain/board visualization
│   └── UnitRenderer.ts   # Unit model rendering (syncs from game state)
├── ui/
│   ├── Lobby.ts          # Invite code creation/joining
│   ├── HUD.ts            # Game UI, turn info, actions
│   └── DiceRoller.ts     # Display dice results
└── main.ts               # Entry point
```

### Data Flow

1. **User Input** → UI captures action intent
2. **Action Creation** → Create action object, send to host (if guest) or validate locally (if host)
3. **Host Validation** → Host validates against rules, phase legality, range, etc.
4. **State Transition** → If valid, apply to authoritative game state, add to action log
5. **State Broadcast** → Host broadcasts confirmed new state to guest
6. **State Application** → Both peers apply confirmed state to their local game state copies
7. **Render Sync** → Renderer reads from game state and updates Three.js objects to match (one-way binding)

**Critical:** The renderer MUST read from game state. Game state MUST NOT read from Three.js objects.

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
- **CameraController:** Desktop camera controls for viewing the battlefield
- **BoardRenderer:** Renders terrain, trenches, obstacles from game state
- **UnitRenderer:** Creates/updates/removes meshes based on units in game state
- **ModelLoader:** Loads low-poly GLTF/OBJ models (future: converted from .STL)

## Connection Lifecycle

1. **Host creates room:** Client connects to signaling server, requests room creation, gets XXX-XXX code
2. **Guest joins:** Client connects to signaling server, provides room code, joins room
3. **Signaling:** Peers exchange offers/answers and ICE candidates through signaling server
4. **Connection established:** WebRTC data channel opens, signaling server role complete
5. **Gameplay:** All game messages flow over data channel. Heartbeats monitor connection.
6. **Disconnect:** Heartbeat timeout detected, connection lost
7. **Reconnection:** If host reconnects to signaling server with same room code, attempt to re-sync state. Guest has cached snapshot.

## Error Handling & Resilience

- **Heartbeat/Timeout:** Ping/pong over data channel every N seconds, timeout after M missed pongs
- **State validation:** Host validates all actions, rejects invalid actions with reason
- **Desync detection:** Action log + sequence numbers to detect if states diverge
- **Graceful degradation:** Clear UI feedback on connection issues
- **Room cleanup:** Server cleans up expired/inactive rooms

## Technology Decisions Rationale

| Decision | Rationale |
| --- | --- |
| Three.js | Full 3D control, good for viewing models on battlefield, widely used |
| Host-authoritative | Simpler than P2P consensus, prevents cheating, easier to validate against complex rules |
| Turn-based confirmed actions | Fits Trench Crusade's turn structure, easier to sync, less bandwidth, easier to animate |
| Server-rolled dice | Fair for friends without complex crypto, trivial with existing ws server |
| Signaling only server | Minimal attack surface, cheap to host, no game state on server |
| Separate game state from rendering | Critical for serialization, snapshots, reconnection, and maintainability |
| XXX-XXX invite codes | Simple, memorable, direct play without accounts |
