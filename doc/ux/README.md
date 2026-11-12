# UI inventory

`inventory/index.html` is a catalogue of every SkirmishLab screen, panel and prompt as of 14C-2 PR 9 (master, 2026-11-11): 75 screenshots in 10 sections (lobby and Map Builder, the game screen, objectives and deployment, activation, movement, shooting, charge and melee, push, alerts and debug, match end). Each screenshot has a note on what it is and what it is for, and the page opens with the design observations collected while taking them. Open the file in a browser; it needs no server.

It is the starting point for the 15F UI design pass (formerly 14G2) in [`doc/ROADMAP.md`](../ROADMAP.md).

## How the screenshots were taken
- A headless Chromium (Playwright) at 1600 x 900.
- In-match screens ran the real `GameHUD`, `GameView` and a host `GameManager` on one page, with a stub data channel and scripted dice, so each player's prompt could be captured from both seats. Unit positions were set directly in the game state.
- Lobby and Map Builder screens ran the normal app against the local signaling server (`npm run dev`), with two browser contexts for host and guest.
- Not captured: the dangerous-terrain casualty selector on a squad move and the "jump N dice" chip (described in the movement section instead).

Re-take the screenshots after UI changes so the inventory stays current: the tooling and steps are in [`tools/ux-inventory/`](../../tools/ux-inventory/README.md).
