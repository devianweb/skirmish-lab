# Batch 1B: ladders, drops, gaps and mid-air
Status: done (2026-11-03): PRs #160, #162, #165, #171 (PR 3a replaced by 1E E1)
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)**, **Out of scope** and **Background** first: decision numbers below refer to it.

The movement bugs from playtesting on `fixtures/testy-mctestface.json`. Order: PR 1 ✓ → PR 5 ✓ → PR 3b (pick) → then batch 1E (E1–E4) → PR 2. (PR 3a is replaced by 1E E1.)

## PR 1: Ladder standing spots + mid-air guard fix (branch: `fix/ladder-standing-spots`)
**Owner report:** "Rush to the bottom of the ladder correctly moves the mini to the bottom of the ladder … but it's mashed the models together." The mini's base ends up inside the ladder and half under the deck.

- **Layer:** shared engine (client needs no code change; the HUD preview and the F9 ray use `findNavPath`)
- **Files:** `shared/src/engine/spatial.ts` (`getStairWaypoints` ladder branch, `isSuspendedInMidAir`), `shared/src/engine/actions.ts` (ladder-rung check), tests in `shared/tests/engine/` (spatial/elevation/actions)
- **Tests first:**
  1. For a ladder snapped to a 3.0" deck face at yaw 0/90/180/270: `foot` is outside the face by `LADDER_STANDOFF` along local −Z at ground height. `head` is on the deck by `LADDER_STANDOFF` along local +Z at the floor's top. A 0.5"-radius base at the foot doesn't overlap the deck solid or its pillars, and a base at the head lies fully over the walkable floor.
  2. `findNavPath` from the ground to the deck via the ladder: the path is foot → climb vertically at the foot's x/z to the top → step onto the head → continue. No slanted climb segment.
  3. With a budget too small to finish the climb, the path ends at the (new) foot, not at the ladder position.
  3b. Cost: `pathMovementCost` of foot → climb → head equals the ladder height (the step-on leg costs 0), and a model with exactly `height` budget left reaches the head.
  4. Going down mirrors it (head → step off to above the foot → vertical descent → foot).
  5. `isSuspendedInMidAir` returns **true** for a point 2" up in open air on a map that contains a ladder elsewhere (bug C). It returns false only for points on that ladder's climb line between foot and head heights.
  6. The rung check: ending part-way up the climb line is still rejected; ending at the new foot or head is accepted. Update the existing test `rejects moves that end suspended mid-air on a ladder rung` to the new geometry.
