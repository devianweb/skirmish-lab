# Batch 1E: movement model (safe auto-paths, declared jumps, climbable terrain)
Status: approved (2026-11-02)
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)**, **Out of scope** and **Background** first: decision numbers below refer to it.

## Why
Playtesting showed the pathfinder making choices a tabletop player makes for themselves: it picks risky gap jumps when a safe drop exists, prefers ladders over drops, stops a model in mid-air when a jump can't be finished, and needed fallback rules (Decision 6) to patch that. Owner: "I'm wondering if I'm trying to get the pathfinder to do too much?"

On the tabletop nobody plans your route. You move the model, and you **declare** risky moves (jumping a gap, leaping off a ledge) because they involve dice and a chance to fall. This batch makes the digital version work the same way. The pathfinder only plans moves that are ordinary movement under the rules. Anything needing a dice test is an explicit choice offered in the move preview. Climbability is set per terrain type (overridable per piece), and the preview shows how each part of a path is traversed.

## Decisions (agreed 2026-11-02; Decisions 14–20 in the index)
- **P1. The pathfinder only uses ordinary movement.** Automatic, no prompt: walking, stairs/ramps, ladders, drops of ≤ 3", gaps of ≤ 1", and climbs of ≤ 3" up a climbable face (P4). It **never** chooses anything that needs a dice test.
- **P2. The pathfinder plans safe moves only; jumps are declared from where the model stands.** A move always follows the safe path as far as the budget allows, exactly as now, and the pathfinder never searches for jumps or take-off edges. A jump is offered only when the model is **already at an edge**: its centre is within the edge's stand-off spot + 0.5" (P5), and the cursor target is 3–6" below (jump down) or across a 1–6" gap (gap jump). The preview then offers e.g. "Jump gap 4.9" · 2 dice (3+)", and the player confirms the risk. To jump, the player first moves to the edge (a normal split move), then clicks the far side. Owner: "Even if they can't make the move in one go, I'd pathfind as far as possible as normal. The user can always move manually to the edge and click the jump prompt."
- **P2b. Drops follow the same split.** ≤ 3" is ordinary movement (automatic). 3–6" is a jump down: offered only from an edge, as in P2. A gap over 6" is never offered (it can't be crossed). A drop over 6" can't be jumped: it's offered only from an edge as an explicit choice with a red warning, "Drop 7.0": too high to jump — the model will fall (falling damage, activation ends)", and never planned. Owner: "Let the player decide."
- **P3. Supersedes Decision 6.** There is no automatic "drop instead of a failed jump" and no jump planning. A jump is a single hop from the model's current spot. A passed jump doesn't count toward the move (core rules), so it doesn't depend on the remaining budget. E1 checks the engine does this. Safe paths never end in mid-air.
- **P4. Climbability is data, not geometry (house rule; amends Decision 8).** Each terrain type has a catalog default `climbable: boolean`, and each placed piece can override it (`TerrainPiece.climbable?`, editor toggle). A model may climb onto a climbable piece's floor (any walkable solid's top) when the rise is ≤ 3" and the stand-off spot at the bottom is clear (PR 5's clearance checks: e.g. a ledge edge backed by a 4" ruin wall can't be climbed from outside, because the wall is in the way). Defaults: **shipping container: yes**, **ruin / ruin-l: yes** (broken masonry; the ledge is climbable from the courtyard, as tabletop players would allow), **platform-small / platform-large / catwalk: no** (slabs on pillars: use the ladder or stairs, which keeps ladders meaningful on 3" decks). Pieces without a walkable top (walls, columns, scatter) are irrelevant. Unknown/custom types default to **no**. The Beginner's Guide allows climbing terrain up to 3" without exceptions; making some pieces unclimbable is our rule, controllable per piece. Owner: "Yes go with A, then we can turn certain terrain off so it can't be climbed."
- **P5. Edge snapping tolerance.** The tolerance applies to the **cursor**, not the model: when the cursor (hover or click point) is within `EDGE_SNAP_TOLERANCE` = **0.5"** of a floor edge (measured horizontally to the edge line), the preview snaps to that edge. The take-off / climb point itself is always calculated exactly: the edge's stand-off spot (Decisions 4/7), with the walk to it measured as usual. So the player doesn't have to click pixel-perfect, but points clearly on the deck or the ground aren't grabbed. Owner thought 1" was too much. 0.5" is about half a base.
- **P6. Show how a path is traversed.** The move preview styles each part by type: walk (solid), stairs/ladder (solid), climb (orange), safe drop (amber), jump (dashed red with a dice icon), with a short label and cost ("climb 2.3"", "drop 3.0"", "jump 4.9" · 2 dice"). In F9 and in the map editor, the floors of climbable pieces get an orange outline.
- **P7. Manual waypoints: later.** Shift-click waypoints are deferred. Split moves (move to an edge, then move again) already give manual routing. Owner: "Later, I don't think we necessarily need it with multi moves straight away."

## Effect on the existing plans
- **Batch 1B PR 3** is split. **3a is replaced by E1 below.** The engine items still valid from the PR 3 section move into E1: stairs reachable from the side, a free drop costed below a ladder, the `deckPoints` rotation sign, never ending in mid-air. **3b (the pick only accepts upward-facing top-face hits) stays in 1B unchanged.** The paused 3a work is saved locally on branch `wip/pr3a-paused` (commit `45d78d4`, unreviewed, in worktree `agent-a601a94161d8a6a2f`). E1's implementer may mine it (stairs corner waypoints, deckPoints sign, tests) but must not take its gap-fallback logic.
- **Batch 1C PR 6** (climbing ≤ 3") is replaced by **E2 + E4**. PRs 7 and 8 are unchanged.
- **Decision 6** is superseded by P3. **Decision 8** is amended by P4 (only pieces whose `climbable` is true). Decisions 5 and 7 stand.
- **PR 2** (end-overlap guard) is unchanged.

## E1: Safe-only pathfinding + traversal classification (engine) (branch: `feat/safe-pathfinding`)
- **Layer:** shared engine.
- **Classify every path segment:** `classifySegment(state, a, b, unit)` → `walk | stairs | ladder | climb | drop | gap | jump-drop | jump-gap | fall | blocked`, with height/distance, dice (for jumps) and cost. `pathMovementCost`, `detectPathGapJump`, `describeDrop` and the HUD read this, so there's one source of truth.
- **`findNavPath` (safe):** only edges classified `walk/stairs/ladder/climb/drop/gap` are in the graph. Climbs require a climbable face (E2; until E2 lands, no climbing). The clamp never ends mid-air or mid-climb.
- **`findJumpOption(state, unit, from, target)`:** if `from` is at an edge (P2/P5) and the target is a lower floor 3–6" down, a floor across a 1–6" gap, or a lower floor more than 6" down (kind `fall`: no dice, a guaranteed fall, P2b), return it: take-off (the stand-off spot), landing spot, kind (jump-drop / jump-gap), distance, dice and success target (pathfinder 2+, airborne auto). Otherwise return null. No path search.
- **Carry over from 1B PR 3 (still needed):**
  - stairs reachable from the side (clearance waypoints around the wedge's foot corners)
  - a free drop costed below a ladder descent
  - ruin ledge → ground steps off the open end
  - the `deckPoints` local→world sign (use `localToWorldXZ`)
- **Host:** a move action may carry an explicit `traversal: { kind: 'jump-drop' | 'jump-gap' | 'fall', takeoff, landing }`. The host recomputes and validates it: edge proximity; gaps ≤ 6"; drops 3–6" for `jump-drop`, > 6" for `fall`. It rolls the jump dice (or applies the fall) via the existing traversal dice path. A move without it that would need a jump is rejected ("needs a jump: choose it explicitly").
- **Tests first (fixture):**
  - ledge → ground in the gap: safe path steps off the east end, drop 3", cost ≈ 3.5, no jump
  - platform A → ground beside: free edge drop, not the ladder
  - ledge → platform A: the safe path goes as far as the budget allows (never over the gap); from the ledge's east edge, `findJumpOption` offers the 5" gap jump (2 dice); from the middle of the ledge it returns null
  - ground beside the stairs → platform A via the stairs round the corner, cost ≈ 10
  - a host move needing a jump without the explicit traversal is rejected; with it, it's accepted and rolls 2 dice
  - no path ever ends in mid-air (property check over sampled targets on the fixture)
- **Docs:** RULES_SPECIFICATION §10.2 (jumps are declared), SYSTEMS.md movement section, DATA_MODEL (move payload `traversal`), ROADMAP.

## E2: Climbability data + climbing ≤ 3" (engine + data) (branch: `feat/climbable-terrain`)
- **Replaces 1C PR 6.** Same climbing rules (Decision 8: rise ≤ 3", vertical counts, not difficult, all-or-nothing, stand-off counts), but only onto pieces whose `climbable` is true (P4).
- **Data:** add `climbable` to `TERRAIN_PALETTE_CATALOG` defaults (`shared/src/data/mapSchema.ts`): container and ruin/ruin-l true, platforms and catwalk false; `TerrainPiece.climbable?: boolean` override; helper `isClimbable(piece)` = override ?? catalog default ?? false.
- **Nav:** climb candidates are the stand-off spots off each walkable-solid edge of climbable pieces (the same spots PR 5 made for drops, used in reverse), kept only if the rise is ≤ 3" and the climb column is clear.
- **Tests first:**
  - container: climbable from all four sides without a ladder; cost = horizontal + 2.25
  - ruin: the ledge (3.0") is climbable from the courtyard; not from outside past the 4" wall
  - platform-small / catwalk: not climbable (a deck still needs its ladder or stairs)
  - override: a container with `climbable: false` can't be climbed; a platform with `climbable: true` can
  - a stacked container-on-container (4.5" rise): not climbable (> 3")
  - all-or-nothing: a budget too small to finish the climb stops at the stand-off spot
- **Docs:** RULES_SPECIFICATION §2.3 (Climbing) and §8 (replace the old "no free climbing" line), DATA_MODEL (`climbable`), ASSETS (climbable column in the catalog table), ROADMAP.

## E3: Move preview: explicit jumps, traversal styling, edge snapping (client HUD) (branch: `feat/preview-traversal`)
- **Preview segments styled per P6, with labels and cost.** No rules logic: render `classifySegment` output.
- **When `findJumpOption` returns an option** (the model is at an edge and the cursor is across a gap or below): the preview shows the jump with a chip "Jump gap 4.9" · 2 dice (3+)" / "Jump down 4.0" · 2 dice". Confirm sends the move with the explicit `traversal`. Otherwise the preview shows the safe path as far as the budget allows, as now. The dice summary and the "Movement hazards" dice-log panel already exist.
- **Edge snapping (P5):** hovering or clicking with the cursor within 0.5" of an edge snaps the drop/jump/climb to that edge's stand-off spot.
- **Squads:** each model's leg is classified. A jump chip applies to the model being placed.
- **Tests:** HUD tests with injected state. Chips appear only when options exist. Confirm builds the right payload. Safe-only targets show no chips. Labels match the classification.
- **Manual checks:** §4 rewritten around declared jumps (see below).

## E4: Show climbability (F9 + editor) and the per-piece toggle (client renderer/editor) (branch: `feat/climbable-terrain-ui`)
- F9: an orange outline on the floors of climbable pieces. Editor: the same when a piece is selected, plus a **Climbable** checkbox in the inspector, pre-set from the catalog default (writes `climbable`).
- **Tests:** renderer test that a container gets the orange outline and a platform doesn't. Editor test that the toggle round-trips through save/load.
- **Manual checks:** §1 and §3 items.

## Manual checks this batch would add (preview)
- From a deck, clicking the ground beside it previews walk → amber "drop 3.0"" with no jump offered. Clicking with the cursor within 0.5" of the edge snaps to the edge.
- Between two decks with a 5" gap: from the middle of a deck, hovering the far deck previews the safe route as far as the budget goes (never over the gap). After moving to the edge, hovering the far deck offers "Jump gap 4.9" · 2 dice". Nothing ever previews in mid-air.
- The container and the ruin ledge (from the courtyard) can be climbed without a ladder (orange "climb …""). A platform deck can't (needs its ladder or stairs). Unticking **Climbable** on a piece in the editor stops it being climbed.
- F9 and the editor outline climbable pieces in orange.

## Order
1B PR 3b (pick) → E1 → E2 → E3 → E4 → 1B PR 2 → 1C PR 7 → 1C PR 8 → 1D.

## Open questions for the owner
1. ~~Edge tolerance~~: 0.5", cursor-to-edge (P5).
2. ~~Seam tolerance~~: no longer needed. Climbability is data (P4).
3. ~~Manual waypoints~~: later (P7).
4. ~~Clicking the far deck~~: the safe path as far as possible. Jumps are only offered from where the model already stands at an edge (P2).
5. ~~Drops over 6"~~: (b), offered from an edge with a red "you will fall" warning (P2b).
