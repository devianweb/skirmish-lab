# 14C-2: Core rules to Firefight v3.6
Status: approved (owner, 2026-11-10; detail decisions reviewed with the owner the same day)
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14C (part 2 of 3). Umbrella: `doc/plans/14C-opr-v3.6-alignment.md` (its Decisions 8–11 and the "v3.6 vs our engine" tables are binding here).

## Goal
The engine plays the v3.6 core rules: wounds kill at Tough, morale is tested at the end of an activation, melee results decide who tests, Shaken units sit idle, melee reaches 3", shooting splits over at most two targets, Blast spreads its hits, jumps are one roll for the unit, falls and dangerous terrain roll wounds directly, Pushing replaces the old knockback, and objectives are placed by the players after a roll-off. The HUD and renderer keep up so the game stays playable after every merge.

## Decisions (agreed)
Reference: `/home/webst/dev-stuff/trench-heresy/assets-src/GFF - Core Rules v3.6.0.pdf` (two pages, the authority). Where this list is more specific than the PDF, this list wins. Never paste PDF text into code, docs or tests.

### Casualties, Tough, morale (PR 1)
1. **No wound-effect table.** Each unblocked hit is one wound (before Deadly/Regeneration/Shred). A model is killed (removed) when its wounds reach its Tough value (Tough 1 when it has no `tough(X)`). Remove the trauma roll, `traumaTokens`, `TraumaOutcome` / `resolveTraumaRoll`, knocked-out results and the `stunned` status entirely (type, engine, HUD, renderer). Casualty picking (the existing `pick-casualties` flow) is unchanged: wounds go to the defender's chosen models; a wounded model keeps taking wounds until it dies before another model takes any (existing allocation behaviour; keep whatever it does today).
2. **Wound morale trigger.** At the end of every activation, each unit (either side, including the active unit) that took at least one wound during that activation and **was not in melee during it** takes a Morale Test if it is now at half or less: for multi-model units, living models × 2 ≤ starting models; for single-model units, remaining wounds × 2 ≤ Tough. Each unit tests at most once per activation. Morale dice are server dice requested at `end-activation` (the existing `runMoraleIfProvided` / finish-activation path).
3. **Morale Test** = a Quality test (d6 ≥ Quality; 6 always passes, 1 always fails). Fail → Shaken. A Shaken unit always fails Morale Tests (no roll needed except Fearless, see 6). **Remove** the round-end "army broken" morale (`isArmyBroken`, `getUnitsRequiringRoundMorale`, `applyRoundEndMorale`) and every morale modifier that came from the old table. Faction morale traits (`steadfast`, `dauntless`, `iron-will`, …) keep working as modifiers to this test until 14C-3 removes them.
4. **Hero:** a unit within 6" (horizontal base-edge-to-base-edge, any friendly unit including the Hero's own) of a friendly living, non-Shaken unit with `hero` may use that unit's Quality for Morale Tests (best available).
5. **Shaken:** one status, `shaken`. A Shaken unit, when activated, may do nothing but end its activation idle (no hold-and-shoot, no move, no charge, no abilities); at the end of that activation Shaken is removed. It may strike back in melee, and does so as Fatigued (hits only on unmodified 6s). It can't seize or contest objectives. It always fails Morale Tests.
6. **Fearless:** when a unit where most models have `fearless` fails a Morale Test (including the automatic fail while Shaken), roll one die; 4+ counts as passed.
7. **Routed** stays a status for "removed as destroyed by morale" (only reachable through PR 2's melee results).

### Melee (PR 2)
8. **Reach:** a model strikes with its melee weapons when its base edge is within **3"** horizontally of an enemy model in the target unit (and within the existing 4" vertical limit, `MELEE_MAX_VERTICAL_REACH`). Charge movement still ends in base contact or as close as possible; defenders' pile-in stays up to 3".
9. **Melee results replace wound morale for units in melee:** after the strike(s) and any strike back, each side's total wounds taken **during this activation** are compared (Impact hits, charge strike, strike back; wounds before Regeneration saves count only if they stuck). Fear(X): **per model** (owner, 2026-11-10): the enemy counts as having taken +X extra wounds for each living model with `fear(X)` in the unit (each model adds its own X). The side with the higher total loses and takes a Morale Test; a tie means nobody tests. If the loser fails while at half or less (Decision 2's test) it **Routs** (all models removed, status `routed`); otherwise it is Shaken. Both units are "in melee" for Decision 2 and skip wound morale for that activation.
10. Fatigue, strike-back prompt, consolidation (3" if the other unit is destroyed, else chargers separate 1") stay as they are.

