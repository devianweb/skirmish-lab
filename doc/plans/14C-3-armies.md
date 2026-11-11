# 14C-3: v3.6 armies at 400 pts (Human Defense Force and Orc Marauders; Prime Brothers and Alien Hives deferred)
Status: approved, PR 1 re-split into 1A–1D with Decisions 3, 3b, 5d on 2026-11-11 (owner, 2026-11-10: "Go ahead with all of 14C"; 2026-11-11: "Just make sure the lists make sense". Opus re-checked every unit, cost, stat and upgrade against the four v3.6 army book PDFs on 2026-11-11: all four lists total 400 pts and meet Decision 1, and every rule they use exists in the engine or is added here)
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14C (part 3 of 3). Umbrella: `doc/plans/14C-opr-v3.6-alignment.md` (Decisions 3, 4, 10). Depends on 14C-2 being merged.

## Goal
**Scope narrowed (owner, 2026-11-11: "I think polish is more important than armies right now"):** this phase ships Human Defense Force (done) and Orc Marauders (PR 2). Prime Brothers (PR 3) and Alien Hives (PR 4) move to ROADMAP "Future Considerations"; their lists, rules and PR notes stay below as the record to pick up later. The original goal follows.

The army pickers offer four ready-made 400-pt lists with official v3.6 stats: Human Defense Force, Orc Marauders, Prime Brothers and Alien Hives. Each list follows Force Org strictly, has no casters, and every special rule it uses works in the engine. Frontier Wardens and Rust Raiders are removed. TEST armies stay behind developer mode.

