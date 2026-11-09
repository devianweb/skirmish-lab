# 14A: Match end, results and Concede
Status: done
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14A

## Goal
When a match ends, both players see a clear results screen: who won and why, the objectives each side held, and what each side lost. Either player can **Concede** at any time. The match ends as a loss for the conceding player and a win for the opponent, and **both** players see the normal results screen ("Defeat" / "Victory"). They stay in the room, so 14B can offer a rematch from that same screen.

## Decisions (agreed)
1. **Draws stay draws.** Owner: "Draw is a draw for now." There is no tournament tie-break, and the existing end-of-round-4 scoring (`endRound` in `shared/src/engine/activation.ts`) is unchanged.
2. **Concede** is a new host-validated action, `concede` (payload `{}`; the actor is `action.actorId`).
   - It is valid any time the match is not over: deployment or activation, either player's turn, during a pending reaction, during a declared charge. The usual turn, reaction and charge-lock checks do **not** apply to it. Only `status === 'game-over'` rejects it, with the reason "Game is over".
   - Applying it sets `status = 'game-over'`, `turnState.phase = 'game-over'`, `activeUnitId = null`, `pendingReaction = null` and `charge` cleared. It also sets `winner` to the **other** player and `endReason` to `"<conceding player's name> conceded"` (the name comes from `state.players`, with "Host" / "Guest" as the fallback).
   - It logs an accepted entry and needs no dice.
