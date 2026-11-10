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

- New (dangerous terrain dice, 14C-2 PR 6). Setup: a map with a hazard pool and a squad of 5 plus a Tough 3 hero (the Standard Battlefield has pools).
  - [ ] Advance a squad of 5 Tough 1 models across a hazard pool: the log shows one roll of 5 dice (not one die per model) and each 1 removes a model.
  - [ ] Activate a unit that starts inside a pool: one test at activation (dice = wounds it would take to destroy it); then moving out of that same pool rolls nothing more.
  - [ ] A hero with Tough 3 and 1 wound taken rolls 2 dice for the same pool.
  - [ ] Move across two different pools in one activation: two separate tests; walk back over the first pool and there is no new test.
  - [ ] A Flying unit crossing or standing in a pool rolls nothing.

## 8. Melee & objectives
- All earlier items verified.

## 9. Multiplayer & custom maps
- All items verified.
