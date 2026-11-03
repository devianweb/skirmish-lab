# Batch 1H: post-1F playtest fixes
Status: approved (2026-11-03), in progress
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)** first (esp. 14–20). No new rules: these are bugs in released work. Fixture: `shared/tests/fixtures/testy-mctestface-2.json` (owner's map 2: decks at 3" and 6", `stairs-upper` standing on the 3" deck at (2,3,0) yaw π/2, head toward +x at the 6" deck).

## PR 24: Raised stairs (stairs standing on a deck) (branch: `fix/raised-stairs`)
**Owner report (screenshot):** rushing up the second staircase misbehaves, with the message "Rushing to wall base: Stops before sheer climb (climb available next turn with full movement)".
- **Reproduced (`findNavPath` on map 2, unit at (−10,0,0), budget 48, rush):**
  - target on the upper stairs slope (2,4.5,0) → the path stops at (0.21,3.28,0), just 0.3" up the slope
  - target on the 6" deck (6,6,0) → [[−10,0,0],[−0.5,0,0]]: no route found, it walks to the base of the lower deck
  - `getStairWaypoints` (foot (−0.2,3,0), head (4.2,6,0)) and `getStairSurfaceHeight` (3.375 → 5.625 along the slope) look right
- **Suspected cause (verify):** code that assumes stairs start at ground level, e.g. `isSegmentOnRampOrStairs` uses `const botY = Math.min(0, piece.position.y ?? 0)`, plus anything else using y = 0 for the stair foot (wedge collision sampling in `findMoveBlocker`, nav candidates, `classifySegment` stairs case, fall-column checks against the wedge, the HUD rush "stopped at base" logic).
- **Tests first:** on map 2, ground → upper slope (2,4.5,0) reaches it. Ground → 6" deck (6,6,0) goes stairs-ground → 3" deck → stairs-upper → 6" deck, cost ≈ walk + stairs lengths. Rush with the TEST runner reaches it in one action. The upper wedge still blocks walking *through* it on the 3" deck. Ground stairs are unchanged (regression).

## PR 25: A hop over open air with a small drop is a gap jump (branch: `fix/gap-with-drop-classification`)
**Owner report (screenshots):** the preview offered "jump 3.8" · 2 dice" from a 4.5" container stack to a 2.25" container across a gap, and Confirm was rejected: "This move needs a jump: choose it explicitly (move to the edge, then declare the jump)".
- **Cause:** `validateDeclaredTraversal` (`shared/src/engine/traversal.ts`) builds its jump list from `classifySegment`, which classifies that hop by its 2.25" height change as a safe `drop`. Separately, `detectPathGapJump` sees 3.8" of open air, so `needsGapJump` is true and the declared `jump-gap` is rejected. The client's `findJumpOption` classified the same hop as `jump-gap`.
- **Fix:** one classification. A segment whose horizontal run over open air (no floor beneath at any height between start and end) is > 1" is a `jump-gap` (dice from the gap distance), whatever its height change ≤ 6". A drop > 6" is still `fall`. A drop ≤ 3" with no open-air run is still `drop`. `findJumpOption`, `classifySegment`, `detectPathGapJump` and `validateDeclaredTraversal` must agree. Add a property test that for every `findJumpOption` result the host accepts the declared move.
- **Tests first:** container stack (top 4.5") → container (top 2.25") across a 3.8" gap: the option is `jump-gap`, 2 dice, and the host accepts the declared move (move and rush, single model). A failed jump falls into the gap (PR 18 landing). A gap ≤ 1" with a small drop is still a free drop.

## PR 26: Remove the stale "sheer climb" rush message (branch: `fix/stale-rush-message`)
- **Cause:** `GameHUD` (`stoppedAtBase` / `isElevationObstacle`, ~l.530) still shows "Rushing to wall base: Stops before sheer climb (climb available next turn with full movement)" when a rush path ends lower than the target. Sheer climbs don't exist since batch 1E (climbing ≤ 3" is ordinary movement on climbable pieces, otherwise unreachable).
- **Fix:** remove the sheer-climb wording. If a safe path can't reach the target, show the real reason in one line ("Can't reach that height from here: use stairs or a ladder", or "Out of movement"), or nothing. Never claim it'll be possible "next turn".
- **Tests:** a HUD test that the old text never appears, and that the replacement appears when the path ends short of an unreachable higher target.

## Order
PR 24 and PR 26 in parallel → PR 25.
