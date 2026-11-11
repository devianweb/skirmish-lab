# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, the 14B rematch pass on 2026-11-10, and the 14C-2 passes the same day (jumps and group crossing, push, keep-away in 3D, flying indicator, squad follow-through, dangerous terrain dice), the 14C-2 PR 7/7B special rules pass on 2026-11-11 (Fast/Slow, Impact, Counter, Assault, Shred, dangerous terrain wording, activation casualty pick), and the 14C-2 PR 8 + 9 setup pass on 2026-11-11 (objective placement and roll-offs, Scout and Ambush steps, map editor objectives removed) and the PR 9B retest the same day (reserve units, objectives without deployment, Fear wording), and the PR 10 Blast split pass the same day; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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

## 8. Melee, objectives & setup
- All items verified.

## 9. Multiplayer & custom maps
- All items verified.

## 10. Armies and faction rules (14C-3)
- Verified items removed (owner pass, 2026-11-11): Repel Ambushers, Hold the Line, loadout counts, Blast on the launcher only, two-weapon melee and strike-back, HDF list, squad-mates don't block sight, which model has which weapon, Deadly first.
- **Per-model weapons as table sub-headings (14C-3 PR 1F).** Setup: both players pick **TEST: Loadouts Check** (developer mode), map **Standard Battlefield**.
  - [ ] Hover or select **Test Mixed Squad**: the data card's weapons table has a sub-heading row per model ("Model 1", "Model 2", "Model 3"), each followed by that model's own weapon rows with type, range, dice and traits (Models 1 and 2: Rifle, Blade; Model 3: Blade, Frag Launcher). There are no "Model N: weapons" lines under the table any more.
  - [ ] Hover one model of the squad on the board: that model's sub-heading and its weapon rows turn yellow; moving to another model moves the highlight; hovering off the squad clears it.
  - [ ] Shoot the enemy Test Mixed Squad until a model is removed (the defender picks, say, Model 2): its heading reads "Model 2 — removed", greyed, with no weapon rows; Models 1 and 3 keep their numbers and rows.
  - [ ] **Test Deadly Squad** (one Fusion Rifle, two Rifles) is split by model the same way; **Test Two-Weapon Leader** (one model) and any HDF unit whose models all carry the same weapons keep the plain table with no sub-headings.
  - [ ] HDF (lobby picker): **Veterans** and **Infantry Squad** show sub-headings (e.g. the Grenade Launcher only under its carrier); **Company Leader** and **Sniper** show the plain table.
  - [ ] Unchanged: the unit list on the left still shows counts ("2× Rifle"), the aim lines are still labelled per model, and the casualty prompt still shows each model's number and weapons.
