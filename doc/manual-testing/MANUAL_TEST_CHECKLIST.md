# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, and batch 1A the same evening; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

Items marked **(known bug)** have a fix planned in `doc/plans/bugfix-playtest-batch-1.md`; retest them after that PR lands.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, climbable floors outlined orange, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- All items verified 2026-11-02.
- [ ] **Climbable checkbox:** select a shipping container in the editor: the inspector shows "Climbable (up to 3")" ticked and the piece has an orange outline on its top. Untick it: the outline disappears. Select a platform (unticked by default), tick it: the outline appears. Pieces with no walkable floor (walls) show no checkbox. Export JSON, re-import (and Save, reload the map): the setting persists.

## 2. Terrain structure (walls, windows, doors, ruin)
- All items verified 2026-11-02.

## 3. Elevation, ladders, stairs

- [ ] **F9 climbable outline:** with F9 on, climbable pieces (shipping container, ruin ledge) show an orange outline around their top floor; platforms and catwalks do not, unless marked Climbable in the editor.
- [ ] **Ladder spots:** rush/move toward a ladder with a budget too short to climb: the mini stops at the ladder foot with its base against the wall, outside the ladder and not under the deck. With enough budget it climbs and ends standing fully on the deck at the head (not half over the edge). The short shuffle on and off the ladder costs nothing (only the climb height counts). Climbing back down mirrors it. Check a ladder on each side of a deck and on the shipping container.
- [ ] **Climb the ruin ledge (3.0"):** from inside the ruin courtyard, move a model onto the ledge: it steps a base off the face, climbs straight up and steps in, with no ladder; movement spent is the walk plus 3". Behind the 4" back wall (outside the ruin) it cannot climb there and walks round instead. With too little movement it stops at the foot, never part-way up. The preview shows the climb leg in orange with a label like "climb 3.0"" and the summary repeats it.
- [ ] **Deck edge pick:** hover the ground just past a deck edge (low camera angle, also over kick-plates): the target is the ground, never deck height at the edge. Hovering the deck top still picks the deck.

## 4. Drops, jumps and movement cost
Movement model (batch 1E): the pathfinder only plans ordinary movement (walking, stairs, ladders, drops of 3" or less, gaps of 1" or less). Jumps and falls are never planned: the player declares them from where the model stands at an edge. The move preview styles each leg by how it is traversed: walking, stairs and ladders normal, climbs orange, safe drops amber, jumps dashed red, with a label and cost in the summary chip ("climb 2.3"", "drop 3.0"", "jump 4.9" · 2 dice"). Squads cannot declare jumps yet (the host rejects them), so jump chips are offered to single-model units only.
- [ ] **Edge snapping:** hover the cursor within 0.5" of a deck edge (on the deck, or on the ground just beside it): the preview snaps to that edge (deck edge at deck height, or the spot a base off the face on the ground). At 0.6" or more it does not snap, so points clearly on the deck or the ground are never grabbed.
- [ ] Stepping off a ledge of **3" or less** is regular movement: no test, no warning, and it costs only the horizontal distance walked. From a deck, hover the ground beside it: the preview walks to the edge and drops, with no jump offered. On the test map (Testy McTestface), from the ruin ledge to the ground in the 5" gap, the path steps off the ledge's open east end (cost about 3.5"), never over the gap; from platform A to the ground beside it the path takes the edge drop, not the ladder.
- [ ] Between two decks with a 5" gap, hovering the far deck from the middle of a deck previews the safe route as far as the budget goes (round by the ground and the ladder or stairs), never over the gap. Nothing ever previews in mid-air.
- [ ] Ground beside the stairs: hovering platform A previews a route round the corner of the stairs and up them (about 10" on the test map), not only via the ladder.
- [ ] A jump of **3-6" down** is offered only when the model is already at an edge and the cursor is below: the preview shows one dashed red hop and the chip says **Jump down 4.0" · 2 dice (3+)** (Confirm sends the declared jump); success lands with no damage, a passed jump costs no movement, and the activation continues; any failure falls: Falling damage and the activation ends. (Pathfinder needs 2+; Airborne auto-passes.)
- [ ] A drop **above 6"** is offered from an edge with a red chip: **Drop 7.0": too high to jump — the model will fall (falling damage, activation ends)**. Confirming it makes the model fall.
- [ ] A move can never end with the model hanging in mid-air (it stays at the edge if it can't finish). On a map that contains a ladder this must hold everywhere, not only away from the ladder.
- [ ] A model can't drop through a deck, through the gap where a stair meets the deck (stair head), or onto/through scatter (a crate, barricade). Hovering the ground under a deck or beside the stair wedge never previews a path through the solid.
- [ ] Dropping off a deck edge, a ledge, or the open side of the stairs still works. The model first steps a full base off the edge (about 0.55"; that step counts as movement), then falls. A drop point is never half over the deck.
- [ ] Climbing (ladders, stairs) still costs its full length; Difficult Terrain caps still apply. Coming down a 3" ladder is just a free edge drop.
- [ ] **Gap jumps** use the same test as drops: a horizontal gap of 1" or less is regular movement; 1-6" needs X+1 dice (1 die under 3", 2 from 3"), all 3+ (Pathfinder 2+, Airborne auto-passes); a failed jump falls into the gap (Falling damage if from 3"+ up, activation ends). From the middle of a deck no gap jump is offered; once the model stands at the edge (a normal split move), hovering the far deck offers "Jump gap 4.9" · 2 dice (3+)" as a dashed red hop; Confirm sends it as a declared jump. A gap over 6" is never offered and the host rejects it.
- [ ] Walking from a platform onto a flush catwalk (and across to the next platform) shows **no** gap warning; only real open air between decks does.
- [ ] **Dice log:** every jump, fall and dangerous-terrain roll appears in the Dice panel ("Movement hazards", with the rolled dice coloured pass/fail) and in the action log line ("moved X — Jump down 4.0" ... landed"). A move with no hazards shows nothing extra.

## 5. Low cover & scatter
- [ ] Shipping Container (2.25"): blocks sight and movement; its flat roof is a walkable floor reached by ladder/stairs or simply climbed from any of its four sides (2.25" rise; cost is the walk plus 2.25"). A platform or catwalk deck cannot be climbed without its ladder or stairs. A model cannot climb a container stacked on another (4.5" rise). The preview shows an orange "climb 2.3"" leg. You can stack pieces on it.

## 6. Squads
- All items verified 2026-11-02.

## 7. Movement, rush and shooting
- All items verified 2026-11-02.
- [ ] Moving or rushing into a crate, pillar, wall corner, ladder or another unit: the preview and the final position stop with the base touching, never overlapping it. Try a squad too (every model ends clear). Standing on a crate/deck or walking under a doorway lintel is still allowed.

## 8. Melee & objectives
- All items verified 2026-11-02.

## 9. Multiplayer & custom maps
- All items verified 2026-11-02.
