# 14B: Rematch ("Play Again")
Status: done
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14B

## Goal
When a match ends, however it ends (round 4, elimination or concede), both players can press **Play Again** on the results screen. Once both have pressed it, the same room starts the exact same game again: same map, armies, sides and starting positions. There is no new invite code and no trip back to the lobby. This PR also ships the two fixes waiting on `master` from the 14A feedback (#257).

## Decisions (agreed)
1. **Exact same game.** Owner: "For now, just make it replay the exact same game."
   - The rematch starts from a state identical to the original starting state: board, terrain, objectives (with control reset), both armies, unit ids and starting positions, deployment phase or not, host and guest roles, deployment sides, and the starting player.
   - Only `gameId`, `createdAt` and `lastActionId` differ, and the action log is empty.
   - There are no setup options to change.
2. **Both players must agree.** A new host-validated action, `request-rematch` (payload `{}`), is valid **only** while `status === 'game-over'` and only from the host or guest.
   - It adds the actor to a new `GameState.rematchRequestedBy: string[]`, de-duplicated, so a second press is a no-op and is accepted.
   - When both players are in the list, the same `applyAction` returns the new starting state (Decision 4) instead of the game-over state.
   - There is no withdraw. Leaving through **Return to Lobby** is the way out.
3. **Record the setup in state.** `applyDefaultScenario` records the options it was given on the state as `GameState.setup = { hostArmyId?, guestArmyId?, useDeploymentPhase? }`. It is JSON-safe and written only when the options were given.
   - The map is not duplicated, because the board, terrain and objective positions already live in the state and never change during play.
   - Old states without `setup` (from before this change) rebuild as a non-deployment game with the players' recorded armies. Note it in DATA_MODEL; there's no extra handling.
4. **Pure rebuild.** `createRematchState(previous: GameState): GameState` lives in `shared/src/engine/rematch.ts`. It works like this:
   - It calls `createInitialGameState` with the same ids and player names.
   - It then calls `applyDefaultScenario` with `previous.setup` and a `customMap` built from `previous.board` (width and height), `previous.terrain` (deep-copied) and `previous.objectives` (deep-copied, with `controllingPlayerId: null` and `isContested: false`).
   - It's a pure function of the previous state, so it also works after a host reload. The authoritative test is that it deep-equals the original starting state except for the fields in Decision 1.
5. **Results screen UX.**
   - **Play Again** sits next to **Return to Lobby** in `.sl-hud-gameover-actions`, for both players, after every ending, the conceding player included.
   - After you press it, the button reads "Waiting for <opponent>…" and is disabled.
   - The opponent sees a line, "<name> wants a rematch", and their button reads **Accept rematch** (primary).
   - If the opponent has left (the 14A "<name> has left." line is showing), **Play Again** is disabled and reads "Opponent has left".
   - When the new game state arrives, the modal closes and play starts. A toast reads "Rematch started — same armies, same map".
6. **Fresh local state on a new game.** When `syncFromState` sees a different `gameId`, both the HUD and the renderer clear every piece of per-match local state:
   - HUD: the flow, staged squad placements, casualty and pile-in selections, the concede state, toasts tied to the old game, and the last-round tracking.
   - Renderer: markers, outcome tokens, previews and selection rings.
   - The camera keeps the player's role view.
7. **Storage and reconnect.** On game over, `GameManager.saveSnapshot` already clears the room's snapshot and the active session. When a non-game-over state follows a game-over state, both peers must save the active session again (the same `saveActiveSession` record `main.ts` writes on `onPeerReady`) and start saving snapshots of the new match. That way a reload during the rematch resumes the rematch, never the old match. The GameManager's in-memory `snapshots` history is reset for the new `gameId`.
8. **Ship with 14B:** the 14A feedback fixes already merged in #257 (the toast stacks under the disconnect banner; the plain **Abandon charge** button) go out in the same release. No code is needed in this plan.

## Out of scope
- Changing armies, map, sides or deployment for a rematch (later, maybe with Army Forge in Phase 16).
- A match series, game counter or score across rematches.
- Withdrawing a rematch request.
- Rematch after one player has left the room (they return through the lobby with an invite code as usual).

## Background
- **Starting a game:** `GameManager.startGame` (`client/src/core/GameManager.ts:231`) calls `createInitialGameState` + `applyDefaultScenario(state, options)`, then broadcasts `'game-start'`. `main.ts:270` passes `{ hostArmyId, guestArmyId, useDeploymentPhase, customMap }`.
- **Scenario:** `applyDefaultScenario` (`shared/src/data/scenario.ts`) handles the deployment and non-deployment paths and the starter armies (`STARTER_ARMIES`). It is deterministic (no RNG); `createInitialGameState` creates `gameId` from the time and `Math.random`.
- **Game over:**
  - `validateAction` (`shared/src/engine/actions.ts:556`) rejects everything with "Game is over" first. `request-rematch` must be allowed past that check, and must be the only action allowed there.
  - The 14A `concede` short-circuit sits right after that check.
- **Snapshots and sessions:** `GameManager.saveSnapshot` (~412) clears the snapshot and the active session on game over. `main.ts:184` saves the active session in `onPeerReady`. `SessionStore` is in `client/src/core/` (or wherever `defaultSessionStore` is defined).
- **HUD:**
  - Results modal and `.sl-hud-gameover-actions` (14A): `GameHUD.ts` ~2674.
  - `syncFromState` (~320) resets some per-state UI.
  - "<name> has left." comes from `peerState` after game over.
  - The concede state is reset at game over.
- **Renderer:** `GameView.syncFromState`, `MarkerRenderer`, outcome markers (check what persists between states).
- **Summary:** `summarizeMatch` (14A) is unaffected.

## PR 1: Rematch in the engine  (branch: `14B-rematch-1`)
- **Layer:** shared engine
- **Files:**
  - `shared/src/gameTypes.ts` (`setup`, `rematchRequestedBy`, the action);
  - `shared/src/data/scenario.ts` (record `setup`);
  - `shared/src/engine/actions.ts`;
  - new `shared/src/engine/rematch.ts` (barrel export);
  - new `shared/tests/engine/rematch.test.ts`.
- **Tests first:**
  - `applyDefaultScenario` records `setup` for each option combination and omits it when there are no options.
  - **Exactness:** `createRematchState(gameOverStateOf(start))` deep-equals `start` except `gameId` / `createdAt` / `lastActionId`, for:
    - a plain game with starter armies;
    - a deployment-phase game;
    - a custom map (terrain, board 44×30, objectives);
    - the default armies (no army ids).
    
    `gameOverStateOf` plays a few actions (moves, a casualty, objective control) and then concedes, so units and objectives have really changed.
  - `request-rematch`:
    - invalid before game over ("The match isn't over");
    - invalid from a non-player;
    - the first request records the actor, and a duplicate is a no-op;
    - the second player's request returns a fresh in-progress (or deployment) state with an empty log, no `winner`, `endReason` or `rematchRequestedBy`, and the same `setup`;
    - works after an elimination, round-4 and concede ending;
    - needs no dice;
    - every other action is still rejected at game over.
  - A state without `setup` rebuilds as a plain game.
- **Implementation steps:**
  1. Add the types.
  2. Record `setup` in `applyDefaultScenario`.
  3. Write `createRematchState`.
  4. Add validation (allowed only at game over).
  5. Add the apply case.
- **Docs:**
  - `DATA_MODEL.md` (`setup`, `rematchRequestedBy`, the action);
  - `RULES_SPECIFICATION.md` (match end: rematch);
  - `NETWORKING.md` (action list);
  - `ROADMAP.md` (14B PR 1 note).
- **Manual checks:** none.
- **Done when:** all workspaces pass.

## PR 2: Play Again on the results screen  (branch: `14B-rematch-2`)
- **Layer:** client (GameManager, HUD, renderer reset)
- **Files:**
  - `client/src/core/GameManager.ts`, `client/src/main.ts` (re-save the active session);
  - `client/src/ui/GameHUD.ts`, `client/src/renderer/GameView.ts` (and the marker reset it needs);
  - tests in `client/tests/core/GameManager.test.ts`, new `client/tests/ui/GameHUD.rematch.test.ts`, `client/tests/renderer/GameView.test.ts`.
- **Tests first:**
  - **GameManager:**
    - after game over, a non-game-over state saves a new snapshot and calls the active-session save hook;
    - the in-memory snapshot history only holds the new game;
    - a reload restores the rematch.
  - **HUD:**
    - Play Again shows for both players after each ending, the conceding player included;
    - pressing it sends one `request-rematch` and shows "Waiting for <opponent>…";
    - the opponent sees "<name> wants a rematch" and **Accept rematch**;
    - after "has left", the button is disabled with "Opponent has left";
    - a new-`gameId` state closes the modal, shows the toast and clears staged squad placements, casualty picks, the concede state and the flow.
  - **GameView:** a new-`gameId` state clears outcome tokens and markers from the old match.
- **Implementation steps:**
  1. Session and snapshot handling for the new match.
  2. The HUD button states.
  3. Reset on a new `gameId` (HUD + view).
- **Docs:**
  - `SYSTEMS.md` (rematch flow);
  - `ROADMAP.md` (tick 14B and the Phase 14 "Rematch resets the game…" acceptance criterion);
  - the manual checklist;
  - set this plan's `Status: done`.
- **Manual checks** (section 9):
  - Play to the end or concede. Both press Play Again (in either order): the same map, armies and starting positions come back, round 1 (or deployment) with the original starting player, with no leftover markers, outcome tokens or log.
  - One player presses Play Again: the other sees "<name> wants a rematch" and Accept rematch.
  - One player presses Return to Lobby: the other's Play Again shows "Opponent has left".
  - Reload the host's tab during the rematch: it resumes the rematch, not the old match.
- **Done when:** tests pass and the manual items are added.

## Open questions
None.
