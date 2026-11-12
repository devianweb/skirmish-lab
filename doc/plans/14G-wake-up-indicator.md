# 14G: Wake-up loading indicator
Status: done, merged as #377 (2026-11-12). Implemented by Gemini; the owner approved the decisions by handing the plan over on 2026-11-12. Review fix: a failed reconnect attempt after a socket has been open keeps the background reconnect loop going. Intended for an outside implementer (Gemini); see `doc/plans/GEMINI_HANDOVER.md`.
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14G, "Wake-up loading indicator"

## Goal
After a quiet spell the free-tier signaling server (Azure App Service F1) can take up to a minute to wake up. Today the lobby shows nothing at all until the WebSocket opens (`Lobby.init()` awaits `signalingClient.connect()` before its first `render()`), and Create / Join can hang without feedback. The lobby should appear at once and say plainly that it is waking the server, then either get on with it or show a clear error with a way to try again.

## Decisions (agreed)
1. **Render first.** `Lobby.init()` renders the lobby straight away and connects in the background. It no longer awaits the connection before the first render.
2. **Connection status line.** The lobby card has one status line under the Create / Join buttons, driven by the signaling connection state:
   - connecting, for less than 1.5 s: nothing shown (no flash on a fast connection);
   - connecting, 1.5 s or longer: a small CSS spinner and "Waking up the server, this can take up to a minute…";
   - connected: the line is empty;
   - gave up (Decision 4): "Couldn't reach the game server. Check your connection, then try again." and a **Try again** button.
3. **Buttons wait for the connection.** Create Room, Join Room and Resume are disabled (greyed, `disabled` attribute) until the socket is open. Map Builder, the army / map pickers and the dev-mode toggle stay usable, since they need no server.
4. **First connection retries, then gives up.** If the first connection fails (error or close before open), the client tries again every 3 s until 60 s have passed since the lobby started connecting. After 60 s with no open socket it stops and shows the error from Decision 2. **Try again** starts a fresh 60 s window. This is only the lobby's first connection: the existing reconnect logic once a room exists (`scheduleReconnect`, rejoin, keep-alive) is unchanged.
5. **Room requests show progress.** After Create Room, Join Room or Resume is clicked, the buttons stay disabled and the status line shows the spinner and "Creating room…" / "Joining room…". If there is no reply after 10 s, the line adds "the server is still waking up". If there is still no reply after 60 s, it shows "The server didn't answer. Try again." and the buttons are enabled again. A reply (`room-created`, `room-joined`) or a server `error` message ends the pending state; the existing `error` handling (the alert) stays as it is.
6. **The auto-join from a room link** (`?room=` / the active-session resume) uses the same pending state as a Join click.
7. **No server or protocol change.** No new message types, no change to the signaling server, the keep-alive or room expiry. Wording is our own; there are no OPR names involved.
8. **Testable timing.** The timings (1.5 s, 3 s, 10 s, 60 s) are named constants. Tests use Vitest fake timers and a fake signaling client (inject it through `LobbyOptions`, as the build stamp PR injected `checkForNewVersion`), so no test opens a real socket.

## Out of scope
- Waking the server early (pinging it from the page before the lobby loads), or changing the Azure plan.
- Any in-game connection UI (the in-game reconnect banner is unchanged).
- Restyling the lobby (15F UI design pass).

## Background
- `client/src/ui/Lobby.ts`: `init()` awaits `this.signalingClient.connect()` then `render()`; `render()` → `renderScreen()` builds the card (`#createBtn`, `#joinBtn`, `#codeInput`, `#resumeBtn`, `#openMapEditorBtn`, `#lobbyFooter`); handlers for `room-created`, `room-joined`, `error` (alert) are registered on the signaling client. `LobbyOptions` already takes injected `buildInfo`, `checkForNewVersion`, `reloadPage` (see `client/tests/ui/Lobby.buildStamp.test.ts` for the test pattern with in-memory stores). The lobby re-renders often (`render()` replaces `innerHTML`), so the status line must be re-applied after each render (the new-version banner in `applyNewVersionBanner` is an example).
- `client/src/network/SignalingClient.ts`: `connect()` returns a promise that resolves on `onopen` and rejects on `onerror`; `onConnectionState(cb)` reports `connected | disconnected | reconnecting`; `scheduleReconnect` only runs once a room exists or handlers are registered. The URL comes from `VITE_SIGNALING_URL` (default `ws://localhost:8080`).
- `client/src/main.ts`: `lobby.init().catch(console.error)`.

## PR 1: Wake-up indicator in the lobby  (branch: `14G-wake-up-indicator-1`)
- **Layer:** client only (`client/src/ui/Lobby.ts`, possibly a small helper such as `client/src/ui/connectionStatus.ts` holding the pure state machine, `client/src/network/SignalingClient.ts` only if a hook is truly needed). One PR.
- **Tests first** (`client/tests/ui/Lobby.wakeUp.test.ts`, jsdom, fake timers, fake signaling client):
  - the lobby renders before the connection opens (the card and footer are in the DOM while `connect()` is still pending);
  - no status text at 1.4 s; spinner and the waking-up text at 1.5 s; empty once connected;
  - Create / Join / Resume disabled until connected, enabled after; Map Builder usable throughout;
  - a failed first connection retries every 3 s; at 60 s the error and Try again appear and retries stop; Try again restarts the cycle and a later success clears the error;
  - Create Room: "Creating room…" with buttons disabled; "still waking up" added at 10 s; a `room-created` reply clears it; no reply by 60 s shows "The server didn't answer. Try again." and re-enables the buttons; a server `error` message clears the pending state;
  - the status line survives a re-render;
  - the existing lobby tests still pass unchanged (if one relied on `init()` awaiting the connection, adjust only how it waits, not what it asserts).
- **Docs:** `doc/NETWORKING.md` (one short paragraph: first-connection retry window and the lobby status line), ROADMAP tick of the 14G "Wake-up loading indicator" entry, `tools/ux-inventory/catalog.js` lobby entry text (add a "waking up" state entry; the planner takes the screenshots), manual checklist.
- **Manual checks** (section 9; Setup: deployed site after it has been idle for 20+ minutes, or locally by starting only the client (`npm run dev --workspace=client`) and the signaling server later):
  1. Open the lobby with the server asleep / not running: the lobby appears at once; after a moment the spinner and "Waking up the server, this can take up to a minute…" show, and Create / Join are greyed out.
  2. When the server comes up (start it locally, or wait on the deployed site), the line clears and Create / Join work.
  3. With the server never starting, after a minute the error and Try again appear; start the server and press Try again: it connects.
  4. On a normal, awake connection nothing flashes.
- **Done when:** all workspaces green; the lobby renders without waiting for the socket; the manual checks are in the checklist.

## Open questions
None. (Still to do: the `70b-lobby-waking-up` UI inventory screenshot.)
