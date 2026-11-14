# Bugfix Batch 2: 14E Code Review & 14F Pathfinder Fixes
Status: in progress (approved 2026-11-14)
Roadmap: [doc/ROADMAP.md](../ROADMAP.md) (§ 14E Full codebase review & § 14F Performance)

## Goal
Resolve the remaining verified correctness, host-validation, pathfinding, and client-reconnection findings from the 14E full codebase review ([doc/reviews/14E-gemini-findings.md](../reviews/14E-gemini-findings.md)) and the 14F pathfinder snapshot audit ([doc/plans/14F-performance.md](14F-performance.md) F1, F2, F4), together with the owner's agreed v3.6 rules fixes (`2F`) and the matching stale-doc updates (`G-35`). When these 5 atomic PRs are merged, every pre-MVP bugfix batch item except deferred low-priority items is closed cleanly with regression tests.

## Decisions (agreed)
1. **Reproduce before fixing:** Each finding in a PR must first be reproduced with a failing unit test; if a finding cannot be reproduced against current `master`, drop it and note why in the PR body.
2. **F3 deferred as a known bug (owner, 2026-11-14):** `modelGap` measuring flat 2D horizontal distance in `closestApproach` / `validateSquadChargeMove` is documented as a known bug (`doc/ROADMAP.md`, `doc/plans/14F-performance.md`, `doc/plans/HANDOVER.md`) and is out of scope for this batch.
3. **G-15 deferred:** Asymmetric corner-grazing / cross-elevation line of sight on exact ties (`G-15`) stays deferred to its own dedicated LoS PR.
4. **Counter and Fatigue timing (owner, 2026-11-12):** A defending unit becomes Fatigued once the charge melee exchange completes (after its strike-back or after declining/completing retaliation, or right away if it has no non-Counter melee weapons for `strike-back`), not immediately after its `Counter` strike. Its non-Counter melee weapons in `strike-back` during the same charge hit on normal Quality unless the unit was already Fatigued beforehand or is Shaken.
5. **Pushing eligibility (owner, 2026-11-12):** Only an enemy unit that attacked the newly Shaken unit during the activation may push it. A unit made Shaken by its own activation (for example, dangerous terrain wounds during `activate-unit`, `hold`, `advance`, `rush`, or `charge-leg`) is never pushed. A charging unit that loses its melee and fails Morale can still be pushed by the defending unit it fought (`meleePairs`).
6. **One shooting action is one salvo (`G-13`, owner, 2026-11-12):** In a multi-weapon `shoot` action, every weapon allocation's firing models, cover, target living-model count, and `Blast(X)` participant list/caps are captured from the target state at the start of the salvo before any allocation applies wounds. Wounds are then applied in `deadlyFirst` order as before.
7. **Impact casualties and carried weapons (`G-18`, owner, 2026-11-12):** Impact wounds on a multi-model defender trigger the `pick-casualties` prompt under the same rules as any other attack (mixed loadouts or `Tough > 1`), whether or not the defender has a `Counter` weapon (resuming at `'counter'` when Counter weapons remain or `'strike'` otherwise). `findCounterWeapons` (`specialRules.ts`) and `weaponsInAttack` / `ownThresholdRings` (`distanceGates.ts`) filter by `w.isEquipped && isCarried(unit, w)` and use `isMeleeWeapon(w)` for `'charge'` context.
8. **Movement hazard wound order (`G-21`, 14C-3 Decision 3g):** Movement dangerous-terrain wounds honor the tabletop already-wounded-model-first order before any client-supplied model pick: in `applyWounds` (`actions.ts:4604-4608`), prefer an already-wounded living model (`alive.find((m) => m.wounds < m.maxWounds)`) before `victimIds`.
9. **Per-tab active session (`2D` / `G-09`):** `SessionStore` persists `skirmish_lab_active_session` (`ACTIVE_SESSION_KEY`) in `window.sessionStorage` (when no custom `Storage` is injected) so two tabs in the same browser never overwrite each other's seat and `rejoinToken`, while game snapshots (`skirmish_lab_snapshot_*`) stay in `window.localStorage`.

