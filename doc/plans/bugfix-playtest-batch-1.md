# Bugfix batch 1: playtest fixes + elevated-terrain rules alignment
Status: approved (2026-11-02), split into sub-plans
Roadmap: tick items under the existing `### 13.6 playtest fixes (bugfix batch 1, …)` heading in doc/ROADMAP.md (just above the 13.6 Acceptance Criteria). Don't create a new heading.

## Goal
A running list of small bugs the owner finds while playtesting, each fixed as its own small PR. Every item says what the player sees, why it happens, and the agreed fix. New bugs are appended as further PR sections. Each section can be handed to the `implementer` agent independently once its open questions are answered.

PRs 6–8 bring movement in line with the Elevated/Impassable Terrain guidance in the OPR **Beginner's Guide v3.5.1** (`/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Beginner's Guide v3.5.1.pdf`, "Terrain" chapter). The core rules are silent on climbing. Read the guide; describe the rules in our own words (clean-room).

## Decisions (agreed)
1. A model never ends a move with its base inside the ladder or overlapping the deck it is climbing. The ladder foot and head are real standing spots (see PR 1).
2. A move never ends with a model's base overlapping solid terrain or another model. The end is pulled back along the path to the nearest clear spot, never pushed forward, and the host rejects any move that still overlaps (see PR 2). This is the same pattern as the existing "never end in mid-air" rule.
3. Ladders stay non-blocking terrain (`isObstacle: false`). We fix the standing spots instead of making the ladder an obstacle.
4. **The ladder step-on/step-off is free.** A ladder costs only its vertical climb, as today. The ~0.55" shuffle between the climb line and the foot/head spot is not measured, just as a tabletop player wouldn't measure it. Owner: "I don't think you'd measure that whilst playing the tabletop right?"
5. **Targeting the ground from a deck means walk to the edge and drop** (free ≤ 3", jump test 3–6"). Never a level crossing into mid-air. Owner: "it should have pathfound including a drop to the floor, rather than trying to jump into mid air."
6. ~~**If the budget can't complete a gap jump, the path drops instead.**~~ *(Superseded by Decision 16.)* The model walks to the take-off edge, drops to the level below (free ≤ 3", jump test 3–6") and moves along the lower level toward the point under the cursor, as far as the budget allows. It never ends over open air and never offers a jump it can't finish. Owner: "unless you have the movement range to make the jump, it should imply a drop and movement along the lower level to meet the cursor."
7. **A drop's step-off counts.** Before dropping, the model's whole base moves off the edge (`DROP_STANDOFF` ≈ 0.55"). That horizontal movement is measured like any other (unlike the free ladder step-on in Decision 4). Owner: "Yes it should."
8. **Climbing up to 3"** *(amended by Decision 17: only onto pieces whose `climbable` is true)*. A model may climb terrain up to 3" tall (a height difference of ≤ 3.0" between the floor it leaves and the floor it climbs onto) as part of a normal move. The vertical distance counts as movement, like any other movement, and it is **not** difficult terrain. It can't end a move part-way up (all-or-nothing, like ladders). Taller rises need a ladder or stairs. Decks (3.0"), the ruin ledge (3.0") and the container roof (2.25") therefore become climbable without a ladder. Before climbing, the model stands a full base off the face (same stand-off as drops, Decision 7), and that horizontal step counts. Replaces the old "sheer wall = difficult terrain + 15" nav penalty" code and the unagreed "no free climbing" line in RULES_SPECIFICATION §8. Owner agreed 2026-11-02 after reading the Beginner's Guide.
9. **Terrain 1" tall or less can be stepped over.** Pieces whose solids are all ≤ 1.0" above the floor they stand on (barricade 0.5", crate 0.75", pipe 0.75") don't block movement. A path goes straight over them at no extra cost (measure as if they weren't there). A model still can't **end** its move on or overlapping one (PR 2). They still give cover and are still drawn and collided for LoS exactly as now. Walls, columns, containers etc. (> 1") still block.
10. **Split-level coherency.** Squad models on different levels (|Δy| > 0.5") may be up to 3" apart (edge to edge, i.e. 4.0" centre to centre with 1" bases) instead of 1". Simplification: the guide allows this when not all models fit on the elevated part. We allow it whenever models are on different levels rather than computing "fit". The 6" whole-squad limit is unchanged.
11. **Squads follow the tabletop per-model rules.** For any interaction between units, measure between models, not unit centres: a target is valid if any shooting model sees and reaches any target model; only those models fire; cover by majority of target models; charges move each model into contact; only models within 2" horizontal / 4" vertical of an enemy model strike; the 1" keep-away rule is per model. `unit.position` is a display anchor only. Owner: "add those to the plan" (2026-11-02), after the per-model walkthrough.
12. **Measure like the tabletop: from the closest points of the bases.** Model↔model distances (shooting range, charge reach, the 1" keep-away rule, engagement/contact, melee strike reach, coherency 1" and 6", range-gated special rules like "> 9"") use base edge to base edge (centre distance − both base radii). Model↔marker distances (objective control 3") use base edge to marker point (centre distance − one radius). Owner: "Base edges if it's not too much of a pain."
13. **The "0" wound marker is the same digit model as 1–5, tinted neutral grey** (1–5 stay red). Owner: "Make it grey."
14. **The pathfinder only uses ordinary movement** (walk, stairs, ladders, drops ≤ 3", gaps ≤ 1", climbs ≤ 3" onto climbable pieces) and never chooses a dice-tested move. See batch 1E P1.
15. **Jumps are declared from where the model stands:** a jump down 3–6" or a gap jump 1–6" is offered only when the model is already at an edge and the cursor is across or below; drops over 6" are offered from an edge with a red "you will fall" warning; gaps over 6" are never offered. See 1E P2/P2b.
16. **Decision 6 is superseded:** no automatic drop-instead-of-jump and no jump planning; a passed jump doesn't count toward the move. See 1E P3.
17. **Climbability is data:** catalog default per terrain type (container and ruin yes; platforms and catwalk no; unknown no) plus a per-piece `climbable` override. Amends Decision 8. See 1E P4.
18. **Edge snapping:** the cursor within 0.5" of a floor edge snaps to it; take-off/climb points are always the exact stand-off spots. See 1E P5.
19. **The move preview shows how each part is traversed** (climb, drop, jump styles + labels); climbable pieces are outlined in F9 and the editor. See 1E P6.
20. **Manual shift-click waypoints are deferred** (split moves cover manual routing). See 1E P7.
21. **Split charges:** a Charge keeps its single budget (12" base) but may be made in legs: declare the target, make safe legs (obeying the 1" keep-away rule, base edge to base edge, against every other enemy unit), declare a jump from an edge like a move (a pass is free; a fail falls, ends the activation, no melee), then a final leg into contact. If contact becomes impossible, the charge ends without melee. A separate move action before a charge is not allowed (one action per activation). Owner: "is a better alternative that we allow movement actions before a charge … then we don't have to do any pathfinding" → agreed as legs within the one Charge action. See 1D PR 16.
22. **A declared charge can't be undone** or changed into another action. Owner: "Agreed, no undoing."
23. **Default board for new maps is 48" × 48"** (the core rules' and tournament standard); existing maps keep their stored size. See batch 1G. Owner: "Go with your recommendation."
24. **Jump distance is measured spot to spot, like a tape on the table:** the straight 3D line from the model's take-off standing spot to its landing standing spot (front of base to front of base), so a jump across a gap is about gap + 1". Dice are X+1, one per full 3" of that distance; the 6" limit applies to it (a longer gap hop isn't offered; a pure drop over 6" is still a declared fall). A hop crossing more than 1" of open air is a gap jump even if it also drops. Owner: "Lets go for C … Spot to spot is more tabletop like right? As you'd measure from the front of the base to the front of the base."
25. **Airborne is not exempt from the end-position rules:** an Airborne (Flying) model moves through units and terrain and ignores terrain effects while moving, and passes jump tests automatically, but it must still end its move fully supported on a floor or the ground (no overhanging, no mid-air endings), like any model placed on the table. Owner: "Go with your recommendation."
26. **Aim line prefers the clicked model** (preview only). See 1I PR 27.
27. **Cover by majority stays strict** (more than half the living target models).
28. **A squad that started its activation out of coherency can't shoot without moving** (it's a Hold). See 1I PR 29.
29. **Regrouping: closer counts.** A squad that started an action out of coherency may end it still out of coherency if its coherency shortfall goes down; a coherent squad must stay coherent. Owner: "Your suggestion sounds reasonable." See 1I PR 29.
30. **A failed squad jump stops the later jumpers** at their take-off spots; walking models finish. Owner: "Lets go with your original plan if it's closer to the tabletop." See 1I PR 31.
31. **"As close as possible" in squad charges uses ordinary movement only**, is checked by the host, and fills in unplaced models; at least one model must still be in base contact; no extra 3" for chargers. See 1I PR 32.
32. **Per-model movement budgets across legs** in split moves and split charges. Owner: "Makes sense." See 1I PR 30.
33. **The host rejects a squad charge without `modelPositions`.** Owner: "Agreed." See 1I PR 27.
34. **Coherency is one unbroken chain:** the links (1" same level, 3" across levels) must join every living model into one group, plus the 6" spread. Owner: "Add the chain rule." See 1I PR 28.
35. **The defender places their own pile-in models** (prompt; host-checked "as close as possible"; the charger's strike is rolled after; timeout falls back to automatic placement). Owner: "It's unfair to just move the minis when it could put them in dumb / unsafe positions." See 1I PRs 33–34.
36. **Squad-mates never block each other's line of sight** (already true; only other units' models block). No change.
37. **The owner of a damaged squad picks its casualties** (any living models; timeout picks chain-preserving ones). Owner: "prompt the defender to remove the models he wants rather than automating." See 1I PRs 35–36.
38. **Too-wide gaps get a hint** in the move preview (HUD only). See 1I PR 27.
39. **The distance left is always shown** during split moves/rushes, per model for squads (HUD only). See 1I PR 30.

## Order
**Updated 2026-11-03:** 1A ✓, 1B ✓ (PRs 1, 5, 3b, 2), 1E ✓ (E1–E4). 1F ✓. **Next:** PR 7 (step over ≤ 1") → PR 8 (split-level coherency) → PR 14 (base-edge measuring) with/before PR 9a → PR 9b/9c (squad geometry) → PR 10 (partial squad move; independent, can go any time) → PR 15 (squad jumps, with PR 10) → PR 16 (split charges with jumps) → PR 11 (per-model charges, after 9a/9b, 10 and 16). PR 12 (editor objectives) and PR 13 (zero marker) are independent quick wins, so do them alongside PR 4.

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
| [batch-1i-squad-followups.md](batch-1i-squad-followups.md) ✓ done | 27–36 | Quick wins (aim, no block charges, jump preview fixes), chain coherency, regrouping, per-model budgets + distance left, failed squad jumps, as close as possible for chargers, defender pile-in prompt, owner picks casualties (Decisions 26–39) |
| [batch-1a-quick-fixes.md](batch-1a-quick-fixes.md) ✓ done | 4, 12, 13 | Stairs pick snapping, editor objectives, zero marker |
| [batch-1b-ladders-drops-midair.md](batch-1b-ladders-drops-midair.md) ✓ done | 1 ✓, 5 ✓, 3b, 2 | Ladder spots + mid-air guard, drop clearance, top-face picking, end-overlap guard (PR 3a → 1E E1) |
| [batch-1c-elevated-terrain-rules.md](batch-1c-elevated-terrain-rules.md) ✓ done | 7, 8 | Step over ≤ 1", split-level coherency (PR 6 → 1E E2/E4) |
| [batch-1d-squads-measuring.md](batch-1d-squads-measuring.md) ✓ done | 14, 9, 10, 15, 16, 11 | Base-edge measuring, per-model squad geometry, confirm-early moves, squad jumps, charge jumps, per-model charges |
| [batch-1h-post-1f-fixes.md](batch-1h-post-1f-fixes.md) ✓ done | 24, 25, 26 | Raised stairs, gap-with-drop jump classification, stale rush message |
| [batch-1g-board-size.md](batch-1g-board-size.md) ✓ done | 21, 22 | Configurable board size (default 48×48), roadmap 13D |
| [batch-1f-traversal-followups.md](batch-1f-traversal-followups.md) ✓ done | 20, 17, 18, 19 | No overhanging ends + climb label, stacked-level climb/drop, failed-jump landing fixes, floating 3D path labels |
| [batch-1e-movement-model.md](batch-1e-movement-model.md) ✓ done | E1–E4 | Safe-only pathfinding, declared jumps, climbable terrain, traversal preview. Replaces 1B PR 3a and 1C PR 6; supersedes Decision 6. |

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

**Answered after 1C/1D (2026-11-04, Decisions 26–33, planned in [batch-1i-squad-followups.md](batch-1i-squad-followups.md)):**
10. ~~Aim line prefers the clicked model?~~ Yes (Decision 26).
11. ~~Cover by strict majority?~~ Yes, unchanged: 2 of 4 is not cover (Decision 27).
12. ~~Block shooting without moving while out of coherency?~~ Yes (Decision 28).
13. ~~Squad that can't regroup?~~ A move that ends closer to coherent is accepted; Hold stays blocked (Decision 29).
14. ~~Failed jump stops the others?~~ Walkers finish; later jumpers stop at their take-off spot (Decision 30).
15. ~~Loose "as close as possible" in squad charges?~~ No: checked by ordinary movement, unplaced models auto-placed; still needs one model in contact; no extra 3" (Decision 31). The defender now places their own pile-in models (Decision 35).
16. ~~Budget per leg as the longest model path?~~ No: per-model totals across legs (Decision 32).
17. ~~Reject a squad charge without `modelPositions`?~~ Yes (Decision 33).

## Follow-ups found during 1B/1E
- Squads can't declare jumps → **1D PR 15**.
- No jump option on charges → **1D PR 16** (split charges in legs, Decisions 21–22).
- Climbing/dropping between a deck and stacked pieces → **1F PR 17**.
- Failed gap jumps (no damage from 3" decks, lands at y=0/inside things, squads stacked, wrong wound count) → **1F PR 18**.
- Segment labels HUD-only → **1F PR 19**.
- Squad moves without explicit `modelPositions` are only overlap-checked at the centroid → covered by 1D PR 9 (per-model geometry).
- ~~Airborne and the no-overhang rule~~: not exempt (Decision 25).
- A plain fall over 6" in a squad applies its hit to the first living model (pre-existing); tidy with 1D squad work.
- `MapStore.importMapJson` falls back to 44×30 when an imported file has no board (keeps old maps unchanged; differs from `DEFAULT_BOARD_SIZE`).
- Editor: the Cover / Blocks LoS / Obstacle inspector toggles don't redraw the F9 debug marker until the next sync (pre-existing, cosmetic; unplanned).

## Follow-ups found in the 2026-11-04 manual pass
- **No feedback over a too-wide gap** (checklist 6.2) → **1I PR 27** (Decision 38).
- **Squad jump hover preview missing** (owner: "the jump works but no red path or floating chip show up"): the squad hover preview passes `allowJump: false` → **1I PR 27**.
- **Remaining movement isn't shown during a split move/rush** → **1I PR 30** (Decision 39).
- **Casualty choice** (owner: "prompt the defender to remove the models he wants") → **1I PRs 35–36** (Decision 37).
- **Answered (no change): out-of-sight models can still be casualties.** Hits and wounds go to the unit: 4 hits mean 4 Defense rolls, and each failed roll removes one model (until the last), wherever it stands. Line of sight only decides which models fire, whether the target is valid, and cover by majority.
- **Answered (no change): 6 strike-back dice in a 4 v 4.** The TEST squad's Blade has 2 attacks, so 6 dice means 3 defending models were within 2" of a charger (`strikers`), as intended.
- **Charge that ended with no melee** (log 2026-11-04): leg 1 + leg 2 used 23.97" of the 24" budget because each leg charges the longest model path and model 1 moved furthest both times, while models 2–4 had 3–5" of their own left → per-model budgets, **1I PR 30**. The next activation's declared charge that "cannot move any closer" is not explained yet: it needs a state snapshot with the target's model positions.

## Follow-ups found during 1I (owner to decide; not planned yet)
- **A stopped jumper's take-off spot isn't checked** (1I PR 31): after a failed squad jump, a later jumper is placed at its declared take-off spot without a fresh overlap check, so it could overlap a squad-mate that ended its own move on that spot. Rare. Option: place it at the nearest clear spot at that edge.
- **Mixed-wound squads and casualty picks** (1I PR 35): the pre-rolled wound-effect result assumes the survivor's toughness; if a squad ever mixes models with different `maxWounds`, the pick could change the survivor. Not reachable with current data (all squad models have 1 wound).
