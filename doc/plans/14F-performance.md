# 14F: Performance
Status: in progress. Approved by the owner 2026-11-13; PR 1 done (Gemini, #407); PR 2 next (Gemini, see Decision 10).
Roadmap: doc/ROADMAP.md § Phase 14, 14F Performance

## Goal
The game stays smooth through a full match on the Standard Battlefield with squads, the move preview, the line-of-sight fan and the F9 debugger running, and host checks that search for paths (squad charges, pile-in) answer quickly. The first target is the pathfinder (`findNavPath`), which costs about 30-150 ms a call today and runs both in the HUD's hover preview and in host rules checks. Rendering is profiled afterwards, and whatever that turns up gets its own PR.

## Decisions (agreed)
1. **The pathfinder's results are part of the rules.** The host calls `findNavPath` through `closestApproach` to judge whether a squad's charging models got "as close as possible" (`validateSquadChargeMove`, `shared/src/engine/actions.ts:526`) and to check or auto-place pile-in moves (`shared/src/engine/pileIn.ts:167`, `:199`, `autoPileIn` called at `actions.ts:2481` on timeout). A speed-up must not change any path, end spot or `closestApproach` result unless a PR says so explicitly and the owner agrees.
2. **Snapshot ("golden") tests come first** (PR 1), before any pathfinder code changes. They record today's outputs; PR 2 must leave every snapshot unchanged. If a snapshot changes, the implementer stops and reports the differing case(s) instead of updating the snapshot.
3. **The open set becomes a binary min-heap with lazy deletion.** Entries are `{ f, seq, node }`, ordered by `f` then by `seq` (a counter incremented on every push). A node that improves is pushed again rather than updated in place; a popped entry whose node is already closed, or whose `f` no longer equals `node.f`, is skipped. No `openSet.includes`.
4. **Ties.** Today ties on `f` are broken by the array's previous order (JS sort is stable), which depends on the search's history; the heap's `seq` order matches it in most cases but not provably all. Equal-cost routes can stop at different spots once clamped to the movement allowance, so a tie change is a behaviour change (Decision 2 applies). If the heap changes a snapshot, report it; do not try to reproduce the old order with tricks.
5. **No change to movement costs or the waypoint set in PR 2.** The free ladder shuffle (`classifySegment` returns `'ladder'` with cost 0 for `isLadderStepSegment`, `shared/src/engine/traversal.ts:172`) stays as it is (Decision 8).
6. **Timing guards stay generous.** CI machines vary, so timing assertions use budgets of about 3-5× the time measured locally after the change, never tight thresholds. The existing guards (`shared/tests/engine/closestApproach.test.ts:186-208`, 1500 ms and 3000 ms) are tightened in PR 2 only to such budgets. Decision 9's targets are measured with the PR 1 benchmark on the owner's machine, not asserted in CI.
7. **Squad size to design for: up to 6 models** (owner, 2026-11-13). The four v3.6 army books have no unit larger than 3 models (no upgrades add models, and the core rules have no joined or combined units), so 6 leaves room for Army Forge imports and later armies. Speed targets are set on squads of up to 6 charging a target of up to 6 (`closestApproach` already looks at no more than the 6 nearest target models). The 10-model cases stay as an extreme stress test with generous guards only.
8. **The free ladder shuffle stays free, and its effect on the search is accepted** (owner, 2026-11-13, option (a)). Because the 1.1" step at the top of a ladder costs nothing, the flat-distance estimate can be too high near ladders, and a path through a ladder can come out up to about 1.1" per ladder longer than the best one. This is documented in `doc/SYSTEMS.md` (PR 2) and not fixed. If a real case is found later that matters in play, the owner decides then (the fallback considered was re-checking closed points with no distance estimate on maps with ladders). Never change the shuffle cost: it is a documented movement rule.
9. **Targets** (owner, 2026-11-13), on the Standard Battlefield on the owner's machine: `findNavPath` under 10 ms per call at the 95th percentile; a 6-model squad charging a 6-model target validated in under 300 ms; 60 fps while hovering a move preview with the F9 debugger open. PR 3 is only planned if PR 2 misses the first two.
10. **Who implements** (owner, 2026-11-13): PR 1 and PR 2 may go to Gemini, an exception to the handover guide's "host validation stays with Claude" rule, because PR 1's snapshots pin every result PR 2 could change. PR 2 starts only after PR 1 is merged. Claude reviews PR 2 line by line against this plan before merging.

## Out of scope
- Rule changes of any kind, including the ladder shuffle cost (Decision 8).
- The HUD's hover memo (`GameHUD.ts:317-322`, `hoverNav` at `:966`) stays; it still helps after the speed-ups.
- Line of sight corner-graze ties (G-15, deferred separately).
- Visual changes. Rendering fixes found in PR 5 change no visuals unless the owner agrees.

## Background
`findNavPath` (`shared/src/engine/spatial.ts:2362`) is A* over a visibility graph rebuilt on every call:
1. Board clamp (`:2381`), then a straight-line fast path (`:2390`): if the direct line is clear, on a surface and test-free it is used, clamped to `maxDistance`, and settled with `settleEnd`.
2. Waypoints (`:2435`): stair/ladder foot and head (and the top of a ladder's climb line), points round stair wedge corners (`:2439`); deck corners and edge midpoints plus drop/climb twin points (`dropTwin`, `dropAirPts`, `climbUp`, `:2480`); ground obstacle corners (`:2555`); points round other units' models, an octagon outside the 1" keep-away when `keepAway` is set (`:2601`). Waypoints inside solids are filtered out.
3. A* (`:2646`): `h` = flat (x, z) distance to the target (drops cost only their horizontal distance). Edges are checked lazily when a node is expanded: drop-twin rules, `isSegmentSurfaceConstrained`, `findMoveBlocker`, then `safeEdgeCost` (`classifySegment`; only `walk`, `stairs`, `ladder`, `climb`, `drop`, `gap` are plannable). Edges longer than 16" (3D) are skipped. Closed nodes are never reopened.
4. String-pulling (`:2813`), vertical ladder climbs (`:2839`), clamping to `maxDistance` (`:2879`).

Known problems in the A* loop:
- **P1 Open set:** a plain array, `sort` on every pop (`:2697`), `shift` (O(k)), and `includes` in the neighbour loop. Fixed by the heap (Decision 3).
- **P2 Check order:** for every node in the graph, each expansion runs `isSegmentSurfaceConstrained`, `findMoveBlocker` and `classifySegment` before the cheap `tentativeG < neighbor.g` test (`:2731-2777`). Edge costs are never negative, so a lower bound can skip the expensive checks first (PR 2, step 2). This is probably the biggest cost, more than P1, but it has not been profiled yet.
- **P3 Duplicate target edge:** the "direct link to target" block (`:2713-2729`) checks current → target, and the neighbour loop checks the same edge again because `targetNode` is in `allNodes`. The only difference is that the direct block has no 16" cap.
- **P4 Heuristic:** the flat-distance `h` assumes every edge costs at least its flat length. The ladder shuffle costs 0 but moves sideways (top of the climb line → ladder head, 1.1": `LADDER_STANDOFF` 0.55" either side of the deck face), so `h` can overestimate and, with no reopening, the search can return a path up to about one shuffle's length longer than the best. Not reproduced by a test; accepted and documented (Decision 8).

Callers: the HUD (16 calls in `client/src/ui/GameHUD.ts`, hover preview and clicks), `autoPlaceSquadFollowers` (`shared/src/engine/squadFollow.ts:242`, HUD-side), and `closestApproach` (`shared/src/engine/closestApproach.ts:205`), which tries up to 6 target models × 5 or 9 angles × 1-2 heights, one `findNavPath` each, for each model not in contact. That makes a squad charge validation on the host potentially dozens of searches per model.

Maps for tests: `BUILTIN_MAPS` in `shared/src/data/builtinMaps.ts:194` (`standard-battlefield`, `jump-range`, `hazard-range`); `shared/tests/data/builtinMaps.test.ts` shows how to build a state from a map with `createInitialGameState` + `applyDefaultScenario`.

The roadmap's 14F note mentions `planFollowerCrossing`; it no longer exists (removed with the follower router in 14C-2 PR 4C), so that part of the note is stale.

## PR 1: Pathfinder snapshot tests and benchmark  (branch: `14F-perf-1`)
- **Layer:** shared engine (tests only, no `src/` changes)
- **Files:** `shared/tests/engine/navGolden.test.ts`, `shared/tests/fixtures/nav-golden/*.json` (or Vitest file snapshots), `shared/tests/engine/navBench.test.ts`
- **Tests first:** this PR is the tests.
  - A fixed, deterministic case list per built-in map (no randomness, or a seeded generator checked in): at least 40 `findNavPath` cases on `standard-battlefield` and 15 each on `jump-range` and `hazard-range`, covering: straight-line fast path, routes round obstacles, up stairs, up and down ladders, drops off decks, climbs, blocked/no-route fallback, clamping at `maxDistance`, `keepAway: true` with other units nearby, `stopBeforeDifficult`, and a Flying unit. Record the full returned path (rounded to 0.01").
  - At least 10 `closestApproach` cases (single models and squads, round walls and up to decks) and 4 squad `charge` validations through `validateAction` (one valid, one rejected with "could get closer", a 6-model squad charging a 6-model target round terrain, and a 10-model extreme case), recording the result.
  - Each case has a label naming what it covers, and a check that it really does: e.g. a ladder case's path contains a vertical segment at the ladder, a drop case's path descends more than 0.5" off a deck edge, a fast-path case has exactly two points, a clamping case's path length equals `maxDistance` (±0.01), a no-route case returns the fallback. A case whose check fails is moved or replaced, not dropped from its category.
  - The test fails if any recorded output differs.
- **Benchmark:** `navBench.test.ts` runs only when `NAV_BENCH=1` (skipped otherwise, so CI time is unchanged). It times the golden case list and prints per-call mean / p95 for `findNavPath` and `closestApproach`, and the total for each squad charge validation (the 6-model case is the one the targets are set on).
- **Implementation steps:** write the cases, generate the snapshots from current `master`, check they pass twice in a row (deterministic).
- **Docs:** one line in `doc/SYSTEMS.md` (pathfinding section) saying pathfinder output is pinned by `navGolden.test.ts` and why (host uses it for rulings). Record the baseline benchmark numbers in the PR body.
- **Manual checks:** none.
- **Done when:** the snapshot suite passes on `master`, and the benchmark runs with `NAV_BENCH=1 npm test --workspace=shared`.

## PR 2: A* speed-ups with identical results  (branch: `14F-perf-2`)
- **Layer:** shared engine
- **Files:** `shared/src/engine/spatial.ts` (the A* section of `findNavPath`), optionally a small `shared/src/engine/minHeap.ts` with its own unit tests, `shared/tests/engine/closestApproach.test.ts` (timing guards)
- **Tests first:** unit tests for the heap (pop order on random input against a sorted copy, ties popped in `seq` order, empty pop). The PR 1 snapshot suite is the behaviour test.
- **Implementation steps** (in this order, running the snapshot suite after each step):
  1. **P3:** delete the "direct link to target" block. In the neighbour loop, when `neighbor === targetNode`, run only the checks the direct block ran (surface, blocker, `safeEdgeCost`): skip the 16" cap and the drop-twin filter for it, because the direct block applied neither (from a drop spot, the old code allowed a direct link to a target at another height). `targetNode` is index 1 of `allNodes` and `startNode` is skipped, so it is still the first edge tried and the push order is unchanged.
  2. **P2:** before the drop-twin, surface, blocker and cost checks, skip the neighbour when it cannot improve: `lb = isLadderStepSegment(state, current.pos, neighbor.pos) ? 0 : distanceHorizontal(current.pos, neighbor.pos)` (use `distanceHorizontal` from `traversal.ts:34`, the same function `classifySegment` uses), and `if (current.g + lb >= neighbor.g) continue;`. Every plannable kind except the ladder step costs at least its horizontal distance, so no update is lost.
  3. **P1:** replace the open array with the heap (Decision 3). The goal test, closed set and path rebuild stay as they are.
- **Measure:** run the PR 1 benchmark before and after, and put both in the PR body. Then set the two `closestApproach.test.ts` timing guards per Decision 6.
- **Docs:** `doc/SYSTEMS.md` pathfinding section: the open set is a binary heap and edges are pre-filtered by a cost lower bound; and the ladder shuffle limitation from Decision 8 in a sentence or two. ROADMAP 14F: note PR 2 done with the before/after numbers, and drop the stale `planFollowerCrossing` mention.
- **Manual checks:** add to `MANUAL_TEST_CHECKLIST.md`: on the Standard Battlefield, hover-preview Advance and Rush paths round containers, up stairs and ladders and off decks look the same as before and feel quicker; a squad charge that needs every model to path round a wall is accepted or rejected as before.
- **Done when:** every PR 1 snapshot is unchanged, all workspaces build and pass, and the benchmark shows the improvement. If any snapshot changes, stop and report (Decision 2).

## PR 3: Reuse the terrain part of the graph  (branch: `14F-perf-3`, only if PR 2 is not enough)
- **Layer:** shared engine
- Only planned in detail once PR 2's numbers are in and compared with the targets in Decision 9. The idea: waypoints from terrain (steps 3a-3c) and terrain-only edge results depend only on `state.terrain` and the unit's movement traits, so they can be cached per terrain layout (keyed by the terrain array's identity plus Flying/Strider), with unit waypoints (3d) and unit blocking added per call. That needs `findMoveBlocker` split into a terrain part and a unit part without changing its results, which is the risky step. Same snapshot rule (Decision 2).

## PR 4: dropped
The ladder shuffle heuristic is accepted as it is (Decision 8); its documentation is part of PR 2.

## PR 5: Client frame profile  (branch: `14F-perf-5`, planned after profiling)
- **Layer:** client HUD / renderer
- Profile a full game on the Standard Battlefield (Chrome performance panel) with squads, move preview, the LoS fan and F9 running, against the 60 fps target. Findings are written into this plan as their own PRs before any work starts; likely suspects to check first are the hover path (`hoverNav`, follower placement via `autoPlaceSquadFollowers`), the LoS fan and marker rebuilds on every sync.

## PR 1 results (2026-11-14)
Baseline from the PR 1 benchmark (`NAV_BENCH=1`), before any speed-up:

| Measure | Baseline | Target (Decision 9) |
|---|---|---|
| `findNavPath`, 79 cases | mean 38 ms, p95 336 ms (Standard Battlefield p95 349 ms) | p95 under 10 ms |
| `closestApproach`, 12 cases | mean 1.9 s, worst 11.9 s | — |
| Squad charge 4 vs 3 (valid / "could get closer") | 5.7 s / 7.9 s | — |
| Squad charge 6 vs 6 round terrain | 25.0 s | under 300 ms |
| Squad charge 10 vs 5 (stress) | 43.5 s | generous guard only |

The gap is far bigger than PR 2 alone is likely to close (about 35× on a search, about 80× on the 6 vs 6 charge). Expect PR 3, and possibly a PR that cuts how many searches `closestApproach` runs per model (it is the multiplier behind the charge times). That PR is planned after PR 2's numbers are in. The golden suite takes about 110 s a run until then; its long Vitest timeouts (60 s / 300 s) are deliberate.

**Findings from PR 1, not part of 14F** (recorded as they are in the snapshots; each needs a failing test before any fix, and they go to a later bugfix batch):
- **F1 Landing on a model at a ladder foot or stair point.** `findMoveBlocker` skips the overlap / keep-away checks for a purely vertical step (`spatial.ts:529`), and `findNavPath` keeps stair and ladder waypoints without checking them for units (`spatial.ts:2636`), so a path can drop or climb onto the spot where an enemy stands. Possibly a host-validation bug; unconfirmed.
- **F2 Ladder-top zigzag** (`jr-ladder-2`): a descent goes back and forth once across the free shuffle at the top before climbing down. No movement is lost (the shuffle is free); cosmetic.
- **F3 "As close as possible" is measured flat.** `modelGap` uses horizontal centre distance (`unitGeometry.ts:18`), so standing on the ground under a model on a deck scores a gap of 0. Confirmed in code. Whether height should count is a rules question for the owner.
- **F4 Dangerous terrain in `closestApproach`.** `findNavPath` does not avoid dangerous terrain, and `closestApproach` rejects paths that cross it, so a model whose straight route crosses a dangerous piece gets "stay put" as its best (`ca-squad-avoids-hazard`). The host's closeness check is then too lenient for that model.

## Open questions
None.