- **Implementation steps:**
  1. Add `LADDER_STANDOFF = 0.55` (base radius 0.5 + 0.05 clearance) next to the other constants.
  2. Ladder branch of `getStairWaypoints`: foot = position − STANDOFF·(local +Z in world) at `botY`; head = position + STANDOFF·(local +Z) at `topY`. Local +Z in world = `(sin yaw, cos yaw)`, the same convention as stairs.
  3. `findNavPath` step 5b: climbing inserts `[foot, {foot.x, topY, foot.z}, head]`; descending inserts `[head, {foot.x, topY, foot.z}, foot]`. Check that the clamp still treats the vertical leg as the "ladder climb" (all-or-nothing). The step-on/step-off leg between the climb line and the head is **free** (Decision 4): give it zero cost in both the nav clamp's `segCost` and `pathMovementCost` (recognise it as the short level leg at the top of a ladder's climb line), so the host and the HUD agree.
  4. `isSuspendedInMidAir`: replace the blanket `return false` with "point lies on this ladder's climb line" (within ~0.3" of `(foot.x, foot.z)`, y between foot and top).
  5. Ladder-rung host check: measure against the climb line `(foot.x, foot.z)`, not the old position.
- **Docs:** SYSTEMS.md (ladder paths sentence: foot/head are standing spots off/on the deck), RULES_SPECIFICATION.md §2.3 ladders (one line), ROADMAP fix bullet.
- **Manual checks:** update §3 "Ladder path" item: the mini stops at the foot with its base against the ladder (not inside it); at the top it stands fully on the deck. Add: on a map with a ladder, a move still can't end in mid-air elsewhere.
- **Also fixes: can't climb onto the shipping container with a ladder (owner report, same map).** Reproduced: with a ladder snapped to the container's face (x = −6.5), `findNavPath` stops at the ground and the direct path is "blocked by terrain". The container body is one solid from 0 to 2.25", so a base centred on the face (the current foot) overlaps it. Platforms only work because the space under a deck is open. Moving the ladder position 0.55" out (simulating the stand-off) makes the climb path work: foot → climb → step onto the roof. Add test 7: ground → container roof via a snapped ladder succeeds at all four ladder rotations. Climbing the container without a ladder comes in PR 6 (Decision 8).
- **Done when:** all tests pass and the owner's screenshot case (rush that can't afford the climb) leaves the base touching the ladder from outside.
- **Behaviour change to call out:** none in cost (the step-on is free). Only where the model stands at the foot and the head changes, plus bug C: the mid-air guard now also applies on maps with ladders.
- **Repro of bug C (confirmed 2026-11-02 against `shared/dist`):** two 4×4 platforms with a 4.9" gap and a 4" budget. The path ends at x=4, y=3 over open air. `isSuspendedInMidAir` returns true without a ladder on the map, and **false** once any ladder is added 30" away.

---

## PR 5: Drops pass through decks and stairs (branch: `fix/drop-clearance`)
**Owner report (screenshot):** "You can climb down between the top of the stairs and the deck." A model on the stairs paths up to the stair head, then drops straight down through the gap where the stair meets the deck, and walks on under the platform.