## Out of scope
- **`G-03`** (rejected during 14E triage — `getAttackDiceSpecs` already sizes melee defense dice for worst-case Ferocious charges).
- **`G-15`** (corner-grazing & cross-elevation LoS symmetry on exact ties — deferred).
- **`14F-F3`** (flat `modelGap` in `closestApproach` — deferred known bug per owner, 2026-11-14).
- **Already-merged batches:** `2A` ([#387](https://github.com/devianweb/skirmish-lab/pull/387)), `2B` ([#396](https://github.com/devianweb/skirmish-lab/pull/396), [#401](https://github.com/devianweb/skirmish-lab/pull/401)), and `2E` ([#389](https://github.com/devianweb/skirmish-lab/pull/389), [#392](https://github.com/devianweb/skirmish-lab/pull/392)).
- **Phase 15 presentation / HUD redesign** and **Player-picked armies (14G)** — planned separately.

## Background
- **Vertical & stair unit-blocker gaps (`14F-F1`):** `findMoveBlocker` (`shared/src/engine/spatial.ts:1019`) skips `findUnitSegmentBlocker` whenever `Math.hypot(to.x - from.x, to.z - from.z) < 1e-6`, and `findUnitSegmentBlocker` (`spatial.ts:943`) also returns `null` when `segLen < 1e-6`. Because `validateAction` (`actions.ts:474, 952, 1059`) checks `findEndOverlap` on `end` but relies exclusively on `findMoveBlocker(..., { keepAway: true })` for the 1" keep-away rule, ending right after a vertical drop/climb (`segLen < 1e-6`) within another unit's 1" zone bypasses keep-away on host validation. Moreover, on outgoing segments (`spatial.ts:974-980`), checking only `endDist` and `hit.tEntry > 0.001` lets a path drop/climb onto an intermediate vertex inside another model's separation zone and step off (`tEntry <= 0`), and `pushStaticWp` / `pushDynamicWp` (`spatial.ts:3114, 3142`) skip node-level unit checks on stair/ramp waypoints.
- **Ladder descent zigzag (`14F-F2`):** On ladder descents (`jr-ladder-2` in `jump-range.json`), string-pulling shortcuts directly to `top` (`foot.x, head.y, foot.z`, `LADDER_STANDOFF = 0.55"` from `ladder.position`). In Step 5b (`spatial.ts:3463-3465`), `atLadder(p1)` checks `< 0.15"` from `ladder.position`, missing `top` and appending `[head, top, foot]` after `top`.
- **Dangerous terrain in `closestApproach` (`14F-F4`):** `closestApproach` (`closestApproach.ts:205, 229`) calls `findNavPath` (which walks straight through dangerous pieces) and then discards every path where `isPathDangerous` is true (`closestApproach.ts:229`). When a hazard blocks the direct route (`ca-squad-avoids-hazard`), every candidate is discarded except `"stay put"`.
- **Engine validation & rules gaps (`2C` / `2F`):** Detailed file:line citations live in [doc/reviews/14E-gemini-findings.md](../reviews/14E-gemini-findings.md) (`G-07`, `G-08`, `G-12`, `G-13`, `G-14`, `G-16`, `G-17`, `G-18`, `G-19`, `G-20`, `G-21`, `G-31`, `G-35`) and Rules Questions 1–4 at the end of that file.
- **Resume as host & reconnect races (`2D` / `G-09`, `G-24`):** `Lobby.ts:441-443` sets up WebRTC as host without calling `createAndSendOffer()` when `room-joined` assigns `host` into a live room with a waiting guest; `Lobby.reset()` (`Lobby.ts:380-382`) sends raw `{ type: 'leave-room' }` without calling `signalingClient.leaveRoom()`; `SignalingClient.connect()` (`SignalingClient.ts:23-80`) has no in-flight promise deduplication; `SignalingDiceProvider` (`SignalingDiceProvider.ts:78-84`) retries without reconnecting a dropped socket; and `SessionStore` (`SessionStore.ts:32-34`) keeps active seat state in `localStorage` across tabs.

---

## PR 1: 14F Pathfinder & Spatial Fixes — F1, F2, F4 (branch: `bugfix-2c-spatial`) — **Done**
- **Layer:** shared engine
- **Files:**
  - `shared/src/engine/spatial.ts`
  - `shared/src/engine/closestApproach.ts`
  - `shared/tests/engine/spatial.test.ts`
  - `shared/tests/engine/closestApproach.test.ts`
  - `shared/tests/fixtures/navGoldenCases.ts` (`ca-single-tall-deck-stays` updated after F2 eliminated the ladder-top zigzag overhead)
  - `shared/tests/fixtures/nav-golden/jump-range.json` (intentional F2 snapshot update: `jr-ladder-2`)
  - `shared/tests/fixtures/nav-golden/closest-approach.json` (intentional F2/F4 snapshot updates: `ca-single-tall-deck-stays`, `ca-squad-avoids-hazard`)
- **Tests first:**
  1. **F1:** Reproduce a move/drop ending cleanly below a ledge (`segLen === 0`, `airPt -> groundPt`) 1.2" horizontally from an enemy on the ground (`0.2"` base-edge gap — inside 1" keep-away without base overlap) and confirm `findMoveBlocker` / `validateAction` previously allowed it and `findNavPath` could route through an intermediate unit at a ladder `foot` / `groundPt`; expect rejection / detour once fixed. Also test a unit standing at a stair waypoint (`wps3a` with `isRampOrStair: true`) so `pushStaticWp` does not route a path through it.
  2. **F2:** Assert `findNavPath` for the `jr-ladder-2` descent case starts descending at `[head, top, foot]` without repeating `top` before `head` (`start -> head -> top -> foot -> end`).
  3. **F4:** Assert `closestApproach` on `hazard-range` with `hazard-pool` C between mover `(9, 0, -14)` and target `(9, 0, -4)` steps to the hazard edge or routes around Pool C rather than staying put at `gap = 9` / `cost = 0`.
- **Implementation steps:**
  1. **F1 (`spatial.ts:943, 970-992, 1019, 3114, 3142`):**
     - Remove the `if (Math.hypot(to.x - from.x, to.z - from.z) < 1e-6) continue;` early skip in `findMoveBlocker` (`spatial.ts:1019`) so vertical steps also run `findUnitSegmentBlocker`.
     - In `findUnitSegmentBlocker` (`spatial.ts:943`), replace `if (segLen < 1e-6) return null;` with vertical-column checks against every other living model `mPos`:
       - If `isIgnored`: block when `minVerticalOffset(fromY, toY, otherY) < TIER_OVERLAP_DY && Math.hypot(from.x - mPos.x, from.z - mPos.z) < PASS_THROUGH_DISTANCE`.
       - Otherwise: block separation when `Math.hypot(from.x - mPos.x, from.z - mPos.z) < UNIT_SEPARATION_DISTANCE - 0.01 && minVerticalOffset(fromY, toY, otherY) < TIER_OVERLAP_DY` (unless `from` is `pathStart`, handled by existing start-overlap rules if applicable, though two living models cannot legitimately start vertically separated at `< 1.8"` in overlap), and run `segmentViolatesKeepAway3D(from, to, fromY, toY, mPos, limit)` when `options.keepAway` is true.
     - In the horizontal loop (`spatial.ts:974-980`), also catch a segment exiting an intermediate overlap vertex (`tEntry <= 0.001` with `hit.tExit > 0.02`) whenever the mover did **not** start `pathStart` already overlapping `mPos` (`Math.hypot(pathStart.x - mPos.x, pathStart.z - mPos.z) >= UNIT_SEPARATION_DISTANCE - 0.01 || Math.abs((pathStart.y ?? 0) - otherY) >= TIER_OVERLAP_DY`).
     - In `findNavPath`, remove the `!sw.isRampOrStair` and `!isSegmentOnRampOrStairs(state, wp, wp)` guards around `findUnitSegmentBlocker` in `pushStaticWp` (`spatial.ts:3114`) and `pushDynamicWp` (`spatial.ts:3142`; `pushDynamicWp` still skips terrain-only checks when on stairs/ramps).
  2. **F2 (`spatial.ts:3463-3465`):**
     - In Step 5b ladder insertion, update `if (climbed.length > 1 && atLadder(p1)) climbed.pop();` to `if (climbed.length > 1 && (atLadder(p1) || sameSpot(p1, top))) climbed.pop();`.
  3. **F4 (`spatial.ts`, `closestApproach.ts:205`):**
     - Add `avoidDangerous?: boolean` to `findNavPath`'s `options`. When `options.avoidDangerous && !flying`:
       - Treat dangerous terrain pieces (`piece.isDangerous || piece.terrainType === 'dangerous'`) as avoidable obstacles: add clearance corners around each dangerous piece (`clearance = UNIT_COLLISION_RADIUS + 0.12` at `piece.position.y ?? 0`) as dynamic waypoints in `findNavPath`, reject any fast-path / A* / string-pull / fallback segment where `isPathDangerous(state, [a, b], unit)` is true, and when falling back / clamping toward an obstacle/hazard along the straight line, include `findEnteredDangerousPiece` (stopping cleanly outside the hazard edge).
     - Pass `avoidDangerous: true` in `closestApproach` (`closestApproach.ts:205`).
  4. Re-capture only `jr-ladder-2` (F2) and `ca-single-tall-deck-stays` / `ca-squad-avoids-hazard` (F2/F4) in `jump-range.json` and `closest-approach.json` (zero unintended changes to the other 93 golden snapshots), and run `npm test --workspace=shared`.
- **Docs:** Update `doc/plans/14F-performance.md` findings status and `doc/ROADMAP.md` (`NAV_BENCH=1` notes if any).
- **Manual checks:** Verify move preview on `jump-range` ladder descent has no back-and-forth twitch at deck edge, and squad follow-through on `hazard-range` steps to/around hazard pool C.
- **Done when:** All unit tests + `navGolden.test.ts` pass (only `jr-ladder-2`, `ca-single-tall-deck-stays`, and `ca-squad-avoids-hazard` intentionally updated), and both Decision 9 performance budgets in `navBench.test.ts` stay met (`Std p95 < 10 ms`, `charge-6v6 < 300 ms`).

---

## PR 2: 2C Movement, Consolidation & Spawn Validation (branch: `bugfix-2c-movement`) — **Done**
- **Layer:** shared engine
- **Files:**
  - `shared/src/engine/actions.ts`
  - `shared/src/data/armies.ts`
  - `shared/src/data/scenario.ts`
  - `shared/tests/engine/actions.test.ts`
  - `shared/tests/data/scenario.test.ts`
- **Tests first:**
  1. **G-07:** Multi-model squad submitting `advance` or `rush` with `path` only and no `modelPositions` is rejected by `validateAction`.
  2. **G-17:** Multi-model squad submitting `advance` or `rush` with `modelPositions` crossing a dangerous piece or cliff drop without explicit `modelPaths` requests the same hazard/fall dice in `getDiceSpecs` and resolves traversals in `applyAction`.
  3. **G-08:** `consolidate-move` is rejected if `path[0]` differs from `unit.position`, leaves board bounds, violates 1" keep-away, overlaps another model, ends mid-air/overhanging/on ladder rungs, crosses non-ordinary terrain / jumps, or (for a multi-model squad) omits `modelPositions` or breaks coherency; valid squad consolidation updates individual model positions via `placeSquadModels` rather than flattening `y`.
  4. **G-20:** `applyDefaultScenario(..., { useDeploymentPhase: false })` with `orc-marauders` (5 units) / `test-special-rules-army` (8 units) places every deployed unit at a distinct non-overlapping spawn position and leaves `Ambush` units with `isDeployed: false` and not passed through `settleSpawnPositions`.
- **Implementation steps:**
  1. **G-07 (`actions.ts:906, 1395`):** Reject `advance` and `rush` when `livingModels(unit).length > 1` and `!isSquad` (`'Multi-model squad move requires modelPositions'`).
  2. **G-17 (`actions.ts:1818-1824, 2073, 2751-2755, 2986-2990`):** Extract `squadMovePaths(unit, payload)` (matching `squadChargePaths` at `actions.ts:369-375`) and use it consistently in `validateAction`, `getDiceSpecs`, `moveLegEntries`, and `applyAction` for `advance` and `rush`.
  3. **G-08 (`actions.ts:1690-1722, 3358-3387`):** Align `consolidate-move` validation with single-model and squad `advance` checks (3.0" budget, start spot match, board bounds, `findMoveBlocker(..., { keepAway: true })`, no gap jumps/falls/hazards or `validateDeclaredTraversal`/ordinary segment check, mid-air/overhang/ladder checks, `findEndOverlap`, `!pointEngagesUnit`, plus squad coherency + pairwise spacing `< 0.90"` and `placeSquadModels` in `applyAction`). *Note: also check whether `GameHUD` sends `modelPositions` for squad consolidation — verify HUD compatibility in `client` tests before changing client payloads.*
  4. **G-20 (`armies.ts:828-846`, `scenario.ts:111-125`):** Dynamically compute non-overlapping spawn coordinates in `createUnitsFromStarterArmy` based on `starterArmy.fighters.length` (spacing `>= 6"` and adding rows if wider than the board), and keep `ambush` units at `isDeployed = false` outside `settleSpawnPositions` when `useDeploymentPhase === false`.
- **Docs:** Tick fixed findings in `doc/reviews/14E-gemini-findings.md`; update `doc/SYSTEMS.md` / `doc/DATA_MODEL.md` if `consolidate-move` payload adds `modelPositions`.
- **Manual checks:** Start a no-deployment game with `orc-marauders` vs `hdf` and confirm 5 Orc units spawn without overlap and `Infiltrator` / `Ambush` units remain in reserve; verify victory consolidation in melee still works cleanly.
- **Done when:** All workspace tests (`shared`, `client`, `server`) build and pass with the new regression tests.

---

## PR 3: 2C Hazard Termination, Morale, Push & Combat Outcomes (branch: `bugfix-2c-combat-morale`) — **Done**
- **Layer:** shared engine
- **Files:**
  - `shared/src/engine/actions.ts`
  - `shared/src/engine/push.ts`
  - `shared/tests/engine/actions.test.ts`
  - `shared/tests/engine/push.test.ts`
- **Tests first:**
  1. **G-12:** Unit with 1 wound remaining dying to dangerous terrain during `advance`, `rush`, `charge-leg`, or `charge` finishes activation (`activeUnitId` cleared / advances) rather than leaving `activeUnitId` pointing to the dead unit (no extra `morale` spec on movement `hazard_*`, since `applyLegTraversals` only ends activation prematurely without a fall when `unit.isDestroyed` is true and destroyed units never test Morale).
  2. **G-14:** A `shaken` squad reduced to `<= 50%` strength by an `activate-unit` dangerous-terrain wound requests morale dice in `getDiceSpecs('end-activation')` and takes its end-of-activation Morale Test instead of silently routing on `undefined` roll.
  3. **G-16:** When an Impact + Counter charge pauses for Impact `pick-casualties` and resumes at `stage = 'counter'`, `DiceResolution.results` contains the `counter*` dice (and strike dice if not paused again) rather than `[]`.
  4. **G-19:** If a defender's `Counter` / `strike-back` destroys the charger while taking enough wounds to fail end-of-activation Morale, `pushAttackerFor` returns `null` rather than prompting a push by the destroyed charger.
  5. **G-21:** A Tough(3) squad with an already-wounded model `m0` taking a movement dangerous-terrain wound applies that wound to `m0` even if `casualtyModelIds` names unhurt `m1` (and an unhurt model `m1` falling still takes its fall wound itself rather than transferring to wounded `m0`).
  6. **G-31:** Multi-weapon `shoot` action where allocation index `0` wounds the primary target and allocation index `1` destroys/shakes it reports `outcome.targetDestroyed === true` (and `targetShaken`).
- **Implementation steps:**
  1. **G-12 (`actions.ts`):** In `applyLegTraversals`, change `if (fallen)` to `if (fallen || unit.isDestroyed)`. Leave `getDiceSpecs` (`^(jump|fall)$`) unchanged so surviving units test at `end-activation` and existing hazard-only `getDiceSpecs` contracts stay intact.
  2. **G-14 (`actions.ts`):** In `getDiceSpecs('end-activation')`, strip `'shaken'` from a shallow clone of `active` when evaluating `getUnitsRequiringMorale(...)` and `moraleDiceCounts(...)` so it matches `finishActivation`.
  3. **G-16 (`actions.ts`):** In `resolveChargeStrike`, when `resumed` is true and `stage === 'counter'`, return the dice used in that resumed step (`paused ? dice.filter((d) => /^counter\d+-/.test(d.purpose ?? '')) : dice.filter((d) => !/^impact/.test(d.purpose ?? ''))`).
  4. **G-19 (`push.ts`):** Return `null` if `!active || active.isDestroyed`, and require `partner && !partner.isDestroyed` for `partnerId`.
  5. **G-21 (`actions.ts`):** Route `resolveHazardTests` non-ledger wounds through `applyTabletopWounds` (prioritizing most-wounded living models before `casualtyModelIds`), have `applyFallWounds` damage `fallen` directly before `settleAfterWounds`, and check `alive.find((m) => m.wounds < m.maxWounds)` before shifting `victimIds` in `applyWounds`.
  6. **G-31 (`actions.ts`):** Compute `primaryTargetDestroyed` and `primaryTargetShaken` once after the `for (const i of resolveOrder)` loop finishes.
- **Docs:** Update `doc/reviews/14E-gemini-findings.md` statuses.
- **Manual checks:** Verify charge dice log after Impact -> pick-casualties -> Counter shows the Counter dice batch, and losing the last wound to a `hazard-pool` passes activation cleanly.
- **Done when:** All workspace tests pass (`shared`, `client`, `server`) with reproducing tests for all 6 findings.

---

## PR 4: 2F Agreed Rules Fixes & Stale Rules Docs (branch: `bugfix-2f-rules`)
- **Layer:** shared engine & docs
- **Files:**
  - `shared/src/engine/actions.ts`
  - `shared/src/engine/push.ts`
  - `shared/src/engine/specialRules.ts`
  - `shared/src/engine/distanceGates.ts`
  - `shared/tests/engine/actions.test.ts`
  - `shared/tests/engine/distanceGates.test.ts`
  - `shared/tests/engine/push.test.ts`
  - `doc/RULES_SPECIFICATION.md`
  - `doc/SYSTEMS.md`
  - `doc/DATA_MODEL.md`
  - `doc/reviews/14E-gemini-findings.md`
- **Tests first:**
  1. **Rules Q1 (Counter & Fatigue timing):** A defending unit armed with both a `Counter` spear and a non-Counter pistol (`Assault` or plain weapon) strikes with its Counter spear first on `toHit` normally, then when offering/resolving `strike-back` on its non-Counter weapon hits at normal Quality (`isFatigued === false`), and gains `'fatigued'` only once the melee retaliation completes or declines (or right away if it has no non-Counter weapons to strike back with).
  2. **Rules Q2 (Push eligibility):** A unit shaken by its own dangerous-terrain wound (with no enemy attack) never gets a `push` roll or prompt; a unit shaken by an enemy attack gets pushed by that enemy; a losing charger shaken by its own end-of-activation morale gets pushed by the defender in `meleePairs`.
  3. **Rules Q3 / `G-13` (Salvo simultaneous Blast):** Two `Blast(3)` weapons in one `shoot` action where weapon 0's auto-split wipes out spill neighbour `g2` still use pre-salvo participant lists and model counts (`[g1, g2]`) for weapon 1 so custom `blast-split` choices never produce `undefined` shares / `NaN` hits.
  4. **Rules Q4 / `G-18` (Impact casualties & `isCarried`):** Impact wounds on a multi-loadout / `Tough > 1` defender without Counter weapons raise `pick-casualties` (and resume into `stage: 'strike'`); a squad whose only Counter-weapon carrier died no longer counts as having a Counter weapon (`findCounterWeapons`); `distanceGates.ts` ignores dead-model weapons, unequipped weapons, and includes `Assault` weapons in `'charge'` context.
- **Implementation steps:**
  1. **Rules Q1 (`actions.ts:3934, 3968, 4050-4165`):** Remove the eager `target.status.push('fatigued')` right after Counter strikes (`actions.ts:3934`). Apply `'fatigued'` to `target` in `settleChargeStrike` when `defenderMelee === undefined && !target.isDestroyed` (only when `counterStruck` or melee retaliation finished), and at the end of `strike-back` / `decline-retaliation` (confirm exact handler around `actions.ts:3260-3350` so pre-existing Fatigued / non-Counter cases don't change behaviour).
  2. **Rules Q2 (`push.ts:60-69`, `actions.ts:4458-4462`):** In `pushAttackerFor`: for `unit.id === active.id`, return only the surviving `meleePairs` opponent; for `unit.ownerId !== active.ownerId`, require `Boolean(state.turnState.attackedFrom?.[unit.id]) || pairedWith(state, unit.id, active.id)` and `!active.isDestroyed`.
  3. **Rules Q3 / `G-13` (`actions.ts:3560-3685`):** Capture pre-salvo per-allocation `{ firing, inCover, aliveModels, participants }` in an array before the `for (const i of resolveOrder)` loop in `resolveShoot`, and consume those pre-salvo values inside the loop. *Verify any test expecting sequential Blast cap reduction adjusts to simultaneous salvo.*
  4. **Rules Q4 / `G-18` (`actions.ts:3879-3883`, `specialRules.ts:65-67`, `distanceGates.ts:70-74, 139-143`):** After `resolveImpactStep` in `resolveChargeStrike`, call `deferCasualties(..., resumeAt(counterStrikeEntries(target, attacker).length > 0 ? 'counter' : 'strike'))` unconditionally so multi-loadout / `Tough > 1` defenders pick Impact casualties before either Counter or normal melee strikes. Update `findCounterWeapons` (`specialRules.ts:65`) to take `models` and filter with `isCarried(unit, w)`. Update `distanceGates.ts` (`weaponsInAttack`, `ownThresholdRings`) to filter by `w.isEquipped && isCarried(unit, w)` and `isMeleeWeapon(w)` for `'charge'`.
  5. **G-35 (`doc/RULES_SPECIFICATION.md`, `doc/SYSTEMS.md`, `doc/DATA_MODEL.md`):** Update the stale pre-14C docs flagged in `14E-gemini-findings.md` (`G-35`) plus Decisions 4–7 above.
- **Docs:** Update `doc/reviews/14E-gemini-findings.md` (`G-13`, `G-18`, `G-35`, Rules Q1–Q4) and `doc/ROADMAP.md`.
- **Manual checks:** Run `test-special-rules-army` in `standard-battlefield` — verify Twin Counter guard vs mixed Counter + Blade guard strike-back Fatigue order, self-hazard Morale failure with `test-hazard-army` (no self-push prompt), and distance badges excluding lost special weapons on `test-loadouts-army`.
- **Done when:** All workspace tests (`shared`, `client`, `server`) pass and `RULES_SPECIFICATION.md`, `SYSTEMS.md`, and `DATA_MODEL.md` match the v3.6 engine.

---

## PR 5: 2D Resume as Host & Client Reconnect Races (branch: `bugfix-2d-reconnect`)
- **Layer:** client networking & storage (plus test updates)
- **Files:**
  - `client/src/storage/SessionStore.ts`
  - `client/src/network/SignalingClient.ts`
  - `client/src/network/SignalingDiceProvider.ts`
  - `client/src/ui/Lobby.ts`
  - `client/tests/storage/SessionStore.test.ts`
  - `client/tests/network/SignalingClient.test.ts`
  - `client/tests/network/SignalingDiceProvider.test.ts`
  - `client/tests/ui/Lobby.test.ts`
- **Tests first:**
  1. **G-09 / multi-tab session:** `Lobby` receiving `room-joined` with `role: 'host'` creates and sends an SDP offer so a resuming host reconnects P2P with an already-waiting guest (`setupWebRTCAsHost` + `createAndSendOffer`); `SignalingClient.handleMessage` updates `currentRole = message.role`; default `SessionStore` stores active session / `rejoinToken` in `sessionStorage` while keeping snapshots in `localStorage` so two tabs don't overwrite each other's seat.
  2. **G-24:** Concurrent `SignalingClient.connect()` / `ensureConnected()` / `scheduleReconnect()` calls reuse one in-flight promise instead of opening duplicate `WebSocket`s; `SignalingDiceProvider` retry tick calls `ensureConnected()` when disconnected before re-sending `requestDiceRoll`; `Lobby.reset()` calls `signalingClient.leaveRoom()` and clears `currentRoomCode`. Also check `WebRTCClient.createPeerConnection` / `handleOffer` if async ICE config loading is present, or note if already synchronous.
- **Implementation steps:**
  1. **G-09 (`SessionStore.ts`, `Lobby.ts:441-443`):**
     - Split default storage in `SessionStore`: keep `sessionStorage` for `ACTIVE_SESSION_KEY` and `localStorage` for `SNAPSHOT_PREFIX` (still accepting one `customStorage?: Storage` override in constructor so existing unit tests pass cleanly).
     - In `Lobby.ts:441-443`, inside `if (assignedRole === 'host')`, run `await this.setupWebRTCAsHost(); await this.createAndSendOffer();` (check how `peer-joined` handles double-offer races if a peer joins simultaneously — guard against stale/unready signaling states).
  2. **G-24 (`SignalingClient.ts`, `SignalingDiceProvider.ts`, `Lobby.ts:380-382`):**
     - Deduplicate `connect()` via `private connectPromise: Promise<void> | null = null` cleared on open/close/error.
     - In `SignalingDiceProvider.ts:78-84`, check `if (!this.signaling.isConnected()) void this.signaling.ensureConnected?.();` inside `retryTimer`.
     - In `Lobby.reset()` (`Lobby.ts:380-382`), call `this.signalingClient.leaveRoom()`.
- **Docs:** Update `doc/reviews/14E-gemini-findings.md` (`G-09`, `G-24`), `doc/ROADMAP.md`, and mark manual checklist section 9 items for two-browser resume test.
- **Manual checks:** Two browsers (host + guest): start match, reload host tab, click Resume Match while guest stays open, verify WebRTC reconnects and match resumes; open host + guest in two tabs of the same browser and verify session tokens stay isolated (`sessionStorage`).
- **Done when:** All workspace tests pass cleanly and manual checklist section 9 passes in two browsers.

## Open questions
None. (All rules questions 1–4 were answered by the owner on 2026-11-12 in `doc/reviews/14E-gemini-findings.md`, and `14F-F3` was deferred on 2026-11-14.)