3. **The conceding player loses and stays.** Owner (revised 2026-11-09): "the conceding player should lose the game, but be given the option to a rematch instead of just dumping them straight to the main menu. Use the existing loss screen." After the host confirms the concede, the conceder sees the existing game-over screen as a loss ("Defeat", reason "<their name> conceded"), with **Return to Lobby** as today. 14B adds **Play Again** to this same screen for both players. Nobody is sent to the main menu automatically.
4. **The opponent** sees the same screen as a win: "Victory", reason "<name> conceded". Once the match is over, neither HUD shows the "Opponent disconnected — waiting for peer to reconnect…" banner, because either player leaving through **Return to Lobby** is expected. After game over, a lost peer shows a quiet line on the results screen instead: "<name> has left."
5. **Concede is never lost because the host is busy.** If the host receives a `concede` while another action's dice request is in flight (`pendingActionId` set), it queues the concede and applies it right after that action finishes. It does not reject it with "Another action is being processed". A queued concede applies to whatever state results (if that action already ended the game, the concede is dropped silently).
6. **Concede with no connection.** If the guest gets no confirmed state within **5 s** of sending a concede (the host is unreachable), the button comes back and a toast says "Couldn't reach your opponent; the concede wasn't sent." Nothing is applied locally, because the host is authoritative. The host's own concede is applied locally, so it can't time out.
7. **The Concede button** sits in the top header, next to the room code. It is a small, muted red button labelled "Concede", visible to both players while the match is not over (including deployment). Clicking it opens a confirmation, "Concede the match? You lose and your opponent wins.", with **Concede** (red) and **Cancel**. Nothing is sent until **Concede** is confirmed. While waiting for the host it reads "Conceding…" and is disabled.
8. **The results screen** is the existing game-over modal, extended. Both players see it for every ending (round 4, elimination, concede), and it shows:
   - the title: "Victory" / "Defeat" / "Draw" (as today);
   - the reason (`endReason`), e.g. "Objective victory (3 to 1)", "Opponent eliminated", "Alice conceded";
   - "Rounds played: N of 4";
   - the existing objective score and per-objective breakdown;
   - **losses per side**, one line each: "<Name> lost U of T units (M of N models)". A unit counts as lost when it is destroyed or routed. Models are lost when destroyed (a routed unit's surviving models are not counted as model losses). Host first, in host colour; guest second, in guest colour.
   - the existing **Return to Lobby** button.
9. **The summary is a pure function.** `summarizeMatch(state): MatchSummary` in `shared/src/engine/` returns the winner, `endReason`, rounds played, the objective score per player, and the per-player unit and model loss counts. The HUD only formats it, and 14B's results screen can reuse it.

## Out of scope
- Rematch / "Play Again" (14B). Don't add buttons for it yet. The results screen should leave room for a second button next to Return to Lobby.
- Tie-breaks, destruction points, and tournament points.
- Statistics beyond Decision 8 (kills per unit, damage dealt, timelines).
- Visual or audio polish of the screen (Phase 15).

## Background
- **Match end:**
  - `endRound` (`shared/src/engine/activation.ts:138`) ends after round 4 on objective count.
  - `checkGameEnd` (`shared/src/engine/actions.ts` ~3773) ends on elimination.
  - `GameState.winner` / `endReason` (`shared/src/gameTypes.ts:466`).
- **Validation and the action union:**
  - `validateAction` (`actions.ts:556`) rejects everything on game over, then gates on `pendingReaction` / `currentPlayerId` / the charge lock. Concede must short-circuit before those checks.
  - Add `'concede'` to `ActionType` and `ActionPayload` (`gameTypes.ts:262`).
- **Host pipeline:** `GameManager.processAction` (`client/src/core/GameManager.ts:271`) rejects with "Another action is being processed" while `pendingActionId` is set. That's where the concede queue goes. `saveSnapshot` already clears the session store when the state is game over.
- **Guest path:** `sendAction` sends an `action-request`, and the guest learns the result from the next state update (the results screen then shows from state as usual).
- **Leaving:** the existing **Return to Lobby** button calls `onReturnToLobby` (`client/src/main.ts:220`). It is unchanged; conceding does not call it.
- **HUD:**
  - Game-over modal: `GameHUD.ts` ~2674 (`gameOverText`, objective breakdown).
  - Disconnect banner: ~2622, using `peerState`.
  - Header: ~2647.
  - Action handler switch: ~4296 (`return-lobby`).
- **Tests:**
  - `client/tests/core/GameManager.test.ts` (injected dice provider; queueing tests go here).
  - `client/tests/ui/GameHUD*.test.ts` (jsdom HUD tests, `setup()` / `clickByText` helpers).
  - Engine tests in `shared/tests/engine/`.

## PR 1: Concede action and match summary (engine)  (branch: `14A-match-end-1`)
- **Layer:** shared engine
- **Files:** `shared/src/gameTypes.ts`, `shared/src/engine/actions.ts`, new `shared/src/engine/matchSummary.ts` (exported from the barrel), new `shared/tests/engine/concede.test.ts`, new `shared/tests/engine/matchSummary.test.ts`.
- **Tests first:**
  - `concede` is valid on your turn, on the opponent's turn, during deployment, during a pending reaction for either player, and during a declared charge. It is invalid once the game is over.
  - Applying it: the game is over, the winner is the other player, `endReason` is "<name> conceded" (and falls back to "Host" / "Guest" without a name), the pending reaction and charge are cleared, there's one log entry, and `getDiceSpecs` is null.
  - The host or the guest can concede.
  - `summarizeMatch`:
    - after a round-4 objective win and a draw (winner undefined);
    - after an elimination;
    - after a concede;
    - losses count destroyed **and** routed units, and destroyed models only;
    - rounds played is right in deployment (0) and in round 3;
    - it is pure (the input isn't mutated) and JSON-serializable.
- **Implementation steps:**
  1. Add the type.
  2. Short-circuit `validateAction` for `concede`.
  3. Add the `applyAction` case.
  4. Add `summarizeMatch`.
- **Docs:**
  - `RULES_SPECIFICATION.md`: match end (concede, draws stay draws).
  - `DATA_MODEL.md`: the action, `MatchSummary`.
  - `NETWORKING.md`: if it lists action types.
  - `ROADMAP.md`: a 14A PR 1 entry.
- **Manual checks:** none (no UI).
- **Done when:** all workspaces pass.

## PR 2: Concede button, leaving, and the results screen  (branch: `14A-match-end-2`)
- **Layer:** client (GameManager + HUD)
- **Files:** `client/src/core/GameManager.ts`, `client/src/ui/GameHUD.ts`, `client/tests/core/GameManager.test.ts`, new `client/tests/ui/GameHUD.concede.test.ts`, and the game-over tests in the existing HUD tests if they assert the old layout.
- **Tests first:**
  - **GameManager:**
    - a host receiving `concede` while a dice request is in flight queues it and applies it after that action, broadcasting both states in order;
    - a queued concede after an action that already ended the game is dropped;
    - concede is never rejected as "Another action is being processed".
  - **HUD:**
    - the Concede button shows for both players while the match isn't over (deployment too) and is hidden at game over;
    - clicking it opens the confirmation, Cancel sends nothing, and Concede sends one `concede` action and shows "Conceding…";
    - when the confirmed state arrives, the conceder sees the results modal with "Defeat" and "<their name> conceded", and `onReturnToLobby` is **not** called;
    - for the guest, with no state within 5 s (fake timers), the button is enabled again and the "Couldn't reach your opponent" toast shows; nothing else changes;
    - the opponent sees "Victory", "<name> conceded", rounds played, both loss lines and the objective breakdown;
    - after game over, `setNetworkStatus({ peer: 'disconnected' })` shows no disconnect banner, but shows "<name> has left." on the results screen;
    - a normal round-4 end shows "Draw" with the losses lines.
- **Implementation steps:**
  1. Queue the concede in `GameManager`.
  2. Add the HUD button, the confirmation and the conceding state.
  3. Add the guest's 5 s no-confirmation timeout (re-enable the button and show the toast).
  4. Rebuild the game-over modal from `summarizeMatch`.
  5. Suppress the disconnect banner after game over.
- **Docs:**
  - `SYSTEMS.md`: HUD concede and results.
  - `ROADMAP.md`: tick 14A.
  - Manual checklist: add the items below.
  - Set this plan's `Status: done`.
- **Manual checks** (section 9, Multiplayer):
  - The guest concedes mid-turn: the guest sees "Defeat" and "<guest> conceded"; the host sees "Victory" with the same reason; both see the losses and rounds played. The guest presses Return to Lobby: the host sees "<guest> has left." and no disconnect banner.
  - The host concedes during the guest's reaction prompt: the same, mirrored.
  - Both players play to the end of round 4: the results screen shows the right winner or "Draw", the objectives and the losses.
  - As the guest, kill the host's tab, then concede: after ~5 s the button comes back with the "Couldn't reach your opponent" toast.
- **Done when:** tests pass and the manual items are added.

## Open questions
None.
