# Batch 1F: traversal follow-ups (stacked levels, failed jumps, 3D labels)
Status: done (2026-11-03): PR 20 #180, PR 17 #181, PR 18 #182, PR 19 #183
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)**, **Out of scope** and **Background** first: decision numbers below refer to it.

Follow-ups found during batches 1B/1E. None of these needs a new rule. PR 17 and PR 18 bring the engine in line with rules already agreed. Order: PR 20 (owner-reported) → PR 17 → PR 18 → PR 19 (independent).

## PR 17: Climb and drop between a deck and pieces stacked on it (branch: `fix/stacked-level-traversal`)
- **Cause:** `findNavPath` (`shared/src/engine/spatial.ts` ~l.2247) creates each edge's drop/climb "ground twin" at `y: 0`. On a container or crate stacked on a deck, the twin floats at the wrong height and the fall-column check blocks it. So a model on a deck can't climb onto a stacked climbable piece, and can't drop from it back onto the deck.
- **Fix:** put the lower point at the highest walkable floor under the stand-off spot (below `platY − 0.5`; `findWalkableSurfaceAt` / `collectWalkableSurfaces`), or the ground if there is none. Climb (≤ 3") and drop/jump thresholds then use the real height difference.
- **Tests first:** a container (2.25") on a platform deck (3.0"): from the deck, climb onto the container (cost = walk + 2.25), drop back to the deck (free ≤ 3"), and from the container roof to the ground (5.25") offer a jump-down only from the edge. A non-climbable piece on a deck still can't be climbed.
- **Manual checks:** §3: climb from a deck onto a container stacked on it, and drop back.

## PR 18: Failed gap jumps land correctly (branch: `fix/failed-jump-landing`)
- **Cause (`applyTraversalHazardsAndFalls`, `shared/src/engine/actions.ts` ~l.1164–1200):**
  1. Falling damage is only applied when the drop is > `FREE_DROP_MAX` (3.05"), but the rule (RULES_SPECIFICATION §10.3) is a fall of ≥ 2" takes 1 hit, AP(1) per full 3". So a failed jump off a standard 3" deck currently takes no damage.
  2. The model is always placed at `y: 0` at the gap's midpoint, ignoring a floor below (a deck under a raised gap) and anything solid under the midpoint.
  3. Every model in a squad is moved to that same spot (stacked). Per the rules, the falling model is killed unless it's the last one left.
  4. It returns `wounds: 1` even when the falling hit is saved. Check whether anything displays it.
- **Fix:** land the model on the highest floor below the gap at a clear spot within 2" of where it fell (use PR 2's `findEndOverlap` / settle helpers). Apply falling damage for falls ≥ 2". For squads, only the jumping model falls (with PR 15). Return the real wound count.
- **Tests first:** a failed jump from a 3" deck → lands on the ground, takes the AP(1) hit, activation ends. A gap over a lower deck → lands on that deck. A crate under the gap → lands clear of it. Squad fall kills only that model. A saved fall reports 0 wounds.
- **Manual checks:** §4: a failed gap jump drops the model to the floor below (clear of terrain), applies falling damage and ends the activation.

## PR 19: Floating 3D labels on the move preview (branch: `feat/preview-3d-labels`)
- **Approach:** Three.js `CSS2DRenderer` (already in the three package: `three/examples/jsm/renderers/CSS2DRenderer.js`). Each labelled preview segment ("climb 2.3"", "jump 4.9" · 2 dice") gets a small HTML `CSS2DObject` at its 3D midpoint, styled like the HUD chips. The CSS2D layer is rendered each frame alongside the WebGL renderer (SceneManager), with `pointer-events: none` so board picking isn't affected. The existing styled line stays.
- **Why not canvas-texture sprites:** blurrier when zoomed, and jsdom has no canvas 2D context, so they're harder to test.
- **Tests:** MarkerRenderer creates one CSS2DObject per labelled segment with the right text, and clears them with the preview. SceneManager renders the CSS2D layer (renderer mocked).
- **Manual checks:** §4: preview labels float next to the climb, drop or jump part of the path and follow the camera.

## PR 20: Climbing onto the ruin ledge leaves the model half off it; "gap 0.6"" label (branch: `fix/no-overhang-ends`)
**Owner report (2026-11-03, deployed build, screenshot):** climbing onto the ruin ledge from the courtyard, the preview showed "climb 3.0" · gap 0.6"" and the model "didn't quite make it onto the ledge fully". Its base ended overhanging the ledge edge.

- **Causes:**
  1. **Edge snapping (E3, `client/src/ui/movePreview.ts` `snapCursorToEdge`)** pulls a cursor on the deck to the edge line *itself*, so the model's centre ends exactly on the edge, half its base over air. `isSuspendedInMidAir` only tests the centre, so the engine accepts it.
  2. **The rules (Beginner's Guide, Impassable Terrain): a model may not end its move partially overhanging gaps or terrain.** We don't enforce that anywhere.
  3. **The label:** after a climb, the short level step from the climb column onto the ledge (the stand-off, ~0.55") is classified as `gap` and labelled "gap 0.6"". It's part of the climb (Decision 7: the stand-off step counts but is not a gap).
- **Fix:**
  1. **Engine:** a move may not end with the model's base overhanging. The base circle (`UNIT_COLLISION_RADIUS`) must be supported by floor at the model's height, using the union of walkable surfaces (so standing across two flush decks is fine). Add it to `settleEnd` (pull back along the path to the first fully supported point, or forward onto the floor if the path's last leg is a climb/step-on that would otherwise stop at the lip) and to the host end checks, next to `isSuspendedInMidAir`.
  2. **Edge snapping:** snap a deck-side cursor to the point **inset by the base radius + 0.05"** from the edge (fully on the deck), not the edge line. The ground-side snap (stand-off spot) is unchanged.
  3. **Classification/labels:** the level step between a climb's top and the floor is part of the climb (`climb` kind or merged into the climb label), never `gap`. The same goes for a drop's step-off (already counted, Decision 7), which shouldn't be labelled as a gap.
- **Tests first:** fixture ruin ledge: courtyard → ledge via a cursor snapped near the edge ends with the base fully on the ledge (centre ≥ 0.5" inside). Host rejects an end with the centre 0.2" inside the edge (overhanging). Two flush decks: standing across the seam is allowed. Preview labels for that climb read "climb 3.0"" with no "gap". A drop's step-off isn't labelled "gap".
- **Manual checks:** §3: after climbing onto the ruin ledge (or any deck) the base is fully on the floor, never overhanging, and the preview says "climb 3.0"" with no "gap 0.6"".
