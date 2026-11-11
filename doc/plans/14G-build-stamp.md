# 14G: Build stamp and "new version" notice
Status: draft, parked as a ROADMAP entry under 14G (owner, 2026-11-11: keep it on the roadmap for now). Needs the owner's approval before an implementer starts.
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14G (Playtest & UX polish)

## Goal
After a release, a player can see at a glance which build their browser tab is running, and a tab that is running an older build than the one deployed says so and offers a reload. This removes the "did it deploy?" guesswork: on 2026-11-11 a tab kept showing the previous build for several minutes after a release because the browser reused its cached copy of the page.

## Decisions (proposed, for the owner to confirm)
1. **Build stamp.** The client build carries the short commit hash and the build time (UTC). The lobby footer, next to the disclaimer, shows one small muted line: `Build a1b2c3d · 2026-11-11 23:00 UTC`. A local dev server shows `Build dev`. The same line is written once to the browser console at start-up.
2. **Where it comes from.** `client/vite.config.ts` injects two constants with Vite's `define`: the commit from `GITHUB_SHA` when set (CI and deploy), else `git rev-parse --short HEAD`, else `dev`; the time is the moment of the build. No new dependency, no network call to build.
3. **New-version notice.** The build also writes `version.json` (`{ "commit": "...", "builtAt": "..." }`) next to `index.html`. When the lobby opens (and each time the player returns to it), the client fetches `version.json` with the browser cache bypassed. If its commit differs from the tab's own, the lobby shows a banner: "A newer version of SkirmishLab is available." with a **Reload** button that reloads the page from the network. If the fetch fails, or the tab is a dev build, nothing is shown.
4. **Lobby only.** No check and no banner during a game (a reload mid-match would drop the player into the reconnect flow). The in-game HUD is unchanged.
5. **No rule or protocol change.** Nothing is sent to the other player or the signaling server. The two players' builds are not compared (see Out of scope).

## Out of scope
- Comparing host and guest builds, or blocking a game between different builds.
- Saved matches: a room reopened from its link restores the match as it was saved, including units created by an older build. Start a new room after a release. (A possible follow-up: stamp the saved snapshot with its build and say so when it is restored by a newer one.)
- A service worker, offline support, or changing GitHub Pages' cache headers (not configurable there).
- The signaling server's version.

## Background
- `client/vite.config.ts`: `base: '/skirmish-lab/'`, no `define` yet. `.github/workflows/deploy.yml` builds the client with `npm run build --workspace=client` (GitHub sets `GITHUB_SHA`).
- `client/src/ui/Lobby.ts`: `LOBBY_DISCLAIMER` and the footer that prints it (`<div>${LOBBY_DISCLAIMER}</div>`). The disclaimer must stay visible (AGENTS.md).
- GitHub Pages serves `index.html` with `cache-control: max-age=600`; the hashed bundle name changes on every build, so a fresh `index.html` always loads the new code.
- Client tests run in Vitest (jsdom for the lobby); constants injected by `define` need a fallback or a test-side define so tests don't depend on git.

## PR 1: Build stamp and new-version notice  (branch: `14G-build-stamp-1`)
- **Layer:** client only (build config + lobby UI). One PR.
- **Files:** `client/vite.config.ts` (the `define` constants and a tiny plugin or `closeBundle` hook that writes `version.json` into the build output), `client/src/buildInfo.ts` (new: reads the constants with a `dev` fallback, formats the stamp, compares versions, fetches `version.json`), `client/src/ui/Lobby.ts` (footer line, banner, Reload), a type declaration for the constants, tests.
- **Tests first** (`client/tests/buildInfo.test.ts`, `client/tests/ui/Lobby.*.test.ts`, jsdom):
  - the stamp text for a normal build and for `dev`;
  - the lobby footer shows the stamp and still shows the disclaimer;
  - same commit: no banner; different commit: banner with Reload; Reload calls the injected reload function;
  - fetch fails, returns bad JSON, or the tab is a dev build: no banner and no error;
  - the fetch asks for `version.json` under the app's base path with the cache bypassed.
- **Implementation steps:** constants and `version.json` in the Vite config; `buildInfo.ts` with the fetch and reload injected so tests need no network; lobby footer and banner; console line at start-up; run `npm run build --workspace=client` and check `client/dist/version.json` and the stamp in the built bundle.
- **Docs:** ARCHITECTURE or DEPLOYMENT (one short paragraph: the stamp, `version.json`, and "hard refresh or use Reload after a release; start a new room"), ROADMAP tick, UI inventory (lobby entry: re-take the lobby shot, add the banner state), manual checklist.
- **Manual checks** (section for multiplayer / lobby; Setup: the deployed site after a release, no army or map needed):
  1. The lobby footer shows `Build <hash> · <time> UTC`, and the hash matches the release's commit on GitHub.
  2. Keep a lobby tab open, deploy a new release, return to the lobby (or reload from cache): the banner appears; Reload brings the new build and the banner is gone.
  3. During a game there is no banner.
- **Done when:** all workspaces green; `version.json` is in the build output; the lobby shows the stamp; the banner appears only for a differing deployed commit.

## Open questions
- The owner confirms Decisions 1–5 (in particular: the banner in the lobby only, and no host/guest build comparison for now).