### Shooting (PR 3)
11. **Two targets max.** A shoot action may name at most two distinct target units. All weapons with the same `name` must shoot at the same target. Host rejects violations; the HUD stops offering a third target.
12. **Blast(X):** ignores cover; after all other special rules, each hit becomes X hits. The hits are split between the target and every other enemy unit with a model within 3" (horizontal base edge) of any model of the target. Each unit can take at most as many hits as it has living models; hits above every cap are lost. **Auto split** (engine, used now and as the prompt's default later): split as evenly as possible across the eligible units, the target gets any odd hit first, then the remaining units in order of distance to the target; re-spread hits that exceed a cap to units still under theirs. Until PR 11 adds the defender prompt, Auto split is applied directly. Each unit's share is then rolled as a separate defense batch (its own cover is ignored; each unit's own Defense/rules apply).
13. **Indirect:** only when the unit used **Hold** this activation may an Indirect weapon target units out of line of sight (and it then ignores cover from sight blockers). Otherwise it needs line of sight like any weapon. Remove the old "-1 to hit after moving" penalty.

### Jumping, falling, pushing (PR 4 engine, PR 5 push prompt)
14. **Jump dice:** free if a gap is ≤ 1" or a drop ≤ 3" (unchanged thresholds `FREE_GAP_MAX` / `FREE_DROP_MAX`). Gaps or drops up to 6" need a jump: **one die per started inch** (`ceil(distance - 0.05)`), each needing **2+**. Strider rolls half the dice (rounding up). Flying passes automatically.
15. **One roll for the unit** (umbrella Decision 8): keep the per-model declared traversals in the payload, but the host makes one roll sized by the **leader's** crossing (the model the player declared the jump with; owner, 2026-11-10, as on the tabletop where one model jumps). All pass → every model crosses and the jumped distance doesn't count toward any model's move. Any fail → the leader falls from its take-off point and the activation ends. If that fall is 2" or more, the Falling rule places every other model of the unit within 1" of the fallen model at the bottom, with no fall dice of their own (owner, 2026-11-10, rules as written; around where it landed if it died); a shorter fall leaves them at their take-off spots. This replaces "later jumpers stop" (batch-1D Decision 30). Purpose tags: one jump roll per leg, tag `jump` (no `m<index>_` prefix).
16. **Falling:** a fall (failed jump, walking off > 6", or a push off an edge) of **2" or more** rolls one die per started inch fallen; each 1–3 is one wound to **the model that fell** (no Defense roll; excess wounds are lost and never carry over to the rest of the unit — owner playtest fix #289). Landing placement stays (within 2" of the bottom, clear, supported; other models within 1" of it where the existing helpers already do this). The activation ends (if it was the falling unit's activation).
17. **Pushing** replaces the old ledge knockback (`calculateLedgeKnockback`): whenever a unit becomes Shaken (or Routs — no push then, it's gone) after being attacked (shooting or melee, including morale at end of activation caused by that attack), the attacking unit's player rolls one die; on 4+ they may move one model of the Shaken unit up to 2" horizontally in any direction to a legal spot (no overlap, on the board, not inside solids). The other models of that unit are then placed by the host's auto placement (closest legal spot to each model's current position) — a digital simplification of "the opponent places"; only models cut off from the pushed model move. If the pushed model ends off an elevated edge with a drop ≥ 2", it falls (Decision 16) without ending anyone's activation, and **every other model of the unit is then placed within 1" of the fallen model** at the bottom (owner, 2026-11-10, as the Falling rule says). Engine prompt: a pending reaction `push` for the attacker with **Auto** (push the model closest to the attacker 2" directly away from the attacker, to the farthest legal point up to 2"), **Confirm** (attacker picks model + destination) and **Don't push** (owner, 2026-11-10: pushing is optional, so declining is a real choice — the one agreed exception to the Auto + Confirm rule); timeout = Auto. PR 4 adds the engine with Auto applied immediately when there is no HUD yet; PR 5 adds the HUD prompt.

### Squad follow-the-leader jumps (PR 4B; owner, 2026-11-10, after the 14C-2 playtest)
37. **Group crossing (option C; owner, 2026-11-10, replacing the earlier walk-to-the-edge version).** In a squad's Advance, Rush or charge leg the player declares the jump with one model (the leader), which must reach the take-off edge on its own move. The single roll (Decision 15) is sized by the leader's crossing. On a pass the leader lands, and **every other model of the unit may cross too without walking to the edge and without it counting toward its move**: the player places each of them on the far side, within 1" (base edge, coherency) of a model already across, Auto placement being the default (owner, 2026-11-10: models, nearest to the leader first, keep the squad's formation by moving with the leader's own displacement when that spot is legal, across and within 1" of a model already across; otherwise the nearest such legal spot). Carried models are exempt from the charge's "as close as possible" check, a leg whose only movement is the leader's hop still counts as a leg, and carried models land on the landing's level (merged #296). Their own movement budgets are not checked for the crossing; a model that is not placed stays where it is (and the usual end-of-leg coherency still applies). Placed models must be legal spots: supported, no overlap with terrain or models, more than 1" from other units (except a charge's target), on the board.
38. **Failure:** the leader falls (Decision 16) and the activation ends. On a fall of 2" or more every other model of the unit is placed within 1" of the fallen model at the bottom, rolling no fall dice (rules as written); on a shorter fall they stay where they were.
39. **No per-model reachability ✗ for crossings.** The ✗ / "cannot reach the take-off edge" routing is removed; the HUD only refuses illegal landing spots (with the reason). The host validates every placed model as in Decision 37.
40. **Applies to drops and gaps alike** (jump-drops over 3" up to 6" as well as gaps over 1" up to 6"), and to charge legs as well as Advance and Rush. Flying models never roll and simply move; Strider halves the dice as usual.

### Dangerous terrain (PR 6)
18. A unit whose models move across dangerous terrain, or which activates with any model in it, rolls as many dice as the **wounds it would take to destroy it** (sum over living models of Tough − wounds taken); each 1 is a wound (casualty picking for squads). A unit tests when it activates in dangerous terrain (that test covers moving out of that patch) and again only if its move crosses a **different** dangerous piece (owner, 2026-11-10); at most one test per piece per activation. Flying is immune. Replaces the one-die-per-model hazard test.

### Special rules (PR 7)
19. **Fast / Slow:** ±2" on Advance, ±4" on Rush/Charge (already implemented — verify and keep).
20. **Impact(X):** as today, plus no Impact dice if the charging unit is Fatigued.
21. **Counter:** a unit with a `counter` weapon that is charged strikes first with that weapon — after the charger's Impact hits, before the charger's melee strikes — unless Fatigued. Its Counter strike replaces its strike back with that weapon. Remove the "charger loses one Impact hit per Counter model" effect.
22. **Assault:** a weapon with `assault` may be used both as a ranged weapon (its profile) and as a melee weapon (same attacks and rules, melee reach) — data-driven via the trait, no duplicate weapon entries.
23. **Shred:** new core rule `shred` (Display "Shred"): each unmodified Defense roll of 1 against this weapon adds one extra wound. (The 14C-1 renames test forbids the old `shred` meaning; update that test so `shred` is now a valid ID that means this rule.)
24. Registry descriptions for every changed rule are rewritten in our own words (Hero 6", Fear, Blast, Indirect, Strider, Counter, Impact, Scout, Ambush, Tough, Shred, Assault).

### Setup, objectives, deployment (PR 8 engine, PR 9 HUD)
25. **New phase order:** `setup` → `objectives` → `deployment` → `activation`. Add `'objectives'` to `TurnPhase`.
26. **Objective count:** the server rolls one d6 at the start of the objectives phase; count = ceil(d6 / 2) + 2 (3–5).
27. **Roll-offs:** a roll-off is one spec of 10 d6 pairs (host die, guest die); the first unequal pair decides, higher wins; if all ten tie, the host wins. Two roll-offs: the **mission roll-off** (who places the first objective) at the start of `objectives`, the **deployment roll-off** at the start of `deployment` (who deploys first and activates first in round 1). Sides stay fixed (host south, guest north).
28. **Objective placement:** action `place-objective { position }`. Players alternate, starting with the mission roll-off winner, until the rolled count is placed. Legal: on the board, outside both deployment zones (`getDeploymentZoneBounds`), more than 9" horizontally from every placed marker, at a spot a model could stand (ground or a walkable surface; y = that surface; not inside solids). Host validates.
29. **Maps no longer define objectives:** remove the editor's objective tool, drop `objectives` from new map saves, ignore `objectives` in old maps and in built-in maps; `createDefaultScenarioObjectives` / `createBalancedObjectives` go. Tests that need objectives place them directly in state.
30. **Rematch** keeps the placed objectives and both roll-off results, and skips the objectives phase (14B replays the exact same game).
31. **Deployment** alternates one unit at a time starting with the deployment roll-off winner (existing alternation; only the starting player changes). Round 1 starts with the deployment roll-off winner; later rounds keep today's rule (the player who did not make the last activation of the previous round starts).
32. **Scout:** during normal deployment each Scout unit may either be deployed like any other unit or be held back (owner, 2026-11-10: a "Hold as Scout / Deploy now" choice in the deployment UI, PR 9); held Scouts are placed after all other units are deployed, alternating, starting with the player who activates first in round 1. Legal: fully within 9" of the owner's deployment zone (i.e. within 12" + 9" = 21" of their edge), more than 9" from every non-Scout enemy unit.
33. **Ambush:** Ambush units are set aside. At the start of each round from round 2, before the first activation, players alternate placing Ambush units (one per placement, starting with the player who activates first that round), anywhere more than 9" from enemy units. A player may decline to place their remaining Ambush units this round (they wait for a later round) — action `skip-ambush`. A unit deployed by Ambush can't seize or contest objectives in the round it arrives. Faction traits that change the 9" (`perimeter-watch`) keep working.

### UI follow-ups
34. **PR 10 — Blast split prompt** (umbrella Decision 9): when a Blast resolution has more than one eligible unit, the engine pauses with a pending reaction `blast-split` for the defender: Auto split + Confirm (custom split with steppers, respecting the caps and "as even as possible" is **not** required for a custom split — any split within the caps that assigns every hit that can be assigned). Timeout → Auto. With one eligible unit, no prompt.
35. Reaction docks follow the existing rule: Auto + Confirm only, timeout = host fallback. The single exception is the push prompt's "Don't push" (Decision 17).
36. The HUD shows: the Shaken badge (and that the only option is End Activation (idle)), morale results in the log ("passed", "Shaken", "Routed"), melee result summary ("X took 3 wounds, Y took 1 (+1 Fear): Y wins"), jump dice for the unit, fall wounds, dangerous dice, the objective count roll and roll-off results.

## Out of scope
- Army data (14C-3). TEST armies only get the trait changes needed for tests.
- Casters/spells.
- Terrain coverage of the Standard Battlefield (14G).
- Line-of-sight method changes.

## Background
- Combat: `shared/src/engine/combat.ts` (`resolveAttack`, `resolveTraumaRoll`, `resolveMoraleTest`, `computeCombatModifiers`, dice extraction).
- Wounds & casualties: `shared/src/engine/actions.ts` (`applyWounds`, `applyTrackedWounds`, `deferCasualties`, `getUnitTough`), `shared/src/engine/casualties.ts`.
- Round flow & morale: `shared/src/engine/activation.ts` (`endRound`, `isArmyBroken`, `applyRoundEndMorale`, deployment helpers, `evaluateObjectives`).
- Activation end: `actions.ts` `finishActivation`, `runMoraleIfProvided`, `beginActivation`.
- Melee: `actions.ts` `resolveChargeStrike`, `settleChargeStrike`, `settleStrikeBack`, `strikers`; `shared/src/engine/pileIn.ts`; `squadTargeting.ts`.
- Traversal: `shared/src/engine/traversal.ts` (`calculateJumpDice`, `resolveDropJump`, `resolveGapJump`, `calculateFallingDamage`, `resolveFallingDamage`, `resolveDangerousTerrain`, `calculateLedgeKnockback`, `findFallLanding`); `actions.ts` `applyModelPathTraversals`, `stopJumperAtTakeoff`, `applyTraversalHazardsAndFalls`, `activationHazardSpecs`.
- Scenario/objectives: `shared/src/data/scenario.ts`, `shared/src/data/mapSchema.ts`, `shared/src/data/builtinMaps.ts`, `client/src/editor/MapEditor.ts`.
- Rematch: `shared/src/engine/rematch.ts`.
- Client: `client/src/ui/GameHUD.ts`, `client/src/core` (GameManager), renderer status badges.
- Server tests use `shared/dist`: rebuild shared first.

**Layer rule for this sub-plan:** each engine PR may include the minimum client changes needed to compile and keep the game playable (removed statuses, renamed fields, log strings, disabling options the host now rejects). New interactive UI (prompts, placement tools) goes in its own PR.

## PR 1: Casualties, Tough and morale  (branch: `14C-2-core-1`)
- **Layer:** shared engine (+ minimal client).
- **Tests first:** Tough kills at X with no roll; multi-wound allocation; no `stunned` anywhere; end-of-activation morale fires at exactly half (e.g. 5-model unit at 2 tests, at 3 doesn't; 10-model at 5 tests; single model Tough 3 with 2 wounds tests, with 1 doesn't); a unit at half that takes no wounds this activation doesn't test; Hero 6" boundary (6.0 yes, 6.1 no) and Shaken Hero gives nothing; Fearless 4+ including while Shaken; Shaken unit may only end activation, and loses Shaken at its end; Shaken can't seize/contest; round end has no army morale.
- **Docs:** RULES_SPECIFICATION (casualties, morale), SYSTEMS, DATA_MODEL (`traumaTokens`, `stunned` removed), ROADMAP.
- **Manual checks:** a squad shot down to half tests morale at the end of the shooter's activation; a Shaken unit can only end its activation and recovers.

## PR 2: Melee reach 3" and melee results  (branch: `14C-2-core-2`)
- **Layer:** shared engine (+ minimal client log text).
- **Tests first:** strikers count at 3.0" vs 3.1"; melee result loser/tie; Fear adds once per unit; Rout at half or less on a failed test; Shaken otherwise; units in melee skip Decision-2 morale.
- **Manual checks:** charge resolves with a melee-result line and the loser tests.

## PR 3: Shooting — two targets, Blast spread, Indirect on Hold  (branch: `14C-2-core-3`)
- **Layer:** shared engine + HUD allocation limit.
- **Tests first:** third target rejected; same-name weapons split rejected; Blast caps and auto split (odd hit to target, cap re-spread, lost hits); Blast ignores cover per unit; Indirect without LoS only after Hold, LoS needed after Advance; no -1 penalty.
- **Manual checks:** the HUD won't allocate a third target; a Blast hit near two units spreads its hits.

## PR 4: Jumps (one roll per unit), falling, pushing engine  (branch: `14C-2-core-4`)
- **Layer:** shared engine (+ minimal HUD jump-dice display).
- **Tests first:** dice counts (1.1" gap = 2 dice, 6.0" = 6, Strider 5→3), 2+ target; one roll for the longest jump; fail → longest jumper falls, others at take-off, activation ends; fall 1.9" = no dice, 2.0" = 2 dice, wounds on 1–3; push only on Shaken after an attack, 4+, ≤2", others within 1", push off an edge falls; Auto push picks closest model and moves directly away.
- **Manual checks:** squad jump shows one dice roll; a pushed unit moves.

## PR 4B: Squad follow-the-leader jumps  (branch: `14C-2-core-4b`) — merged #285; replaced by PR 4C (option C)
- **Layer:** shared engine + client HUD (the routing preview is UX; the host re-checks every model's path, reach and coherency).
- **Tests first:** a 4-model squad where only the leader starts at the edge: the others walk to the edge and cross on one roll, their move spent only on the walk; failure leaves them at their take-off spots and the longest crosser falls; a model that can't reach the edge with its remaining move makes the leg invalid when the end positions break coherency, valid when it doesn't need to cross; a 4" drop as a group jump (5 dice); a charge leg with a group jump; Strider dice halved; Flying no roll.
- **Manual checks:** move a 4-model squad across a 3" gap from a starting position where only one model is at the edge: one roll, all cross; a failed roll leaves the others at the edge.

## PR 4C: Group crossing, option C  (branch: `14C-2-core-4c`) — merged #296
- **Layer:** shared engine + client HUD (replaces follower walk-to-edge routing).
- **Tests first:** leader at the edge, three others several inches back with little move left: on a pass all four end across, each within 1" of a model already across, none charged for the crossing; Auto placement legal (keep-away, overlap, support); a hand placement that breaks coherency or keep-away is refused with the reason (HUD and host agree); failed roll as Decision 38; charge leg with a group crossing; Strider/Flying unchanged.
- **Manual checks:** group gap jump from a cluster several inches from the edge; hand-placing followers across; failed group jump.

## PR 5: Push prompt HUD  (branch: `14C-2-core-5`)
- **Layer:** client HUD (+ renderer preview ring if cheap).
- Attacker's dock: Auto / Confirm, pick model then destination within a 2" ring; timeout Auto.

## PR 6: Dangerous terrain dice  (branch: `14C-2-core-6`)
- **Tests first:** dice = remaining wounds (squad of 5 Tough 1 = 5 dice; Tough 3 hero with 1 wound = 2); once per activation; Flying immune.

## PR 7: Special rules  (branch: `14C-2-core-7`)
- **Tests first:** Fast/Slow distances; Impact none when Fatigued; Counter strikes first after Impact, unless Fatigued, no Impact reduction; Assault weapon usable in melee and at range; Shred extra wound per natural 1 on defense; registry descriptions updated.

## PR 8: Objectives, roll-offs, Scout, Ambush engine  (branch: `14C-2-core-8`)
- **Layer:** shared engine + minimal client (phase handling so the client compiles; PR 9, which follows immediately, adds the placement UI — master may be unplayable between the two merges, which is acceptable since releases are manual).
- **Tests first:** D3+2 mapping; roll-off tie-break; placement legality (zones, 9", surfaces); alternation; deployment starts with deployment roll-off winner; round 1 order; Scout zone and 9" rule; Ambush alternation, skip, 9" rule, can't seize the round it arrives; rematch skips objectives and keeps roll-offs; old maps' objectives ignored.

## PR 9: Objective placement & roll-off HUD, editor clean-up  (branch: `14C-2-core-9`)
- **Layer:** client HUD + editor + renderer markers.
- Click-to-place with a legality preview (red/green ring, 9" circles around placed markers), roll-off and count announcements, Scout/Ambush placement steps reuse deployment UI, remove the editor objective tool.

## PR 10: Blast split prompt  (branch: `14C-2-core-10`)
- **Layer:** shared reaction + client HUD.

## Open questions
None. Owner review on 2026-11-10: Decisions 15, 17, 18 and 32 were revised (leader decides the jump dice and falls; a push-fall drops the whole unit to the fallen model and the attacker may decline; dangerous terrain re-tests only for a different piece; Scouts may deploy normally), Decision 9 changed to Fear per model, and Decisions 12, 21, 27 and 33 were kept as written. An Ambush unit that never arrives simply never enters play (it can't score and isn't counted as destroyed).
