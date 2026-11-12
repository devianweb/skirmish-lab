# 14G: Distance-indicator polish (owner pass follow-ups)
Status: approved (owner, 2026-11-12, answers to the PR 3 pass notes). For Gemini; see `doc/plans/GEMINI_HANDOVER.md`.
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14G, "Indicators for distance-gated rules" (follow-up)

## Goal
After the owner's pass on the distance indicators (`doc/plans/14G-distance-rule-indicators.md`, PRs #370/#371/#373): Hero aura rings no longer look like objective markers, each aura says what it is, and the units that would share a Blast's hits stand out from the other enemies in range.

## Decisions (agreed)
1. **Hero aura style.** Hero aura rings are **dashed** (not a solid band) and drawn in the **Hero's side colour**: host Heroes blue `0x29b6f6`, guest Heroes red `0xef5350` (the existing selection / outcome colours in `MarkerRenderer`). Still bright when that Hero lends its Quality to the selected/hovered unit and faint when not (keep the current opacities, 0.85 / 0.25). The ring radius and when auras show are unchanged.
2. **Blast outline style** stays orange `0xff9800`, but dashed too, so all aura rings share one look.
3. **One label per aura, lying flat on the board.** Each Hero unit's aura and each Blast target's outline gets **one** label: `Hero 6"` / `Blast 3"` (rule display name from the trait registry plus the gate distance, `gateDistance('hero','morale-aura')` / `gateDistance('blast','blast-spread')`; no hard-coded numbers). The label is flat text lying on the board just outside the ring (a canvas-texture plane, not a camera-facing CSS2D label), placed at the ring's point nearest the local player's own board edge (host: the −z side, guest: the +z side) and turned along the ring's tangent there, so it follows the curve and reads upright from that player's camera. For a multi-model Hero or Blast target, the label goes on one model's ring only (the first living model). It never takes pointer events.
4. **Blast sharing mark.** Units that would share the hits of the Blast shot being aimed (`blastSharingUnitIds`) wear an **orange** ring (same style as the target ring, in `0xff9800`) and are **removed** from the dark-red "reachable target" list, so they no longer look like every other enemy in range. Other enemies in range keep the dark-red ring.
5. **Ring sizes stay as they are.** The owner noticed the 6" aura ring and the 6" movement ring don't line up. That's intended: the movement ring is how far the model's centre can travel, while the Hero aura is measured base edge to base edge, so its ring sits one Hero base radius further out (it shows where the other unit's nearest base edge has to be). Add one sentence saying so to the Hero aura entry in `doc/ASSETS.md`.
6. No rule changes, no engine changes.

## Out of scope
- Threshold rings on the range fan and target badges (unchanged).
- Moving the threshold ring label out from under the data card (not raised by the owner).

## Background
- HUD data: `client/src/ui/GameHUD.ts` `computeHeroAuras` / `computeBlastAuras` / `computeBlastSharing`; `MarkerSnapshot.auras` is `Array<{ kind: 'hero' | 'blast'; position; radius; active }>`. Decision 1 needs the side (`hero.ownerId === state.hostId`), Decision 3 the label text and which entry carries it, and the local player's side for placement; extend the aura entries (e.g. `side: 'host' | 'guest'`, `label?: string`) and pass the local side to the renderer.
- Renderer: `client/src/renderer/MarkerRenderer.ts` `setAuras` (today `RingGeometry` + `MeshBasicMaterial`; `HERO_AURA_COLOR`, `BLAST_AURA_COLOR`), the dashed-line pattern in `setThresholdRings` (`LineDashedMaterial` + `computeLineDistances`), `setReachableTargets` and `setTarget` for the ring styles; signature-based rebuild skipping must keep working.
- Wiring: `client/src/main.ts` `applyMarkers` currently merges `blastSharingUnitIds` into the reachable list (change per Decision 4); `client/src/renderer/GameView.ts`.
- Tests: `client/tests/renderer/distanceIndicatorMarkers.test.ts` (jsdom), `client/tests/ui/GameHUD.indicators.test.ts`.

## PR 1: Aura style, aura labels, Blast sharing mark  (branch: `14G-indicator-polish-1`)
- **Layer:** client HUD data + renderer (one small PR; no engine change).
- **Tests first:**
  - HUD: Hero aura entries carry the Hero's side (host Hero → host, guest Hero → guest); exactly one entry per Hero unit and one per Blast target carries the label, with text `Hero 6"` / `Blast 3"` built from the registry;
  - renderer: aura rings use a dashed line material; host Hero ring blue, guest Hero ring red, Blast orange; active/inactive opacity; one flat label mesh per labelled aura (not a CSS2D object), lying flat (rotated to the board plane), placed on the local player's side of the ring; labels removed with the auras and by `clearAll` / `dispose`; an identical snapshot does not rebuild;
  - Blast sharing: sharing units get the orange ring and are not in the reachable (dark-red) set; with no Blast aim nothing orange is drawn.
- **Docs:** `doc/ASSETS.md` UI markers rows (Hero aura: dashed, side colour, label, the base-edge note from Decision 5; Blast outline: dashed, label; new row for the Blast sharing ring), ROADMAP sub-bullet under the indicators entry, `tools/ux-inventory/catalog.js` text for `g14-03-hero-aura` and `g14-04-blast-outline` (list them as needing new screenshots), manual checklist.
- **Manual checks** (section 10; Setup: Orc Marauders (host) vs Human Defense Force (guest), Standard Battlefield):
  1. Select an HDF unit near the Company Leader: a dashed red ring around the Leader (guest side colour), bright when the unit is within 6" and faint when not, with `Hero 6"` written flat on the board along the ring on your side. As host, selecting an Orc unit near the Orc Leader gives a dashed blue ring.
  2. Aim the Heavy Flamer-Mod at an HDF unit with another HDF unit close by: dashed orange outlines with one `Blast 3"` label; the nearby unit wears an orange ring; other enemies in range keep the dark-red ring.
  3. The Hero ring no longer looks like an objective marker.
- **Done when:** all workspaces green; manual checks added; catalog text updated.

## Open questions
None.
