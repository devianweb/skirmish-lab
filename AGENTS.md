# AGENTS.md

## Project Overview
SkirmishLab is an unofficial, unendorsed tabletop skirmish simulator for One Page Rules games (Grimdark Future: Firefight first), built with TypeScript and Three.js. Two players connect via peer-to-peer WebRTC using invite codes for direct play. The engine is ruleset-agnostic — rulesets are data packs, not code.

## IP & Legal Constraints
- **Unofficial project:** Not affiliated with, endorsed by, or sponsored by One Page Rules. Never imply official status.
- **Naming:** The product is named SkirmishLab and uses no OPR logos in its name or branding. Rules, units, weapons and traits use One Page Rules' own names, and mechanics follow the current Firefight rules (v3.6), so the game plays as OPR players expect.
- **No pasted text, no art:** Never paste rulebook or army book text, lore prose, or artwork. Describe mechanics in your own words (short own-words summaries in docs are fine). Don't use OPR logos or art. Don't use anything from Patreon-only files.
- **Disclaimer:** Keep the visible disclaimer (README, in-app): SkirmishLab is a fan project, not affiliated with, endorsed by, or sponsored by One Page Rules.
- **Reference material:** The v3.6 rule PDFs in the gitignored `assets-src/` are for reference only. `assets-src/OPR_TERM_MAPPING.md` is historical (from before the move to OPR's own names) and no longer needs updating.
- **Monetisation:** Out of scope until after MVP and any endorsement discussion with OPR.

## Tech Stack Constraints
- **Language:** TypeScript (frontend and backend)
- **Renderer:** Three.js for 3D rendering, cameras, and model visualization
- **Networking:** WebRTC data channels for P2P gameplay, custom Node.js + TypeScript + ws for signaling
- **Target:** Desktop browsers only
- **Art Style:** Low poly (will need to convert .STL models to low poly in future)
- **Players:** Human vs Human only (no AI opponent)
- **Rules:** Implement OPR Firefight skirmish mechanics as of v3.6 (Quality/Defense d6 rolls, alternating activations, wound/stun tracking, range brackets), using OPR's own terminology

## Core Architecture Rules

### State Management
- **NEVER** store game state in Three.js objects (meshes, groups, etc.). Keep a separate serializable game state object.
- **Host is authoritative.** The host validates all actions against rules. The guest sends actions to host and applies confirmed state from host.
- **State must be serializable.** All game state must be JSON-serializable for snapshots and reconnection.
- **Separate concerns:** Game logic/state is completely decoupled from rendering.

### Networking
- **Signaling & dice only:** The ws server is strictly for signaling (SDP/ICE exchange) and authoritative dice rolls. Once WebRTC data channel is open, all gameplay actions, state updates, and movements flow P2P directly over the data channel.
- **Invite codes:** Use XXX-XXX format room codes, no matchmaking.
- **Rooms are ephemeral with disconnect grace:** Rooms expire after inactivity (5 minutes) or max lifetime (3 hours). A 5-minute disconnect grace window preserves active rooms to allow socket recovery or reboots without dropping the game. Rejoining peers automatically reoccupy vacant role slots (`host` or `guest`) via the standard lobby invite code.
- **Server-rolled dice:** All dice rolls must go through the server's RNG and be broadcast to both peers simultaneously. Roll requests retry with backoff and the server caches results by `rollId` for strict idempotency.
- **Keep-alive:** Periodic signaling keep-alive pings (25s interval) ensure WebSocket connections stay active under cloud load balancer idle timeouts (e.g. Azure's 230s limit) even under browser background timer throttling.
- **Confirmed actions only:** Only broadcast final confirmed positions/actions, no real-time dragging sync.

### Audio & UI Feedback
- **Zero-dependency audio cues:** In-game notifications (turn transitions, reaction alerts) synthesize tones procedurally via the Web Audio API (`AudioContext`) with zero network latency or external asset bundle dependencies.

### Rendering & Camera
- **Role-dependent perspective:** The camera starts positioned from each player's deployment corner looking across the battlefield (Host at South corner `(d, d, -d)` looking +z; Guest at North corner `(-d, d, d)` looking -z), where `d` = half the board's longer edge (24 on the default 48"×48" board), so the whole board is framed at any size.
- **Decoupled from state:** Scene meshes are purely visual and reactive; game state is never stored in Three.js objects.
- **Terrain meshes vs collision:** Cosmetic detail (bevels, rounded pipes, trim) may differ slightly from the collision boxes, like a game hitbox, but only **inside** them and by at most about 0.2" (owner, 2026-11-12); the visible shape is never bigger than the collision, and openings (windows, doors, gaps) always match exactly.

### Development Do's
- Keep game state pure and serializable
- Validate all actions on the host
- Keep armies, weapons, and special rules as data files (ruleset-agnostic engine)
- Use action logs + snapshots for resilience
- Cache game state snapshots on guest for potential rehosting
- Use heartbeats/pings over data channel for connection monitoring
- Keep networking protocol well-documented
- Write TypeScript with strict types
- Follow Three.js best practices for performance
- **Atomic Sub-Phasing for Complex Mechanics:** When implementing expansive or complex phases (e.g. multi-model squads, 3D verticality, custom army builders), break work into atomic, sequential PRs:
  1. *Engine & Data Schema (`shared/`):* Define serializable types and pure engine logic functions accompanied by unit tests.
  2. *HUD & Interaction Controls (`client/src/ui`):* Add user controls, targeting chips, and HUD state management.
  3. *3D Scene & Rendering (`client/src/scene`):* Implement Three.js meshes, animations, and visual synchronization.
- **TDD for Rules Engine:** Write unit tests in `shared/tests` to verify rules behavior before wiring UI or scene rendering. Pure engine tests ensure robustness regardless of AI reasoning tier.

### Development Don'ts
- Don't put game logic in Three.js scene objects
- Don't trust client-side validation
- Don't relay game messages through signaling server (signaling only)
- Don't implement full host migration for v1 (just rejoin host if possible)
- Don't add AI/matchmaking features
- Don't optimize for mobile
- Don't use third-party WebRTC signaling services
- Don't allow real-time drag synchronization
- Don't hardcode ruleset-specific logic into the engine (rulesets are data packs)
- Don't bundle rulebook or army book text, lore prose, or artwork, and don't use Patreon-only content
- Don't attempt monolithic PRs across complex subsystems (schema + UI + 3D rendering all in one go); split them logically
- Don't open or merge a pull request targeting the `release` branch unless explicitly commanded by the user

## Planning & Implementation Workflow (Fable plans, Sonnet implements)
- **Plan (Fable, main session):** research the docs, code and rule references, settle rules questions with the owner, and write the plan to `doc/plans/<phase>-<slug>.md` using the template in [doc/plans/README.md](doc/plans/README.md). Anything agreed in chat must end up in the plan file. Implementation doesn't start until the owner approves.
- **Implement (Sonnet):** one `implementer` agent ([.claude/agents/implementer.md](.claude/agents/implementer.md)) per PR section, ideally in an isolated worktree. It writes tests first, runs all workspaces, updates docs and the manual checklist, opens a PR to `master`, and never merges or touches `release`. On a rules ambiguity it stops and reports instead of guessing.
- **Review & merge (Fable):** check each PR against the plan and the rules, send fixes back to the same agent, squash-merge to `master`, then remove that agent's worktree and delete its local branch (`git worktree remove <path>`, `git branch -D <branch>`; check it has no uncommitted or unmerged work first), then start the next section. Releases still require the owner's explicit command.
- **Gemini handover:** a self-contained, approved PR section can go to Gemini instead of a Claude implementer, using the prompt and review steps in [doc/plans/GEMINI_HANDOVER.md](doc/plans/GEMINI_HANDOVER.md). Fable still reviews and merges.
- **Working without Claude:** when Claude is unavailable, Gemini plans and implements and the owner merges, following [doc/plans/HANDOVER.md](doc/plans/HANDOVER.md) (roles, merge policy, house rules, the work queue).
- **Rule references** (the v3.6 core rules, Beginner's Guide, Tournament Guidelines, army book PDFs) live in the gitignored `assets-src/`. Worktrees don't have them, so use the absolute paths listed in `doc/plans/README.md`.

## Git Workflow
- Always work on feature branches, never commit directly to master/main
- Create a PR for review before merging
- Use descriptive branch names (e.g., phase-X-description)

## CI/CD & Deployment
- **PR Checks:** Pull requests to `main`/`master` must build and run tests across all workspaces. No deployments from PRs.
- **Release Deployments:** Only a **merged PR into the `release` branch** triggers deployment. GitHub Actions deploys the client to GitHub Pages and the signaling server to Azure App Service (Linux Node 24 LTS, Free F1 tier) when a PR targeting `release` is merged. Deployments are intentional — open a PR (`master` → `release`) and merge it when ready to demo.
- **Never auto-deploy or assume release timing:** Never create or merge a pull request targeting the `release` branch unless the user explicitly and directly commands you to deploy a release in the current turn. Merges to `master` are normal development merges; releases are strictly deliberate events initiated on explicit user command.
- **Configuration:** The client uses `VITE_SIGNALING_URL` to point to the deployed signaling server. For GitHub Pages, ensure `base` is configured correctly in `client/vite.config.ts`.
- **Documentation:** See [DEPLOYMENT.md](doc/DEPLOYMENT.md) for full setup instructions.

## Testing Requirements
- Write unit tests for pure logic (utilities, state management, validation)
- Write integration tests for networking flows
- All new features must have tests before merging
- Tests should run in CI and pass locally
- Use Vitest for both client and server tests
- Server tests resolve `@skirmish-lab/shared` via the workspace's compiled `shared/dist` output, not its TypeScript sources — if shared code changes don't appear in server tests, rebuild first (`npm run build --workspace=shared`). The client's Vite config aliases `@skirmish-lab/shared` to its TypeScript source (shared compiles to CommonJS whose barrel re-exports Vite's bundler cannot statically analyze), so client tests and builds always use current shared sources.
- Rules logic lives in `shared/src/engine/` as pure functions over `GameState` — test it in the shared workspace; the client's `GameManager` orchestration (dice requests, broadcast, rejection) is tested in the client workspace with injected dice providers
- Renderer tests use real Three.js scene classes, which run headless (node environment) for pure scene logic (board/unit/model/game-view); DOM- or WebGL-dependent components use the `jsdom` environment (via `@vitest-environment jsdom` docblock) with `three`'s `WebGLRenderer` mocked

- Rules measure per model (batch 1D): test fixtures that move `unit.position` must also move `unit.models[*].position` (see the `syncModels` helper in `client/tests/ui/GameHUD.test.ts`). Squad payloads pass `modelPositions` / `modelPaths` / `modelTraversals` in living-model order, and per-model dice use `m<index>_` purpose tags (e.g. `m1_gap_jump`).

## Testing Philosophy
- **Test behavior, not structure.** Don't test that methods exist or types compile - TypeScript handles that.
- **Test logic you wrote.** Focus on custom logic: message routing, state transitions, validation, timeouts, error handling.
- **Test integrations.** Prefer integration tests for network flows (WebRTC signaling, room management).
- **Avoid tautologies.** Tests like 'constructor creates instance' or 'method is a function' are not useful.
- **Test edge cases.** Focus on failures, disconnects, timeouts, and boundary conditions.

## Documentation Requirements
- **Always read relevant docs first.** Before implementing features, read GDD.md, ARCHITECTURE.md, NETWORKING.md, DATA_MODEL.md, SYSTEMS.md, RULES_SPECIFICATION.md, and ASSETS.md as they apply.
- **Keep docs updated.** When making architectural changes, update the relevant docs in doc/.
- **Use OPR's names.** New traits, special rules, units and weapons use One Page Rules' own names and v3.6 behaviour. No separate term-mapping file is maintained.
- **Keep `doc/ASSETS.md` updated.** Whenever adding or changing 3D models, fighter roles, terrain pieces, or UI markers, update the asset mapping table in [`doc/ASSETS.md`](doc/ASSETS.md).
- **Follow the patterns.** All implementations must follow the architecture and patterns documented.
- **Update ROADMAP.** Mark tasks complete when finished.
- **Keep the UI inventory current.** `doc/ux/inventory/index.html` catalogues every screen, panel and prompt with a screenshot and its purpose (see `doc/ux/README.md`; tooling in `tools/ux-inventory/`). When a PR adds, removes or visibly changes a screen, panel, prompt, marker or HUD text, update the matching entry: re-take its screenshot, adjust the "what it is" / "purpose" notes, and add or remove entries. Note it in the PR body.
- **Keep one manual checklist.** Manual playtest items live in `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`; update or add items there when behaviour changes instead of creating per-phase checklist files.
- **Update AGENTS.md** if new constraints or patterns emerge.
