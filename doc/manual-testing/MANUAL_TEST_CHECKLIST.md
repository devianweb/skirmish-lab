# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, the 14B rematch pass on 2026-11-10, and the 14C-2 passes the same day (jumps and group crossing, push, keep-away in 3D, flying indicator, squad follow-through, dangerous terrain dice), the 14C-2 PR 7/7B special rules pass on 2026-11-11 (Fast/Slow, Impact, Counter, Assault, Shred, dangerous terrain wording, activation casualty pick), and the 14C-2 PR 8 + 9 setup pass on 2026-11-11 (objective placement and roll-offs, Scout and Ambush steps, map editor objectives removed) and the PR 9B retest the same day (reserve units, objectives without deployment, Fear wording); which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- [ ] **Blast split prompt (14C-2 PR 10).** Setup: both players pick **TEST: Rules Check** (Test Squad A and Test Squad B start within 3" of each other). Host activates the Test Heavy Gunner, shoots Squad A with only the Frag Launcher selected. Guest: the dock "Split Blast Hits" appears with a countdown, one row per squad (Squad A and Squad B, each "max 4"), the Auto split pre-filled, "3 of 3 hits assigned"-style count and Auto split / Confirm. Host: sees "Waiting for Guest to split the Blast hits". Check: the + / - buttons stop at 0 and at each squad's max; Confirm is disabled while the count is wrong; Auto split puts the Auto numbers back; a lopsided split (all hits on one squad) is accepted; after Confirm the dice panel and log show the roll and the chosen split ("Frag Launcher Blast(3): ... -> Squad A n · Squad B m"), followed by the usual casualty picks.
- [ ] **Blast split: timeout and no-prompt cases.** Let the 30 s run out on a Blast split: the Auto split is applied for the guest. A Blast shot at a lone unit (nothing else within 3") and a Blast shot that misses entirely show no split prompt. Firing both Blast weapons of the Heavy Gunner in one salvo (Frag Launcher and Trench Mortar at the same squad) gives one dock with a block per weapon.

## 8. Melee, objectives & setup
- All items verified.

## 9. Multiplayer & custom maps
- All items verified.
