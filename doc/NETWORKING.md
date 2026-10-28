# Networking Document

## Overview
This document details the networking architecture for the SkirmishLab browser game: WebRTC P2P for gameplay, custom Node.js + ws signaling server, invite codes, host authority, and reconnection.

## Signaling Server

### Technology
- **Runtime:** Node.js with TypeScript
- **WebSocket Library:** `ws`
- **Purpose:** Strictly signaling only - SDP/ICE exchange and server-rolled dice

### Room System
- **Code Format:** XXX-XXX (e.g., ABC-123, using alphanumeric characters)
- **Generation:** Random generation on host request
- **No Matchmaking:** Direct invite only
- **Ephemeral:** Rooms expire after inactivity or when game ends
- **Cleanup:** Server periodically cleans up expired rooms

### Room Lifecycle
1. Host requests room creation → Server generates unique XXX-XXX code → Room created with host
2. Guest joins with code → Server adds guest to room → Both peers notified
3. Signaling exchange occurs (offer/answer/ICE) → Peers establish WebRTC connection
4. Once data channel open, server no longer relays game messages
5. Room expires on inactivity timeout or explicit game end
6. Server removes room and cleans up resources

### Room Expiration Rules
- **Inactivity:** No signaling activity for 5 minutes (`inactivityTimeout = 5 * 60 * 1000`)
- **Disconnect Grace Window:** If host or guest disconnects, the room is preserved for 5 minutes (`graceTimeout = 5 * 60 * 1000`) rather than destroyed immediately, allowing reboots or temporary socket drops to recover without losing the session
- **Post-game:** Room expires after game ends + grace period
- **Max lifetime:** Absolute maximum room lifetime (3 hours) as safety measure

## WebRTC Connection

### Configuration
- **Connection Type:** Peer-to-peer via WebRTC
- **Channel:** Reliable data channel for game messages (ordered, guaranteed delivery)
- **Signaling:** ICE candidates and SDP exchanged via WebSocket server
- **STUN/TURN:** May need STUN servers for NAT traversal; TURN only if necessary

### Connection Flow
```
1. Host: createPeerConnection() → createDataChannel() → createOffer() → send to signaling server
2. Signaling: relay offer to guest
3. Guest: setRemoteDescription(offer) → createAnswer() → send to signaling server
4. Signaling: relay answer to host
5. Host: setRemoteDescription(answer)
6. Both: exchange ICE candidates via signaling server
7. Data channel opens → connection established → signaling can be idle
```

## Message Protocol

All messages are JSON serialized. Messages flow over WebRTC data channel for gameplay, WebSocket for signaling.

### Signaling Messages (WebSocket)
```typescript
type SignalingMessage =
  | { type: 'create-room' }
  | { type: 'room-created', code: string }
  | { type: 'join-room', code: string }
  | { type: 'room-joined', code: string, role: 'host' | 'guest' }
  | { type: 'peer-joined' }
  | { type: 'offer', sdp: RTCSessionDescriptionInit }
  | { type: 'answer', sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate', candidate: RTCIceCandidateInit }
  | { type: 'error', message: string }
  | { type: 'roll-dice-request', rollId: string, dice: DiceSpec[] }
  | { type: 'roll-dice-result', rollId: string, results: DiceResult[] }
```

### Game Messages (WebRTC Data Channel)
```typescript
type GameMessage =
  | { type: 'action-request', action: GameAction }      // Guest → Host
  | { type: 'action-rejected', actionId: string, reason: string } // Host → Guest
  | { type: 'state-update', state: GameState, actionId: string } // Host → Guest
  | { type: 'heartbeat-ping', timestamp: number }
  | { type: 'heartbeat-pong', timestamp: number }
  | { type: 'request-snapshot' }                         // Guest → Host (if needed)
  | { type: 'snapshot', state: GameState }              // Host → Guest
  | { type: 'game-end', reason: string }
```

