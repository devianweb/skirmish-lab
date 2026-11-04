# Batch 1G: configurable board size (map builder)
Status: approved (2026-11-03), in progress (2026-11-04).
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)**, **Out of scope** and **Background** first.
Roadmap: doc/ROADMAP.md Phase 13 → **Sub-phase 13D: Configurable Board Size**.

## Why
The core rules play on a 4' × 4' (48" × 48") area, or a smaller one as long as armies deploy at least 24" apart. The tournament guidelines also use 4' × 4'. Our default is 44" × 30", and since #177 the game uses the map's board size. On a 30"-deep board, 24"-apart deployment zones are only 3" deep. Owner: "Maybe we make it configurable in the map builder."

## Background
- `CustomMapDefinition.board` (`shared/src/data/mapSchema.ts`) already stores `width`/`height`. `applyDefaultScenario` copies it into `state.board` (#177). `getDeploymentZoneBounds` (`shared/src/engine/activation.ts`) sizes zones up to 12" deep but ≥ 24" apart.
- Hard-coded sizes to audit: `createBlankMap()` (44 × 30), `MapEditor` scene fallbacks (`?? 44`, `?? 30`), the lobby label "Empty Battlefield (44"x30")", `validateMapDefinition` (assumes deployment lines at z = ±12), `MapEditor.autoDistributeObjectives` (fixed positions), `createInitialGameState` (36 × 36 default), and the camera start positions (`CameraController` (20,20,∓20), `SceneManager` (20,20,20)).

## PR 21: Board size in the schema and engine (branch: `feat/board-size-engine`)
- **Default (Decision 23):** new maps and the blank battlefield use **48" × 48"**. Existing saved maps keep their stored size.
- **Validation (`validateMapDefinition`):** board width/height in [24, 72] inches, multiples of 1". A warning when the depth is under 36" (zones under 6" deep), and an error under 26" (can't keep 24" apart with any zone). Objectives inside a deployment zone are checked against the real `getDeploymentZoneBounds`, not fixed ±12. Terrain or objectives outside the board are warnings.
- **Auto objectives:** `autoDistributeObjectives` (move it to shared) places objectives relative to the board size (e.g. at ±25% width and ±(zone inner edge − 3") depth, > 9" apart), and falls back to fewer objectives if the board is too small.
- **Tests first:** blank map 48×48. Zones 12" deep on 48, 3" on 30, rejected on 25. Validation messages. Auto objectives stay > 9" apart and outside zones on 24×36, 36×36, 48×48 and 44×30. Old 44×30 maps still load and play unchanged.

## PR 22: Map builder board-size control + camera scaling (branch: `feat/board-size-editor`)
- **Editor:** a "Board" control in the editor toolbar with presets **48×48 (standard)**, **36×36**, **24×36 (narrow)** and **Custom** (width/height inputs, 1" steps). Changing it resizes the grid live, shows the validation badge, and flags pieces or objectives now outside the board. It's saved with the map.
- **Lobby:** the map dropdown shows each map's size. The blank option shows the new default.
- **Camera:** the start positions and zoom scale with the board (e.g. distance ∝ max(width, height)), so a 48×48 board fits the view for both host and guest. Keep the corner/facing convention from AGENTS.md (host south, guest north).
- **Tests:** the editor resizes the grid and persists the size through save/export/import. Lobby label. Camera start position scales with the board (headless).
- **Docs:** ROADMAP 13D ticks, DATA_MODEL (board limits), RULES_SPECIFICATION §2.1 (default board), ASSETS if any marker changes, AGENTS.md camera note if the start positions change.
- **Manual checks:** §1: change the board size in the builder (presets and custom), the grid resizes, out-of-board pieces are flagged, and the size persists. §9: a 48×48 map plays with 12"-deep zones and the camera frames the board.

## Open questions
1. ~~Default board~~: 48" × 48" (Decision 23). Owner: "Go with your recommendation."
