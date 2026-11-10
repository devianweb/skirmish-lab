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
- All items verified.

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.
- [ ] **14C-2 Hero:** (TEST: Rules Check army in Developer mode; Test Squads A/B are Quality 6+, the Test Hero 3+) a squad at half within 6" of a living non-Shaken Hero tests with the Hero's better Quality; at more than 6" it uses its own.
- [x] **14C-2 two targets:** (TEST: Rules Check army; the Test Heavy Gunner carries a Frag Launcher, a Trench Mortar, two weapons named Rifle and a Sidearm) the HUD lets you send the weapons to two enemy units but toasts "Cannot split fire across more than 2 distinct targets" for a third. Two weapons with the same name always move to a new target together.
- [ ] **14C-2 Blast spread:** (TEST: Rules Check army; the enemy Test Squads A and B start within 3" of each other) fire the Test Heavy Gunner's Frag Launcher at one of them: the dice panel shows the target's hits plus a "Blast spill" line for the neighbour (its own Defense); both squads owe morale at the end of the activation if they dropped to half. A neighbour more than 3" away takes nothing.
- [ ] **14C-2 Indirect:** (TEST: Rules Check army) the Test Heavy Gunner's Trench Mortar, when the gunner held (did not move) can target a unit behind a wall; after an Advance it reports "No line of sight" on the same target. No -1 to hit appears after moving.

## 8. Melee & objectives
- All earlier items verified.

## 9. Multiplayer & custom maps
- All items verified.
- [ ] **Deployment spacing:** during deployment, try to place a squad so one of its ring models would sit within 1" of a unit you already deployed (friendly or enemy): the placement is refused ("Cannot deploy within 1\" of another friendly unit" / "...of enemy models"), even when the click point itself is clear. With deployment off, the TEST: Rules Check squads start about 2.5" apart (not touching), still close enough for a Blast spill.
- [x] **14C-1 F9 in game:** during a match F9 still opens the LoS debugger and does not change developer mode (return to the lobby: the state is as you left it).
- [x] **14C-1 smoke game:** play a few activations. Data cards show AP / Tough / Rending where relevant, the button and log say Advance, and nothing reads "Suppressed" or "Toughness".
