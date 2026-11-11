# 14C: Line up with One Page Rules (Firefight v3.6)
Status: approved (umbrella, 2026-11-10); sub-plans: 14C-1 (`14C-1-renames-housekeeping.md`), 14C-2, 14C-3 to follow
Scope note (owner, 2026-11-11): 14C-3 is narrowed to Human Defense Force and Orc Marauders. Prime Brothers and Alien Hives are deferred to ROADMAP "Future Considerations"; see `doc/plans/14C-3-armies.md`.
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14C

## Goal
SkirmishLab plays Grimdark Future: Firefight **v3.6.0** as written. It uses OPR's own names for stats, actions, statuses and special rules, and it ships four ready-made armies with official v3.6 stats: Human Defense Force, Orc Marauders, Prime Brothers and Alien Hives. It's a non-commercial fan project. It keeps a one-line "unofficial, not affiliated" disclaimer, uses no OPR logos or art, and copies no rulebook text: in-app rule help is a short summary in our own words, plus a link to OPR's free rules.

## Owner decisions so far (2026-11-09/10)
1. Drop the clean-room distinctness and line up entirely. Keep the **SkirmishLab** name.
2. **Move to v3.6** (option A). The v3.6 PDFs in `assets-src/` replace the v3.5 references: Core Rules, Beginner's Guide, Tournament Guidelines, the four army books, and Campaign, Horde Mode and Solo & Co-Op, which aren't used for the MVP.
3. Four pre-canned armies: HDF, Orc Marauders, Prime Brothers, Alien Hives. Army Forge import is post-MVP Phase 16.
4. **Casters and spells are left out** of the pre-canned lists. They get their own post-MVP roadmap stage.
5. A **clean break** for old saved sessions: no compatibility mapping. Saved custom maps are unaffected, because terrain IDs don't change.
6. **Both IDs and display names** are renamed to OPR's terms.
7. The TEST armies sit behind a **developer mode**, switched on and off with **F9 on the main menu**. It's saved in the browser, shows a small DEV badge, and lists the TEST armies in the army pickers. Normal players never see them.
8. **Jumping (Q1): one roll for the unit**, as v3.6 is written. The player declares one jump for the squad, and its dice are sized by the longest distance any model has to jump. If every die passes, all models cross and it doesn't count toward their move. If any die fails, the model that was jumping (the one with the longest jump) falls and the activation ends; the other models stay at their take-off spots. This replaces per-model declared jumps and Decision 30's "later jumpers stop".
9. **Blast split (Q2): a defender prompt plus auto.** When a Blast's multiplied hits could reach more than one enemy unit (the target and enemy units within 3" of it), the defender splits them in a short timed prompt with **Auto split**: as even as possible, any odd hit going to the target, no unit taking more hits than it has models. On timeout the host applies Auto split. With only one eligible unit there's no prompt.
10. **List size (Q3): 400 pts.** One pre-canned list per army, following Force Org at 400 pts: at most 1 Hero, at most 2 copies of the same unit, no unit over 140 pts, at most 5 units, at most 30 total Tough. No casters. Force Org is followed **strictly** (owner, 2026-11-10). HDF, Orc Marauders and Alien Hives have heroes under the 140-pt cap, but Prime Brothers' cheapest hero is 160 pts, so their list has no hero unless the owner says otherwise when approving it.
    - **Terrain coverage:** v3.6 tournaments want at least 50% of the table covered; the Standard Battlefield covers about 19%. That is revisited in 14G (playtest & polish), not here.
11. **Objectives (Q4): players place D3+2**, as v3.6 is written. There's a new pre-game step before deployment:
    - the server rolls D3+2;
    - a roll-off decides who places first;
    - the players alternately click to place one marker each, outside both deployment zones and more than 9" from other markers.

    Maps no longer define objectives: the editor's objective tool and the map schema's `objectives` go away, and old maps' objectives are ignored. A **rematch keeps the placed objectives** (it replays the exact same game, 14B), so it skips the placement step.

## Reference files (absolute paths; `assets-src/` is gitignored)
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Core Rules v3.6.0.pdf`: the rules. Two pages, the authority.
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Beginner's Guide v3.6.0.pdf`: worked explanations, including the terrain chapter.
- `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Tournament Guidelines v3.6.0.pdf`: 800 pts over 4 rounds. Terrain: at least 50% of the table covered, at least 50% of pieces block sight, at least 33% give cover, at least 33% are difficult, at least 2 are dangerous, and 3" gaps between large pieces. Draws and destruction points; three line-of-sight methods.
- Army books: `GFF - Human Defense Forcev3.6.0.pdf`, `GFF - Orc Maraudersv3.6.0.pdf`, `GFF - Prime Brothersv3.6.0.pdf`, `GFF - Alien Hivesv3.6.0.pdf`.
- `doc/plans/README.md` still lists the removed v3.5 files. 14C-1 updates it.