- **Cause (found by reading the code, verify with a test first):** `findMoveBlocker` (`shared/src/engine/spatial.ts`) skips any segment with no horizontal length (`if (segLen < 1e-6) continue;`). A drop is a vertical segment, so it's **never collision-checked**. Whatever is under the drop point (a deck slab, the stair wedge, a crate) is ignored. The nav graph then happily uses "climb to the stair head, drop through the deck edge" as a shortcut under the platform. Related: the drop point itself sits exactly on the edge (in the PR 3 repro the drop is at x = 2.0 for a deck spanning −2…2), so half the model's base is still over the deck when it falls.
- **Second cause (reproduced on the fixture):** a segment that *touches* stairs counts as "on stairs" (`isSegmentOnRampOrStairs`), and `findMoveBlocker` then skips the stair wedge entirely. So deck (7,3,0) → ground (6.32,0,1.32) goes diagonally down through the solid high end of the wedge. On stairs, only segments that follow the slope surface (y within ~0.3" of `getStairSurfaceHeight` along the segment) should count as on-stairs. Anything else is collision-checked against the wedge body.
- **Layer:** shared engine (nav + host validation). No client changes expected.
- **Files:** `shared/src/engine/spatial.ts` (`findMoveBlocker`, `isSegmentOnRampOrStairs`, drop-point generation in `findNavPath`, `isFreeDropSegment`), tests.
- **Tests first:**
  1. A vertical drop segment whose fall column (a base circle of `UNIT_COLLISION_RADIUS` swept from the start height down to the landing height) intersects a deck slab, a stair wedge, or any obstacle solid is **blocked**, both in `findMoveBlocker` (host) and in `findNavPath` (no such edge in the graph).
  1b. Fixture: platform A (7,3,0) → ground (3,0,0.5) never passes through the stair wedge, and a unit mid-slope (7,1.5,3) can't reach the ground at the stair head (7,0,1) through the wedge.
  2. The screenshot case: platform with stairs snapped to its face, unit on the slope, target on the ground on the far side under the deck. The path walks down the stairs (or steps off the stair side where the fall is clear) and never drops at the stair head.
  3. A legal edge drop still works: from a deck to the ground beside it, the drop point is **outside** the deck by at least the base radius + clearance, so the fall column is clear. Cost and jump-test thresholds are unchanged.
  4. Stepping off the open side of a stair slope (fall column clear) is still allowed as a drop from the slope height.
  5. Regression: existing drop, ladder and stair tests still pass (fixture positions may move by the stand-off).
- **Implementation steps:**
  1. In `findMoveBlocker`, handle near-vertical segments (horizontal < 0.05", |Δy| > 0.5): test the base circle at that x/z against every obstacle solid (and the stair wedge body) whose vertical span overlaps `(landingY + 0.05, startY − 0.05)`. Ignore the floor being landed on and the floor being stepped off *only if the circle is clear of it horizontally*.
  2. Where the nav generates drop points at floor edges, place them `DROP_STANDOFF` (base radius 0.5 + 0.05) beyond the edge, so the whole base clears the deck before falling. Use the same stand-off idea as PR 1's ladder spots.
  3. Make sure the vertical-segment check also covers a ladder's climb line (PR 1). It must be clear of the deck it climbs, which the 0.55" stand-off guarantees.
- **Docs:** SYSTEMS.md drops bullet ("a drop needs clear air below the model's base; models step fully off the edge before falling"), ROADMAP fix bullet.
- **Manual checks:** §4 add: a model can't drop through a deck, the gap at a stair head, or onto/through scatter. Dropping off a deck edge or the open side of stairs still works. The drop point is a full base off the edge.
- **Overlaps with:** PR 2 (end-of-move overlap) and PR 3 (deck drops). Do PR 5 **before** PR 3, because PR 3's "path drops at the edge" relies on drop points being legal. Behaviour to confirm: Open question 6.

---

## PR 3: Drops from decks / never path into mid-air (branch: `fix/deck-drops`)
> **Superseded in part by batch 1E (2026-11-02):** PR 3a (engine) is replaced by 1E **E1**. Only **PR 3b** (the pick accepts only upward-facing top-face hits) remains here. The engine notes below are kept as background for E1.
**Owner report (screenshot, deployed build):** the cursor was over the **ground in the gap** between two decks. The Rush preview showed "GAP JUMP (4.9"): roll 2 dice" and a destination marker floating at deck height over the gap. Owner: "I think it should have pathfound including a drop to the floor, rather than trying to jump into mid air … Dropping from the platform seems to be entirely broken honestly."

**Agreed behaviour (Decision 5):** when the target is the ground (or any lower floor), the path walks to the deck edge and drops down: free if ≤ 3", the jump test if 3–6". It never crosses the gap at deck height, and it never ends over open air.

- **Fixture:** the owner's map is saved at `doc/plans/archive/fixtures/testy-mctestface.json` (ruin-l at (−2,−1) with its 3.0" ledge; platform-small A at (7,−1) with a ladder on its west face at x=5 and stairs on its south face (head at z=1, foot at z=5); catwalk (9…15) flush to platform-small B at (17,−1). The ruin ledge's east end (x=0) and platform A's west edge (x=5) leave a 5" gap). Copy it to `shared/tests/fixtures/` and drive the tests below from it.
- **Reproduced in the engine alone, no client involved (2026-11-02, `findNavPath` on the fixture, budget 12):**
  | From → to | Path today | What's wrong |
  | :--- | :--- | :--- |
  | Ruin ledge (−1,3,0) → ground in the gap (2.5,0,0) | ledge → **level across the 5" gap** to the ladder top at x=5 (gap jump, 2 dice) → down the ladder → walk back to 2.5. Cost 11.8 | Should step off the ledge's open east end and drop 3" (free), cost ≈ 3.5. With a smaller budget the clamp stops mid-gap: that's the screenshot. |
  | Platform A (7,3,−1) → ground in the gap (2.5,0,−1) | walk to the ladder at x=5 → climb down (costs 3) → walk. Cost 7.5 | A free ≤3" drop off the edge (cost ≈ 4.5) is never considered when a ladder or stairs is nearby. The ladder is costed as cheaper than a free drop. |
  | Platform A (7,3,0) → ground (3,0,0.5) | deck → **diagonally down through the stair wedge** to the ground under its high end (6.32,0,1.32) → out the side. Cost 7.4 | Passes through the solid stair body (see PR 5). |
  | Ledge ↔ Platform A | a single level segment across the 5" gap with a 2-dice jump | Fine **only** if the budget completes it. Otherwise it stops mid-gap. |
- **Root causes (engine):**
  1. **Drop-off edges aren't nav candidates** for structured floors (at least the ruin ledge strips). `findNavPath` adds edge waypoints only for some floors, so "step off here and drop" is often missing from the graph, and the planner reaches for gap jumps, ladders or stairs instead. Check `addPlatformAscentPoints` / waypoint generation for walkable *solids* (`getWalkableSurfaces`), not whole pieces.
  2. **Drop costing:** make sure the graph uses `pathMovementCost` rules (free drop ≤3" = horizontal only), so a drop beats a 3" ladder descent.
  3. **The clamp can stop over open air** on a level gap segment (no all-or-nothing guard like drops/ladders).
  4. Bug C hides it from the host (PR 1).
- **Pick (secondary, still worth fixing):** `GameView.computePickTarget` can accept a deck **side-face** or kick-plate hit as "on the floor" (within 0.05" of the footprint and 0.15" of the top). Require an upward-facing hit.
- **Update after PR 1 (#160) and PR 5 (#162) merged (replayed on the fixture):**
  - PR 5 added per-surface drop spots (edge point → over-air point one `DROP_STANDOFF` out → ground point), made A* cost drops by horizontal distance, and made "step off, then fall" all-or-nothing. **Build on these. Don't duplicate them.**
  - Still wrong:
    - Ruin ledge (−1,3,0) → ground (2.5,0,0) still crosses the 5" gap at deck height to the ladder's climb-top, then climbs down (cost 10.7, gap 4.6). It should step off the ledge's open east end and drop 3".
    - Platform A (7,3,−1) → ground (2.5,0,−1) climbs down the ladder (cost 6.4) instead of the cheaper free edge drop (≈5.0).
    - Ledge → platform A with a 4" budget still ends at (2.97,3,−0.5) over the gap (host now rejects it via the mid-air guard, but the nav must not produce it: Decision 6).
  - **New, pre-existing nav gap: stairs can't be reached from the side.** From ground (10,0,4), next to the stairs at (7,0,3) (yaw π, foot waypoint (7,0,5.2)), the direct segment to the foot is correctly blocked by the wedge, but there are no nav waypoints around the wedge's foot corners. So the planner never finds the stairs. A target on the slope (7,1.5,3) or on platform A routes to the ladder instead. Add clearance waypoints around the stair wedge's footprint corners (at least the two foot-end corners, offset by `UNIT_COLLISION_RADIUS` + margin), and test: from (10,0,4) the path to platform A goes round the corner, up the stairs, cost ≈ 10.
  - **Suspected bug, verify with a test:** `findNavPath` step 3b `deckPoints` converts local → world with `x*cos − z*sin`, while `localToWorldXZ` uses the opposite sign. It's likely wrong for rotated pieces (the catwalk at yaw π/2 in the owner's first map). Use `localToWorldXZ`.
- **Layer:** shared engine (PR 3a: nav drop edges, costing, clamp) then client pick (PR 3b).
- **Tests first:**
  1. Pick: a ray that hits a deck's side face or kick-plate (normal not pointing up) never picks the deck top. Only hits whose face normal points up (`face.normal.y > 0.7` in world space) on the top face count. A ray over the gap resolves to the ground.
  2. Engine: from deck A to a ground point in the gap, beside the deck, and at the far side of the gap, the path drops at the edge (no level segment over open air). Cost is horizontal only, and the jump test is offered only for drops > 3".
  3. Engine (Decision 6): a deck-to-deck path whose budget can't complete the gap jump instead walks to the take-off edge, drops, and continues on the lower level toward the point below the target (budget permitting). No jump test is offered, and the drop test applies only if > 3".
  4. `detectPathGapJump` never reports a jump on a path that drops to the ground.
  5. Fixture cases from the table above: ledge → gap ground drops off the ledge's east end (no gap jump, cost ≈ 3.5); platform A → gap ground drops off the west edge, not the ladder; ledge → platform A with a 4" budget does not end over the gap.
- **Implementation steps:** (a) pick: require an upward-facing hit on a walkable top face (use the raycast `face.normal` transformed to world). (b) clamp: treat a level segment over open air as all-or-nothing, like drops. If it can't be completed, re-plan to the ground point under the original target (Decision 6) from the take-off edge, with the remaining budget. (c) HUD shows the drop message, not the gap message, when the target is lower.
- **Docs:** SYSTEMS.md drops/jumps bullet, RULES_SPECIFICATION §10.2 one line, ROADMAP fix bullet.
- **Manual checks:** §3/§4 add: hovering the ground beside or between decks previews walk-to-edge + drop. Hovering just past a deck edge never picks the deck. No preview ever ends in mid-air.
- **Depends on:** PR 1 (bug C) for host rejection.

---

## PR 2: No move ends overlapping terrain or models (branch: `fix/move-end-overlap`)
**Why:** a general guard so this class of bug (ladders, crate edges, pillars, other units) can't recur.

- **Layer:** shared engine first. A small HUD follow-up in the same PR is acceptable only if it's just calling the new engine function from the preview; otherwise it's a separate PR 2b.
- **Files:** `shared/src/engine/spatial.ts` (new helpers), `shared/src/engine/actions.ts` (host checks), `client/src/ui/GameHUD.ts` (preview uses the settled end), tests.
- **Definitions:**
  - *Overlaps terrain:* a base circle of radius `UNIT_COLLISION_RADIUS` at the end point intersects (in x/z) any structure solid with `isObstacle !== false` whose vertical span overlaps the model's body `[y + 0.15, y + EYE_HEIGHT]`. The floor the model stands on and lintels above head height don't count. Use `resolveTerrainStructure` boxes (`distanceToBoxXZ`) so it matches collision exactly. Legacy unstructured pieces use their fallback body.
  - *Overlaps a model:* another living model (any unit, friendly or enemy, excluding the moving model itself) within 0.9" centre-to-centre at a similar height (|Δy| < 1.0").
- **Tests first:**
  1. `findEndOverlap(state, unitId, point)` returns the overlapping solid/model or null: inside a crate, base clipping a pillar, on top of another model, standing on a deck (no overlap), under a lintel (no overlap).
  2. `settleMoveEnd(state, unit, path)` walks back along the path (0.05" steps, across segments) to the first clear point. It never returns a point further along the path, and returns the start if nothing is clear.
  3. Host: a move/rush/charge whose final point (or any squad model's final point) overlaps terrain or another model is rejected with a clear reason.
  4. Regression: existing moves next to walls, crates and doorways in the current tests are unaffected.
- **Implementation steps:** add the two helpers; call `findEndOverlap` in all four validation sites next to `isSuspendedInMidAir`; have the HUD path preview pass its clamped path through `settleMoveEnd` so the player never submits an overlapping end.
- **Docs:** SYSTEMS.md movement bullet ("a move never ends overlapping terrain or another model; it stops short"), ROADMAP fix bullet.
- **Manual checks:** §7 add: moving or rushing into a crate, pillar, ladder or another unit stops with the base touching, never overlapping. Squads too.
- **Done when:** tests pass and no existing test needed weakening (fixture position changes are fine).
