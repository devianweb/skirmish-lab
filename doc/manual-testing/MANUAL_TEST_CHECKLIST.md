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
- [x] **Repel Ambushers (14C-3 PR 1).** Setup: press F9 in the lobby (developer mode), both players pick "TEST: Scout & Ambush Check", map Standard Battlefield. Deploy everything; play round 1. In the round-2 Ambush step, with an Ambush unit to place, hover the board near the enemy's "Test Guard" (it carries Repel Ambushers): the red exclusion circle around it is 12" wide (9" around the enemy's other units), and a spot between 9" and 12" from the Guard is refused with a reason while the same distance from another enemy unit is accepted.
- [x] **Hold the Line (14C-3 PR 1).** Setup: same lobby entries and map. Shoot the enemy "Test Guard" (Hold the Line, Q4+, 2 models, 1 wound each) from more than 9" away until one model dies, so it must take a Morale Test: the Morale line in the dice panel reads "(need Q4+, roll +1)" and a roll of 3 passes. Repeat from 9" or less (move closer first): the line shows no "+1" and a 3 fails (Shaken). Charge it from more than 6" away and make it lose the melee: "+1" shows again; from 6" or less it does not.
- [x] **Loadouts in the unit panel and shoot panel (14C-3 PR 1C).** Setup: press F9 in the lobby (developer mode), both players pick "TEST: Loadouts Check", map Standard Battlefield. Deploy everything. In the unit list, "Test Mixed Squad" shows "2× Rifle", "3× Blade" and "1× Frag Launcher"; "Test Two-Weapon Leader" shows "Power Sword" and "Assault Rifle" with no count. Activate the squad and press Shoot: two weapon chips appear ("2× Rifle (24")", "1× Frag Launcher (24")"). Click an enemy in range: each chip says how many models fire ("2 fire" / "1 fire"), and the confirmation reads "2× Rifle & 1× Frag Launcher". Move one Rifle model out of range (keep the squad coherent) and aim again: the Rifle chip drops to "1 fire".
    - Units within squad are blocking eachothers LOS, otherwise works.
- [x] **Blast only on the launcher's hits; killing the launcher removes it (14C-3 PR 1C).** Setup: same lobby entries and map. Shoot the enemy "Test Mixed Squad" with yours: the dice panel shows one salvo line per weapon; Blast multiplies only the Frag Launcher's hits, not the Rifle's. Kill the enemy squad's launcher model (pick it when asked which models go): the enemy's unit panel loses "Frag Launcher" and the "Shoot" chips of that unit no longer offer it; the Rifle count falls by one for each Rifle model you remove.
    - There's no indication of which model has which weapon? Does appear to work anwyay.
- [x] **A Leader-style model strikes with both weapons (14C-3 PR 1C).** Setup: same lobby entries and map. Charge the enemy with "Test Two-Weapon Leader": there is no weapon choice anywhere; the confirmation says it "strikes with Power Sword + Assault Rifle" with the attacks for each. After Confirm, the dice panel shows a block per weapon ("Power Sword — To-Hit (need Q4+)" with its dice, then its own Defense row with that weapon's AP, then the same for "Assault Rifle" with no AP), and the total hits/blocked/wounds line still appears; the log has one line per weapon ("Power Sword: 2 attacks, N hits, N unsaved wounds", ...).
- [x] **Strike-back lists every weapon (14C-3 PR 1C).** Setup: same lobby entries and map. Charge the enemy "Test Two-Weapon Leader" with any unit and let it survive: the enemy's Melee Retaliation prompt reads "Strike back with Power Sword + Assault Rifle?" and the button says "Strike Back (Power Sword + Assault Rifle)". Accept: the dice panel shows a To-Hit and Defense block for each weapon.
- [x] **HDF list plays (14C-3 PR 1D).** Setup: lobby (no developer mode needed), host picks "Human Defense Force (400 pts)", guest any army, map Standard Battlefield. Check: (1) the picker lists Human Defense Force for both players and the default matchup is unchanged; 
(2) deploy all 4 units inside your 12" zone; 
(3) the unit cards show Company Leader (Q4+ D5+, Tough 9, Hero, Hold the Line), Veterans (3 models, Q4+ D5+), Infantry Squad (3 models, Q5+ D5+) and Sniper (Q5+ D5+, Scout, Stealth); 
(4) weapon counts: Veterans "3x Strike, 2x Battle Rifle, 1x Grenade Launcher"; Infantry Squad has one Plasma Rifle, one Plasma Pistol with a Sgt. Hand Weapon, one Battle Rifle and 2x Strike; 
(5) the Veterans' Grenade Launcher is the only Blast weapon (the launcher salvo is the only one multiplied); 
(6) Hold the Line: shoot an HDF unit from over 9" until it takes a Morale Test and the Morale line shows +1 (no bonus at 9" or less); 
(7) the Company Leader charges and strikes with Hand Weapon (A6) and Pistol (A2) together; (8) a Sniper Rifle shot (Deadly(2)) at a squad with a plain weapon in the same shoot: the Deadly wounds come off an unhurt model first.