### Message Routing Rules
- **Signaling Server:** Only routes signaling messages and dice roll requests/results. Never routes game messages.
- **Host:** Receives action-requests from guest, validates, sends state-update or action-rejected
- **Guest:** Sends action-requests to host, applies state-updates from host, caches snapshots
- **Dice:** Any peer can request dice roll via signaling server, server rolls and broadcasts result to both peers

## Host Authority Model

### Authority Rules
- **Source of Truth:** Host's game state is authoritative
- **Validation:** All actions must be validated by host against the rules engine
- **Guest Actions:** Guest sends intent as `action-request`, never applies actions directly
- **Confirmation:** Only host can produce `state-update` messages with confirmed state
- **Rejection:** Host can reject invalid actions with reason

### Action Flow
```
Guest wants to move unit:
1. Guest creates GameAction { type: 'move-unit', unitId, destination, ... }
2. Guest sends action-request to Host over data channel
3. Host receives, validates:
   - Is it guest's turn? Correct phase?
   - Is unit owned by guest?
   - Is move legal per rules (movement, terrain, etc.)?
   - Are all prerequisites met?
4. If invalid: Host sends action-rejected with reason
5. If valid: Host applies action to authoritative state, adds to action log
6. Host broadcasts state-update with new state to Guest
7. Guest applies state-update to its local copy
8. Both renderers update from new game state
```

### Game Start Flow (Phase 5, as shipped)
```
1. Both peers complete the WebRTC handshake; the first heartbeat proves
   the channel is alive → Lobby fires onPeerReady exactly once
2. Both clients construct GameManager (host also with a
   SignalingDiceProvider) and wire GameManager.onStateUpdate →
   GameView + GameHUD
3. Host calls GameManager.startGame(): creates initial state, applies the
   default scenario data pack, broadcasts state-update ("game-start")
4. Guest receives the starting state; both HUDs render "your turn" for
   the host (round 1 starter)
5. Signaling keep-alive pings begin; the P2P game is live
```

Player IDs are deterministic (`player-host` / `player-guest` in shared),
so both peers know their local identity without negotiation.

## Dice Rolling

### Server-Authoritative RNG
- **Location:** Signaling server (`DiceRoller.ts`)
- **Method:** Use Node's `crypto.randomInt()` or secure RNG
- **Flow:** Request → Server rolls → Broadcast to both peers simultaneously

### Dice Message Flow
```typescript
// When roll needed (e.g., to-hit)
1. Host determines roll needed: { count: 2, sides: 6, purpose: 'to-hit' }
2. Host sends roll-dice-request to signaling server with rollId
3. Server generates random results using secure RNG
4. Server sends roll-dice-result to both host and guest simultaneously
5. Both peers display and apply results to game state resolution
```

### Phase 5 Dice Flow (as shipped)
The host client drives attack resolution (`SignalingDiceProvider` +
`GameManager`):

```
1. Attacker confirms a shoot/fight action in the HUD
2. HUD → GameManager.sendAction (host: local; guest: action-request over
   the data channel)
3. Host validates the action first — illegal actions never spend a roll
4. Host computes the dice specs (N to-hit + N defense d6) and sends
   roll-dice-request with rollId = the action id
5. Server rolls (crypto RNG) and broadcasts roll-dice-result to both peers
6. Host resolves deterministically, attaches the DiceResolution to the
   action log entry, and broadcasts state-update
7. Both peers' HUDs render the dice panel from the confirmed state
```

The host processes one action at a time; actions arriving while dice are
in flight are rejected with "Another action is being processed".

### Signaling Keep-Alive & Auto-Reconnect
Once gameplay runs over the data channel, the signaling WebSocket sees no
natural traffic — but dice requests still need the room to exist on the
server. Clients therefore ping the signaling server every 25 s
(`SignalingClient.startKeepAlive(intervalMs = 25000)`). A 25s interval ensures
connections stay active under Azure App Service's 230-second TCP idle proxy
timeout even when browsers aggressively throttle timers in background tabs.
The server's `ping` handler refreshes room activity, preventing mid-game
inactivity cleanup.

