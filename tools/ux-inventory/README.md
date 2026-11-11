# UI inventory tooling

Takes the screenshots for `doc/ux/inventory/index.html` and rebuilds that page. Not an npm workspace: it has its own `package.json` (Playwright only) and never runs in CI.

## Files
- `harness.template.ts` + `make-harness.js`: writes a temporary page into the client (`client/ux-harness.html` + `client/src/uxHarness.ts`) that runs the real `GameView`, `GameHUD` and a host `GameManager` with a stub data channel and scripted dice, exposed as `window.ux`. The marker wiring is copied from `client/src/main.ts` each time. `node make-harness.js --clean` removes it. **Never commit the harness files.**
- `lib.js`, `common.js`, `scene.js`: Playwright helpers (`scene()` starts a game with chosen armies and map, places units, sets the camera, and adds `pick`, `pickAt`, `hoverAt`, `btn`, `as` (switch seat), `shot`).
- `scenes/*.js`: one script per group of screens. `08-lobby.js`, `09-map-builder.js` and `11-p2p-objectives.js` use the normal app and the signaling server; the rest use the harness.
- `catalog.js`: the inventory's sections and entries (screenshot name, title, "what it is", "purpose"). `build.js` holds the design observations.
- `build.js` -> `site/` (PNG preview); `tojpg.js` -> `doc/ux/inventory/` (committed page, JPEG screenshots). `grid.js out.png a.png b.png c.png d.png` makes a 2x2 contact sheet for checking shots.

## Updating the inventory
1. `cd tools/ux-inventory && npm install && npx playwright install chromium`
2. From the repo root: `npm run dev` (client on :3000, signaling on :8080), then `node tools/ux-inventory/make-harness.js`.
3. Run the scenes you need, e.g. `./run.sh scenes/05-charge-reactions-push.js` (all of them for a full refresh). Screenshots land in `out/`.
4. Edit `catalog.js` (and the observations in `build.js`) for anything added, removed or changed.
5. `./run.sh build.js` (warns about missing screenshots: every catalog entry needs its PNG in `out/`, so run every scene first for a full rebuild), then `./run.sh tojpg.js`.
6. `node make-harness.js --clean`, check `git status` shows no `client/` harness files, and commit `doc/ux/inventory/` with the catalog changes.

## Linux/WSL notes
- Headless Chromium needs `libasound.so.2`. Without root: `apt-get download libasound2t64 && dpkg -x libasound2t64*.deb libs` in this folder; `run.sh` adds `libs/` to `LD_LIBRARY_PATH`.
- Emoji render as boxes without an emoji font. Without root: `apt-get download fonts-noto-color-emoji && dpkg -x fonts-noto-color-emoji*.deb fonts`, then write a `fonts.conf` that includes `/etc/fonts/fonts.conf` and adds `<dir>` for `fonts/`; `run.sh` sets `FONTCONFIG_FILE` when the file exists.
- WebGL runs on SwiftShader (`lib.js` passes the flags).

## Known gaps
The dangerous-terrain casualty selector on a squad move and the "jump N dice" chip aren't captured: the scripted placements in `scenes/07-jump-hazard.js` don't reach them reliably.