## v3.6 vs our engine: what changes
Proposals default to **adopt v3.6 as written**. "Keep" marks a digital adaptation or an earlier owner decision that v3.6 leaves room for. The owner's choices on jumping, Blast, list size and objectives are Decisions 8–11.

### Casualties, Tough and morale (the biggest change)
| Area | v3.6 | Ours now | Proposal |
|---|---|---|---|
| Wounds | Each failed block is a wound. A model dies once its wounds reach its Tough (Tough 1 if none). No roll after wounds. | Wound-effect table: 1d6 + wound tokens; Shaken below 5+X, Knocked Out at 5+X; `resilient(X)` accumulates first. | **Adopt.** Remove the wound-effect table, `stunned` from wounds, knocked-out rolls and `traumaOutcome`. Rename `resilient(X)` to `tough(X)`; wounds kill at X. Casualty picking (Decision 37) stays as is. |
| Morale trigger | Morale is tested at the end of an activation where wounds leave a unit at half or less of its size (or of its Tough, for a single model), or when it loses a melee. | Round-end "army broken at 50% of units" tests. | **Adopt.** Remove army-broken morale. |
| Failed morale | Shaken. If it fails a melee-result test while at half or less, it Routs (destroyed). | Shaken; already Shaken plus a fail means Routed. | **Adopt.** |
| Shaken | Stays idle and may only strike back (as Fatigued). Always fails morale, can't seize or contest objectives, and clears by spending one whole activation idle. | Similar (`stunned`/`shaken`). | **Adopt.** One status, `shaken`. |
| Melee result | Units in melee skip wound morale. Whoever took more wounds this activation loses and tests. Fear(X) counts as +X wounds dealt for this. | Fear (`dread`) adds to wound-effect rolls. | **Adopt.** Fear rewritten. |
| Hero | Units within **6"** may use the Hero's Quality for morale (if not Shaken). | 12". | **Adopt.** |
| Pushing | When a unit is Shaken after being attacked, the attacker rolls one die. On 4+ it may move one model up to 2"; the owner then places the rest within 1" of it. | Old knockback on a Suppressed result (check whether it's implemented). | **Adopt.** The push reuses our placement UI pattern (attacker's prompt with a timeout). |

### Movement, terrain, jumping
| Area | v3.6 | Ours now | Proposal |
|---|---|---|---|
| Coherency | Within 1" of at least one other member, and within 6" of all. | Same, plus our **single-chain** rule (batch 1I) and **3" across levels**. | **Keep** our extras (earlier owner decisions; v3.6 allows them). |
| 1" rule | Units only come within 1" of other units when charging. | Same. | No change. |
| Difficult | No more than 6" in total. | Same (whole path). | No change. |
| Dangerous | Units moving across it, or activating in it, roll as many dice as the wounds needed to destroy them. Each 1 is a wound. | One die per model (14C was going to look at this). | **Adopt.** For a squad that's the sum of the living models' remaining wounds. Settles the Tough-dice follow-up. |
| Jumping | Free: gaps of 1" or less, drops of 3" or less. Gaps or drops up to 6" need a jump: **one die per 1"** of the distance, each needing **2+**. If all pass, **all models in the unit** cross without it counting toward the move; any fail and the model falls. | X+1 dice, one per full 3", needing 3+. Jumps are declared per model, and a failed jump stops the later jumpers (Decision 30). | **Adopt**, including **one roll for the unit** (Decision 8). |
| Strider | Ignores difficult terrain; jumps roll **half the dice** (rounding up). | Jumps on 2+. | **Adopt.** |
| Flying | Moves through units and terrain, ignores difficult and dangerous terrain, auto-passes jumps. | Same. | No change. |
| Falling | A fall of **2"** or more: roll one die per 1" fallen, and each 1–3 is a wound. Place the model within 2" of the bottom, the rest of the unit within 1" of it. The activation ends. | One hit with AP(1) per full 3". | **Adopt.** Landing placement stays (within 2", clear, supported). |

