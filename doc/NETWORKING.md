# Networking Document

## Overview
This document details the networking architecture for Trench Heresy browser game: WebRTC P2P for gameplay, custom Node.js + ws signaling server, invite codes, host authority, and reconnection.

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
- **Inactivity:** No signaling activity for X minutes (configurable)
- **Post-game:** Room expires after game ends + grace period
- **Disconnect:** If both peers disconnect and no reconnection, expire
- **Max lifetime:** Absolute maximum room lifetime as safety measure

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
- **Validation:** All actions must be validated by host against Trench Heresy rules
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

### Dice Types
Support standard dice: d6, d3, etc. as needed by Trench Heresy rules.

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
3. If host drops: Guest keeps last snapshot cached
4. Host attempts to reconnect to signaling server with same room code
5. Signaling server recognizes room (if not expired) and allows rejoin
6. Peers re-establish WebRTC connection through signaling
7. Host sends current authoritative state to guest (or guest has snapshot)
8. Game resumes from last confirmed state
```

### Reconnection Rules (v1)
- **Host Authority:** Host remains authoritative source of truth
- **Guest Recovery:** Aim to rejoin host's state if host reconnects
- **No Auto-Migration:** Don't implement full guest-takeover for v1
- **State Sync:** On reconnection, host sends full state snapshot to guest
- **Room Persistence:** Room must not be expired during reconnection attempt window

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
  roomMaxLifetime: 3600000,      // 1 hour
  cleanupInterval: 60000        // 1 minute
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
