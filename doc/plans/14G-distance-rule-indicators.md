# 14G: Indicators for distance-gated rules
Status: approved (owner, 2026-11-12: "Go ahead with the build stamp and the indicators"; the owner's roadmap entry of 2026-11-10 is the spec, the decisions below fill in the details)
Roadmap: doc/ROADMAP.md § Phase 14, sub-phase 14G, "Indicators for distance-gated rules"

## Goal
While aiming or charging, a player can see how far the target is and which distance rules switch on for that attack, without doing the maths. The attacker's own switch distances are drawn on the range fan, and the two area effects (a Hero's 6" morale help and Blast's 3" spread) are drawn when they matter. Everything is data-driven: each rule in the trait registry declares its distance gate, and the HUD and scene draw gates generically, with no per-rule code.

## Decisions (agreed)
1. **No rule changes.** The engine's behaviour stays exactly as it is (strict "more than": exactly 9.0" / 6.0" does not count; Hero is "within 6"" inclusive, Blast spread "within 3"" inclusive, both with the existing tolerances). Every number the engine uses for these rules moves into the registry and the engine reads it from there, so the indicators and the rules can never disagree. Existing engine tests must stay green unchanged.
2. **Gate data in the registry.** `TraitMetadata` gets an optional `distanceGates: DistanceGate[]`:
   ```ts
   interface DistanceGate {
     context: 'shooting' | 'charge' | 'morale-aura' | 'blast-spread';
     /** Whose rule it is: the attacking unit (or its weapon), the attacked unit, or a friendly unit near the one testing. */
     holder: 'attacker' | 'target' | 'friendly';
     comparison: 'beyond' | 'within';
     /** Inches, base edge to base edge (as `unitDistance` measures). */
     distance: number;
     /** Short own-words effect for badges and ring labels, e.g. '6s add a hit', '-1 to hit', '+1 morale'. */
     effect: string;
   }
   ```
   Entries (only rules the engine already implements):
   | Rule | context | holder | comparison | distance | effect |
   |---|---|---|---|---|---|
   | Relentless | shooting | attacker | beyond | 9 | 6s add a hit |
   | Ferocious | shooting | attacker | beyond | 9 | 6s add a hit |
   | Ferocious | charge | attacker | beyond | 6 | 6s add a hit |
   | Stealth | shooting | target | beyond | 9 | -1 to hit |
   | Hold the Line | shooting | target | beyond | 9 | +1 morale |
   | Hold the Line | charge | target | beyond | 6 | +1 morale |
   | Hero | morale-aura | friendly | within | 6 | lends Quality for Morale |
   | Blast | blast-spread | target | within | 3 | hits spread |
   Fear (3", melee results), Repel Ambushers, Scout and Ambush (setup circles already exist) are out of scope. Hive Bond joins Hold the Line's entries when Alien Hives is built.
3. **Charge distance** for a gate is the distance when the charge began: the recorded `turnState.attackedFrom[target].charged` once a charge is declared, else the current `unitDistance(attacker, target)` while the player is still choosing the target. Shooting distance is the current `unitDistance(attacker, target)`. Both are exactly what the engine uses.
4. **Rule sources.** An attacker's rules are the unit's special rules plus the rules of the weapons in this attack: the weapons assigned to that target (shoot allocations / confirming payload), else the previewed weapon (`shootPreviewWeapon`), and for a charge the unit's melee weapons. A target's rules are its unit special rules. **Unstoppable** on the attacker marks a target's negative to-hit gate (Stealth) as "negated by Unstoppable" (it still shows, struck through), matching the engine.
5. **Target badge** (one per target being aimed at or charged): a floating label above the target unit (CSS2D, styled like the move-path segment labels), never taking pointer events. Text: the distance, then one entry per gate that this attack involves, from the attacker's rules first, then the target's:
   - applies: `Relentless ✓ (beyond 9")`, `Stealth −1 to hit (beyond 9")`, `Hold the Line +1 morale (beyond 9")`, drawn bright;
   - does not apply: `Ferocious ✗ (needs beyond 9")`, drawn dim.
   Example: `12.4" · Relentless ✓ (beyond 9") · Stealth −1 to hit (beyond 9")`. A target with no gates involved shows only the distance. Distance shows one decimal; when the one-decimal value equals a shown gate's threshold, it shows two decimals. ✓ / ✗ always come from the same comparison the engine makes, never from the rounded text.
   Shown: shoot targeting (the hovered enemy and every enemy with a weapon assigned), shoot confirming (each allocated target), charge targeting (hovered enemy), charge confirming and the squad charge legs (the declared target). Not shown for Fight (no distance rule applies in place).
6. **Threshold rings** on the range fan: while the existing attack range fan is shown for shoot or charge, add a dashed ring at each distinct switch distance of the **attacker's own** gates for that context (shooting: the unit's rules plus any ranged weapon's rules; charge: the unit's rules plus its melee weapons'), padded by the attacker's base radius like the shooting fan (a gate is base edge to base edge, so the ring shows where an enemy base edge has to be). Each ring carries one small label: `9": Ferocious, Relentless`. Rings beyond the fan's radius are not drawn. A declared squad charge (no unit-wide fan today) draws no threshold ring.
7. **Hero aura:** when a unit is selected or hovered (any phase with units on the board), draw a ring of radius 6" + base radius around each living model of every living, non-Shaken, non-Routed friendly Hero unit **of that unit's side** (the unit itself included when it is a Hero). The ring is bright when that Hero lends its Quality to the selected/hovered unit (`heroQualityFor` rule: `unitDistance` ≤ 6 with the existing tolerance), faint otherwise. Hovering wins over the selection, as the selection marker does today.
8. **Blast spread outline:** while shoot targeting with a Blast weapon in the attack (the previewed weapon, or any Blast weapon assigned to the hovered target) and an enemy is hovered, draw a ring of radius 3" + base radius around each living model of that target, and mark the other units that would share the hits (`getBlastParticipants`) with the existing "reachable target" ring style. Nothing for non-Blast weapons.
9. **Pure logic in shared.** The gate maths are pure functions in `shared/src/engine/distanceGates.ts`, exported from the barrel. The HUD only picks the attacker, target, weapons and context, and turns the result into marker data; the renderer only draws it.
10. **Colours:** reuse the palette already in `MarkerRenderer` (fan red `0xff7961` for threshold rings, dashed; Hero aura gold `0xffd54f`; Blast outline orange `0xff9800`). No new colour system; the 15F UI design pass restyles later.

## Out of scope
- New rules, Fear / setup-distance indicators, Hive Bond (Alien Hives is deferred).
- Indicators for the opponent's view of my attack (the badge is for the local attacker only).
- Restyling the range fan or other markers (15F UI design pass, formerly 14G2).

## Background
- Registry: `shared/src/rules/traits.ts` (`TRAIT_REGISTRY`, `TraitMetadata`, `DISTANT_ATTACK_MORALE_TRAITS`, `hasTrait`).
- Engine thresholds today: `shared/src/engine/combat.ts` (`ferociousApplies`: `> 9` shooting, `> 6` charge; `bonusHitsPerSix`: Relentless `> 9`; Stealth `> 9` in the hit modifiers; `distantAttackMoraleBonus`: `> 9` / `> 6`), `shared/src/engine/activation.ts` (`HERO_MORALE_RANGE = 6`, `heroQualityFor`), `shared/src/engine/blast.ts` (`BLAST_SPREAD_RANGE = 3`, `getBlastParticipants`). Unstoppable negates negative hit modifiers in `combat.ts`.
- Distances: `unitDistance` (`shared/src/engine/unitGeometry.ts`) is the closest living-model base-edge gap. Charge start distance: `noteAttackedFrom(..., 'charged', unitDistance(...))` in `actions.ts` (declared charge and plain charge).
- HUD: `GameHUD.ts` builds `MarkerSnapshot` (around `markers.attackRange`, `ringPad = baseRadius(active)` for shooting, `isSquadChargeFlow`), `shootPreview` / `shootPreviewWeapon` / `shootAllocations`, `declaredCharge`, `hoveredUnitId`, `selectedUnitId`, `reachableEnemies`. Weapons: `rangedWeaponsOf` (`client/src/ui/loadout.ts`).
- Renderer: `client/src/renderer/MarkerRenderer.ts` (`setAttackRange` with `concentricRanges`, `createSegmentLabel` CSS2D labels, `setReachableTargets`, `createFlatRing`), wired from `GameView.ts`.
- Test helpers: `syncModels` in `client/tests/ui/GameHUD.test.ts` (move `unit.models[*].position` with `unit.position`).

## PR 1: Gate data and pure gate logic  (branch: `14G-distance-gates-1`)
- **Layer:** shared engine + data. No client change.
- **Files:** `shared/src/rules/traits.ts`, `shared/src/engine/combat.ts`, `shared/src/engine/activation.ts`, `shared/src/engine/blast.ts`, new `shared/src/engine/distanceGates.ts`, barrel export, `shared/tests/engine/distanceGates.test.ts`.
- **Tests first:**
  - registry: the table in Decision 2 (each listed rule declares exactly those gates; rules not listed declare none);
  - `gateApplies(gate, distance)`: beyond 9 at 9.0 false, 9.01 true; within 6 at 6.0 true (with the existing tolerance), 6.01 false;
  - `attackDistanceRules({ state, attacker, target, context: 'shooting' | 'charge', weaponIds? })` returns `{ distance, entries: [{ traitId, displayName, holder, gate, applies, negatedBy? }] }`: a gate on a weapon (e.g. a fixture weapon with Relentless) counts only when that weapon is in the attack; unit rules always count (the Orc Specialist's unit-level Relentless, Ferocious); Stealth and Hold the Line from the target; attacker entries before target entries; Unstoppable marks Stealth `negatedBy: 'unstoppable'`; charge context uses the recorded `attackedFrom[target].charged` when present, else the current distance; squads measure closest living models;
  - `ownThresholdRings(unit, context)`: distinct distances with their rule names, from unit rules plus ranged (shooting) or melee (charge) weapon rules; empty for a unit with no gates;
  - the engine reads the registry: existing combat / morale / Hero / Blast tests stay green with no edits.
- **Implementation steps:** add the gate type and entries; small accessor (`gateDistance(traitId, context)`); replace the literal 9 / 6 / `HERO_MORALE_RANGE` / `BLAST_SPREAD_RANGE` values with registry reads (keep the exported constants as aliases so nothing else breaks); write `distanceGates.ts`.
- **Docs:** SYSTEMS (one paragraph: gates live in the registry, engine and HUD read them), DATA_MODEL (`distanceGates` on trait metadata), ROADMAP sub-bullet (PR 1 done).
- **Manual checks:** none (engine only).
- **Done when:** all workspaces green; no engine test edited; the registry is the only place the gate numbers appear in `shared/src/engine`.

## PR 2: Indicator data in the HUD  (branch: `14G-distance-gates-2`, after PR 1)
- **Layer:** client HUD (`client/src/ui`) only: compute marker data; nothing drawn yet.
- **Files:** `client/src/ui/GameHUD.ts` (`MarkerSnapshot` gains `targetBadges`, `thresholdRings`, `auras`), optional helper `client/src/ui/distanceIndicators.ts` (pure: badge text and segments from `attackDistanceRules`), tests in `client/tests/ui/`.
- **Snapshot shapes** (renderer-facing, plain data):
  - `targetBadges?: Array<{ unitId: string; position: Vector3; segments: Array<{ text: string; tone: 'distance' | 'on' | 'off' | 'negated' }> }>` (position = above the target unit's centre);
  - `thresholdRings?: { position: Vector3; rings: Array<{ radius: number; label: string }> } | null` (radius already padded, per Decision 6);
  - `auras?: Array<{ kind: 'hero' | 'blast'; position: Vector3; radius: number; active: boolean }>` and `blastSharingUnitIds?: string[]`.
- **Tests first** (jsdom where the HUD needs it; pure helper tests in node):
  - badge text formatting: one decimal; two decimals when it rounds onto a shown threshold; ✓ / ✗ from the comparison, not the text (8.96" shows "8.96"" with ✗ for beyond 9; 9.04" shows "9.04"" with ✓);
  - Orc Leader aiming the Carbine at an HDF Infantry Squad 12" away: badge `12.0" · Ferocious ✓ (beyond 9") · Hold the Line +1 morale (beyond 9")`; at 8" both read ✗ (`needs beyond 9"`); HDF aiming at the Orc Infiltrator from 12": `12.0" · Stealth −1 to hit (beyond 9")`; HDF aiming at the Orc Veteran: the distance only;
  - assigned targets each get a badge; Fight shows none; a charge uses the recorded start distance after declaration;
  - threshold rings: Orc Leader shooting fan has one ring at 9 + base radius labelled `9": Ferocious`; charge fan has 6 + base radius; HDF unit with no gates: none; ring beyond the fan radius dropped; squad charge flow: none;
  - Hero aura: selecting an HDF unit 5" from the Company Leader gives an active hero aura around the Leader; 7" away inactive; a Shaken Hero gives none; hovering an enemy unit shows the enemy side's Heroes;
  - Blast: aiming the Heavy Flamer-Mod (Blast 3) at a hovered target gives a blast aura per living target model and `blastSharingUnitIds` = the other participants; a non-Blast weapon gives none.
- **Docs:** ROADMAP sub-bullet (PR 2 done). No UI inventory change (nothing visible yet).
- **Manual checks:** none yet (PR 3 adds them).
- **Done when:** all workspaces green; the snapshot carries the data in every mode listed in Decision 5-8 and nothing in other modes.

## PR 3: Draw the indicators  (branch: `14G-distance-gates-3`, after PR 2)
- **Layer:** renderer (`client/src/renderer`) + the `GameView` wiring.
- **Files:** `client/src/renderer/MarkerRenderer.ts` (`setTargetBadges`, `setThresholdRings`, `setAuras`, Blast sharing rings), `client/src/renderer/GameView.ts`, renderer tests (headless Three.js; jsdom for CSS2D labels).
- **Tests first:** markers appear with the expected names, counts and radii for a snapshot, are replaced (not stacked) on the next snapshot, and are removed when the snapshot field is empty/null; badges and ring labels are CSS2D objects with `pointer-events: none`; dispose frees them; `clearAll` removes them.
- **Implementation steps:** badges as CSS2D labels styled like segment labels (tone → bright / dim / struck through); dashed rings (`LineDashedMaterial`, `computeLineDistances`) at fan height with one label each; Hero aura gold rings (bright when `active`, faint otherwise); Blast outline orange rings and the sharing units with the existing reachable-target ring.
- **Docs:** ASSETS (UI markers table: target badge, threshold ring, Hero aura, Blast outline), ROADMAP tick of the roadmap entry, UI inventory (add entries for the badge while aiming, the threshold ring on the shooting fan, the Hero aura and the Blast outline; re-take the shoot targeting shot), manual checklist.
- **Manual checks** (section 10; Setup: Orc Marauders (host) vs Human Defense Force (guest), Standard Battlefield):
  1. Aim the Orc Leader's Carbine at an HDF unit more than 9" away: the badge above it reads the distance, `Ferocious ✓ (beyond 9")` and `Hold the Line +1 morale (beyond 9")`; from within 9" both read `✗ (needs beyond 9")`. The shooting fan has a dashed ring labelled `9": Ferocious`.
  2. Assign the Carbine to one unit and the Heavy Flamer-Mod to another: both targets carry a badge.
  3. Choose Charge with the Orc Leader: the charge fan has a dashed `6": Ferocious` ring; hovering a target over 6" away shows `Ferocious ✓ (beyond 6")`.
  4. As HDF, aim at the Orc Veteran: the badge shows the distance only (HDF has no attacker gates). Aim at the Orc Infiltrator from more than 9": `Stealth −1 to hit (beyond 9")`. The HDF fan has no dashed ring.
  5. Select an HDF unit near the Company Leader: a gold 6" ring around the Leader, bright when the unit is within 6", faint when not.
  6. Aim the Heavy Flamer-Mod at a unit with another HDF unit close by: orange 3" outlines around the target's models and the nearby unit is marked as sharing hits.
  7. Nothing floats over the board in Fight, setup placement or the opponent's turn (apart from the Hero aura on select/hover).
- **Done when:** all workspaces green; the manual checks above are in the checklist; inventory updated.

## Open questions
None.
