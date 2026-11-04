# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, and batches 1B/1E, 1F and 1H on 2026-11-03/04; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

Items marked **(known bug)** have a fix planned in `doc/plans/bugfix-playtest-batch-1.md`; retest them after that PR lands.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, climbable floors outlined orange, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- All items verified.
- [ ] A new blank map is 48" x 48" (grid and ground). "Auto objectives" places four markers, each more than 9" apart and clear of both deployment zones. Opening an older 44" x 30" saved map still shows it at that size. The validation badge shows no new warnings on either.
- [ ] The toolbar "Board" control offers 48×48 (standard), 36×36, 24×36 (narrow) and Custom. Picking a preset resizes the grid and ground live. Custom shows width/height boxes (whole inches); values outside 24–72 snap to the limit. Shrink the board with terrain or objectives near the edge: the badge shows notices naming the pieces now outside. Save, reload and re-open the map (and Export/Import): the size is kept, and the lobby dropdown lists it, e.g. `(9 pieces, 44"×30")`.

## 2. Terrain structure (walls, windows, doors, ruin)
- All items verified.

## 3. Elevation, ladders, stairs
- All items verified.

## 4. Drops, jumps and movement cost
- All items verified.

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- All items verified.

## 9. Multiplayer & custom maps
- All items verified.
- [ ] The lobby's "Empty Battlefield" option reads 48"x48". A game on it has 12"-deep deployment zones (the camera framing for the larger board arrives in a later PR). A game on an old 44"x30" map still has 3"-deep zones.
- [ ] On a 48×48 map the whole board is in view at the start for both host (south corner, looking north) and guest (north corner, looking south). Repeat on 24×36 and 72×72: the board stays framed and you can zoom out far enough to see all of it.
