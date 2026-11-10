# 14C-3: Four v3.6 armies at 400 pts
Status: approved (owner, 2026-11-10: "Go ahead with all of 14C"; the four lists below were drafted by Opus under that approval and are flagged for the owner's morning review)
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14C (part 3 of 3). Umbrella: `doc/plans/14C-opr-v3.6-alignment.md` (Decisions 3, 4, 10). Depends on 14C-2 being merged.

## Goal
The army pickers offer four ready-made 400-pt lists with official v3.6 stats: Human Defense Force, Orc Marauders, Prime Brothers and Alien Hives. Each list follows Force Org strictly, has no casters, and every special rule it uses works in the engine. Frontier Wardens and Rust Raiders are removed. TEST armies stay behind developer mode.

## Decisions (agreed)
1. **Force Org at 400 pts (strict):** at most 1 Hero; at most 2 copies of a unit; no unit over 140 pts; at most 5 units; at most 30 total Tough (sum over all models). A shared data test enforces this for every non-TEST army, plus "total = 400".
2. **Tough is per model.** `Infantry Squad [3] … Tough(3)` means three models with Tough 3 each (9 Tough for the unit). Each model's `maxWounds` = its Tough.
3. **Per-model loadouts.** A unit's weapons are listed per model (e.g. in a 3-model squad, one model has a Plasma Rifle instead of a Battle Rifle). Use whatever the engine already supports for per-model weapons in squads; if it only supports unit-level weapon lists with counts, keep counts accurate and note the gap in the report — don't invent a new schema without stopping to report.
4. **Names:** unit, weapon and army names are OPR's own (as in the book). Army IDs: `hdf`, `orc-marauders`, `prime-brothers`, `alien-hives`. Descriptions/flavour text: one short line in our own words, never book text.
5. **Faction rules** used by these lists, implemented as data-driven traits (registry entries with own-words descriptions):
   - `hold-the-line` (HDF) and `hive-bond` (Alien Hives): +1 to Morale Test rolls when the unit was shot from over 9" away or charged from over 6" away (the attacker's distance at the moment of the attack/charge start). Applies only if most models in the unit have the rule.
   - `bad-shot` (Orc Marauders): -1 to hit when shooting.
   - `ferocious` (Orc Marauders): when this model shoots at a target over 9" away or charges a target that was over 6" away at the charge start, each unmodified 6 to hit deals 1 extra hit (only the original counts as a 6 for other rules).
   - `primeborn` (Prime Brothers): hits against a unit where most models have this rule count as having AP(-1), to a minimum of AP(0).
   - Old faction traits (`steadfast`, `marksman`, `riot-shield`, `iron-will`, `order-*`, `aura-*`, …) are deleted with the Frontier Wardens / Rust Raiders armies unless a TEST army still needs one (then keep it, but only for the TEST army).
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

## PR 1: Faction rules + Human Defense Force  (branch: `14C-3-armies-1`)
- **Layer:** shared data + engine traits (+ lobby picker entry).
- **Tests first:** Force Org/points test harness for all non-TEST armies; Hold the Line +1 at shot from 9.1" (yes) vs 9.0" (no) and charged from 6.1" vs 6.0"; "most models" rule; HDF list totals.
- **Docs:** DATA_MODEL/SYSTEMS (faction traits), ASSETS, ROADMAP, manual check "HDF list plays".

## PR 2: Orc Marauders  (branch: `14C-3-armies-2`)
- **Tests first:** Bad Shot -1; Ferocious extra hit on 6 at >9" shooting and on charges started >6" away, not at 9.0"/6.0"; list totals.

## PR 3: Prime Brothers  (branch: `14C-3-armies-3`)
- **Tests first:** Primeborn AP(-1) min 0 (AP(2) → 1, AP(0) stays 0, Rending's AP(+4) on 6s → 3); list totals.

## PR 4: Alien Hives, remove Frontier Wardens / Rust Raiders  (branch: `14C-3-armies-4`)
- **Tests first:** Hive Bond (shares the Hold the Line logic); list totals; old army IDs gone from data, lobby and tests (tests that used them move to TEST armies or the new armies); default matchup HDF vs Orcs.
- **Docs:** README/GDD army list, ROADMAP (14C done), manual checks for all four armies.

## Open questions
None blocking. For the owner's review: the four lists (Decision 6), Prime Brothers without a Hero, Hold the Line / Ferocious distance measurement (Decision 5).
