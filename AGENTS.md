# AGENTS.md

## Project Overview
This is a browser-based 3D version of Trench Crusade, built with TypeScript and Three.js. Two players connect via peer-to-peer WebRTC using invite codes for direct play.

## Tech Stack Constraints
- **Language:** TypeScript (frontend and backend)
- **Renderer:** Three.js for 3D rendering, cameras, and model visualization
- **Networking:** WebRTC data channels for P2P gameplay, custom Node.js + TypeScript + ws for signaling
- **Target:** Desktop browsers only
- **Art Style:** Low poly (will need to convert .STL models to low poly in future)
- **Players:** Human vs Human only (no AI opponent)
- **Rules:** Follow Trench Crusade rules exactly as much as possible

## Core Architecture Rules

### State Management
- **NEVER** store game state in Three.js objects (meshes, groups, etc.). Keep a separate serializable game state object.
- **Host is authoritative.** The host validates all actions against rules. The guest sends actions to host and applies confirmed state from host.
- **State must be serializable.** All game state must be JSON-serializable for snapshots and reconnection.
- **Separate concerns:** Game logic/state is completely decoupled from rendering.

### Networking
- **Signaling only:** The ws server is strictly for signaling (SDP/ICE exchange). Once WebRTC data channel is open, server gets out of the way.
- **Invite codes:** Use XXX-XXX format room codes, no matchmaking.
- **Rooms are ephemeral:** Rooms expire after inactivity or when game ends. Clean up on server.
- **Server-rolled dice:** All dice rolls must go through the server's RNG and be broadcast to both peers simultaneously.
- **Confirmed actions only:** Only broadcast final confirmed positions/actions, no real-time dragging sync.

### Development Do's
- Keep game state pure and serializable
- Validate all actions on the host
- Use action logs + snapshots for resilience
- Cache game state snapshots on guest for potential rehosting
- Use heartbeats/pings over data channel for connection monitoring
- Keep networking protocol well-documented
- Write TypeScript with strict types
- Follow Three.js best practices for performance

### Development Don'ts
- Don't put game logic in Three.js scene objects
- Don't trust client-side validation
- Don't relay game messages through signaling server (signaling only)
- Don't implement full host migration for v1 (just rejoin host if possible)
- Don't add AI/matchmaking features
- Don't optimize for mobile
- Don't use third-party WebRTC signaling services
- Don't allow real-time drag synchronization

## Git Workflow
- Always work on feature branches, never commit directly to master/main
- Create a PR for review before merging
- Use descriptive branch names (e.g., phase-X-description)

## CI/CD & Deployment
- **PR Checks:** Pull requests to `main`/`master` must build and run tests across all workspaces. No deployments from PRs.
- **Release Deployments:** Only pushes to `release/*` branches trigger deployment. The client deploys to GitHub Pages, and the signaling server is deployed separately to a free WebSocket host (Railway/Fly.io) over WSS.
- **Configuration:** The client uses `VITE_SIGNALING_URL` to point to the deployed signaling server. For GitHub Pages, ensure `base` is configured correctly in `client/vite.config.ts`.
- **Documentation:** See [DEPLOYMENT.md](doc/DEPLOYMENT.md) for full setup instructions.

## Testing Requirements
- Write unit tests for pure logic (utilities, state management, validation)
- Write integration tests for networking flows
- All new features must have tests before merging
- Tests should run in CI and pass locally
- Use Vitest for both client and server tests

## Testing Philosophy
- **Test behavior, not structure.** Don't test that methods exist or types compile - TypeScript handles that.
- **Test logic you wrote.** Focus on custom logic: message routing, state transitions, validation, timeouts, error handling.
- **Test integrations.** Prefer integration tests for network flows (WebRTC signaling, room management).
- **Avoid tautologies.** Tests like 'constructor creates instance' or 'method is a function' are not useful.
- **Test edge cases.** Focus on failures, disconnects, timeouts, and boundary conditions.

## Documentation Requirements
- **Always read relevant docs first.** Before implementing features, read GDD.md, ARCHITECTURE.md, NETWORKING.md, DATA_MODEL.md, and SYSTEMS.md as they apply.
- **Keep docs updated.** When making architectural changes, update the relevant docs in doc/.
- **Follow the patterns.** All implementations must follow the architecture and patterns documented.
- **Update ROADMAP.** Mark tasks complete when finished.
- **Update AGENTS.md** if new constraints or patterns emerge.
