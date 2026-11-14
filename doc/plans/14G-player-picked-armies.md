# 14G: Each player picks their own army
Status: draft (awaiting owner approval)
Roadmap: doc/ROADMAP.md § 14G (line 792)

## Goal
Replace the host-picks-both-armies lobby flow with per-player army selection. Each lobby renders a single **Your Army** dropdown (`#armySelect`): the host picks their army when creating the room (or while waiting), and the guest picks their own army when joining (or while waiting before start). Over the WebRTC data channel, the guest sends `select-army` and the host validates it against known starter/test army IDs before building `GameState`, broadcasts `lobby-state` so both players see each other's pick in the waiting room (`Host Force (South)` and `Guest Force (North)`), and records both validated IDs in `GameState.setup` so rematches reuse them.

## Decisions (agreed)
1. **Authoritative validation independent of host dev mode:** Add a pure helper `isKnownArmyId(id: unknown): id is string` in `shared/src/data/armies.ts` that checks own-property membership in `STARTER_ARMIES` (`'hdf'`, `'orc-marauders'`, and the 8 `'test-*'` armies). When the host receives `select-army` over the data channel, the host checks `isKnownArmyId(msg.armyId)` (NOT the host's local `isDevMode()`), falling back to the default guest army (`'orc-marauders'`) if unknown. As `doc/ROADMAP.md` specifies, developer mode is each client's local UI convenience for listing `TEST:` armies in its own picker, never a lock blocking the peer's selection.
2. **Local F9 dev mode resets only your own pick:** Each client's `#armySelect` includes `TEST:` armies only when that client's local `isDevMode()` is enabled. Toggling F9 dev mode off resets only the local player's own selection if it was a dev-only army.
3. **`applyDefaultScenario` records only resolved IDs:** In `shared/src/data/scenario.ts`, when `options.hostArmyId` or `options.guestArmyId` is passed, record the resolved `hostStarter.id` and `guestStarter.id` (never raw unvalidated strings) in `state.setup.hostArmyId` and `state.setup.guestArmyId`, so `createRematchState` (`shared/src/engine/rematch.ts:30-34`) always reuses valid army IDs.
4. **Protocol messages for waiting-room sync:** Reuse `{ type: 'select-army', armyId: string, playerId: string }` (already declared in `client/src/network/WebRTCClient.ts:9` and `doc/NETWORKING.md:90`) for Guest → Host selection updates, and add `{ type: 'lobby-state', hostArmyId: string, guestArmyId?: string, mapName: string, useDeploymentPhase: boolean }` for Host → Guest state sync in `GameMessage`.
5. **Mid-game reconnects bypass the waiting room:** If the host has an active match in memory (`hasActiveMatch?.() === true`) or is resuming an existing room rather than creating a fresh one, or if the guest receives `state-update` / `state-sync`, `Lobby` immediately fires `onPeerReady` as today instead of pausing in the waiting room.

*UX choices for newly created waiting rooms (waiting-room start button, untouched guest default, and read-only map/deployment in waiting room) are proposed in PR 2 below and listed under **Open questions** for owner confirmation before implementation.*

## Out of scope
- Custom army list building or point-buy customization (Phase 10).
- Letting the guest change the host's map choice or deployment-phase toggle.
- Rematch army re-selection (rematches continue to reuse `GameState.setup.hostArmyId` and `GameState.setup.guestArmyId` via `createRematchState`).

## Background
- Today `client/src/ui/Lobby.ts` renders two pickers (`#hostArmySelect` and `#guestArmySelect`) on the initial screen, and on the first `heartbeat-ping` (`Lobby.ts:525-530`) `maybeFirePeerReady()` immediately ends the lobby and triggers `gameManager.startGame(...)` (`client/src/main.ts:302`) on the host and `gameManager.applyStateUpdate(initialState)` (`client/src/main.ts:309`) on the guest.
- Because the lobby closes on the first `heartbeat-ping`, neither player currently pauses in the waiting room once connected, and `select-army` (`WebRTCClient.ts:9`, `doc/NETWORKING.md:90`) is declared in types/docs but not wired up.
- `shared/src/data/armies.ts:109` defines `STARTER_ARMIES` (`'hdf'`, `'orc-marauders'`, and 8 `'test-*'` armies).
- `shared/src/data/scenario.ts:42-51` already resolves `STARTER_ARMIES[options.hostArmyId ?? ''] ?? STARTER_ARMIES[DEFAULT_HOST_ARMY_ID]` and `STARTER_ARMIES[options.guestArmyId ?? ''] ?? STARTER_ARMIES[DEFAULT_GUEST_ARMY_ID]`, and writes `setup.hostArmyId` and `setup.guestArmyId` (`shared/src/gameTypes.ts:622-626`), though if an unknown string were passed in `options` it could still be echoed if not resolved via `hostStarter.id` / `guestStarter.id`.
- `tools/ux-inventory/scenes/08-lobby.js` and `tools/ux-inventory/scenes/11-p2p-objectives.js` drive lobby interactions in headless UX inventory captures and will need updating alongside `doc/ux/inventory/index.html` if `#hostArmySelect` / `#guestArmySelect` and the start flow change.

## PR 1: Shared army validation and setup recording (branch: `14G-player-armies-1`)
- **Layer:** shared engine / data
- **Files:**
  - `shared/src/data/armies.ts`
  - `shared/src/data/scenario.ts`
  - `shared/src/index.ts` (re-export `isKnownArmyId` if needed alongside `STARTER_ARMIES`)
  - `shared/tests/data/scenario.test.ts`
- **Tests first:**
  1. `isKnownArmyId` returns `true` for `'hdf'`, `'orc-marauders'`, and every `'test-*'` key in `STARTER_ARMIES`, and `false` for unknown strings (`'unknown-army'`, `'__proto__'`, `'constructor'`, `''`) and non-strings (`null`, `undefined`, `123`).
  2. `applyDefaultScenario` records the resolved starter IDs (`DEFAULT_HOST_ARMY_ID`, `DEFAULT_GUEST_ARMY_ID`) in `state.setup.hostArmyId` / `state.setup.guestArmyId` when invalid/unknown IDs are passed (never storing the bogus string in `GameState.setup`), while accepting any known `'test-*'` army ID without needing any dev-mode flag in `shared`.
  3. `createRematchState` preserves distinct picked `hostArmyId` and `guestArmyId` (including mirror matches such as `'hdf'` vs `'hdf'` and mixed starter + `'test-*'` picks).
- **Implementation steps:**
  1. Export `isKnownArmyId(id: unknown): id is string` in `shared/src/data/armies.ts` using `typeof id === 'string' && Object.prototype.hasOwnProperty.call(STARTER_ARMIES, id)` and ensure it is exported from `shared/src/index.ts`.
  2. Update `applyDefaultScenario` (`shared/src/data/scenario.ts`) so `state.setup.hostArmyId` / `state.setup.guestArmyId` record `hostStarter.id` / `guestStarter.id` whenever explicit army IDs are supplied (or resolved defaults).
  3. Build `shared` (`npm run build --workspace=shared`) and run `npm test --workspace=shared`.
- **Docs:** None (PR 2 updates user-facing protocol/roadmap docs once client wiring lands).
- **Manual checks:** None (covered in PR 2's lobby E2E checks).
- **Done when:** `isKnownArmyId` is exported and tested, `applyDefaultScenario` never writes unknown army IDs into `GameState.setup`, and `npm run build --workspace=shared && npm test --workspace=shared` passes with zero failures.

## PR 2: Client Lobby "Your Army" picker, waiting room sync & docs (branch: `14G-player-armies-2`)
- **Layer:** client network + UI + docs + UX inventory
- **Files:**
  - `client/src/network/WebRTCClient.ts`
  - `client/src/ui/Lobby.ts`
  - `client/src/main.ts`
  - `client/tests/ui/Lobby.test.ts`
  - `tools/ux-inventory/scenes/08-lobby.js`
  - `tools/ux-inventory/scenes/11-p2p-objectives.js`
  - `doc/ux/inventory/index.html` (plus regenerated lobby screenshot if visually changed)
  - `doc/NETWORKING.md`
  - `doc/ROADMAP.md`
  - `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`
- **Tests first:**
  1. Initial lobby renders a single `#armySelect` ("Your Army") picker and does not render `#hostArmySelect` or `#guestArmySelect`.
  2. Creating a room enters the waiting room showing `Host Force (South)` (host's pick), `Guest Force (North)` ("Waiting for guest…"), the selected map, the host's `#armySelect` picker, and a disabled `#startMatchBtn` until the guest connects and sends `select-army`.
  3. On `heartbeat-ping` in a fresh room, Host stays in the waiting room (does not fire `onPeerReady` yet) until Guest's `select-army` arrives and the Host clicks `#startMatchBtn`; Host sends `lobby-state` to Guest whenever connected or either player changes their army.
  4. On Guest receiving `heartbeat-ping`, Guest sends `{ type: 'select-army', armyId, playerId }` and renders Host's + Guest's picks from `lobby-state`, allowing Guest to change `#armySelect` in the waiting room (which sends a new `select-army` and updates Host's waiting room); receiving `state-update` launches the Guest's match.
  5. Authoritative host validation: if Guest sends an unknown `armyId`, Host ignores/falls back to `'orc-marauders'` and broadcasts the validated `guestArmyId` back in `lobby-state`; if Guest has dev mode enabled and sends a `'test-*'` army while Host has dev mode OFF, Host accepts it (`isKnownArmyId` passes) and displays it.
  6. Toggling local F9 dev mode off resets only the local player's own `TEST:` selection; mid-game reconnects (`hasActiveMatch` returning `true`, or Host room resume, or Guest receiving `state-sync` / `state-update`) still immediately transition out of the lobby without waiting for `#startMatchBtn`.
- **Implementation steps:**
  1. Add `{ type: 'lobby-state', hostArmyId: string, guestArmyId?: string, mapName: string, useDeploymentPhase: boolean }` to `GameMessage` in `client/src/network/WebRTCClient.ts`.
  2. Update `LobbyOptions` (`client/src/ui/Lobby.ts`) to accept `hasActiveMatch?: () => boolean` and pass `() => gameManager.getGameState() !== null` from `client/src/main.ts`.
  3. Replace `#hostArmySelect` and `#guestArmySelect` with `#armySelect` ("Your Army"); track `yourArmyId`, `hasEditedArmy`, `hostArmyId`, `guestArmyId`, `guestArmyReceived`, and `peerConnected` in `Lobby.ts`. (If Open Question #2 is approved, automatically default an untouched guest picker to `'orc-marauders'` when joining / opening `?room=`.)
  4. Render the waiting room with both players' picks (`Host Force (South)` / `Guest Force (North)`), `Map`, an editable **Your Army** `#armySelect`, and Host's `#startMatchBtn` (disabled until guest connects and sends `select-army`).
  5. Wire P2P pre-game sync (`select-army` Guest → Host; `lobby-state` Host → Guest) for new rooms while keeping immediate `maybeFirePeerReady` bypass on reconnect/resume.
  6. Update `client/tests/ui/Lobby.test.ts`, UX inventory scripts (`08-lobby.js`, `11-p2p-objectives.js`) and `doc/ux/inventory/`, `doc/NETWORKING.md` (document `lobby-state` alongside `select-army` and the waiting-room handshake), `doc/ROADMAP.md` (§14G tick + status), and `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`.
- **Docs:** Update `doc/NETWORKING.md`, `doc/ROADMAP.md`, `doc/ux/inventory/`, and `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`.
- **Manual checks:** Add a 14G section to `doc/manual-testing/MANUAL_TEST_CHECKLIST.md`:
  - Host creates room with HDF; Guest opens `?room=` and picks Orc Marauders (or mirror HDF vs HDF) -> both waiting rooms display both picks live.
  - Guest changes army in the waiting room before start -> Host waiting room updates and **Start Match** builds the match with the updated armies.
  - Guest toggles F9 Dev Mode and picks a `TEST:` army while Host keeps Dev Mode OFF -> match launches with Guest's `TEST:` army and Host's starter army.
  - Post-match **Rematch** reuses both players' picked armies from `GameState.setup`.
  - Mid-game refresh/reconnect on Host or Guest skips the waiting-room **Start Match** button and resumes directly into the match.
- **Done when:** All client & shared builds and test suites pass (`npm run build --workspace=shared && npm run build && npm test`), UX inventory scripts pass against the updated lobby selectors, and docs/checklist are updated.

## Open questions
Please confirm these 3 UX details before implementation starts:

1. **Starting the match from the waiting room:**
   - **Options:**
     - **(A — Recommended)** Once the guest connects and sends `select-army`, both players stay in the waiting room seeing both picks (and can change **Your Army**); the **Host** clicks a **"Start Match"** button (`#startMatchBtn`) to launch the game. Mid-game reconnects/resumes still skip the waiting room automatically.
     - **(B)** Both players click "Ready" (or Host starts as soon as Guest clicks Ready).
   - **Why A:** Simple, familiar lobby flow (only one player clicks Start once both picks look right), with zero extra ready/unready toggle edge cases if someone changes their army at the last second.

2. **Default selection for "Your Army":**
   - **Options:**
     - **(A — Recommended)** `#armySelect` defaults to **Human Defense Force** (`hdf`), and if the user hasn't manually changed `#armySelect` before joining as Guest (or loading `?room=<code>`), it automatically defaults the Guest's picker to **Orc Marauders** (`orc-marauders`).
     - **(B)** Both Host and Guest default to `'hdf'` unless manually changed.
   - **Why A:** Keeps the initial single-picker UI clean while ensuring a quick two-tab Create + Join playtest still gets HDF vs Orc Marauders out of the box without requiring extra clicks, while letting the guest switch to HDF for mirror matches at any time.

3. **Map and Deployment toggle in the waiting room:**
   - **Options:**
     - **(A — Recommended)** Host picks Map and Deployment phase on the initial Create Room screen; the waiting room displays the Map read-only to both players while keeping **Your Army** editable before start.
     - **(B)** Also allow the host to change Map and Deployment phase inside the waiting room (and broadcast updates via `lobby-state`).
   - **Why A:** Keeps host-only match setup (Map and Deployment phase) on the Create Room screen without cluttering the waiting room, while leaving **Your Army** editable for both players.
