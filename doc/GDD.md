# Game Design Document (GDD)

## Vision
Create a faithful digital recreation of Trench Heresy that can be played in a web browser with 3D visualization. Two players can connect directly via invite codes and play head-to-head with the rules followed as closely as possible.

## Core Pillars
- **Faithful Rules** - Follow Trench Heresy rules exactly as much as possible
- **3D Tabletop Experience** - Use Three.js to render the battlefield in 3D with controllable cameras to view models on the field
- **Direct Play** - Peer-to-peer connection via invite codes, no matchmaking or public lobbies
- **Low Poly Aesthetic** - Clean low-poly models, with plans to convert .STL tabletop models
- **Desktop Focused** - Optimized for desktop browsers only

## Target Audience
Players of Trench Heresy who want to play digitally with friends without needing full VTT platforms.

## Core Gameplay Loop
1. **Lobby/Connection** - Host creates a room with XXX-XXX code, guest joins with code via WebRTC
2. **Army Selection/Setup** - Players set up their forces according to Trench Heresy rules
3. **Game Play** - Alternate turns following Trench Heresy phase structure
4. **Resolution** - All actions validated by host, dice rolled by server, results applied to state
5. **Victory** - Game ends per Trench Heresy victory conditions

## Scope

### In Scope (v1)
- [ ] WebRTC P2P connection with invite codes
- [ ] Custom Node.js + ws signaling server
- [ ] Host-authoritative turn-based gameplay
- [ ] 3D battlefield rendering with Three.js
- [ ] Trench Heresy rule implementation (movement, combat, phases, etc.)
- [ ] Server-rolled dice
- [ ] Action confirmation system (no real-time dragging)
- [ ] Basic reconnection (rejoin host's state if host returns)
- [ ] Game state snapshots and action log
- [ ] Low-poly model rendering

### Out of Scope (v1)
- [ ] AI opponent
- [ ] Matchmaking/random lobbies
- [ ] Mobile support
- [ ] User accounts/authentication
- [ ] Game persistence/saving across sessions
- [ ] Spectator mode
- [ ] Full host migration
- [ ] Campaign mode
- [ ] Chat system
- [ ] Modding support

## Gameplay Feel
- **Turn-Based** - Confirm actions, then see animations of results. Not a real-time shared tabletop.
- **Tactical** - Focus on faithful recreation of Trench Heresy's tactical gameplay
- **Clean Presentation** - Low poly models, clear UI, 3D camera for viewing the battlefield

## Win Conditions
Follow Trench Heresy's standard victory conditions as defined in the official ruleset.

## Art Direction
- **Style:** Low poly 3D models
- **Source:** Will convert existing .STL tabletop models to low poly format
- **Environment:** Trench warfare terrain appropriate for Trench Heresy setting
- **UI:** Clean, functional interface for desktop
