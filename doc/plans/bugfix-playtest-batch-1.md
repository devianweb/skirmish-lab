# Bugfix batch 1: playtest fixes + elevated-terrain rules alignment
Status: approved (2026-11-02), split into sub-plans
Roadmap: doc/ROADMAP.md § 13.6 (playtest fixes; add a "13.6 playtest fixes" bullet list when the first PR lands)

## Goal
A running list of small bugs the owner finds while playtesting, each fixed as its own small PR. Every item says what the player sees, why it happens, and the agreed fix. New bugs are appended as further PR sections. Each section can be handed to the `implementer` agent independently once its open questions are answered.

PRs 6–8 bring movement in line with the Elevated/Impassable Terrain guidance in the OPR **Beginner's Guide v3.5.1** (`/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Beginner's Guide v3.5.1.pdf`, "Terrain" chapter). The core rules are silent on climbing. Read the guide; describe the rules in our own words (clean-room).

## Decisions (agreed)
1. A model never ends a move with its base inside the ladder or overlapping the deck it is climbing. The ladder foot and head are real standing spots (see PR 1).
2. A move never ends with a model's base overlapping solid terrain or another model. The end is pulled back along the path to the nearest clear spot, never pushed forward, and the host rejects any move that still overlaps (see PR 2). This is the same pattern as the existing "never end in mid-air" rule.
3. Ladders stay non-blocking terrain (`isObstacle: false`). We fix the standing spots instead of making the ladder an obstacle.
4. **The ladder step-on/step-off is free.** A ladder costs only its vertical climb, as today. The ~0.55" shuffle between the climb line and the foot/head spot is not measured, just as a tabletop player wouldn't measure it. Owner: "I don't think you'd measure that whilst playing the tabletop right?"
5. **Targeting the ground from a deck means walk to the edge and drop** (free ≤ 3", jump test 3–6"). Never a level crossing into mid-air. Owner: "it should have pathfound including a drop to the floor, rather than trying to jump into mid air."
6. **If the budget can't complete a gap jump, the path drops instead.** The model walks to the take-off edge, drops to the level below (free ≤ 3", jump test 3–6") and moves along the lower level toward the point under the cursor, as far as the budget allows. It never ends over open air and never offers a jump it can't finish. Owner: "unless you have the movement range to make the jump, it should imply a drop and movement along the lower level to meet the cursor."
7. **A drop's step-off counts.** Before dropping, the model's whole base moves off the edge (`DROP_STANDOFF` ≈ 0.55"). That horizontal movement is measured like any other (unlike the free ladder step-on in Decision 4). Owner: "Yes it should."
8. **Climbing up to 3".** A model may climb terrain up to 3" tall (a height difference of ≤ 3.0" between the floor it leaves and the floor it climbs onto) as part of a normal move. The vertical distance counts as movement, like any other movement, and it is **not** difficult terrain. It can't end a move part-way up (all-or-nothing, like ladders). Taller rises need a ladder or stairs. Decks (3.0"), the ruin ledge (3.0") and the container roof (2.25") therefore become climbable without a ladder. Before climbing, the model stands a full base off the face (same stand-off as drops, Decision 7), and that horizontal step counts. Replaces the old "sheer wall = difficult terrain + 15" nav penalty" code and the unagreed "no free climbing" line in RULES_SPECIFICATION §8. Owner agreed 2026-11-02 after reading the Beginner's Guide.
9. **Terrain 1" tall or less can be stepped over.** Pieces whose solids are all ≤ 1.0" above the floor they stand on (barricade 0.5", crate 0.75", pipe 0.75") don't block movement. A path goes straight over them at no extra cost (measure as if they weren't there). A model still can't **end** its move on or overlapping one (PR 2). They still give cover and are still drawn and collided for LoS exactly as now. Walls, columns, containers etc. (> 1") still block.
10. **Split-level coherency.** Squad models on different levels (|Δy| > 0.5") may be up to 3" apart (edge to edge, i.e. 4.0" centre to centre with 1" bases) instead of 1". Simplification: the guide allows this when not all models fit on the elevated part. We allow it whenever models are on different levels rather than computing "fit". The 6" whole-squad limit is unchanged.
11. **Squads follow the tabletop per-model rules.** For any interaction between units, measure between models, not unit centres: a target is valid if any shooting model sees and reaches any target model; only those models fire; cover by majority of target models; charges move each model into contact; only models within 2" horizontal / 4" vertical of an enemy model strike; the 1" keep-away rule is per model. `unit.position` is a display anchor only. Owner: "add those to the plan" (2026-11-02), after the per-model walkthrough.
12. **Measure like the tabletop: from the closest points of the bases.** Model↔model distances (shooting range, charge reach, the 1" keep-away rule, engagement/contact, melee strike reach, coherency 1" and 6", range-gated special rules like "> 9"") use base edge to base edge (centre distance − both base radii). Model↔marker distances (objective control 3") use base edge to marker point (centre distance − one radius). Owner: "Base edges if it's not too much of a pain."
13. **The "0" wound marker is the same digit model as 1–5, tinted neutral grey** (1–5 stay red). Owner: "Make it grey."

## Order
PR 4 (pick ignores lines, independent quick win) → PR 1 (ladder spots + bug C) → PR 5 (drop clearance + stair wedge) → PR 3a (deck drops / nav / gap fallback) → PR 3b (pick top faces) → PR 2 (end-overlap guard) → PR 6 (climbing ≤ 3") → PR 7 (step over ≤ 1") → PR 8 (split-level coherency) → PR 14 (base-edge measuring) with/before PR 9a → PR 9b/9c (squad geometry) → PR 10 (partial squad move; independent, can go any time) → PR 11 (per-model charges, after 9a/9b and 10). PR 12 (editor objectives) and PR 13 (zero marker) are independent quick wins, so do them alongside PR 4.

PR 6 reuses PR 5's stand-off and vertical-clearance machinery (a climb is a drop in reverse), so it must come after PR 5 and PR 3a. PR 7 relies on PR 2 so a model can't end on top of a stepped-over piece.

## Out of scope
- Visual polish of ladders/stairs beyond what a fix needs.
- Any jump/fall rule change (PRs 6–8 change climbing, stepping over low terrain and split-level coherency only).
- Changing the deck tier height (3.0"). If ladders should matter more later, that's a terrain-height decision, not a rule.
- The objective-height question and the checklist tidy from the earlier review. Those are tracked separately.

## Background
- Ladder waypoints: `getStairWaypoints` (`shared/src/engine/spatial.ts`, ladder branch). Today **foot and head are both the ladder's own position**, which the editor snaps onto the deck face (`MapEditor.snapLadderToFace`: position on the face, local +Z points into the floor, `scale.y` = floor top).
- Nav path: `findNavPath` step 5b inserts `[foot, head]` (or `[head, foot]` going down) when a segment climbs a ladder (`findLadderForSegment`). Step 6 clamps to the budget, and an unaffordable ladder climb stops at `p1` (the foot).
- Host checks in `validateAction` (`shared/src/engine/actions.ts`, move/rush/charge, single model ~l.320 and squads ~l.420, plus the charge equivalents ~l.650/760): `findMoveBlocker`, `detectPathGapJump(...).tooWide`, `isSuspendedInMidAir`, then a "suspended on ladder rungs" check that measures `end` against `foot` within 0.6".
- Squad models may not overlap each other (< 0.9" apart, `actions.ts` ~l.375/711; HUD toast in `GameHUD.ts` ~l.871). Nothing checks a model's end position against solids or against *other* units' models.
- Constants: `UNIT_COLLISION_RADIUS` 0.45, base radius 0.5, `EYE_HEIGHT` 1.1.
- **Found while planning (bug C, folded into PR 1):** `isSuspendedInMidAir` loops over the terrain and does `if (isLadderPiece(piece)) return false;` for *any* ladder on the map. So on every map that contains a ladder, the mid-air guard is switched off everywhere.

---

## Sub-plans (hand one PR section at a time to the `implementer`)
| Sub-plan | PRs | Theme |
| :--- | :--- | :--- |
| [batch-1a-quick-fixes.md](batch-1a-quick-fixes.md) | 4, 12, 13 | Stairs pick snapping, editor objectives, zero marker |
| [batch-1b-ladders-drops-midair.md](batch-1b-ladders-drops-midair.md) | 1, 5, 3, 2 | Ladder spots + mid-air guard, drop clearance, deck drops, end-overlap guard |
| [batch-1c-elevated-terrain-rules.md](batch-1c-elevated-terrain-rules.md) | 6, 7, 8 | Climb ≤ 3", step over ≤ 1", split-level coherency |
| [batch-1d-squads-measuring.md](batch-1d-squads-measuring.md) | 14, 9, 10, 11 | Base-edge measuring, per-model squad geometry, confirm-early moves, per-model charges |

Fixture: [fixtures/testy-mctestface.json](fixtures/testy-mctestface.json) (owner's map export; copy into `shared/tests/fixtures/` when a test needs it).

## Open questions
1. ~~PR 1 ladder cost~~: answered. The step-on is free (Decision 4).
2. ~~One mini or a squad?~~: answered. One mini (PR 1 alone covers the screenshot).
3. ~~The warning~~: answered. It was the expected "can't finish the climb" warning.
4. ~~Budget runs out over a gap~~: answered. Drop at the take-off edge and continue on the lower level toward the cursor (Decision 6).
5. ~~Map export~~: received, saved as `doc/plans/fixtures/testy-mctestface.json`. Both screenshots reproduce in the engine.
6. ~~PR 5 step-off cost~~: answered. The ~0.55" step fully off the edge before a drop **counts** as movement (Decision 7).
7. ~~Per-model rules for squads~~: answered. Yes (Decision 11).
8. ~~Base-edge measuring~~: answered. Yes (Decision 12, PR 14).
9. ~~Zero marker colour~~: answered. Grey (Decision 13).
