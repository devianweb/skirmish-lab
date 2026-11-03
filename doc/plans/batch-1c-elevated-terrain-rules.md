# Batch 1C: elevated-terrain rules (Beginner's Guide alignment)
Status: approved (2026-11-02)
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)**, **Out of scope** and **Background** first: decision numbers below refer to it.

Stepping over terrain up to 1" (PR 7) and split-level coherency (PR 8). Climbing (PR 6) moved to batch 1E (E2 + E4). Do these after batch 1E.

## PR 6: Climbing terrain up to 3" (branch: `feat/climb-up-to-3in`)
> **Replaced by batch 1E E2 + E4 (2026-11-02).** Climbability is now data (catalog default + per-piece override). Kept for background only. Don't implement this section.
**Why:** owner report "can't climb onto the shipping container", plus Decision 8. The engine today half-supports "sheer wall" climbing (difficult terrain, a 15" nav penalty, rush stops at the base), which neither the rules nor the owner asked for, and it doesn't work on structured terrain.

- **Layer:** shared engine (nav, cost, host validation). The HUD needs only message text.
- **Files:** `shared/src/engine/spatial.ts` (`findNavPath`: candidate climb points at floor edges, remove `isClimbingSheerWall` +15 penalty, the rush `isSheerClimb` stop, the clamp's sheer-climb `break` becomes the all-or-nothing climb rule), `shared/src/engine/traversal.ts` (`isPathDifficult`: remove "free-climbing counts as difficult"; `pathMovementCost`: climbs cost their vertical + horizontal length), `shared/src/engine/actions.ts` (host: reject climbs > 3.05" not on a ladder/stairs, and mid-climb ends), `client/src/ui/GameHUD.ts` (preview text "climb 2.3"").
- **Tests first** (use the fixture):
  1. Ground beside the container → container roof (2.25"): the path stands off the face, climbs vertically, steps onto the roof. Cost = horizontal + 2.25. Not difficult (a rush keeps its 12").
  2. Ground → platform-small deck (3.0") without using the ladder or stairs, when that's shorter. With the ladder nearby, the planner picks whichever is cheaper. A ladder and a free climb of the same height cost the same.
  3. Ground → anything with a rise > 3.05" (e.g. a deck stacked on a container, a hand-built 4" floor): no free climb. Only via ladder/stairs, otherwise the path stops at the base. The host rejects a hand-built path that climbs it.
  4. A budget that can't finish the climb stops at the stand-off spot (never mid-climb). The host rejects a mid-climb end.
  5. Ruin: the courtyard → ledge (3.0") climb works. Ruin walls (4", not walkable) can't be climbed onto.
  6. `isPathDifficult` is false for a climb. The old test `detects sheer wall climbs as difficult terrain without a ladder/stairs` is replaced by its opposite (rule change, intended).
  7. Airborne still ignores all of this.
- **Implementation steps:** generate climb candidates from walkable-solid edges (the same edges PR 3a/PR 5 use for drops) at `DROP_STANDOFF`. Classify a vertical rise ≤ 3.05" without ladder/stairs as a legal climb. Use real cost in A*. Clamp all-or-nothing. Host validation mirrors it.
- **Docs:** RULES_SPECIFICATION §2.3 (add "Climbing" bullet) and §8 Elevated Floors row (replace "Ladders and stairs are the only ways up (no free climbing)"), SYSTEMS.md drops/climbs bullet, ROADMAP, `doc/plans/README.md` rule references (add the Beginner's Guide).
- **Manual checks:** §3 add: a model can climb onto a deck, the ruin ledge or the container roof without a ladder, paying the height in movement. It can't stop part-way up, and taller rises still need ladders/stairs. §5 container item: drop the "(known bug)" tag.

---

## PR 7: Step over terrain up to 1" (branch: `feat/step-over-low-terrain`)
**Why:** Decision 9.

- **Layer:** shared engine.
- **Files:** `shared/src/engine/spatial.ts` (`findMoveBlocker`, nav obstacle waypoints / clearance), maybe a helper `isStepOverPiece(piece, floorY)` next to `resolveTerrainStructure`.
- **Tests first:**
  1. A model walks straight across a barricade, crate and pipe (path has no detour). Cost = the straight-line distance.
  2. A model can't end its move overlapping one (PR 2's overlap guard still treats them as solids).
  3. A barricade stacked on a deck is stepped over by a model on that deck (height measured from the deck floor).
  4. Walls, columns, the container and 2" walls (> 1") still block.
  5. Cover is unchanged: a defender within 1" behind a barricade still gets +1 Defense. LoS over it is unchanged.
- **Docs:** RULES_SPECIFICATION §8 (low cover row: "can be stepped over"), SYSTEMS.md movement bullet, DATA_MODEL low-cover note, ROADMAP.
- **Manual checks:** §5 replace "they block movement" with "models step over them (no detour, no extra cost) but can't end on them".

---

## PR 8: Split-level squad coherency (branch: `feat/split-level-coherency`)
**Why:** Decision 10.

- **Layer:** shared engine + HUD toast text.
- **Files:** `shared/src/engine/spatial.ts` (`validateSquadCoherency`: positions already carry y), its callers in `actions.ts` and `GameHUD.ts` (staging checks), tests.
- **Tests first:**
  1. Two models, one on a 3.0" deck and one on the ground 3.5" away horizontally (centre distance ≤ 4.0") → coherent. The same 3.5" on one level → not coherent (the 1" rule).
  2. A model on a different level 4.5" away → not coherent.
  3. The 6" whole-squad spread still applies.
  4. HUD staging allows the split-level placement and the toast explains the 3" allowance when it's exceeded.
- **Docs:** RULES_SPECIFICATION §2.1 coherency bullet, SYSTEMS.md, ROADMAP.
- **Manual checks:** §6 add: a squad can leave some models on a deck and others below, up to 3" apart.
