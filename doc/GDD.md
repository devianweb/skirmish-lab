# Game Design Document (GDD)

## Vision
SkirmishLab is an unofficial, unendorsed tabletop skirmish simulator for One Page Rules games, playable in a web browser with 3D visualization. Two players connect directly via invite codes and play head-to-head. The first target ruleset is Grimdark Future: Firefight (OPR), with the engine designed ruleset-agnostic so additional OPR skirmish rulesets (e.g., Age of Fantasy: Skirmish) can be added later as data packs.

## IP & Legal Stance
- SkirmishLab is a fan-made community project, not affiliated with, endorsed by, or sponsored by One Page Rules.
- All game mechanics are implemented from first principles — no third-party rulebook text, lore prose, or artwork is bundled.
- Faction names and unit data shipped with the engine are original/generic until an endorsement agreement (if any) clarifies what is permitted.
- The engine's brand (SkirmishLab) is neutral; no third-party trademarks appear in the product name.

## Core Pillars
- **OPR-Style Skirmish Play** - Quality/Defense d6 resolution, alternating activations, wound/stun tracking, morale — the standard OPR skirmish math implemented from first principles
- **3D Tabletop Experience** - Use Three.js to render the battlefield in 3D with controllable cameras to view models on the field
- **Direct Play** - Peer-to-peer connection via invite codes, no matchmaking or public lobbies
- **Ruleset-Agnostic Engine** - Rules logic reads stats and special rules from data definitions; rulesets are data packs, not code
- **Low Poly Aesthetic** - Clean low-poly models, with plans to convert .STL tabletop models
- **Desktop Focused** - Optimized for desktop browsers only

## Target Audience
Players of One Page Rules skirmish games (Grimdark Future: Firefight first) who want to play digitally with friends without needing full VTT platforms.

## Core Gameplay Loop
1. **Lobby/Connection** - Host creates a room with XXX-XXX code, guest joins with code via WebRTC
2. **Army Selection/Setup** - Players pick forces from the available army data packs and deploy
3. **Game Play** - Players alternate activating one unit at a time; each activation is move and/or shoot/fight
4. **Resolution** - All actions validated by host, dice rolled by the server and broadcast to both players, results applied to state
5. **Victory** - Game ends per the mission's victory conditions

## Scope

### In Scope (v1)
- [ ] WebRTC P2P connection with invite codes
- [ ] Custom Node.js + ws signaling server
- [ ] Host-authoritative alternating-activation gameplay
- [ ] 3D battlefield rendering with Three.js
- [ ] OPR skirmish rule implementation (Q/D rolls, alternating activations, wounds/stun, morale)
- [ ] Two hardcoded armies as data files (original faction names)
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
- [ ] Army Forge / external roster import (schema will be shaped so this can be added later as a data problem)

## Gameplay Feel
- **Alternating Activations** - Players take turns activating one unit each, keeping both players engaged throughout the round; each activation is confirmed, then results are shown
- **Tactical** - Cover, range brackets, line of sight, morale and stun states drive tactical decisions
- **Clean Presentation** - Low poly models, clear UI, 3D camera for viewing the battlefield

## Win Conditions
Victory conditions are defined per mission. v1 ships with a simple skirmish mission (e.g., eliminate the enemy force / objectives). Specific mission types expand later as data.

## Art Direction
- **Style:** Low poly 3D models
- **Source:** Original models only; will convert existing .STL tabletop models to low poly format
- **Environment:** Sci-fi skirmish terrain suited to Grimdark Future: Firefight-style play
- **UI:** Clean, functional interface for desktop
