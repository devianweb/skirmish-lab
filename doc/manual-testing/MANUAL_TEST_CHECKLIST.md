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
- [ ] **14C-2 morale at half:** shoot a 4-model squad with a squad of yours until it has 2 models left, then end your activation: a Morale dice panel appears for both players (unit, die, Quality needed, result) and the log says passed or Shaken. A squad hit but still above half (3 of 4 left) rolls nothing. A unit at half that was not hit this activation rolls nothing.
- [ ] **14C-2 Tough:** a Tough(3) model shows `1/3 W`, `2/3 W` as it takes wounds, is not Shaken by the wounds themselves, and is removed on the third (no Wound Effect roll anywhere).
- [ ] **14C-2 Shaken:** a Shaken unit, when you activate it, offers only *End Activation (idle)* (Advance, Rush, Shoot, Charge greyed out); ending it removes the SHAKEN tag. A second wound to a Shaken unit at half still re-tests (it fails automatically, no die). A Fearless unit gets a Fearless die.
- [ ] **14C-2 Hero:** a squad at half within 6" of a living non-Shaken Hero tests with the Hero's better Quality; at more than 6" it uses its own.
- [ ] **14C-2 round end:** ending a round with half your army dead triggers no morale tests.

## 8. Melee & objectives
- All items verified.

## 9. Multiplayer & custom maps
- All items verified.
- [ ] **14C-1 lobby default:** the lobby footer shows "Unofficial fan project for One Page Rules games. Not affiliated with or endorsed by One Page Rules." plus the "Full rules: onepagerules.com (free)" link, and neither army picker lists a TEST army.
- [ ] **14C-1 F9 toggle:** F9 on the main menu shows the toast "Developer mode on", a DEV badge and the TEST armies in both pickers. A page reload keeps it. F9 again shows "Developer mode off" and hides them.
- [ ] **14C-1 F9 in game:** during a match F9 still opens the LoS debugger and does not change developer mode (return to the lobby: the state is as you left it).
- [ ] **14C-1 smoke game:** play a few activations. Data cards show AP / Tough / Rending where relevant, the button and log say Advance, and nothing reads "Suppressed" or "Toughness".
