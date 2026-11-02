# Batch 1D: squads and measuring (tabletop per-model rules)
Status: approved (2026-11-02)
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)**, **Out of scope** and **Background** first: decision numbers below refer to it.

Base-edge measuring, then measuring between models instead of unit centres (shooting, charges, the 1" rule), confirm-early squad moves, and per-model charges. Order: PR 14 with/before PR 9a → 9b → 9c; PR 10 any time; PR 11 last.

## PR 14: Base-edge measuring (branch: `refactor/base-edge-measuring`)
**Why:** Decision 12. Distances today are a mix: coherency already uses base edges (1" = 2.0" centre in `validateSquadCoherency`), but the 6" squad spread (6.0 centre), shooting range (`boardDistance` centre), objective control (`OBJECTIVE_CONTROL_RADIUS` 3.0 centre, `activation.ts` ~l.91/104), engagement/contact (`ENGAGEMENT_RANGE` 1.5 centre, `actions.ts` ~l.98), charge reach and the "> 9"" rules are centre to centre.

- **Layer:** shared engine (lands *with or just before* PR 9a: the same `unitGeometry` module owns both "closest models" and "base-edge gap").
- **Helpers:** `baseRadius(unit)` (0.5 today, from data later), `modelGap(a, b)` = max(0, centre distance − rA − rB), `markerGap(model, marker)` = max(0, centre distance − r). Every distance rule calls these with the tabletop number (1", 2", 3", 6", 9", weapon range), so the constants become the real inch values.
- **Audit:** every `boardDistance(` and `Math.hypot(` on positions in `shared/src/engine/` and `client/src/ui/GameHUD.ts`. Path *lengths* (movement) stay centre-based (a model moves its centre). Only *distances between things* change.
- **Tests first:** a rifle (24") hits a target whose centre is 24.9" away (edges 23.9" apart) and misses at 25.1"; objective control at centre 3.4" (edge 2.9") counts, 3.6" doesn't; coherency 6" spread at centre 6.9" OK, 7.1" not; contact/engagement and the 1" rule at the right edge distances; single-model regression numbers updated deliberately (rule change).
- **HUD:** range rings drawn at weapon range + base radius from the model centre (so the ring shows where an enemy base edge can be); the objective ring stays 3" around the marker (a model counts once its base edge touches it).
- **Docs:** RULES_SPECIFICATION §2.1/§2.2/§4 (measuring rule), SYSTEMS.md, ROADMAP.
- **Manual checks:** §7/§8 add: range rings and objective capture match base-edge measuring (a model just inside the ring with its base edge counts).

---

## PR 9: Squad geometry: measure between models, not unit centres (branches: `refactor/unit-geometry-*`)
**Owner reports:** "Shooting a multi model unit aims at the middle unit rather than the one you clicked." "How should line of sight work for multi-model units when shooting?"

**Assessment (2026-11-02):** the multi-model squad implementation is **half per-model**. That's a gap, not a rewrite.
- **Already per-model (good):** movement (each model has its own path, `modelPositions`/`modelPaths`), coherency (`validateSquadCoherency`), casualties (`casualtyModelIds`, last-model wound tokens), other units blocking LoS (`unitBlockingSegment` tests every living model), objective control (checks each model).
- **Still one point per unit (the bug class):** every check that measures *between two units* uses `unit.position`, which for squads is the centroid (`computeSquadCentroid`, `actions.ts` ~l.1358/1809/2496):
  - shooting range `boardDistance(attacker.position, target.position)` (`actions.ts` ~l.507, 817, HUD ~l.1200)
  - LoS `traceLineOfSight` / `hasLineOfSight` (`spatial.ts` ~l.798, 844) and cover `findCoverSource` / `hasCoverAgainstAttack` (~l.869, 991)
  - the F9 `computeShootingRayDebug` (~l.1039)
  - range-gated special rules (sustained / camouflaged "> 9"", `actions.ts` ~l.1002, 1052, 1503, 1651)
  - charge distance to target (~l.572)
  - "1" exclusion" checks for moving models, which test a moving model against **enemy unit centres** `u.position` (~l.314, 456, 676, 788), so a model can end within 1" of an enemy squad's edge model
  - engagement (~l.2566)
  So the aim line goes to the centre, and range/LoS/cover/1" checks are wrong for squads in both directions.
- **Approach:** one small `shared/src/engine/unitGeometry.ts` that every inter-unit measurement goes through, then swap the call sites. `unit.position` stays only as the display/anchor point. Single-model units behave exactly as today (except Open question 8 if adopted).

**How the tabletop handles shooting LoS (Beginner's Guide, paraphrased; core rules agree):**
- LoS is true line of sight from the model's eye level, all round (facing doesn't matter).
- A unit picks one target unit. It's a valid target if **at least one** shooting model can see **any** model of the target unit and has a weapon in range of it.
- **Only** the models that can see the target and are in range fire. Their attacks are summed into one roll.
- A model ignores its **own** squad-mates for LoS. Models of **other** units (friend or foe) block LoS, and they also count as sight blockers for cover.
- Distances are measured between the closest models, from the closest points of the bases.
- Cover: the target gets +1 Defense if the **majority** of its models are in cover / behind sight blockers (for a single model: if it's mostly in cover).
- Clicking one model doesn't pick that model. You target the unit, and the defender's casualty flow decides who is removed.
Our 3D eye-level ray (`traceLineOfSight`, 1.1" eye to head/torso/feet samples) is already the right tool. It just has to be run per model pair.

### PR 9a: `unitGeometry` + shooting (engine)
- **New helpers (pure, tested):** `livingModelPositions(unit)`, `closestModelPair(a, b)`, `unitDistance(a, b)` (closest models; base-edge or centre per Open question 8), `firingModels(state, attacker, target, weapon)` (models with LoS to any target model and that model in range), `targetCoverByMajority(state, firingModels, target)`.
- **Swap:** shooting validation (`validateAction` shoot), `getDiceSpecs` attack counts (only firing models' weapons), cover in resolution, the HUD's range/LoS pre-checks call these.
- **Tests first:**
  1. A 4-model target with only one model visible and in range → valid. Only the shooter models that see it fire (attack count = theirs only).
  2. The target centre is behind a wall but an end model is visible → valid (today invalid).
  3. The centre is visible but every model is hidden (the squad straddles a pillar) → invalid (today valid).
  4. A shooter squad whose models are partly out of range → only in-range models fire.
  5. Own squad-mates never block. Another unit's model does.
  6. Cover: 3/4 target models behind a barricade → cover, 1/4 → none.
  7. Single-model vs single-model results are unchanged.
### PR 9b: charges, engagement, 1" rule, range-gated rules (engine)
- Swap the charge distance, engagement, "1" exclusion" (moving model vs every living enemy **model**), and the sustained/camouflaged "> 9"" checks to `unitGeometry`.
- Audit melee "who strikes" (RULES_SPECIFICATION §5: models within 2" horizontal / 4" vertical strike). Check it's per model. If it isn't, move it to PR 11.
- **Audit, and fix here if small, otherwise flag for PR 11:**
  - The defenders' 3" move into contact after a charge (`consolidateSquadToward`, `spatial.ts` ~l.2569, appears to do something like it). Confirm it moves only the target unit's models not in contact, up to 3", keeping coherency.
  - A model that starts its activation out of coherency must be moved back into coherency (probably not enforced). Add a host check and an HUD hint.
  - Models may never move *through* other models (any unit, even when charging). Check `findMoveBlocker` / nav treat every living model of every other unit as an obstacle along the whole path, not just at the end.
- **Tests first:** a model can't end within 1" of an enemy squad's *edge* model; a charge reaches the closest enemy model; sustained/camouflaged use the closest models.
### PR 9c: HUD + F9 (client)
- The targeting preview and F9 draw one ray per firing model to its nearest visible target model. The hovered/clicked target model is highlighted. The toast/chip shows "N of M models can fire". No rules logic in the HUD.
- **Manual checks:** §7 add: shooting a squad partly behind cover draws a line from each firing model, only visible in-range models fire, and cover is applied only if most target models are in cover.
- **Docs (across 9a–c):** RULES_SPECIFICATION §4 (targeting, who fires, cover majority, measuring), SYSTEMS.md "Line of Sight, Cover", DATA_MODEL note that `unit.position` is the anchor only, ROADMAP.

---

## PR 10: Confirm a squad move before every model has moved (branch: `feat/squad-partial-move`)
**Owner request:** "Add a confirm button before they've all moved" (instead of a per-model skip chip).

- **Rules check:** fine on the tabletop. Each model moves *up to* the action's distance, so a model may move 0". Coherency must still hold for the final positions.
- **Current behaviour:** `GameHUD` only builds the move/rush action once every living model has a staged position (`stagedSquadModelPositions`, ~l.900–975, "All living models have been placed!").
- **Change:** show a **Confirm move** button as soon as at least one model is staged. Unstaged models keep their current position with a zero-length path `[start]`. Then run the same summary/coherency/hazard checks and `beginConfirmation`. Models already staged can still be re-picked.
- **Engine/host:** make sure `validateAction` accepts a model whose path is just its start (or `[start, start]`), counts 0" for it, and still enforces coherency on the final set. Add a test. Rush: unmoved models still count as having rushed (unit-level), so no shooting.
- **Tests first:** host accepts a 4-model move with 2 models unmoved and coherent, rejects it if the result breaks coherency, and the HUD confirm button appears after the first staged model and produces that action.
- **Manual checks:** §6 add: in a squad move, **Confirm move** is available after placing any model, and unplaced models stay where they are.

---

## PR 11: Per-model charge moves (branch: `feat/per-model-charge`)
**Why:** Decision 11. Today a squad charge is **one path** from the unit centre (`validateAction` charge, `actions.ts` ~l.540–600: `path[0]` = `attacker.position`, end within `ENGAGEMENT_RANGE` of `target.position`). On the tabletop each charging model moves up to 12" into base contact with a model of the target unit, or as close as possible, keeping coherency.

- **Layer:** shared engine (charge action payload + validation + resolution), then HUD (stage each charging model like the squad move flow, PR 10's confirm-early button included).
- **Payload:** charge gains `modelPositions` / `modelPaths` like `move-unit` (single-model units keep today's shape).
- **Rules to implement (Beginner's Guide, paraphrased):**
  - Valid charge target: at least one charging model can reach base contact (path within charge distance) with one target model. No LoS needed.
  - Each charging model moves up to the charge distance, ending in base contact with a target-unit model or as close as possible. Coherency must hold. The 1" rule is ignored for the charge. Models never move *through* other models.
  - Then the defenders not in contact move up to 3" into contact (PR 9b audit result).
  - Who strikes: models within 2" horizontal / 4" vertical of a target model, for both the charge and the strike-back. Attacks are pooled.
  - Afterwards: if one unit is wiped out, the survivor may move 3" (existing consolidation). Otherwise the charger steps back 1" (existing push-back, now per model).
- **Tests first:** a 4-model squad charging a 3-model squad: each model's path is validated; models that can't reach contact move "as close as possible" and are accepted; strike count = models within 2"/4"; the defenders' pile-in; push-back per model; single-model charges unchanged.
- **HUD:** reuse the squad move staging (chips, per-model paths, coherency toasts) with the charge target fixed; Confirm early (PR 10).
- **Docs:** RULES_SPECIFICATION §5, SYSTEMS.md charge section, DATA_MODEL charge payload, ROADMAP.
- **Manual checks:** §8 add: charging with a squad lets you place each model, models that can't reach still move closer, only models within 2" strike, defenders pile in 3".
- **Depends on:** PR 9a/9b (`unitGeometry`), PR 10 (confirm early).