### Shooting and melee
| Area | v3.6 | Ours now | Proposal |
|---|---|---|---|
| Targets | Up to **two** targets, with different weapon types. | Per-weapon allocation to any number of targets. | **Adopt.** At most 2 targets; two weapons with the same profile can't split. |
| Melee reach | Models within **3"** of enemies strike with all melee weapons. | 2" base edge (and 4" vertical). | **Adopt** 3" base edge. Keep the 4" vertical limit. |
| Strike back | The defender may choose to strike back. | Same (prompt). | No change. |
| After melee | If either unit is destroyed the other may move up to 3"; otherwise the chargers move back 1". | Same. | No change. |
| Blast(X) | Ignores Cover. Each hit becomes X hits, split evenly between the target and all enemy units within 3" of it (**the defender picks how**). No unit takes more hits than it has models. | Hits × X, capped at the target's models (or those within 3"). | **Adopt**, with a defender prompt and Auto split (Decision 9). |
| Indirect | Only on **Hold**: may target enemies out of sight and ignores cover from sight blockers. | −1 to hit after moving. | **Adopt.** |
| Deadly(X) | Resolve first; each wound on one model ×X; no carry-over. | Same. | Check during the audit. |

### Special rules (core reference)
- **New to implement:** Fast, Slow, Impact(X), Counter (strikes first when charged, unless Fatigued), Assault (the weapon counts as both ranged and melee), **Shred** (each unmodified block roll of 1 adds a wound; a different rule from Rending, which our code calls `shred` today).
- **Changed:** Scout (deploys within 9" of its own zone, more than 9" from non-Scout enemies), Ambush (alternate placement), Hero (6"), Indirect, Strider, Fear, Blast, Counter.
- **Unchanged in effect:** AP, Bane, Deadly, Fearless, Flying, Furious, Immobile, Limited, Regeneration, Relentless, Reliable, Rending, Stealth, Surge, Thrust, Unstoppable.
- **Out (post-MVP stage):** Caster(X), Spell Amplifier, all spells.

### Setup and match
| Area | v3.6 | Ours now | Proposal |
|---|---|---|---|
| Points | 400 to start, **800** for a full match (and the tournament standard). Optional Force Org. | ~300. | **400 pts**, following Force Org (Decision 10). |
| Objectives | D3+2 markers, placed alternately by the players outside the zones, more than 9" apart. | Fixed by the map (the Standard Battlefield has 4). | **Adopt** (Decision 11): a placement step before deployment; maps drop objectives. |
| Deployment | Roll-off. The winner picks a long edge and deploys first, then the players alternate placing units within 12" of their edge. The roll-off winner goes first in round 1. | Host south, guest north; the host deploys and activates first. | **Adopt the roll-off** (server dice) for **who deploys and activates first**. **Keep sides fixed** (host south): the camera and lobby are built on it and the table is symmetric. |
| Game length / winner | 4 rounds; most markers wins. | Same; a draw is a draw (14A). | No change. |

## How 14C is split (each part gets its own sub-plan before any code)
- **14C-1 Renames and housekeeping:**
  - every ID and display name moves to OPR terms (stats, actions, statuses, special rules, weapons), mechanics unchanged;
  - AGENTS.md IP section and the implementer's clean-room rule rewritten;
  - lobby footer and README disclaimer;
  - `doc/plans/README.md` references point at the v3.6 files;
  - the term-mapping file is retired;
  - the developer-mode toggle (F9 on the main menu) for the TEST armies.
- **14C-2 Core rules to v3.6:** engine first, a few PRs, in this order:
  1. casualties, Tough and morale;
  2. melee 3" and melee results;
  3. shooting (2 targets, Blast split, Indirect);
  4. jumping (one roll per unit), falling and pushing;
  5. dangerous dice;
  6. new special rules;
  7. objective placement (D3+2, alternating), deployment roll-off, Scout and Ambush;
  8. the Blast split prompt.
  
  HUD and renderer follow-ups come after each engine PR.
- **14C-3 Armies:** one PR per army, in the order HDF, Orc Marauders, Prime Brothers, Alien Hives. Each gets a pre-canned list of the agreed size (Force Org, no casters) and the faction rules that list uses, with tests. Opus drafts each list from the book and the owner approves it before the PR starts. Frontier Wardens and Rust Raiders are removed with the last army.
- **Roadmap:** add a post-MVP **Phase 17: Casters & spells**. 14D (rules audit) becomes a final check against v3.6.

## Out of scope
- Casters, spells, Campaign, Horde Mode, Solo & Co-Op.
- Army Forge import (Phase 16).
- Tournament scoring, fortune points, chess clocks.
- Changing our 3D line of sight to one of the tournament methods.

## Open questions
None at umbrella level. Each sub-plan lists its own.