## Decisions (agreed)
1. **Force Org at 400 pts (strict):** at most 1 Hero; at most 2 copies of a unit; no unit over 140 pts; at most 5 units; at most 30 total Tough (sum over all models). A shared data test enforces this for every non-TEST army, plus "total = 400".
2. **Tough is per model.** `Infantry Squad [3] … Tough(3)` means three models with Tough 3 each (9 Tough for the unit). Each model's `maxWounds` = its Tough.
3. **Per-model loadouts** (owner, 2026-11-11, after PR 1A found the engine has none: "1, assuming this is the closest to how the tabletop handles it" — it is). Each model carries its own weapons, as on the tabletop: in the 3-model Veterans two models have a Battle Rifle and one a Grenade Launcher. Schema (shared): `FighterDefinition.modelLoadouts?: string[][]` (weapon profile IDs per model, length = `modelCount`; absent = every model carries `weapons`, so existing armies are unchanged); `Unit.weapons` stays the list of distinct weapons the unit carries; `Model.weaponIds?: string[]` names the ones that model carries (absent = all). A weapon fires or strikes once per **living model that carries it** and qualifies (in range and sight for shooting, within 3" for melee). A model removed as a casualty takes its weapons with it (the owner still picks casualties, Decision 37 of 14C-2). Same-name weapons on different models still share one target. Special rules stay unit-level: in all four lists every model in a unit has the same rules, so "most models have the rule" is the same as "the unit has it". Per-model rules wait for Army Forge (Phase 16).
3b. **Strike with all melee weapons** (owner, 2026-11-11: adopt v3.6). Each model within 3" of the enemy strikes with every melee weapon it carries, Assault weapons included, one resolution per weapon (e.g. the HDF Company Leader strikes with Hand Weapon A6 and Pistol A2). Counter weapons still strike first when charged (14C-2 PR 7); the strike-back uses all the defender's non-Counter melee weapons (all of them when it made no Counter strike). Impact stays per striking model. Replaces "the unit strikes with its first melee weapon".
3c. **Deadly first** (owner, 2026-11-11: fix as written, in PR 1D). When one attack (a shoot, or a unit's melee strike) uses several weapons on the same unit, the Deadly weapons' wounds are applied before the others, as v3.6 says. Otherwise the order stays as it is (equipment / allocation order). When the target is wiped out, the remaining weapons' wounds are lost, as on the tabletop (no carry-over to other units).
3g. **Wounds in squads follow the tabletop order** (owner, 2026-11-11; v3.6 Beginner's Guide, resolving wounds: the defender gives wounds to one model at a time and must keep wounding the model that already has the most wounds until it is killed). Replaces "the owner picks which models are removed and the wounds go on the picked models first" (14C-2 Decision 37's replay order; the owner still chooses, but in this order):
   1. If the squad has an already-wounded model, new wounds go on it automatically until it dies. No choice. (If several models are wounded, which only fall or dangerous-terrain move wounds can cause, the one with the most wounds taken goes first, ties by model number.)
   2. When wounds must start on an unhurt model, the defender picks which one. It takes wounds until it dies, then the defender picks the next.
   3. One prompt per damaged unit per attack. The engine works out up front how many unhurt models will take wounds (every model in a unit has the same Tough, so the number does not depend on who is picked) and asks the defender to pick that many models **in order**. The last one picked may survive wounded.
   4. The prompt also appears when nobody dies (1 wound on an unhurt Tough 3 squad), because who takes the wound decides which model and weapon goes next.
   5. Deadly is unchanged: each Deadly wound is a chunk of X on one model, resolved before plain wounds (Decision 3c), and what is left of a chunk when that model dies is lost. It follows the same order, so it lands on the already-wounded model if there is one. Example: an unhurt Tough 3 squad takes 1 Deadly(3) wound + 2 plain wounds: pick 2 models in order; the first dies, the second ends on 2/3. Example: Tough 3 squad with one model on 2 wounds takes 4 wounds: the wounded model dies (1), the defender picks 1 model and it dies (3). Two models are removed.
   6. No prompt when there is no choice: the wounds all fit on the already-wounded model(s), only one unhurt model is left to take them, the attack wipes the unit out, or the unit has one model. The result is applied at once.
   7. Unchanged: Tough 1 squads behave as now (every pick is a removal, order does not matter, same wording); the 30 s timeout with the host picking (prefers keeping the squad in one chain); the defender may break coherency and regroup next activation; fall wounds stay on the model that fell and the dangerous-terrain move selector keeps its own picker and order; single-model units get no prompt. The activation test in dangerous terrain already uses this prompt (14C-2 Decision 42), so it follows the new order too.
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
Status: done, merged as #357 and released 2026-11-11; the owner passed its manual check the same day.
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

## PR 1H: Wounds in squads follow the tabletop order  (two PRs: 1H-1 engine, then 1H-2 HUD)
Status: approved by the owner 2026-11-11; 1H-1 merged as #358; 1H-2 merged as #359, released 2026-11-11; the owner passed all its manual checks the same day ("All working"). Do after PR 1G is merged (both touch the data card / casualty prompt area). Implements Decision 3g.

**Why (owner, 2026-11-11):** today the prompt only asks which models are removed, and the replay puts wounds on the picked models first. A Tough 3 squad with one model on 2 wounds that takes 4 new wounds should lose two models, but picking two unhurt models kills only one. Wounds that kill nobody go on the first living model without asking.

**Background (code as it is):**
- `shared/src/engine/actions.ts`: `applyWounds(unit, wounds, deadlyValue, victimIds?)` picks a new victim as "next id of `victimIds`, else an already-wounded model, else the first living model" (the bug: picks beat the wounded model). `applyTrackedWounds` records each application `{ wounds, deadlyValue }` and the unit's snapshot in a `WoundLedger`, then applies with no picks. `deferCasualties` restores every surviving unit that **lost models** and raises `pick-casualties` with `entry.count` = models removed. `replayCasualties` re-applies the applications with the picked ids. The timeout path (`respond-reaction`) calls `autoPickCasualties(unit, count)`.
- `applyWounds` has two other callers that must keep today's "named model first" behaviour: `applyFallWounds` (wounds stay on the model that fell) and `resolveHazardTests` without a ledger (the move's `casualtyModelIds`).
- `shared/src/engine/casualties.ts`: `CasualtyEntry { unitId, count, applications }`, `createPickCasualtiesReaction` (title / description), `validatePickCasualties` (exact count, distinct, living), `autoPickCasualties`.
- Client: `GameHUD.casualtyContext / toggleCasualtyModel / autoPickCasualtyModels / confirmCasualties / casualtySplits / casualtyPromptHtml` (`client/src/ui/GameHUD.ts`), the waiting line for the other player, the log line "removed casualties from …" and the dice-panel title "Casualties removed: …". Tests: `shared/tests/engine/casualties.test.ts`, `deadlyFirst.test.ts`, `client/tests/ui/GameHUD.casualties.test.ts`.
- Deadly first (Decision 3c) already orders the ledger's applications; nothing changes there.

### PR 1H-1: engine  (branch: `14C-3-armies-1h-1`)
- **Layer:** shared engine only (`shared/src/engine/casualties.ts`, `shared/src/engine/actions.ts`, tests). No HUD change; the existing prompt keeps working because the payload shape (`modelIds`) is the same, now read as an ordered list.
- **Wound order (attacks).** One pure allocation routine (suggested: `allocateWounds` in `casualties.ts`, used by `applyWounds`, the count and the preview below). When a new model has to start taking wounds: (a) the living already-wounded model with the most wounds taken, ties by place in `unit.models`; (b) else the next picked id; (c) else, with no picks, the first living model. Deadly chunks as now (chunk of X on one model, the rest of the chunk lost when it dies). The fall and move-hazard callers keep their current "named model first" order (a flag or a separate path), so their tests stay green untouched.
- **Count up front.** While `applyTrackedWounds` applies an attack's wounds, count how many times step (b)/(c) had to start on an unhurt model (`picks`), and how many unhurt living models there were at the first such moment. `deferCasualties` then, per tracked unit that survives: `picks === 0` (all wounds fit on wounded models) or only one unhurt model was available: keep the result, no prompt. Otherwise restore the snapshot and queue the prompt, **also when no model died**.
- **Entry.** `CasualtyEntry` becomes `{ unitId, count, applications, lockedModelIds, removed }`: `count` = unhurt models to pick, in order; `lockedModelIds` = the already-wounded models that take wounds first, in order (empty when none); `removed` = how many models the attack kills in total. All plain data.
- **Validation** (`validatePickCasualties`): as now (prompted owner, the unit, exactly `count` distinct living models), plus every picked model must be unhurt ("Model … is already wounded: it takes wounds first").
- **Replay** (`replayCasualties`): the applications in order with the ordered picks under the new order.
- **Preview for the HUD.** Export a pure `previewCasualtyPick(unit, entry, modelIds)` that returns, in the order they take wounds, `{ modelId, wounds (left), destroyed }` for the locked models and the models picked so far (works with a partial list: wounds that need a pick not yet made are left unassigned). It must not change the unit.
- **Timeout pick** (`autoPickCasualties`): picks only unhurt models, `count` of them, in order; same greedy rule as now (the removal that leaves the smallest `coherencyShortfall`, ties by list order), starting from the squad without the locked models that will die and treating each pick as a removal. Deterministic.
- **Reaction text** (`createPickCasualtiesReaction`): Tough 1 units keep today's title and description. Otherwise title "Assign Wounds" and a description in our own words that says how many models to pick in order and that the last may survive wounded.
- **Tests first** (`shared/tests/engine/casualties.test.ts`, new cases; update the existing "Tough 2" case and any that relied on picked-first):
  - Tough 3 squad, one model on 2 wounds, 4 wounds: prompt with `count` 1, `lockedModelIds` that model, `removed` 2; after the pick both it and the picked model are dead (the owner's bug).
  - Same squad, 1 wound: no prompt, the wounded model dies. 2 wounds on a squad whose wounded model has taken 1: no prompt, it ends on 3 and dies only at Tough.
  - Unhurt Tough 3 squad, 1 wound: prompt with `count` 1, `removed` 0; the picked model ends on 2 left, nobody dies.
  - Unhurt Tough 3 squad, 4 wounds: `count` 2; the first pick dies, the second has 1 wound taken; swapping the order swaps the results.
  - Unhurt Tough 3 squad, 1 Deadly(3) wound + 2 plain (two weapons, Deadly first): `count` 2, first dies, second ends on 2 taken. Deadly(3) on a squad whose wounded model has 1 left: the chunk lands on it, the other 2 are lost, no prompt.
  - Two wounded models (set up by hand): the more wounded one takes wounds first, then the other, then a pick.
  - Rejects: a wounded model in the picks, wrong count, duplicate, dead model, wrong player.
  - No prompt: two living models, one wounded, wounds that kill it and spill onto the other (only one unhurt model); wipe-out; single model.
  - Tough 1 squad: count = wounds, any order gives the same result, same title/description as before.
  - Timeout: picks only unhurt models, keeps the chain where it can, and the result equals a manual pick of the same ids.
  - `previewCasualtyPick`: full and partial lists, unit untouched.
  - Melee: a charge strike that wounds a Tough 3 squad without killing anyone stops at the defender's prompt before the strike-back; the activation hazard test follows the new order.
  - Fall wounds and the move-hazard selector: existing tests unchanged and green.
  - A pending pick survives a JSON round trip (existing test, with the new fields).
- **Docs:** RULES_SPECIFICATION §6.1 / §6.2 (replace the "picked models first" bullet with the order above, in our own words), SYSTEMS "Casualty picks" paragraph and the `applyWounds` sentence, DATA_MODEL if it lists the entry, ROADMAP line. No manual checks in this PR (they come with 1H-2), but say in the PR body that the old prompt now appears for non-lethal wounds.
- **Done when:** all workspaces green; the cases above pass; client tests that drive `pick-casualties` are adjusted only where the old picked-first order was asserted.

### PR 1H-2: HUD prompt  (branch: `14C-3-armies-1h-2`, after 1H-1 is merged)
- **Layer:** client UI only (`client/src/ui/GameHUD.ts`, `client/tests/ui/GameHUD.casualties.test.ts`); no renderer change (picked models keep the orange rings).
- **Ordered pick.** `casualtyPicked` is an ordered list. Clicking an unhurt model (chip or board) appends it; clicking a picked one removes it and the later ones move up. A pick beyond the count toasts as now. Picked chips show their place ("1", "2") and what happens to that model, from `previewCasualtyPick`: "removed" or "survives, N/T W" (wounds taken, the `woundTag` wording of PR 1G).
- **Locked wounded model.** Each id in `lockedModelIds` is shown first as a chip that cannot be clicked: "Model 2 · 2/3 W · takes wounds first", plus "removed" or its new wound tag. Clicking it on the board toasts "Model 2 is already wounded: it takes wounds first".
- **Wording (Tough above 1).** Title "Assign wounds: <unit>" with the countdown. One sentence under it, our own words, e.g. "Model 2 is already wounded and takes wounds first. Then pick 2 models in order (1/2): each takes wounds until it is removed; the last one may survive wounded." Without a locked model the first sentence is left out. When `removed` is 0 say that no model is removed.
- **Tough 1 squads:** exactly today's prompt (title "Remove N models from …", same sentence, no order numbers).
- **Unchanged:** Auto pick (fills the ordered list with `autoPickCasualties`, still editable) and Confirm (enabled with exactly `count` picked); no "let the host pick" button; per-model weapons on the chips for mixed loadouts; fixed model numbers. "splits the squad" now looks at the models that would actually be removed (locked and picked models that die), not at a last pick that survives.
- **Other texts.** The other player's waiting line, the log line and the dice-panel title say "assign wounds" / "Wounds assigned: <unit>" when the unit's Tough is above 1 ("removed casualties" stays for Tough 1).
- **Tests first** (jsdom): locked chip rendered, disabled, and not toggled by a board click; order numbers and renumbering after an unpick; per-chip outcome text for the Deadly(3) + 2 example (first "removed", second "survives, 2/3 W"); the nobody-dies prompt (1 wound, `removed` 0); Confirm sends `modelIds` in click order; Auto pick fills in order; Tough 1 prompt unchanged (existing tests stay green); the waiting line for the other player.
- **Fixtures:** TEST: Loadouts Check on Standard Battlefield, both players (Test Deadly Squad is Tough 3 with a Deadly(3) Fusion Rifle and two Rifles; Test Tough Squad from PR 1G is Tough 3 with Rifles; Test Mixed Squad is Tough 1). No new army or map is needed; if a check turns out to be out of reach, add a unit to this army.
- **Manual checks** (checklist section 10, Setup: dev mode, TEST: Loadouts Check for both players, Standard Battlefield):
  1. Shoot an unhurt Test Tough Squad for 1 or 2 wounds: the defender gets "Assign wounds", picks 1 model, nobody is removed, and the data card shows that model's wounds.
  2. Shoot the same squad again for fewer wounds than the hurt model has left: no prompt, the wounds go on the hurt model.
  3. Shoot it again so the hurt model dies with wounds to spare: the prompt shows the hurt model locked ("takes wounds first", removed) and asks for the next model(s) in order; the last one picked ends wounded as the chip said.
  4. Owner's case: a model on 2 wounds, 4 new wounds: two models are removed (the hurt one and the one picked).
  5. Fire Test Deadly Squad's Fusion Rifle and Rifles together at an unhurt Tough 3 squad: the Deadly wound removes the first model picked, plain wounds go on the second.
  6. Picking order: pick two, unpick the first, the numbers move up; Auto pick fills an order you can still change; Confirm needs the full count.
  7. Let the 30 s run out: the host assigns the wounds, preferring models that keep the squad together.
  8. Test Mixed Squad (Tough 1): the prompt is the old "Remove N models" one.
  9. Charge a Tough 3 squad and wound it without a kill: the defender assigns the wound before its strike-back.
  10. A single-model unit never gets the prompt; a jump/fall or dangerous-terrain move keeps its own selector.
- **Docs:** UI inventory (`l13-09-casualty-pick-models`, `s5-25-reaction-0-pick-casualties-guest`, `s5-25-reaction-0-picked`: re-take or add shots of the ordered prompt with a locked model; notes in `catalog.js` and `doc/ux/inventory/index.html`), SYSTEMS "Casualty pick HUD", manual checklist, ROADMAP.
- **Done when:** all workspaces green, the prompt matches the above on TEST: Loadouts Check, inventory shots updated.

## PR 2: Orc Marauders  (branch: `14C-3-armies-2`)
Status: done, merged as #362 (2026-11-11). Waiting for the owner's manual checks. Note: an extra hit from a 6 (Ferocious, and also Surge, Relentless, Furious) is now a plain hit: only the original hit counts as a 6 for Rending and similar rules, as v3.6 says.
Owner, 2026-11-11: go. Follow PR 1D (Human Defense Force) as the pattern.
- **Layer:** shared data (army `orc-marauders`, weapons, the two trait registry entries) + the engine hooks for the two faction rules + the lobby picker entry. One PR: the rules are small and data-driven (Decision 5).
- **The list:** Decision 6, Orc Marauders (400 pts, Tough 27, 5 units, all single models). Re-check every cost, stat and weapon against `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Orc Maraudersv3.6.0.pdf`; stop and report if a number differs or a rule the list uses (Limited, Reliable, Relentless, Strider, Fast, Scout, Stealth, Blast, Assault) is missing from the engine or behaves differently from v3.6.
- **Bad Shot** (`bad-shot`): -1 to hit when shooting (not in melee). **Ferocious** (`ferocious`): when the model shoots at a target more than 9" away, or charges a target that was more than 6" away when the charge started, each unmodified 6 to hit deals 1 extra hit; only the original counts as a 6 for other rules. Exactly 9.0" / 6.0" does not count. Distances are the host's own (per model, as Hold the Line measures them). Registry descriptions in our own words.
- **Tests first:** Bad Shot -1 on shooting and none in melee; Ferocious extra hit on unmodified 6s at over 9" shooting and on charges started over 6" away, none at exactly 9.0" / 6.0", the extra hit is not a 6 for other rules, and a modified roll that reaches 6 does not count; the list totals 400 and passes the Force Org harness; the army deploys inside its zone (Decision 9).
- **Lobby:** add Orc Marauders to both pickers. The default matchup and the old armies are not touched in this PR (see Open questions).
- **Docs:** ASSETS (Decision 7: map each unit to an existing model role, the Biker to the bike), RULES_SPECIFICATION trait matrix, SYSTEMS, ROADMAP, the dice panel / log wording if a Ferocious extra hit is shown.
- **Manual checks** (section 10; Setup: Orc Marauders vs Human Defense Force, Standard Battlefield): the five units and their weapons read right in the unit list and data card; shooting shows the -1 for Bad Shot; a 6 to hit at over 9" adds a hit and says so in the dice panel, and does not at 9" or closer; a charge started over 6" away does the same in melee; the Heavy Flamer-Mod fires once (Limited); the Biker moves as Fast. If a check can't be reached with this matchup, add a dev TEST army or map for it and name it in the Setup line.

## PR 2B: Remove Frontier Wardens / Rust Raiders, default matchup HDF vs Orc Marauders  (branch: `14C-3-armies-2b`, after PR 2 is merged)
Owner, 2026-11-11: "Yes, remove the old armies." Approved.
- **Layer:** shared data + lobby + docs. Delete the Frontier Wardens and Rust Raiders armies (every `frontier-wardens*` / `rust-raiders*` entry), their fighters, their weapons that nothing else uses, and the old faction traits no other army uses (Decision 5: keep a trait only if a TEST army still needs it, and then only for that army). Delete the Force Org harness's legacy exemption list (PR 1A). The picker then offers Human Defense Force and Orc Marauders, plus the TEST armies in dev mode.
- **Default matchup (Decision 8):** host Human Defense Force vs guest Orc Marauders, in the lobby defaults and in the `applyDefaultScenario` fallbacks.
- **Tests first:** the old army IDs are gone from data and from the lobby options; the default game is HDF vs Orc Marauders and deploys inside its zones; every non-TEST army passes Force Org with no exemptions. Tests that used the old armies move to a TEST army or to HDF / Orc Marauders without weakening what they assert.
- **Docs:** README and GDD army list (two armies), ASSETS, RULES_SPECIFICATION trait matrix (removed traits), ROADMAP, UI inventory (lobby shots and any shot showing the old armies; re-take what the scenes reach and list the rest), manual check: the lobby offers the two armies, the default game is HDF vs Orc Marauders. Old saved rooms with the removed armies are a clean break (no compatibility).

## PR 3: Prime Brothers  — deferred (owner, 2026-11-11), see ROADMAP "Future Considerations"
- **Tests first:** Primeborn AP(-1) min 0 (AP(2) → 1, AP(0) stays 0, Rending's AP(+4) on 6s → 3); list totals.

## PR 4: Alien Hives  — deferred (owner, 2026-11-11), see ROADMAP "Future Considerations"
- **Tests first:** Hive Bond (shares the Hold the Line logic); list totals.
- The rest of the old PR 4 (remove Frontier Wardens / Rust Raiders, default matchup HDF vs Orc Marauders, README/GDD army list) is now PR 2B.

## Open questions
None. (The old armies go in PR 2B: owner, 2026-11-11.)
