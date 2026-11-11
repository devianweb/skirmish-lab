# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, the 14B rematch pass on 2026-11-10, and the 14C-2 passes the same day (jumps and group crossing, push, keep-away in 3D, flying indicator, squad follow-through, dangerous terrain dice), the 14C-2 PR 7/7B special rules pass on 2026-11-11 (Fast/Slow, Impact, Counter, Assault, Shred, dangerous terrain wording, activation casualty pick), and the 14C-2 PR 8 + 9 setup pass on 2026-11-11 (objective placement and roll-offs, Scout and Ambush steps, map editor objectives removed); which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file). When a change alters what a screen, panel or prompt looks like, also re-take its screenshots in the UI inventory (`doc/ux/inventory/index.html`, see `doc/ux/README.md`).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, climbable floors outlined orange, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- All items verified.

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
- All earlier items verified.

### 14C-2 PR 7 + 8: Fear and the melee result line
**Setup:** dev mode (F9 in the lobby), both players pick army `TEST: Special Rules Check` (`test-special-rules-army`; its Fear cultists are 4 models with Fear(1)) on the Standard Battlefield or any open map.
- [ ] Fear in reach, owners named: in a mirror match (both players on `TEST: Special Rules Check`), after a melee that involves the Fear cultists, the log's indented "Melee:" line under "ended an activation" names each unit with its owner (for example "Host's Test Fear Cultists 6 took 1 wound, Guest's Test Fear Cultists 6 took 2 wounds (+1 Fear from Host's 1 model in reach): Guest's Test Fear Cultists 6 loses") and N equals the number of cultists within 3" of the enemy unit times Fear(1), not all four when some stand back. The "Melee result & Morale" dice panel shows the same wording.

### 14C-2 PR 8 + 9: objectives, roll-offs, Scout, Ambush
**Setup:** dev mode (F9 in the lobby); both players pick army `TEST: Scout & Ambush Check` (`test-scout-ambush-army`: two ordinary squads, `Test Scouts` and `Test Outriders` with Scout, `Test Ambushers` and `Test Lurkers` with Ambush) on the Standard Battlefield (or any open map), deployment phase ticked. Two browser windows.
- [ ] A new game opens in the "Objectives" phase with no host click needed: a panel at the top lists "Objective roll: N — M objectives" (3 to 5) and the mission roll-off ("X wins and places the first objective", the dice pairs up to the deciding one, host die first). Both windows show the same numbers, and the log shows the host's "rolled for the objectives" entry.
- [ ] The roll-off winner sees "Place objective 1 of M"; the other player sees "Waiting for X to place objective 1 of M" and clicking the board only says to wait. Both deployment zones are shaded.
- [ ] After the last marker the panel adds "Deployment roll-off: X deploys first" (also toasted) and that player has the first deployment turn; deployment itself works as before.
- [x] Ambush units (`Test Ambushers`, `Test Lurkers`) are listed as "IN RESERVE (AMBUSH)" for both players from the start, cannot be deployed in the deployment phase, and take no part in round 1.
- [ ] Retest: a unit in reserve cannot be activated. In round 2, after both players skip the Ambush step, the Ambush units (`Test Ambushers`, `Test Lurkers`) are still "IN RESERVE (AMBUSH)": clicking them in the roster or on the table does nothing, "N available" in the bottom bar does not count them, and Hold is not offered. The same goes for a Scout that is still held back during deployment.
- [ ] A new game with "Interactive Pre-Match Deployment" unticked also opens in the "Objectives" phase: the host's roll, the mission roll-off, alternate placement and the deployment roll-off all work as above, the units are already standing in their automatic positions, and after the last marker round 1 starts at once (no deployment turns) with the deployment roll-off winner activating first.
- [ ] Rematch after a finished game without the deployment phase keeps the same objectives and roll-offs and starts straight in round 1 with the same player first (no new rolls, no deployment).

## 9. Multiplayer & custom maps
- All items verified.
