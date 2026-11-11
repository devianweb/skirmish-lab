# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, the 14B rematch pass on 2026-11-10, and the 14C-2 passes the same day (jumps and group crossing, push, keep-away in 3D, flying indicator, squad follow-through, dangerous terrain dice), the 14C-2 PR 7/7B special rules pass on 2026-11-11 (Fast/Slow, Impact, Counter, Assault, Shred, dangerous terrain wording, activation casualty pick), and the 14C-2 PR 8 + 9 setup pass on 2026-11-11 (objective placement and roll-offs, Scout and Ambush steps, map editor objectives removed) and the PR 9B retest the same day (reserve units, objectives without deployment, Fear wording), and the PR 10 Blast split pass the same day, and the 14C-3 PR 1G / 1H pass (grouped model headings, wound order in squads) on 2026-11-11; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- Verified items removed (owner pass, 2026-11-11): Repel Ambushers, Hold the Line, loadout counts, Blast on the launcher only, two-weapon melee and strike-back, HDF list, squad-mates don't block sight, which model has which weapon, Deadly first, per-model weapon sub-headings in the data card (PR 1F). Follow-up from the PR 1F pass: identical models share one sub-heading, each model shows its wounds, and the hover line in the card header goes (plan PR 1G).

- Verified items removed (owner pass, 2026-11-11, later the same day): grouped model headings and per-model wounds in the data card (PR 1G), ordered wound assignment with the locked wounded model, Deadly, timeout, Tough 1 unchanged and the melee pause (PR 1H, Decision 3g).

- [ ] **Orc Marauders list reads right (14C-3 PR 2).** Setup: Orc Marauders (host) vs Human Defense Force (guest) in the lobby pickers, Standard Battlefield. The unit list shows Orc Leader, Orc Biker, Veteran, Infiltrator and Specialist. Open each data card: Orc Leader has Hand Weapon, Heavy Flamer-Mod (12", A2, AP(1), Blast(3), Limited) and Carbine (18", A4); Orc Biker has Hand Weapon, Pistol and Bike-Gun (24", A4); Veteran (Q3+ D4+) and Infiltrator have Hand Weapon and Pistol; Specialist has Strike and Flamer (A2, Blast(3), Reliable). Every unit lists Bad Shot and Ferocious; hovering them shows the descriptions.
- [ ] **Bad Shot.** Same setup. Shoot with the Orc Leader's Carbine at the Human Defense Force: the dice panel shows Q4 with "-1 Bad Shot" (hits need 5+). Charge and fight in melee: no Bad Shot modifier.
- [ ] **Ferocious, shooting.** Same setup. Shoot at a target more than 9" away until a 6 to hit comes up: the dice panel says "Ferocious (6s add a hit)" and the hit total reads "(incl. N extra from 6s)". At exactly 9" or closer a 6 adds nothing and the Ferocious note is absent.
- [ ] **Ferocious, charging.** Same setup. Charge a unit that was more than 6" away when the charge began: a 6 to hit in the strike adds a hit and the panel says so. Charge from 6" or less: no extra hit.
- [ ] **Heavy Flamer-Mod is Limited.** Same setup. Fire the Orc Leader's Heavy Flamer-Mod once; in a later activation it is no longer offered.
- [ ] **Orc Biker is Fast.** Same setup. The Biker's Advance reach is 8" (Speed 6 +2"), Rush and Charge 16".
