# 14C-3: Four v3.6 armies at 400 pts
Status: approved, PR 1 re-split into 1A–1D with Decisions 3, 3b, 5d on 2026-11-11 (owner, 2026-11-10: "Go ahead with all of 14C"; 2026-11-11: "Just make sure the lists make sense". Opus re-checked every unit, cost, stat and upgrade against the four v3.6 army book PDFs on 2026-11-11: all four lists total 400 pts and meet Decision 1, and every rule they use exists in the engine or is added here)
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14C (part 3 of 3). Umbrella: `doc/plans/14C-opr-v3.6-alignment.md` (Decisions 3, 4, 10). Depends on 14C-2 being merged.

## Goal
The army pickers offer four ready-made 400-pt lists with official v3.6 stats: Human Defense Force, Orc Marauders, Prime Brothers and Alien Hives. Each list follows Force Org strictly, has no casters, and every special rule it uses works in the engine. Frontier Wardens and Rust Raiders are removed. TEST armies stay behind developer mode.

## Decisions (agreed)
1. **Force Org at 400 pts (strict):** at most 1 Hero; at most 2 copies of a unit; no unit over 140 pts; at most 5 units; at most 30 total Tough (sum over all models). A shared data test enforces this for every non-TEST army, plus "total = 400".
2. **Tough is per model.** `Infantry Squad [3] … Tough(3)` means three models with Tough 3 each (9 Tough for the unit). Each model's `maxWounds` = its Tough.
3. **Per-model loadouts** (owner, 2026-11-11, after PR 1A found the engine has none: "1, assuming this is the closest to how the tabletop handles it" — it is). Each model carries its own weapons, as on the tabletop: in the 3-model Veterans two models have a Battle Rifle and one a Grenade Launcher. Schema (shared): `FighterDefinition.modelLoadouts?: string[][]` (weapon profile IDs per model, length = `modelCount`; absent = every model carries `weapons`, so existing armies are unchanged); `Unit.weapons` stays the list of distinct weapons the unit carries; `Model.weaponIds?: string[]` names the ones that model carries (absent = all). A weapon fires or strikes once per **living model that carries it** and qualifies (in range and sight for shooting, within 3" for melee). A model removed as a casualty takes its weapons with it (the owner still picks casualties, Decision 37 of 14C-2). Same-name weapons on different models still share one target. Special rules stay unit-level: in all four lists every model in a unit has the same rules, so "most models have the rule" is the same as "the unit has it". Per-model rules wait for Army Forge (Phase 16).
3b. **Strike with all melee weapons** (owner, 2026-11-11: adopt v3.6). Each model within 3" of the enemy strikes with every melee weapon it carries, Assault weapons included, one resolution per weapon (e.g. the HDF Company Leader strikes with Hand Weapon A6 and Pistol A2). Counter weapons still strike first when charged (14C-2 PR 7); the strike-back uses all the defender's non-Counter melee weapons (all of them when it made no Counter strike). Impact stays per striking model. Replaces "the unit strikes with its first melee weapon".
3c. **Deadly first** (owner, 2026-11-11: fix as written, in PR 1D). When one attack (a shoot, or a unit's melee strike) uses several weapons on the same unit, the Deadly weapons' wounds are applied before the others, as v3.6 says. Otherwise the order stays as it is (equipment / allocation order). When the target is wiped out, the remaining weapons' wounds are lost, as on the tabletop (no carry-over to other units).
4. **Names:** unit, weapon and army names are OPR's own (as in the book). Army IDs: `hdf`, `orc-marauders`, `prime-brothers`, `alien-hives`. Descriptions/flavour text: one short line in our own words, never book text.
5. **Faction rules** used by these lists, implemented as data-driven traits (registry entries with own-words descriptions):
   - `hold-the-line` (HDF) and `hive-bond` (Alien Hives): +1 to Morale Test rolls when the unit was shot from over 9" away or charged from over 6" away (the attacker's distance at the moment of the attack/charge start). Applies only if most models in the unit have the rule.
   - `bad-shot` (Orc Marauders): -1 to hit when shooting.
   - `ferocious` (Orc Marauders): when this model shoots at a target over 9" away or charges a target that was over 6" away at the charge start, each unmodified 6 to hit deals 1 extra hit (only the original counts as a 6 for other rules).
   - `primeborn` (Prime Brothers): hits against a unit where most models have this rule count as having AP(-1), to a minimum of AP(0).
   - Old faction traits (`steadfast`, `marksman`, `riot-shield`, `iron-will`, `order-*`, `aura-*`, …) are deleted with the Frontier Wardens / Rust Raiders armies unless a TEST army still needs one (then keep it, but only for the TEST army).
5b. **Repel Ambushers** replaces the old `perimeter-watch` trait (owner, 2026-11-11: "go with however the tabletop handles it"). OPR's rule (an HDF upgrade): enemy units using Ambush must be set up more than 12" away from this model's unit, measured per unit. That is what `ambushKeepOut` already does for `perimeter-watch`; rename the trait to `repel-ambushers` (Display "Repel Ambushers", own-words description) and keep the logic, so it survives the removal of the old armies. No list below takes it; a TEST army may.
5c. **Objectives on a zone edge** (owner, 2026-11-11, confirming PR 8): a spot exactly on a deployment-zone edge is inside the zone (the zone is everything within 12" of the table edge), so an objective can't go there.
5d. **Blast spill counts as shot** (owner, 2026-11-11; the books are silent, so common sense): a unit that takes split Blast hits counts as shot for Hold the Line / Hive Bond, at the shooter's distance to that unit. A unit within 3" that gets no hits from the split isn't shot.
6. **The four lists** (points from the v3.6 books; the implementer re-checks each cost against the PDF and stops if a number doesn't match):

   **Human Defense Force (400 pts, Tough 30, 4 units)** — `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Human Defense Forcev3.6.0.pdf`
   - Company Leader [1] — 100: Q4+ D5+, Hero, Hold the Line, Tough(9); Hand Weapon (A6), Pistol (12", A2, Assault).
   - Veterans [3] — 125: Q4+ D5+, Hold the Line, Tough(3); 3× Strike (A2); 2× Battle Rifle (24", A2); 1× Grenade Launcher (24", A2, Blast(3)) replacing one Battle Rifle (+15).
   - Infantry Squad [3] — 120: Q5+ D5+, Hold the Line, Tough(3); one model Plasma Rifle (24", A4, AP(2)) + Strike (+20); one Sergeant with Plasma Pistol (12", A2, AP(2), Assault) + Sgt. Hand Weapon (A2) (+5 +10); one model Battle Rifle + Strike.
   - Sniper [1] — 55: Q5+ D5+, Hold the Line, Scout, Stealth, Tough(3); Strike (A2), Sniper Rifle (30", A1, AP(1), Deadly(2), Reliable) (free swap for the Wrecker-Sniper Carbine, avoiding Anti-Cover/Fracture).

   **Orc Marauders (400 pts, Tough 27, 5 units)** — `…/GFF - Orc Maraudersv3.6.0.pdf`
   - Orc Leader [1] — 95: Q4+ D5+, Bad Shot, Ferocious, Hero, Tough(9); Hand Weapon (A2), Heavy Flamer-Mod (12", A2, AP(1), Blast(3), Limited), Carbine (18", A4).
   - Orc Biker [1] — 120: Q4+ D5+, Bad Shot, Fast, Ferocious, Tough(9); Hand Weapon (A2), Pistol (12", A2, Assault), Bike-Gun (24", A4).
   - Veteran [1] — 60: Q3+ D4+, Bad Shot, Ferocious, Tough(3); Hand Weapon (A2), Pistol (12", A2, Assault).
   - Infiltrator [1] — 60: Q4+ D5+, Bad Shot, Ferocious, Scout, Stealth, Strider, Tough(3); Hand Weapon (A2), Pistol (12", A2, Assault).
   - Specialist [1] — 65: Q4+ D5+, Bad Shot, Ferocious, Relentless, Tough(3); Strike (A2), Flamer (12", A2, Blast(3), Reliable).

   **Prime Brothers (400 pts, Tough 15, 5 units, no Hero)** — `…/GFF - Prime Brothersv3.6.0.pdf` (cheapest Hero is 160 pts > 140 cap, umbrella Decision 10)
   - Prime Brother [1] — 80: Q3+ D3+, Fearless, Primeborn, Tough(3); Strike (A2), Marksman Rifle (30", A2, AP(1)) (+5).
   - Prime Brother [1] — 75: as above with Heavy Rifle (18", A2, AP(1)).
   - Assault Prime Brother [1] — 80: Q3+ D3+, Fearless, Primeborn, Tough(3); Hand Weapon (A2), Heavy Pistol (9", A2, AP(1), Assault).
   - Support Prime Brother [1] — 95: Q3+ D3+, Fearless, Primeborn, Relentless, Tough(3); Strike (A2), Flamer (12", A2, Blast(3), Reliable).
   - Elimination Brother [1] — 70: Q4+ D4+, Fearless, Primeborn, Scout, Stealth, Strider, Tough(3); Strike (A2), Sniper Rifle (30", A1, AP(1), Deadly(2), Reliable).
   (The two Prime Brothers are two copies of the same unit, which Force Org allows.)

   **Alien Hives (400 pts, Tough 30, 4 units)** — `…/GFF - Alien Hivesv3.6.0.pdf`
   - Grunt Veteran [1] — 105: Q5+ D5+, Hero, Hive Bond, Strider, Tough(9); Spike-Shooter (12", A2, Assault), Slashing Blade (A6, Rending) replacing Claws (+20).
   - Assault Grunts [3] — 100: Q5+ D5+, Hive Bond, Strider, Tough(3); 2× Toxin Claws (A2, Bane); 1× Serrated Claws (A6, AP(2)) replacing one Toxin Claws (+20).
   - Shooter Grunts [3] — 125: Q5+ D5+, Hive Bond, Strider, Tough(3); 3× Claws (A2); 2× Bio-Ravager (18", A4); 1× Bio-Plasma (24", A4, AP(2)) replacing one Bio-Ravager (+15).
   - Support Grunt [1] — 70: Q5+ D5+, Hive Bond, Relentless, Strider, Tough(3); Bug-Spewer Bio-Mortar (24", A2, Blast(3), Indirect), Claws (A2).
7. **Models/visuals:** map each unit to an existing fighter role/model in `doc/ASSETS.md` (infantry, leader, bike, beast, sniper…). No new art. Update the ASSETS table.
8. **Default matchup:** host HDF vs guest Orc Marauders. TEST armies unchanged (dev mode).
9. **Deployment fit:** with 4–5 units per side the default deployment helpers must still place everything inside the 12" zones; adjust scenario spawn spacing if needed.

## Out of scope
- Army builder / upgrades UI, Army Forge import (Phase 16).
- Casters, spells, auras, buffs, any rule not used by these four lists.

## Background
- `shared/src/data/armies.ts`, `shared/src/data/weapons.ts`, `shared/src/rules/traits.ts`, `shared/src/data/scenario.ts` (default units), `client/src/ui/Lobby.ts` (army pickers), `doc/ASSETS.md`.

## PR 1 is split into 1A–1D (2026-11-11)
PR 1A found the engine has no per-model weapons, so PR 1 became four PRs. "PR 1 done" (the owner's deploy trigger) means 1D is merged.

## PR 1A: Force Org harness, Hold the Line, Repel Ambushers  (branch: `14C-3-armies-1`, PR #340)
- **Layer:** shared data + engine traits; one HUD text change (the Morale line shows the roll modifier).
- **Tests first:** Force Org/points harness for all non-TEST armies (the legacy armies are exempt until PR 4); Hold the Line +1 at shot from 9.1" vs 9.0" and charged from 6.1" vs 6.0" (declared and one-click charges); Blast spill units count as shot (Decision 5d); `perimeter-watch` renamed `repel-ambushers`, same 12" keep-out.
- **Docs:** DATA_MODEL/SYSTEMS, ROADMAP, manual checks on the TEST: Scout & Ambush Check army (Test Guard carries Repel Ambushers and Hold the Line).

## PR 1B: Per-model loadouts and all-weapons melee, engine  (branch: `14C-3-armies-1b`)
- **Layer:** shared schema + engine only (Decisions 3, 3b). The client must still build and pass; any HUD gap is listed for 1C.
- **Tests first:** a 3-model squad with 2× Battle Rifle + 1× Grenade Launcher fires A2×2 and A2×1 (Blast on the launcher only); removing the launcher model as a casualty removes the launcher; a model out of range/sight doesn't add its weapon; existing armies without `modelLoadouts` unchanged; melee: a model strikes with each of its melee + Assault weapons (Leader 6 + 2), only models within 3" count, per weapon; Counter first, then the rest; strike-back with all non-Counter melee weapons; casualty pauses (14C-2 PR 7B) still size dice right; serialization round-trip of `Model.weaponIds`.
- **Docs:** DATA_MODEL (schema), SYSTEMS/RULES_SPECIFICATION (melee strikes with every weapon), ROADMAP.

## PR 1C: Loadouts and multi-weapon melee in the HUD  (branch: `14C-3-armies-1c`)
- **Layer:** client UI. The unit panel lists weapons with counts (`2× Battle Rifle`); the shoot panel shows how many models fire each weapon; the charge/fight UI no longer picks one melee weapon; the dice panel and log show one line per melee weapon. A TEST army with mixed loadouts (dev mode) as the manual-check fixture.
- **Docs:** UI inventory entries for the panels that change; manual checks with a Setup line naming the TEST army and map.

## PR 1D: Human Defense Force  (branch: `14C-3-armies-1d`)
- **Layer:** shared data + lobby picker entry. The list in Decision 6 with `modelLoadouts`; costs re-checked against the PDF; ASSETS mapping (Decision 7); deployment fit (Decision 9). The Force Org harness now checks HDF.
- **Engine fix (Decision 3c):** resolve Deadly weapons first in shooting and melee. Test: a Tough(3) squad takes 2 wounds from a plain weapon and 1 wound from a Deadly(3) weapon in the same attack; the Deadly wound kills an unhurt model and the plain wounds then land, whatever order the weapons are listed in.
- **Tests first:** HDF list totals and Force Org; each unit's per-model weapons match Decision 6.
- **Docs:** ASSETS, ROADMAP, manual check "HDF list plays" (Setup: HDF in the lobby picker, Standard Battlefield).

## PR 1E: Fixes from the owner's PR 1 pass  (branch: `14C-3-armies-1e`)
Owner feedback, 2026-11-11 (checklist section 10):
- **Squad-mates block sight (bug).** Three models of one squad in their starting triangle: the rear models' sight lines pass through the front model and are treated as blocked. Models of the shooting unit must never block each other (SYSTEMS: `unitBlockingSegment` skips the shooter's unit). Find which path blocks (host check, HUD preview `squadAim`, aim lines, debugger), reproduce it in a test first, fix it everywhere the HUD and host agree.
- **Which model carries which weapon (Decision 3d, owner: "I like your recommendations. Maybe instead of showing a list of total weapons, show model 1 weapons, model 2 etc").** For units with per-model loadouts:
  - the unit data card lists weapons per model ("Model 1: Battle Rifle, Strike", "Model 2: …"), numbered by the model's fixed index so numbers don't shift when models die; dead models are shown as removed; units whose models all carry the same weapons keep the current list;
  - hovering or selecting a model on the board shows that model's number and weapons;
  - in the shoot preview each aim line is labelled with the weapon(s) that model fires;
  - the casualty-pick prompt shows each model's weapons next to it.
  - The compact unit list on the left keeps the counts (`2× Battle Rifle`).
- **Deadly-first manual check.** HDF step 8 can't be run. Give a unit in TEST: Loadouts Check a Deadly weapon and a plain ranged weapon that fire together, and rewrite the check to use it.
- **Docs:** UI inventory (data card, hover, aim labels, casualty prompt), manual checklist items with Setup lines, SYSTEMS (sight fix).

## PR 1F: Per-model weapons as table sub-headings  (branch: `14C-3-armies-1f`)
Status: done, merged as #353 and released 2026-11-11; the owner passed all its manual checks the same day. Follow-ups are PR 1G.
Owner feedback on PR 1E, 2026-11-11: "Not a huge fan of this approach. Can you make it so the weapons table has sub headings to split it up for each model?"
- **Layer:** client UI. For units whose models' loadouts differ, the data card's weapons table is split by model: a sub-heading row per model ("Model 1", "Model 2", …, fixed numbers; a dead model's heading reads "Model N — removed" with no rows or greyed rows), each followed by that model's weapon rows (type, range, dice, traits). This replaces the separate "Model N: weapons" lines under the table. Units whose models all carry the same weapons keep the plain table. Hover highlighting moves to the hovered model's sub-heading block. Compact unit list, aim-line labels and casualty prompt unchanged.
- **Tests first** (jsdom): sub-heading per model in fixed order, a dead model's block, identical-loadout units unchanged, hover highlight.
- **Docs:** UI inventory (data card shots), manual check with Setup "TEST: Loadouts Check", Standard Battlefield.

## PR 1G: Grouped model sub-headings, per-model wounds, no header hover line  (branch: `14C-3-armies-1g`)
Owner feedback on PR 1F, 2026-11-11 (all PR 1F manual checks passed): "Header line kept: Get rid please." "I like the sub headers, but if two models are the exact same maybe we need Model 1 / Model 2 etc? Also it would be nice to be able to see what wounds each model has."
- **Layer:** client UI only (data card in `client/src/ui/GameHUD.ts`, helpers in `client/src/ui/modelLoadout.ts`). No engine or rules change.
- **Remove the header hover line.** Delete the yellow "Model N · weapons" line (`.sl-hud-hovered-model`) from the data card header. The highlighted sub-heading block already says it.
- **Identical models share one block (Decision 3e).** Models that carry exactly the same weapons are grouped under one sub-heading, followed by one set of weapon rows: "Model 1 / Model 2" then Rifle, Blade; "Model 3" then Blade, Frag Launcher. Groups are ordered by their lowest model number and members are listed in number order, adjacent or not ("Model 1 / Model 3"). Numbers stay fixed (`modelNumber`). The weapon rows show no carrier counts.
- **Per-model wounds (Decision 3f).** For units whose models have Tough above 1, each model in a sub-heading shows the wounds it has taken out of its Tough, in the wording the HUD already uses for single models (`woundTag`): "Model 1 · 0/3 W / Model 2 · 2/3 W". Tough 1 models show no wound text (they are either alive or removed).
- **Squads with the same weapons but Tough above 1** (e.g. a 3-model Tough(3) squad where every model has the same loadout) also get the sub-heading row, as one group over the plain rows, so each model's wounds can be read: "Model 1 · 0/3 W / Model 2 · 1/3 W / Model 3 · 0/3 W". Single-model units and Tough 1 squads with identical loadouts keep the plain table with carrier counts.
- **Removed models.** A dead model stays in its group's heading, greyed, as "Model 2 — removed" (e.g. "Model 1 · 0/3 W / Model 2 — removed"). The group keeps its weapon rows while any member is alive. When every member is dead, the whole heading is greyed and it has no rows (as in PR 1F).
- **Hover.** Hovering a model highlights only that model's name (and wound text) in the heading, plus the group's weapon rows. Each model's part of the heading is its own element (e.g. `<span class="sl-hud-model-name" data-model-number="2">`) so tests and styles can address it.
- **Unchanged:** unit list counts ("2× Rifle"), aim-line labels, the casualty prompt, the single-model wound tag in the card's status tags.
- **Tests first** (jsdom, `client/tests/ui/GameHUD.modelWeapons.test.ts`; pure helpers in `client/tests/ui/modelLoadout.test.ts`): Test Mixed Squad renders "Model 1 / Model 2" + rows then "Model 3" + rows; non-adjacent identical models group; wound text per model for a Tough 3 squad after one model takes a wound, none for Tough 1; identical-loadout Tough 3 squad gets one heading with all three models; one dead member greyed in a live group, rows kept; all members dead, no rows; hover highlights one model name and the group's rows; no `.sl-hud-hovered-model` anywhere; single-model unit and identical Tough 1 squad keep the plain table.
- **Fixtures:** TEST: Loadouts Check already has Test Mixed Squad (Tough 1, two identical models + one different) and Test Deadly Squad (Tough 3, mixed). Add a 3-model Tough 3 squad with identical loadouts ("Test Tough Squad": Rifle + Blade each) to that army for the same-weapons case, and check the deployment still fits.
- **Docs:** UI inventory (re-take the `l13-*` shots that show the data card with `tools/ux-inventory/scenes/13-loadouts.js`; update the two entries' notes in `catalog.js` and in `doc/ux/inventory/index.html`; add a shot with a wounded and a removed model if the scene reaches it), manual checks with Setup "TEST: Loadouts Check, Standard Battlefield", SYSTEMS (the "Which model carries which weapon" paragraph), ROADMAP.

## PR 2: Orc Marauders  (branch: `14C-3-armies-2`)
- **Tests first:** Bad Shot -1; Ferocious extra hit on 6 at >9" shooting and on charges started >6" away, not at 9.0"/6.0"; list totals.

## PR 3: Prime Brothers  (branch: `14C-3-armies-3`)
- **Tests first:** Primeborn AP(-1) min 0 (AP(2) → 1, AP(0) stays 0, Rending's AP(+4) on 6s → 3); list totals.

## PR 4: Alien Hives, remove Frontier Wardens / Rust Raiders  (branch: `14C-3-armies-4`)
- **Tests first:** Hive Bond (shares the Hold the Line logic); list totals; old army IDs gone from data, lobby and tests (tests that used them move to TEST armies or the new armies); default matchup HDF vs Orcs.
- **Docs:** README/GDD army list, ROADMAP (14C done), manual checks for all four armies.

## Open questions
None. The owner asked only that the lists make sense; they were checked against the books (see Status).
