# Batch 1I: squad follow-ups after 1C/1D
Status: approved (2026-11-04), not started
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)** first (esp. 10–12, 15, 21–22). This batch answers that plan's open questions 10–17 (owner, 2026-11-04) as Decisions 26–33, plus Decisions 34–36 agreed in the same review.
Roadmap: tick items under the existing `### 13.6 playtest fixes (bugfix batch 1, …)` heading in doc/ROADMAP.md. Don't create a new heading.

## Goal
Close the gaps the 1D squad work left open: squads must form one unbroken chain; a squad that is out of coherency can always do something legal and must regroup before it shoots; failed squad jumps play out like moving the jumpers last on the table; each model has its own movement budget across legs; squad models that don't reach contact in a charge really get as close as they can; the defender places their own models when piling in; the aim line follows the model you clicked; and the host stops accepting old-style block charges from squads.

## Decisions (agreed)
26. **Aim line prefers the clicked model** (Q10). In the shooting preview, each firing model aims at the model the player pointed at if that firing model sees it and has it in range; otherwise at its nearest visible in-range model, as today. Preview only: who fires, attacks and cover are unchanged.
27. **Cover by majority stays strict** (Q11). More than half of the target's living models must be in cover; 2 of 4 is not cover. No change.
28. **An out-of-coherency squad can't shoot without moving** (Q12). Shooting without having moved is a Hold, and Hold is already blocked for a squad that started its activation out of coherency (PR 10). Advance and then shoot is allowed. Stunned units stay exempt.
29. **"Closer counts" when regrouping** (Q13). A squad that started the action out of coherency may end it still out of coherency if it ends measurably closer to coherent (its *coherency shortfall* goes down, see PR 29). A squad that started coherent must still end coherent. Holding (and shooting in place) stays blocked. Owner: "Your suggestion sounds reasonable." This follows the guide's "or as close as possible" for the 6" limit.
30. **A failed squad jump stops the later jumpers** (Q14). Walking models always finish their paths (like moving the jumpers last on the table). Declared jumps resolve in model order (living-model order; the staging order isn't recorded). After the first failed jump, every later jumper stops at its take-off spot and its jump is not attempted. The squad may end out of coherency; it regroups next activation (Decision 29). Owner: "Lets go with your original plan if it's closer to the tabletop."
31. **"As close as possible" in squad charges is checked properly, by ordinary movement only** (Q15). In a final squad charge, every charging model not in base contact must end about as close to the target as it could have got by ordinary movement (walk, stairs, ladders, drops ≤ 3", gaps ≤ 1", climbs ≤ 3" onto climbable pieces; never a jump) within its own remaining charge distance, keeping coherency and a legal end. A model is never required to jump. Models the player doesn't place in a final squad charge are moved as close as possible automatically (they no longer stay put). At least one charging model must still be in base contact for melee (owner: "at least one unit has to make base contact"; no melee-without-contact case). Chargers get **no** extra 3" (owner: "drop it").
32. **Each model has its own movement budget across legs** (Q16). In split moves and split charges, each model's own path costs are added up across legs and must stay within the action's distance (6"/12"/charge). The longest model path per leg no longer drains everyone's budget. Owner: "Makes sense."
33. **The host rejects a squad charge without per-model positions** (Q17). A `charge` or `charge-leg` for a unit with more than one living model must carry `modelPositions` (and `modelPaths`/`modelTraversals` as needed). The old single-path block move is rejected. Owner: "Agreed."
34. **Coherency is one unbroken chain** (the guide's wording). Two squad models are *linked* when they are within the link distance (1" edge to edge on the same level, 3" across levels, Decision 10). A squad is coherent when its links join every living model into one connected group **and** every pair is within the 6" spread. Today each model only has to be linked to *some* other model, so two separate pairs 4" apart pass; under this rule they don't. Casualties may still break the chain; the squad then regroups (Decision 29). Owner: "Add the chain rule."
35. **The defender places their own models when piling in.** After a final charge, if the target unit has living models not in base contact with a charging model, the defending player is prompted to move them (each up to 3", ordinary movement only, into base contact with a charging model or as close as possible, keeping coherency; models already in contact don't move). The host checks the placement with the same "as close as possible" rule as the chargers (Decision 31). The charger's strike is rolled only after the pile-in is confirmed. If the prompt times out, the host places the models with the same helper. Owner: "It's unfair to just move the minis when it could put them in dumb / unsafe positions."
36. **Line of sight inside a squad is already right; no change.** A model never blocks the sight of models in its own unit, and the target unit's own models don't block sight to each other (so they don't give themselves cover); only *other* units' models block (`unitBlockingSegment`, `shared/src/engine/spatial.ts` ~l.1164, skips both the shooter's and the target's unit; test `squadShooting.test.ts` "own squad-mates never block line of sight; another unit does").

## Out of scope
- Melee without base contact (owner: at least one model must be in contact).
- The winner's 3" consolidation after a unit is wiped out (already a prompt, `consolidate-move`): unchanged.
- `MapStore.importMapJson`'s 44×30 fallback and the editor inspector's F9 marker redraw (batch 1 follow-ups; not part of this batch).
- Any change to cover, LoS, jump dice, falling or strike reach.
- Choosing casualties to keep the chain intact (the defender still picks casualties freely; a broken chain is fixed by regrouping).

## Background
- Out-of-coherency block: `incoherentStartBlock` (`shared/src/engine/actions.ts` ~l.188), used by `hold` (~l.495/500) and `end-activation` (~l.1304). `shoot` (~l.752) doesn't use it. HUD hint ~`GameHUD.ts` l.3042–3054.
- Coherency check: `validateSquadCoherency` (`shared/src/engine/spatial.ts` ~l.3141): step 1 the 6" spread (all pairs, centre 6.0 + tolerance), step 2 each model linked to at least one other (1" same level, 3" across levels; centre distances; `areOnDifferentLevels`). There is no connectivity check. Used by moves/rush (~`actions.ts` l.646 and l.1113), squad charges (`validateSquadChargeMove` ~l.259), deployment, the pile-in and push-back, and the HUD staging (~`GameHUD.ts` l.1128–1199).
- Squad jumps: `DeclaredTraversal` (`shared/src/engine/traversal.ts` ~l.612: `kind`, `takeoff`, `landing`), `applyModelPathTraversals` (`actions.ts` ~l.1588, called ~l.1948 and ~l.2400), dice tagged `m<index>_` in `getDiceSpecs`.
- Budgets: `unit.remainingMovement` (unit-level, `gameTypes.ts` ~l.134), reset in `activation.ts` ~l.180 and `actions.ts` ~l.3026. Squad move spend = longest model path (`actions.ts` ~l.1933–1945, also ~l.1992); charge budget `chargeBudget`/`chargeSpent` (~l.245, ~l.422), squad legs in `validateSquadChargeMove`.
- Squad charge "as close as possible" today: non-contact models must end no farther from the target than they started (`validateSquadChargeMove` doc comment ~l.229).
- Pile-in today: automatic, inside the charge resolution (`consolidateSquadToward(newState, target, …, 3.0, { intoContact: true, contactWith: attacker })`, `actions.ts` ~l.2578; helper `spatial.ts` ~l.3386): straight-line steps only, no pathing. `getDiceSpecs` simulates it (~l.1494–1507) so the charger's strike count (`strikers`, ~l.2996) is known when the charge's dice are requested.
- Reactions: `TurnState.pendingReaction` (`PendingReaction`, `gameTypes.ts` ~l.19: `type`, `promptingPlayerId`, `options`, `expiresAt`/`durationMs`, `data`). While one is pending, only `respond-reaction` and `consolidate-move` are accepted (`actions.ts` ~l.429). Examples: `melee-retaliation` (~l.2640, strike back) and the winner's `consolidate-move` placement prompt (~l.1264 / ~l.2895), which is the closest model for a placement prompt.
- Block-charge compat: `isSquadCharge` (~l.215) is `!!payload.modelPositions && livingModels(unit).length > 1`, so a multi-model charge without `modelPositions` falls through to the single-path validation.
- Aim: `squadAim` (`shared/src/engine/squadTargeting.ts` ~l.116); the per-shooter loop (~l.136) picks the nearest visible model; `aimedModelId` is already passed in and only drives the ring.
- Test conventions (AGENTS.md): fixtures that move `unit.position` must move `unit.models[*].position` (`syncModels` in `client/tests/ui/GameHUD.test.ts`); squad payloads are in living-model order; per-model dice use `m<index>_` tags.

## PR 27: Aim at the clicked model; reject squad block charges (branch: `batch-1i-aim-and-block-charge`)
- **Layer:** shared engine (+ HUD test)
- **Files:** `shared/src/engine/squadTargeting.ts`, `shared/src/engine/actions.ts`, tests, docs.
- **Tests first:**
  - `squadAim` with `aimedModelId`: a shooter that sees the clicked model aims at it even when another target model is nearer; a shooter that can't see it (or has it out of range) falls back to its nearest visible model; `firingCount` and `coverByMajority` are identical with and without `aimedModelId`.
  - `validateAction`: a `charge` and a `charge-leg` from a 2+-living-model unit without `modelPositions` are rejected with a clear reason; with `modelPositions` they behave as today; a unit down to one living model may still send the plain `path`.
- **Implementation:** in the shooter loop, prefer the picked model when `sees(shooter, pickedPos)`. In `charge`/`charge-leg` validation, reject when the unit has > 1 living model and no `modelPositions`. Update any old tests that relied on the block charge to send `modelPositions`.
- **Docs:** RULES_SPECIFICATION §5 (squad charge payload required), DATA_MODEL charge payload, SYSTEMS (aim line), ROADMAP.
- **Manual checks:** shooting a squad: clicking a far model that your models can see moves their aim lines to it.
- **Done when:** tests pass in all workspaces; no HUD path sends a squad charge without `modelPositions`.

## PR 28: Coherency is one unbroken chain (branch: `batch-1i-chain-coherency`)
- **Layer:** shared engine (+ HUD toast text)
- **Files:** `shared/src/engine/spatial.ts` (`validateSquadCoherency`), `client/src/ui/GameHUD.ts` (staging messages), tests, docs.
- **Tests first:**
  - Four models in a line, each 1" from the next: coherent. Two pairs (A·B and C·D, B to C 4" edge to edge): **not** coherent, with a reason naming the break ("squad is split into 2 groups: …"). Five models with the middle one removed: not coherent. A chain whose link crosses levels at ≤ 3" (Decision 10): coherent. A chain that is connected but spans more than 6": not coherent (spread rule unchanged).
  - Regression sweep: existing coherency, deployment, squad move, squad charge, pile-in and push-back tests still pass; update any fixture that relied on two separate clumps, and say which in the PR.
- **Implementation:** after the existing two steps, build the link graph (same level-aware limits and tolerance) and check it is connected (union-find or BFS over living models). Return the same `SquadCoherencyResult` shape. The HUD staging check already calls `validateSquadCoherency` when the last model is placed; make its toast show the new reason. Placement-by-placement hints that only look at the nearest placed model may stay as they are.
- **Docs:** RULES_SPECIFICATION (coherency: one chain), SYSTEMS, ROADMAP.
- **Manual checks:** try to end a squad move as two separate pairs: refused with the "split into groups" message.
- **Done when:** a squad split into separate groups is never accepted as coherent anywhere in the engine.

## PR 29: Regrouping an out-of-coherency squad (branch: `batch-1i-regroup`)
After PR 28.
- **Layer:** shared engine, then client HUD (same PR is fine; split if it grows)
- **Files:** `shared/src/engine/spatial.ts` (new pure helper), `shared/src/engine/actions.ts`, `client/src/ui/GameHUD.ts`, tests, docs.
- **Coherency shortfall (new pure helper `coherencyShortfall(positions)` next to `validateSquadCoherency`):** take the complete graph of living models with edge weight `max(0, d − linkLimit)` (same level-aware limits and tolerance) and sum the weights of its minimum spanning tree (the total distance the chain is missing, including the gap between separate groups), then add `max(0, largest pair distance − 6" spread limit)`. It is 0 exactly when `validateSquadCoherency` says coherent (test this equivalence).
- **Tests first:**
  - Shortfall: 0 for coherent squads (same level and split level); two pairs 4" apart give the gap beyond the link limit; grows with the gap; equivalence with `validateSquadCoherency` on a spread of random layouts.
  - Host, squad that starts incoherent (4 models, one 14" away): a 6" Advance bringing the stray 6" closer but still incoherent is accepted; a move that leaves the shortfall the same or larger is rejected; a move that makes it coherent is accepted; then it may shoot.
  - Host, squad that starts coherent: ending incoherent is still rejected (regression).
  - Same "closer counts" rule for rush, split-move legs (compare with the positions before that leg) and squad charges/legs.
  - `shoot` with no prior move by a squad that started incoherent is rejected (reason says it must move back together); after an Advance it's allowed; stunned units exempt; single models unaffected.
- **Implementation:** wherever a squad end position is checked for coherency (move/rush ~l.646/~l.1113, `validateSquadChargeMove`), accept an incoherent end when the positions before the action were incoherent and `coherencyShortfall(end) < coherencyShortfall(start) − 0.05`. Add `incoherentStartBlock` to `shoot` when the unit hasn't moved. HUD: the staging toasts (~l.1128–1199) let the player place models that reduce the shortfall when the squad started incoherent; disable Shoot (like Hold) with the existing hint until it has moved.
- **Docs:** RULES_SPECIFICATION (coherency: regrouping, closer counts, no shooting in place), SYSTEMS, ROADMAP.
- **Manual checks:** split a squad (remove a middle model of five, or a fall), then on its next activation: Hold and Shoot are disabled with the hint; an Advance moving the stray as far as it can is accepted even if still apart; then it can shoot.
- **Done when:** an incoherent squad always has a legal move unless it is completely boxed in.

## PR 30: Per-model movement budgets across legs (branch: `batch-1i-per-model-budget`)
- **Layer:** shared engine (schema + rules), then client HUD
- **Files:** `shared/src/gameTypes.ts`, `shared/src/engine/actions.ts`, `shared/src/engine/activation.ts`, `client/src/ui/GameHUD.ts`, tests, docs.
- **Schema:** add an optional, serializable per-model spent distance for the current action, e.g. `Unit.modelMovementSpent?: Record<modelId, number>`, reset wherever `remainingMovement` is reset (activation start, ~`actions.ts` l.3026). `unit.remainingMovement` becomes the most any living model can still move (budget − the smallest spent), so existing "out of movement" checks keep working.
- **Tests first:** split move, 4-model squad, Advance 6": leg 1 model A moves 6", leg 2 model B moves 6" → accepted (today rejected); leg 2 model A moves 0.5" more → rejected. Same for a split squad charge (12"). A passed jump stays free per model. Difficult terrain: the existing 6" cap still applies (per model, as today). Single-model units unchanged. State round-trips through JSON.
- **Implementation:** replace "longest model path per leg" with per-model running totals in move/rush squad legs (~l.1933–1945, ~l.1992) and in `validateSquadChargeMove` (`remaining`/`spent` per model). HUD: the remaining-budget ring and "N" left" text show the selected model's own remaining distance while staging.
- **Docs:** DATA_MODEL (new field), RULES_SPECIFICATION (split moves/charges: per-model budget; also fix §5's "the longest model path is what the leg spends" line), SYSTEMS, ROADMAP.
- **Manual checks:** split-move a squad in two legs moving different models each time; each model can use its full distance.
- **Done when:** no model can exceed its distance across legs, and no model loses distance because a squad-mate moved.

## PR 31: Failed squad jump stops the later jumpers (branch: `batch-1i-squad-jump-fail`)
- **Layer:** shared engine (+ HUD log text)
- **Files:** `shared/src/engine/actions.ts` (`applyModelPathTraversals`), tests, docs.
- **Tests first:** 4-model squad, models 2 and 3 declare jumps, model 1 and 4 walk: model 2 fails → model 2 falls/is removed as today, model 3 ends at its `takeoff` spot (not its landing), its dice are ignored and the log says its jump was not attempted, models 1 and 4 end at their path ends, the activation ends. Model 2 passes and model 3 fails → both resolve. Only one jumper → unchanged. Walking models after a failure in model order still finish. Model 3's movement spent is its path up to the take-off spot (PR 30).
- **Implementation:** dice are still requested up front for every declared jumper (one round trip, server-rolled); during resolution, after the first failed jump, later jumpers are placed at their declared `takeoff`, their remaining path is dropped, and their rolls are logged as "Model N: jump not attempted (activation ended)". Don't change the dice spec order or tags.
- **Docs:** RULES_SPECIFICATION §10.3 (squad jumps), SYSTEMS, ROADMAP.
- **Manual checks:** two models of a squad declare jumps; if the first fails, the second stays at the edge and the log says why.
- **Done when:** after a failed jump no later jumper moves past its take-off spot.

## PR 32: "As close as possible" for squad chargers (branch: `batch-1i-as-close-as-possible`)
After PR 29 and PR 30 (it uses per-model remaining budgets and the regroup rule).
- **Layer:** shared engine, then client HUD
- **Files:** new helper in `shared/src/engine/` (e.g. `closestApproach.ts`), `shared/src/engine/actions.ts` (`validateSquadChargeMove`), `client/src/ui/GameHUD.ts`, tests, docs.
- **Helper (pure):** `closestApproach(state, unit, modelIndex, start, budget, target, otherFinalPositions, opts)` returns the legal end spot closest (base edge) to any living model of `target` reachable from `start` by ordinary movement (`findNavPath`, safe-only, never a jump) within `budget`, such that the model's end is legal (no overlap, fully supported, keep-away except toward `target`, `findMoveBlocker` clear) and the squad stays coherent with `otherFinalPositions` (or, if the squad started incoherent, doesn't increase the shortfall). Sample along the nav path(s) toward each target model's contact point; deterministic. Written so PR 33 can reuse it for the pile-in (budget 3", `target` = the charging unit).
- **Host rule (final squad charge only; legs keep "no farther than they started"):** at least one model in base contact (unchanged). Every other model must end with a base-edge gap to the target no more than 0.5" larger than `closestApproach` gives for it (using the other models' submitted final positions). Otherwise reject: "Model N could get closer to the target".
- **HUD:** on a final squad charge, models the player didn't place are filled in with `closestApproach` (in model order, each using the others' positions so far) before the host check, and shown in the confirmation. Placed models that fail the check show the host's toast.
- **Tests first:** a model 8" from the target with a clear path left at its start → rejected; placed 0.3" short of its best spot → accepted; a model that could only get closer by a jump is not required to (ordinary movement only); a model held back by coherency is accepted; unplaced models auto-placed and accepted; dice/strike counts match the resolved positions; single-model charges unchanged.
- **Docs:** RULES_SPECIFICATION §5 (as close as possible), SYSTEMS, ROADMAP.
- **Manual checks:** squad charge where only one model is placed in contact: the others move up automatically as close as they can.
- **Done when:** non-contact chargers end as close as ordinary movement allows, and the host rejects a squad that holds models back.

## PR 33: Defender pile-in prompt, engine (branch: `batch-1i-pile-in-engine`)
After PR 32.
- **Layer:** shared engine (schema + rules); client `GameManager` only where the action flow needs it
- **Files:** `shared/src/gameTypes.ts` (reaction type, new action), `shared/src/engine/actions.ts`, `shared/src/engine/spatial.ts` (retire the automatic `intoContact` path or keep it only as the timeout fallback via `closestApproach`), client `GameManager` dice flow if needed, tests, docs.
- **Flow:**
  1. The final `charge` moves the chargers as today. If the target has living models not in base contact with a charging model, it sets `pendingReaction` of a new type `pile-in` for the defending player (`data`: charger and target ids, the models that must move) and does **not** resolve the charger's strike yet. Otherwise (everyone already in contact, or a single-model target) melee resolves exactly as today.
  2. New action `pile-in-move` from the defending player (accepted while the `pile-in` reaction is pending, like `consolidate-move`), carrying `modelPositions` / `modelPaths` in living-model order. Host checks: only the listed models moved; each path is ordinary movement only, ≤ 3", no jumps; models already in contact are unchanged; each moved model ends in base contact with a charging model or within 0.5" of what `closestApproach` (budget 3", toward the charging unit, others' submitted positions) gives; legal end positions (no overlap, supported, on board); the unit ends coherent (chain rule), or no less coherent than before if it started incoherent.
  3. Accepting `pile-in-move` clears the reaction, applies the positions, then resolves the charger's strike: `getDiceSpecs` for `pile-in-move` returns the charger's strike dice counted from the new positions (`strikers`), and the rest (strike-back prompt, fatigue, push-back) carries on as today.
  4. Timeout: the prompt gets a 60 s countdown (placing several models takes longer than the strike-back choice). When it expires, the host submits the pile-in itself using `closestApproach` for each listed model (nearest-first, as the old automatic pile-in did), then resolves as in 3. Reuse the host's existing reaction timer in client `GameManager` (`reactionTimeoutTimer`, ~l.51; it already pauses while the peer is disconnected, ~l.200–213).
- **Tests first:** a 4-model charger reaching one of three defenders → `pile-in` reaction pending, no strike dice yet; the attacker can't act while it's pending; a valid `pile-in-move` is accepted and the charger's strike uses the post-pile-in striker count; a model moved > 3", a jump, a model in contact that moved, a model left 2" short of a reachable contact spot, an incoherent result, and a `pile-in-move` from the wrong player are each rejected; timeout fallback places models round a wall into contact and then resolves; single-model target and "all already in contact" skip the prompt (regression: same dice and result as today); state with a pending pile-in round-trips through JSON (reconnect).
- **Docs:** RULES_SPECIFICATION §5 (pile-in by the defender), SYSTEMS (reaction flow), NETWORKING/DATA_MODEL (new reaction type and action), ROADMAP.
- **Manual checks:** none until PR 34 (engine only); note it in the PR.
- **Done when:** the host never moves the defender's models itself except on timeout, and the charger's strike count always reflects the confirmed pile-in.

## PR 34: Defender pile-in prompt, HUD (branch: `batch-1i-pile-in-hud`)
After PR 33.
- **Layer:** client HUD (+ scene previews reused)
- **Files:** `client/src/ui/GameHUD.ts` (and the reaction UI it uses), tests, docs.
- **Behaviour:** the defending player sees a "Pile in" prompt with the reaction countdown: reuse the squad staging (select a model, click a spot, per-model paths and coherency toasts, 3" ring per model). Models already in contact can't be selected. **Auto place** fills every unplaced model with the engine's `closestApproach` suggestion; **Confirm** sends `pile-in-move`. The host check runs before sending so refusals show as toasts. The charging player sees "Waiting for <defender> to pile in" and can't act.
- **Tests first (HUD):** the prompt appears only for the defending player; Auto place produces a payload the host accepts; a model placed too far is refused with a toast; Confirm sends `pile-in-move` with positions in living-model order; the attacker sees the waiting message.
- **Docs:** SYSTEMS (HUD), ROADMAP.
- **Manual checks:** charge a squad with a squad so only some defenders touch: the defender gets the Pile in prompt, Auto place puts the others in contact or as close as they can, you can move them elsewhere within 3" instead, and the attacks are rolled after you confirm; letting the timer run out piles in automatically.
- **Done when:** a defender can place their pile-in models themselves, and nothing else about melee changes.

## Order
PR 27 (quick wins) → PR 28 (chain) → PR 29 (regroup; needs 28) → PR 30 (per-model budgets) → PR 31 (jump fail; can run alongside PR 30 but rebase onto it for the spent-distance test) → PR 32 (chargers as close as possible; needs 29 and 30) → PR 33 (pile-in engine; needs 32) → PR 34 (pile-in HUD).

## Open questions
None (Q10–Q17 and Decisions 34–36 agreed 2026-11-04).
