# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, and the 14B rematch pass on 2026-11-10; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

Items marked **(known bug)** have a fix planned in `doc/plans/bugfix-playtest-batch-1.md`; retest them after that PR lands.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, climbable floors outlined orange, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- All items verified.

## 2. Terrain structure (walls, windows, doors, ruin)
- All items verified.

## 3. Elevation, ladders, stairs
- All items verified.

## 4. Drops, jumps and movement cost
- All items verified except the squad group-crossing items below (14C-2 PR 4C). Setup for all of them: press F9 in the lobby (Developer mode), pick the army **TEST: Jump Check (squad, Strider squad, Flying squad)** for both players and the built-in map **Jump Range**. Deploy "Test Jumpers" near the stairs at x -9, z -12 (host side), then walk it up the stairs onto the first 3" deck (deck A, x -11..-7, z -10..-2).

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All earlier items verified. New (keep-away measured in 3D, 14C-2 bugfix). Setup: F9 in the lobby (Developer mode), army **TEST: Jump Check** for both players, map **Jump Range**, Deploy off or place the squads by hand.
- New (flying indicator and stop note, UI only). Same setup (F9 in the lobby, army **TEST: Jump Check**, map **Jump Range**), run from either side:
- [ ] Flying: activate "Test Flyers" and Advance, then Rush, hovering over a gap, a deck and another unit: the hover note starts "Flying · X\" · over terrain" with X the path length, and the path line is dashed cyan (not solid green). Do the same with a single flyer model pick in the squad and with a charge leg. Test Jumpers or Test Striders show a plain solid line and no Flying chip.
- [ ] Stairs blocked by a friendly unit: stand "Test Jumpers" on the first 3" deck within 1" of the head of a 2"-wide stair (host stairs at x -9, z -12), then Rush / Advance a "Test Striders" model toward the deck at the stair head: the model stops short, the hover note reads "Stopped: within 1\" of <that unit's name> (keep-away)", and a blue ring with the same text sits at the stop point. Move the friendly unit away and the note disappears.
- [ ] Same with an enemy unit standing there (the note names the enemy), and with a charge leg (the declared target is exempt, any other unit is named).
- [ ] Aim a move past its allowance: the note is "Stopped: out of movement" with the marker at the end of the path. Rush out of rubble or other difficult ground toward a far point: "Stopped: difficult terrain caps the move at 6\"". Rush toward a point on the far side of rubble: the existing "Rush stops at the edge of difficult terrain" shows once, with the marker. Point at a 3" deck from open ground with no stairs or ladder in reach: "Stopped: can't climb there (use stairs or a ladder)".
- [ ] Both players: the guest sees the same notes and markers when moving on their side.

## 8. Melee & objectives
- All earlier items verified.

## 9. Multiplayer & custom maps
- All items verified.