If the WebSocket disconnects unexpectedly (e.g. WiFi hiccup or Azure socket recycling),
`SignalingClient` automatically reconnects and issues `reconnect-room` to re-bind
to its active room slot.

### Resilient Server-Rolled Dice
To prevent actions from hanging or failing if a temporary disconnect occurs right
as an attack is submitted:
1. `SignalingDiceProvider` verifies connection state via `isConnected()`, and calls
   `ensureConnected()` to initiate an immediate reconnect if needed.
2. The roll request automatically re-transmits every 2 seconds (up to 3 retries) with
   the same `rollId` if no answer has arrived yet.
3. The signaling server caches recent roll results by `rollId` (`room.rollCache`),
   ensuring that roll requests are strictly idempotent: retries return the exact
   same dice values rather than re-rolling.
4. Total timeout is 10 seconds before rejecting the action.

### Dice Types
Support standard dice: d6, d3, etc. as needed by the rules engine (d6 core resolution).

## Snapshots & Reconnection

### Snapshot Strategy
- **When to Snapshot:** After every confirmed action, after phase changes
- **Who Stores:** Guest caches full serialized game state as snapshots
- **Format:** Plain JSON, fully serializable (must match DATA_MODEL.md)
- **Purpose:** Recovery if host drops and comes back, potential rehosting (v1: recovery focused)

### Reconnection Flow
```
1. Connection drops (heartbeat timeout detected)
2. UI shows disconnected state
3. If host drops: Guest keeps last snapshot cached; server preserves room in 5-min grace window
4. Host reconnects to signaling server with { type: 'reconnect-room', code, role: 'host' }
5. Signaling server re-links host WebSocket to existing room
6. Peers re-establish WebRTC connection through signaling
7. Host sends current authoritative state to guest (or guest has snapshot)
8. Game resumes from last confirmed state
```

### Reconnection Rules (v1)
- **Host Authority:** Host remains authoritative source of truth
- **Guest Recovery:** Aim to rejoin host's state if host reconnects
- **No Auto-Migration:** Don't implement full guest-takeover for v1
- **State Sync:** On reconnection, host sends full state snapshot to guest
- **Room Persistence:** 5-minute grace window preserves room on server during reconnection attempts

## Connection Monitoring

### Heartbeats
- **Frequency:** Send heartbeat-ping every 2-5 seconds over data channel
- **Timeout:** Consider disconnected after 3-5 missed pongs
- **Implementation:** Track last pong timestamp, check periodically
- **Purpose:** Detect ICE disconnects/failures (can be finnicky)

### Heartbeat Protocol
```typescript
// Every interval
send({ type: 'heartbeat-ping', timestamp: Date.now() })

// On receive ping
send({ type: 'heartbeat-pong', timestamp: ping.timestamp })

// On receive pong
updateLastPongTime(Date.now())

// Monitor loop
if (now - lastPongTime > timeout) {
  handleDisconnect()
}
```

## Security Considerations

- **Server RNG:** Dice rolls use server-side RNG, can't be manipulated by clients
- **Host Validation:** All actions validated server-side (on host), guest can't cheat by sending invalid actions
- **Signaling Only:** Game state never goes through signaling server
- **No Authentication:** Acceptable for friends playing direct invites
- **Room Codes:** Random enough for casual use, not cryptographically secure (not needed)
- **P2P:** Direct connection after signaling, no relay of game traffic

## Configuration

### Signaling Server Config
```typescript
{
  port: 8080,
  roomCodeLength: 6,        // XXX-XXX format
  roomInactivityTimeout: 300000, // 5 minutes
  roomGraceTimeout: 300000,      // 5 minutes disconnect grace window
  roomMaxLifetime: 10800000,     // 3 hours
  cleanupInterval: 60000         // 1 minute
}
```

### Client Config
```typescript
{
  heartbeatInterval: 3000,   // 3 seconds
  heartbeatTimeout: 10000,   // 10 seconds
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
}
```
