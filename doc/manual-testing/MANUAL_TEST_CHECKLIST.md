# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, the 14B rematch pass on 2026-11-10, and the 14C-2 passes the same day (jumps and group crossing, push, keep-away in 3D, flying indicator, squad follow-through, dangerous terrain dice), and the 14C-2 PR 7/7B special rules pass on 2026-11-11 (Fast/Slow, Impact, Counter, Assault, Shred, dangerous terrain wording, activation casualty pick); which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- [ ] Moving the pointer over the board as the placer draws a ring at the cursor: green on legal ground, red inside a deployment zone, inside the 9" circle of a placed marker, or inside terrain, with the reason under the prompt. A click on a red spot shows the same reason as a toast and sends nothing; a click on a green spot asks Confirm / Cancel.
- [ ] After each confirmed marker the turn passes, the marker appears on the table in both windows (coloured ring and disc), and a gold 9" circle is drawn around it. Placing on a catwalk or deck puts the marker at the deck height.
- [ ] After the last marker the panel adds "Deployment roll-off: X deploys first" (also toasted) and that player has the first deployment turn; deployment itself works as before.
- [ ] Select `Test Scouts` in the roster: the bottom bar offers "Deploy now" and "Hold as Scout" (an ordinary unit offers neither). "Deploy now" says to click in your zone, and deploying works only inside the 12" zone. "Hold as Scout" asks Confirm, then the unit is tagged "HELD AS SCOUT" and the turn stays with you while you still have other units.
- [ ] Once every other unit is placed, the held Scouts are placed starting with the player who activates first in round 1: the zone shading grows 9" past your zone, orange circles surround enemy models that are not Scouts, and a spot inside a circle or past the zone is red with the reason. Then round 1 starts with the deployment roll-off winner.
- [ ] Ambush units (`Test Ambushers`, `Test Lurkers`) are listed as "IN RESERVE (AMBUSH)" for both players from the start, cannot be deployed in the deployment phase, and take no part in round 1.
- [ ] At the start of round 2 the Ambush step opens for the player who activates first: the header reads "Your turn to place Ambush units", orange circles show the ground within 9" of every enemy model, a red spot gives the reason, and a green click + Confirm places the unit anywhere else. A unit that arrived this way can't seize or contest an objective at the end of that round. The opponent sees "Waiting for X to place Ambush units".
- [ ] "Skip (wait for a later round)" asks Confirm / Cancel (a real choice), then the placement passes to the opponent; when both have placed or skipped, the round starts with the same first player. An Ambush unit that was skipped is still "IN RESERVE (AMBUSH)" and can arrive in round 3.
- [ ] A new game without the deployment phase starts in round 1 with no objective markers on the table (maps no longer carry objectives).
- [ ] Map editor: there is no Objectives tab, "Objective Beacon" tool or "Auto Obj" button; loading an older saved map that had objectives works and Save / Export JSON no longer contains an `objectives` list; the validation badge never mentions objectives.
- [ ] Rematch after a finished game keeps the same objectives and roll-offs and starts straight in deployment (no new rolls).

## 9. Multiplayer & custom maps
- All items verified.
