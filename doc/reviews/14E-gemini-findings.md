# 14E Full Codebase Review — Gemini Findings (First Pass)

> Read-only review by Gemini; findings to be triaged by Claude.

## Summary

- **Total findings:** 36 (all verified against the codebase at `930abbf`)
  - **Critical:** 3 (`G-01` – `G-03`)
  - **High:** 11 (`G-04` – `G-14`)
  - **Medium:** 15 (`G-15` – `G-29`)
  - **Low:** 7 (`G-30` – `G-36`)
- **By category:** 19 `correctness`, 5 `security`, 2 `architecture`, 2 `test-gap`, 3 `dead-code`, 5 `stale-doc`
- **Known items confirmed:**
  1. **Asymmetric corner-grazing and cross-elevation line of sight:** [`G-15`](#g-15) (`shared/src/engine/terrainStructure.ts:117-142`, `shared/src/engine/spatial.ts:1257-1285, 1340-1361`)
  2. **Stale crate-footprint comment and metadata:** [`G-30`](#g-30) (`shared/src/data/terrainStructures.ts:137-139`, `shared/src/engine/spatial.ts:45-58, 85`)

### Top Three Most Important Findings

1. **`G-01` (Critical / Security — `server/src/SignalingServer.ts:179-205`, `server/src/DiceRoller.ts:5-29`):** Unvalidated `count` and `sides` fields in `roll-dice-request` allow any connected client to crash the signaling server immediately (`RangeError` in `crypto.randomInt`) or freeze its event loop and exhaust memory (`count: 1e9`).
2. **`G-02` (Critical / Security — `server/src/Room.ts:97-115`, `server/src/SignalingServer.ts:137-154`):** `RoomManager.reconnectRoom` unconditionally overwrites `room.host` or `room.guest` even when that slot already has an open WebSocket connection, allowing unauthenticated role hijacking and orphaning the displaced peer in `clientRooms`.
3. **`G-03` (Critical / Correctness — `shared/src/engine/actions.ts:1950, 2552-2555, 3187, 3948-3951`):** `getDiceSpecs` for `charge` (after a `charge-leg`) and `pileInStrikeSpecs` (after a defender `pile-in`) compute `Ferocious` bonus hits using the post-move distance (`<= 6"`) instead of the start-of-charge distance (`turnState.attackedFrom[target.id].charged`), requesting too few defense dice and throwing `Incomplete dice results` during combat resolution.

---

## Triage (Claude, 2026-11-12)
Spot-checked against the code: G-01, G-02 and G-04 confirmed; G-03 **rejected** (`getAttackDiceSpecs` already sizes melee dice for the worst case with `chargedFrom: 'any'`, and resolution uses the recorded start distance, so a Ferocious charge after a leg or pile-in gets enough dice). Everything else is "probably real, confirm while fixing": each fix PR must first reproduce the finding with a failing test and drop it if it can't.

Bugfix batch 2, as small PRs (any of them can go to Gemini via `doc/plans/GEMINI_HANDOVER.md`; Claude reviews):
- **2A Signaling server hardening** (server only): G-01, G-02, G-05, G-25, plus the G-29 server tests.
- **2B Client trust and robustness** (client only): G-04, G-06, G-10, G-11, G-22, G-23, G-24.
- **2C Host validation in the engine** (shared, no rule changes): G-07, G-08, G-12, G-14, G-16, G-17, G-19, G-21, G-31.
- **2F Rules fixes** (shared, after 2C): the owner's answers to Rules questions 1-4 below, with G-13 and G-18.
- **2D Resume as host** (client + signaling): G-09.
- **2E Cleanup** (no behaviour change): G-20, G-26, G-27, G-28, G-30, G-32, G-33, G-34; the stale docs G-35 / G-36 go to 14H Docs sync.
- **Deferred:** G-15 (corner-graze line of sight on exact ties; low impact, needs its own careful PR).
- **Rules questions 1-5:** answered by the owner on 2026-11-12 (see the end of this file).

## Findings

### G-01
- **ID:** G-01
- **Severity:** critical
- **Category:** security
- **Location:** `server/src/SignalingServer.ts:179-205`, `server/src/DiceRoller.ts:5-29`
- **Status:** fixed in #387
- **Defect:** `handleDiceRoll` and `DiceRoller.rollDice` do not validate that `message.dice` is a bounded array of positive integer `count` and `sides` values, allowing any client to crash or freeze the signaling server.
- **Failure scenario:** A client in a room sends `{ type: "roll-dice-request", rollId: "r1", dice: [{ count: 1, sides: 0 }] }` (or `sides: -6`, `sides: 1.5`, or `dice: null`), which throws an uncaught `RangeError [ERR_OUT_OF_RANGE]` in `crypto.randomInt(1, spec.sides + 1)` (`DiceRoller.ts:12`); or sends `{ count: 1e9, sides: 6 }`, which blocks the single-threaded Node.js event loop in a synchronous loop and exhausts process memory on the Azure Free F1 instance.
- **Suggested fix:** In `handleDiceRoll`, validate that `Array.isArray(message.dice)` (`1 <= message.dice.length <= 64`) and that every spec has integer `1 <= count <= 200` and `1 <= sides <= 100` before calling `rollDice`, returning an `error` message otherwise.

### G-02
- **ID:** G-02
- **Severity:** critical
- **Category:** security
- **Location:** `server/src/Room.ts:97-115`, `server/src/SignalingServer.ts:137-154`
- **Status:** fixed in #387
- **Defect:** `RoomManager.reconnectRoom` unconditionally overwrites `room.host` or `room.guest` even when that role slot already has an open WebSocket connection, allowing unauthenticated role hijacking and leaving the displaced socket orphaned in `clientRooms`.
- **Failure scenario:** While a match is active in room `ABC-DEF` with a connected host, another client sends `{ type: "reconnect-room", code: "ABC-DEF", role: "host" }`; `reconnectRoom` overwrites `room.host` with the new socket (redirecting all signaling and dice broadcasts to it), while the original host socket remains mapped in `this.clientRooms` and has all subsequent `relayMessage` calls silently dropped because `room.host !== ws`.
- **Suggested fix:** Reject `reconnectRoom` when the target slot (`room.host` or `room.guest`) already holds a different socket with `readyState === WebSocket.OPEN`, and clean up any prior `this.clientRooms` entry before binding a socket to a room.

### G-03
- **ID:** G-03
- **Severity:** critical
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:1950, 2552-2555, 3187, 3948-3951`
- **Status:** verified
- **Defect:** `getDiceSpecs` for `charge` (after a `charge-leg`) and `pileInStrikeSpecs` (after a defender `pile-in`) pass the post-move distance (`<= 6"`) instead of the start-of-charge distance (`turnState.attackedFrom[target.id].charged`) to `strikeSpecs`, requesting too few defense dice for `Ferocious` chargers and crashing combat resolution.
- **Failure scenario:** An Orc Marauders unit (`ferocious`, granting `+1` hit per unmodified 6 when charging from `> 6"`) starts its charge `8"` from an enemy squad and either takes a `charge-leg` to `4"` before `charge` or triggers a defender `pile-in` on contact (where `createPileInReaction` at `actions.ts:3187` records `Math.hypot(cdx, cdz) ≈ 1"` after moving the charger). `getDiceSpecs` sees `distance <= 6"` (`bonusPerSix = 0`) and requests `N` defense dice, whereas `resolveChargeStrike` (`actions.ts:3950`) reads `chargedFrom = 8 > 6`, produces `> N` hits when a 6 is rolled with all dice hitting, and `resolveAttack` (`combat.ts:523-526`) throws `Incomplete dice results: expected at least X defense rolls, got Y`, rejecting the action and soft-locking the activation.
- **Suggested fix:** Pass `state.turnState.attackedFrom?.[target.id]?.charged ?? unitDistance(attacker, target)` as the charge distance in `getDiceSpecs` (`actions.ts:1950`), `createPileInReaction` (`actions.ts:3187`, captured before moving the charger), and `pileInStrikeSpecs` (`actions.ts:2554`).

### G-04
- **ID:** G-04
- **Severity:** high
- **Category:** architecture
- **Location:** `client/src/core/GameManager.ts:194-199`
- **Status:** fixed in #396
- **Defect:** The host's `action-request` P2P handler passes `msg.action` directly to `processAction` without verifying that `msg.action.actorId === this.gameState.guestId`.
- **Failure scenario:** A guest sends `{ type: "action-request", action: { id: "a1", type: "concede", actorId: "player-host", timestamp: 1, payload: { type: "concede" } } }` (or a host turn/reaction action with `actorId: "player-host"`) over the WebRTC data channel; the host validates `actorId` against `state.players`, accepts it, and forces the host to concede or executes host actions on the host's behalf.
- **Suggested fix:** In the host's `action-request` handler in `GameManager.ts:195`, verify `this.gameState && msg.action && msg.action.actorId === this.gameState.guestId` before calling `processAction`, and send `action-rejected` (`"Unauthorized actor"`) if it does not match.

### G-05
- **ID:** G-05
- **Severity:** high
- **Category:** security
- **Location:** `server/src/SignalingServer.ts:179-205`
- **Status:** fixed in #387
- **Defect:** `handleDiceRoll` neither restricts `roll-dice-request` to the room's host nor checks that a cached `room.rollCache.get(message.rollId)` entry matches the requested `DiceSpec[]` (and fails to evict falsy `rollId` keys when `size > 100`).
- **Failure scenario:** Because the guest generates `action.id` before sending `action-request` to the host and the host requests dice with `rollId = action.id` (`GameManager.ts:323`), a guest can send `{ type: "roll-dice-request", rollId: action.id, dice: [{ count: 10, sides: 1, purpose: "to-hit" }] }` to the signaling server first; when the host requests the real combat dice for `action.id`, the server returns the guest's pre-populated all-1s roll from `rollCache`.
- **Suggested fix:** Require `room.host === ws` and a non-empty string `rollId` in `handleDiceRoll`, store the serialized `DiceSpec[]` alongside cached results so mismatched specs are rejected, and check `if (firstKey !== undefined)` when evicting from `rollCache`.

### G-06
- **ID:** G-06
- **Severity:** high
- **Category:** security
- **Location:** `client/src/ui/Lobby.ts:145-148, 575-577, 589, 609, 684`, `client/src/editor/MapEditor.ts:673, 675, 716, 736`, `client/src/ui/GameHUD.ts:3938, 3976-3977, 4001-4032`
- **Status:** fixed in #396
- **Defect:** Untrusted strings from the `?room=` URL query parameter, imported custom map JSON files (`map.name`, `piece.id`), and peer-supplied state/rejection messages are interpolated unescaped into `innerHTML` across `Lobby`, `MapEditor`, and `GameHUD`.
- **Failure scenario:** Opening an invite link such as `?room="><img src=x onerror="&#97;&#108;&#101;&#114;&#116;(1)">` (where numeric HTML character references survive `.toUpperCase()` in `Lobby.ts:147, 589`) or importing a shared map JSON whose `name` contains `<img src=x onerror=alert(1)>` (`Lobby.ts:684`, `MapEditor.ts:673`) executes arbitrary JavaScript in the user's browser.
- **Suggested fix:** Sanitize `?room=` to `/^[A-Z0-9-]{0,7}$/`, and wrap all dynamic text and attribute interpolations in `Lobby.ts`, `MapEditor.ts`, and `GameHUD.ts` with `escapeHtmlText` and `escapeHtmlAttr`.

### G-07
- **ID:** G-07
- **Severity:** high
- **Category:** architecture
- **Location:** `shared/src/engine/actions.ts:906, 1395, 2774-2790, 3008-3024`
- **Status:** fixed in `bugfix-2c-movement` (PR 2)
- **Defect:** Unlike `charge` and `charge-leg` (`actions.ts:1232, 1310`), `advance` and `rush` do not require `modelPositions` when `livingModels(unit).length > 1`, allowing a multi-model squad to move via a single centroid `path` that bypasses per-model validation.
- **Failure scenario:** A guest submits an `advance` or `rush` action for a 5-model squad with a centroid `path` and omits `modelPositions`; `validateAction` checks only the centroid path, and `applyAction` (`actions.ts:2784-2789, 3018-3023`) translates every living model by `(deltaX, deltaZ)` and overwrites every model's `y` with `targetPos.y`, allowing squad members to pass through walls, end inside obstacles or off the board, violate the 1" keep-away zone, or float in mid-air.
- **Suggested fix:** In `validateAction` for `advance` (`actions.ts:906`) and `rush` (`actions.ts:1395`), reject actions when `livingModels(unit).length > 1` and `!modelPositions || modelPositions.length === 0`.

### G-08
- **ID:** G-08
- **Severity:** high
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:1690-1722, 3358-3387`
- **Status:** fixed in `bugfix-2c-movement` (PR 2)
- **Defect:** `consolidate-move` does not validate that `path[0]` starts at `unit.position`, that waypoints stay within board bounds, that `{ keepAway: true }` and end-overlap/overhang/mid-air/traversal checks pass, or that multi-model squad members retain valid individual elevations.
- **Failure scenario:** During a `melee-consolidation` prompt, a player submits `path: [{ x: 20, y: 0, z: 20 }, { x: 21, y: 0, z: 20 }]` (cost `1.0" <= 3.0"`) to teleport across the board or into base contact with a new enemy unit, or consolidates a multi-level squad onto a platform so `applyAction` (`actions.ts:3376`) sets `m.position.y = end.y` on all models and suspends off-platform models in mid-air.
- **Suggested fix:** Validate in `validateAction` (`actions.ts:1690-1722`) that `path[0]` matches `unit.position`, enforce board bounds, `keepAway: true`, end-overlap, mid-air, overhang, and coherency checks, and require per-model positions/paths for multi-model squads on consolidation.

### G-09
- **ID:** G-09
- **Severity:** high
- **Category:** correctness
- **Location:** `client/src/ui/Lobby.ts:408-439`, `client/src/network/SignalingClient.ts:156-159`, `server/src/Room.ts:69-74`
- **Status:** verified
- **Defect:** When a disconnected host clicks "Resume Match" (which sends `join-room` via `Lobby.joinRoom`) while the guest is still connected in the room, neither peer initiates a WebRTC SDP offer and `SignalingClient` overwrites `this.currentRole` with `'guest'`.
- **Failure scenario:** The host reloads the page mid-match and clicks "Resume Match" (`Lobby.ts:704`); `RoomManager.joinRoom` (`Room.ts:69-74`) assigns the vacant host slot (`role: 'host'`) and sends `room-joined` (`role: 'host'`) to the host and `peer-joined` to the guest. In `Lobby.ts:408-424`, `room-joined` with `assignedRole === 'host'` calls `setupWebRTCAsHost()` without calling `createAndSendOffer()`, while `peer-joined` on the guest (`Lobby.ts:433-438`) calls `setupWebRTCAsGuest()` and waits for an offer, hanging both peers at `"Waiting for peer..."`.
- **Suggested fix:** Have the "Resume Match" flow call `signalingClient.reconnectRoom(code, role)` (or in `Lobby.ts:413`, call `await this.createAndSendOffer()` when `room-joined` assigns `role === 'host'` and a guest is present), and set `this.currentRole = message.role` in `SignalingClient.ts:158`.

### G-10
- **ID:** G-10
- **Severity:** high
- **Category:** correctness
- **Location:** `client/src/core/GameManager.ts:169-175`
- **Status:** fixed in #401
- **Defect:** When the host recovers state from the guest via `state-sync` (`else if (!this.gameState)`), it does not call `this.beginObjectivesIfNeeded()` (and accepts `msg.state` without structural validation).
- **Failure scenario:** If the host reloads with empty `localStorage` during the initial `objectives` setup phase before `roll-objectives` has completed, the host adopts the guest's `state-sync` state (`objectivesRolled === false`) and never auto-submits `roll-objectives`, leaving both peers permanently stuck on `"Rolling for the number of objectives and the mission roll-off…"`.
- **Suggested fix:** Validate the structure of `msg.state` and call `this.beginObjectivesIfNeeded()` at the end of the host's `state-sync` recovery branch in `GameManager.ts:174`.

### G-11
- **ID:** G-11
- **Severity:** high
- **Category:** correctness
- **Location:** `client/src/core/GameManager.ts:296-307, 327-333, 395-411`
- **Status:** fixed in #401
- **Defect:** If `reactionTimeoutTimer` fires while an action is awaiting server dice (`this.pendingActionId !== null`) and that dice request subsequently fails or times out, `reactionTimeoutTimer` is left `null` and the pending reaction never expires.
- **Failure scenario:** During a `melee-retaliation` (`strike-back`) or `pile-in` prompt, the player submits their reaction just before the timer expires; while `diceProvider.requestRoll` is in flight, `handleReactionTimeout()` fires, sets `this.reactionTimeoutTimer = null`, and calls `processAction(fallbackAction)`, which is rejected because `this.pendingActionId` is non-null. If `requestRoll` then times out (`catch` at `GameManager.ts:328`), `processAction` exits without calling `syncReactionTimer()`, leaving `pendingReaction` active with no timer.
- **Suggested fix:** In `handleReactionTimeout()`, reschedule the timer if `this.pendingActionId !== null`, and in `processAction()`'s `finally` block, call `this.syncReactionTimer()` whenever `this.gameState?.turnState.pendingReaction` is still present and `this.reactionTimeoutTimer === null`.

### G-12
- **ID:** G-12
- **Severity:** high
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:2363-2372, 2751-2758, 2986-2993, 3073, 3167`
- **Status:** fixed in `bugfix-2c-combat-morale` (PR 3)
- **Defect:** When a unit is destroyed by dangerous terrain during `advance`, `rush`, `charge-leg`, or `charge` without a jump/drop fall (`fallen === null`), `applyLegTraversals` returns `{ terminated: false }` and `finishActivation` is never called.
- **Failure scenario:** An active unit with 1 wound remaining moves, rushes, or charges across a `hazard-pool` and rolls a `1` on its hazard test; `resolveHazardTests` marks `unit.isDestroyed = true`, but `applyLegTraversals` only calls `finishActivation` inside `if (fallen)` (`actions.ts:2369`), leaving `state.turnState.activeUnitId` pointing to the destroyed unit and preventing the turn from advancing.
- **Suggested fix:** In `applyLegTraversals` (`actions.ts:2366`), check `if (fallen || unit.isDestroyed)` so fatal dangerous-terrain rolls terminate and finish the activation, and include end-of-activation morale specs in `getDiceSpecs` when hazard specs are requested.

### G-13
- **ID:** G-13
- **Severity:** high
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:3466, 3490, 3604-3656, 3685`
- **Status:** verified
- **Defect:** In multi-weapon `shoot` actions, `resolveShoot` applies each weapon's wounds in place before resolving subsequent allocations, causing earlier allocations (and the auto-split trial in `blastSplitPause`) to mutate target model counts and blast participants for later Blast allocations.
- **Failure scenario:** A unit fires two `Blast(3)` weapons at a 2-model squad `g1` with another 2-model squad `g2` within 3". During `blastSplitPause`'s trial run (`actions.ts:3466`), allocation 0's auto-split destroys `g2`, so allocation 1's `prompts[1]` is recorded with only 1 participant (`[g1]`). When the defender submits a custom split for allocation 0 that keeps `g2` alive, `applyBlastSplit` (`actions.ts:3490`) re-runs `resolveShoot`: allocation 1 now finds 2 participants (`[g1, g2]`), reads `shares[1] === undefined`, and passes `count: undefined` into `resolveAttack`, producing `NaN` hit counts.
- **Suggested fix:** Compute `getBlastParticipants` (and range/cover/blast caps) for all allocations in a `shoot` action from the pre-salvo snapshot before applying any allocation's wounds, or defer applying wounds until all allocations in the salvo have been resolved.

### G-14
- **ID:** G-14
- **Severity:** high
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:1779-1792, 4453-4463`, `shared/src/engine/activation.ts:403-413, 471-475`
- **Status:** fixed in `bugfix-2c-combat-morale` (PR 3)
- **Defect:** When a `shaken` active unit is wounded to half strength during its activation (via an `activate-unit` dangerous-terrain test) and then executes `end-activation`, `getDiceSpecs('end-activation')` requests 0 morale dice while `finishActivation` clears `shaken` before calling `applyEndOfActivationMorale`.
- **Failure scenario:** A 2-model `shaken` squad standing in a `hazard-pool` activates (`activate-unit`), loses 1 model to the activation hazard test (now at 50% strength), and sends `end-activation`. In `getDiceSpecs` (`actions.ts:1781`), `active.status.includes('shaken')` is still `true`, so `moraleDiceCounts` (`activation.ts:408`) requests `0` morale dice; then `finishActivation` (`actions.ts:4454`) strips `'shaken'` before calling `applyEndOfActivationMorale` (`actions.ts:4463`), which sees `alreadyShaken === false`, reads `moraleRolls[0] === undefined` (`activation.ts:475`), and executes `break`, skipping the morale test (and any subsequent units' morale tests).
- **Suggested fix:** In `getDiceSpecs('end-activation')` (`actions.ts:1781`), exclude the active unit's `'shaken'` status when computing `moraleDiceCounts` (matching `finishActivation` clearing `'shaken'` before `applyEndOfActivationMorale`), or clear the active unit's `'shaken'` status only if it did not take a new morale test.

### G-15
- **ID:** G-15
- **Severity:** medium
- **Category:** correctness
- **Location:** `shared/src/engine/terrainStructure.ts:117-142`, `shared/src/engine/spatial.ts:1257-1285, 1340-1361`, `shared/tests/data/builtinMaps.test.ts:339-340`
- **Status:** verified
- **Defect:** **[Known Item 1]** Line of sight is not symmetric (`hasLineOfSight(state, a, b) !== hasLineOfSight(state, b, a)`) when a ray grazes a terrain box corner (`s0 === s1` under directional IEEE-754 rounding) or when units at different elevations trace from a single `1.1"` eye height to three target sample heights (`1.1"`, `0.6"`, `0.1"`).
- **Failure scenario:** `segmentBoxIntersection(a, b, box)` (`terrainStructure.ts:139`) rejects only when `s0 > s1` (treating zero-length corner touches `s0 === s1` as solid hits) and computes `(lo - o) / d` from `a -> b` without canonical endpoint ordering; on a diagonal ray grazing a box corner (e.g. a rotated crate at `(0, 0, 0)` with units at `(-5, 0, -2.513031523548441)` and `(4.54952, 0, 2.2866124383286655)`), floating-point rounding gives `s0 <= s1` from `A` to `B` (blocked) and `s0 > s1` by `~1e-16` from `B` to `A` (clear). Additionally, in `hasLineOfSight` (`spatial.ts:1264-1265`), the viewer traces only from `y + 1.1` to the target's `y + 1.1`, `y + 0.6`, and `y + 0.1`, so an elevated viewer on a platform with a wall blocking `y + 1.1` to `y + 1.1` can see the ground unit's feet (`y + 0.1`), while the ground unit cannot see the elevated unit's feet through the platform deck.
- **Suggested fix:** Require a positive interior intersection chord `s1 - s0 > 1e-6` in `segmentBoxIntersection` (`if (s0 > s1 - 1e-6) return null;`), canonicalize endpoint ordering `(a, b)` before slab division so `segmentBoxIntersection(a, b, box)` and `segmentBoxIntersection(b, a, box)` are bit-identical, and evaluate the symmetric pair of sample heights between `a` and `b`.

### G-16
- **ID:** G-16
- **Severity:** medium
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:3974-3979`
- **Status:** fixed in `bugfix-2c-combat-morale` (PR 3)
- **Defect:** When `resolveChargeStrike` resumes at `stage = 'counter'` after an Impact `pick-casualties` prompt, `resumed` is `true` and `stage === 'strike'` is `false`, causing `DiceResolution.results` to be set to `[]`.
- **Failure scenario:** A charger with `Impact` wounds a multi-model defender equipped with a `Counter` weapon; the charge pauses at stage `'impact'` for the defender to pick casualties, and when `applyPickCasualties` calls `resumeChargeStrike` with `stage = 'counter'`, line 3979 (`!resumed ? dice : stage === 'strike' ? ... : []`) evaluates to `[]`, wiping all Counter and charger melee dice rolls from the resulting `ActionLogEntry.dice.results`.
- **Suggested fix:** When `stage === 'counter'` in `resolveChargeStrike` (`actions.ts:3979`), include the `counter*` dice (and when `!paused`, also the non-`impact`/non-`counter` strike dice) in `results` instead of returning `[]`.

### G-17
- **ID:** G-17
- **Severity:** medium
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:1818-1824, 2073, 2751-2755, 2986-2990`
- **Status:** fixed in `bugfix-2c-movement` (PR 2)
- **Defect:** For squad `advance` and `rush` actions that include `modelPositions` without `modelPaths`, `validateAction` synthesizes per-model straight paths `[mStart, modelPositions[i]]`, whereas `moveLegEntries`, `getDiceSpecs`, and `applyAction` only inspect `payload.modelPaths` and fall back to `payload.path`.
- **Failure scenario:** A squad `advance` or `rush` payload with `modelPositions` (and `modelTraversals` or paths across dangerous terrain/ledges) but no `modelPaths` passes `validateAction`, yet `getDiceSpecs` requests no jump/fall/hazard dice for the models and `applyAction` skips `applyModelPathTraversals`, allowing the squad to cross hazards or drop off ledges without rolling.
- **Suggested fix:** Synthesize `modelPaths` as `living.map((m, i) => payload.modelPaths?.[i] ?? [m.position ?? unit.position, payload.modelPositions![i]])` in a shared helper used by `validateAction`, `getDiceSpecs`, `moveLegEntries`, and `applyAction` (matching `squadChargePaths` at `actions.ts:369-375`).

### G-18
- **ID:** G-18
- **Severity:** medium
- **Category:** correctness
- **Location:** `shared/src/engine/specialRules.ts:65-67`, `shared/src/engine/distanceGates.ts:70-74, 139-143`
- **Status:** verified
- **Defect:** `findCounterWeapons` in `specialRules.ts` and `weaponsInAttack` / `ownThresholdRings` in `distanceGates.ts` do not filter weapons by `isCarried(unit, w)` (and `distanceGates.ts` also omits `w.isEquipped` and `Assault` melee weapons).
- **Failure scenario:** In a mixed-loadout squad where the only model carrying a `Counter` weapon (or a weapon with a distance-gated rule like `Relentless`) has been killed, `findCounterWeapons(unit)` still returns that weapon and `attackDistanceRules` / `ownThresholdRings` still display its distance badge and threshold ring; conversely, charging with an `Assault` ranged weapon (`type: 'ranged'` with `'assault'`) omits weapon distance gates because `distanceGates.ts:71, 141` checks `w.profile.type === 'melee'` instead of `isMeleeWeapon(w)`.
- **Suggested fix:** Filter `findCounterWeapons` by `isCarried(unit, w)`, and in `distanceGates.ts` filter by `w.isEquipped && isCarried(unit, w)` using `isMeleeWeapon(w)` for `'charge'` context.

### G-19
- **ID:** G-19
- **Severity:** medium
- **Category:** correctness
- **Location:** `shared/src/engine/push.ts:60-69`, `shared/src/engine/actions.ts:4458-4462`
- **Status:** fixed in `bugfix-2c-combat-morale` (PR 3)
- **Defect:** `pushAttackerFor` returns `active` or the melee partner from `state.turnState.meleePairs` without checking `!u.isDestroyed`.
- **Failure scenario:** During a charge, the defender's `Counter` strike or `strike-back` destroys the charging unit while the defender also lost wounds and is at half strength; at `finishActivation`, the defender fails its Morale Test and becomes `shaken`, and `pushAttackerFor` returns the destroyed charger, prompting a 4+ `push` move by a dead unit.
- **Suggested fix:** Check `if (!active.isDestroyed)` and `u && !u.isDestroyed` in `pushAttackerFor` (`push.ts:63, 67`).

### G-20
- **ID:** G-20
- **Severity:** medium
- **Category:** correctness
- **Location:** `shared/src/data/armies.ts:828-846`, `shared/src/data/scenario.ts:111-125`
- **Status:** fixed in `bugfix-2c-movement` (PR 2)
- **Defect:** When `useDeploymentPhase` is `false`, `createUnitsFromStarterArmy` cycles unit X-coordinates through a 4-element array (`spread = [-9, -3, 3, 9]`) and `settleSpawnPositions` sets `unit.isDeployed = true` on all units including `Ambush` units.
- **Failure scenario:** Starting an auto-deployed match (`useDeploymentPhase: false`) with `orc-marauders` (5 units), `test-scout-ambush-army` (6 units), or `test-special-rules-army` (8 units) spawns units 5–8 directly on top of units 1–4 at `x = -9, -3, 3, 9, z = ±12`, and places `Ambush` units on the board in Round 1 instead of holding them in reserve (`isDeployed: false`) for Round 2+.
- **Suggested fix:** Space unit X-coordinates dynamically across the board width based on `army.fighters.length`, and skip `Ambush` units (`hasTrait(unit.specialRules, 'ambush')`) in `settleSpawnPositions` so they remain `isDeployed: false`.

### G-21
- **ID:** G-21
- **Severity:** medium
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:2363, 4599-4614`
- **Status:** fixed in `bugfix-2c-combat-morale` (PR 3)
- **Defect:** Movement dangerous-terrain tests call `resolveHazardTests` without a `WoundLedger` (bypassing `pick-casualties`) and delegate to `applyWounds`, which honors client-supplied `casualtyModelIds` ahead of already-wounded models.
- **Failure scenario:** A Tough(3) squad where `m0` already has 1 wound remaining (`wounds: 1, maxWounds: 3`) moves across a `hazard-pool` and takes 1 wound; if the client passes `casualtyModelIds: ['m1']`, `applyWounds` (`actions.ts:4605-4608`) applies the wound to the unhurt `m1` instead of finishing off the already-wounded `m0`, violating the tabletop wound allocation rule (`allocateWounds` in `casualties.ts`).
- **Suggested fix:** Route movement dangerous-terrain wounds through `applyTabletopWounds` / `deferCasualties` (or `allocateWounds`) and remove the legacy `casualtyModelIds` parameter from `applyWounds`.

### G-22
- **ID:** G-22
- **Severity:** medium
- **Category:** correctness
- **Location:** `client/src/main.ts:206, 210-219, 244-265`, `client/src/core/GameManager.ts:118-125, 201-231`
- **Status:** fixed in #396
- **Defect:** `main.ts` never calls `gameManager.destroy()` when returning to the lobby, and `rebindWebRTCClient` neither detaches listeners from the old `WebRTCClient` nor attaches `hud.setNetworkStatus` to the new `WebRTCClient`.
- **Failure scenario:** If the host clicks "Return to Lobby" while a reaction timer is active, `onReturnToLobby` (`main.ts:244`) clears `defaultSessionStore` and nulls `gameManager` without calling `gameManager.destroy()`; when `reactionTimeoutTimer` fires, the orphaned `GameManager` processes the fallback action and saves the old match snapshot back into `localStorage`. Furthermore, when a guest rejoins via the fast-rebind path (`main.ts:210-219`), the old `WebRTCClient`'s delayed `disconnected` event still fires on `GameManager` (pausing reaction timers) while the new `WebRTCClient` never updates `hud.setNetworkStatus`.
- **Suggested fix:** Call `gameManager?.destroy()` in `onReturnToLobby`, guard `GameManager`'s WebRTC callbacks with `if (this.webrtcClient !== client) return;`, and wire `webrtcClient.onConnectionState` to `hud?.setNetworkStatus` inside the fast-rebind branch in `main.ts:212`.

### G-23
- **ID:** G-23
- **Severity:** medium
- **Category:** correctness
- **Location:** `client/src/ui/GameHUD.ts:419-433, 509-516, 1383-1388`
- **Status:** fixed in #396
- **Defect:** `GameHUD.syncFromState` executes an early `return;` on round transitions (`roundNumber > prevRound`), and `GameHUD.dispose()` fails to clear `this.reactionTimerInterval`.
- **Failure scenario:** When Round 2, 3, or 4 starts (`GameHUD.ts:509-516`), `syncFromState` shows the round toast and returns at line 515 before running lines 519–550, skipping `SoundFx.getInstance().playTurnChime()`, leaving `prevCurrentPlayerId` stale, and skipping `reactionTimerInterval` cleanup; additionally, when `hud.dispose()` (`GameHUD.ts:1383`) is called on lobby return during a reaction, the 250ms `reactionTimerInterval` is leaked and re-renders the detached HUD indefinitely.
- **Suggested fix:** Remove the early `return;` at `GameHUD.ts:515` so round transitions still update audio/timer state before rendering, and consolidate `destroy()` and `dispose()` so both clear `toastTimer`, `concedeTimer`, and `reactionTimerInterval`.

### G-24
- **ID:** G-24
- **Severity:** medium
- **Category:** correctness
- **Location:** `client/src/network/SignalingClient.ts:22-79, 86-101, 116-126`, `client/src/network/SignalingDiceProvider.ts:47-53, 78-84`, `client/src/ui/Lobby.ts:362-377`, `client/src/network/WebRTCClient.ts:49-56, 149-175`
- **Status:** verified
- **Defect:** Concurrent `ensureConnected()` and `scheduleReconnect()` calls open duplicate WebSockets; `SignalingDiceProvider`'s retry timer never reconnects a closed socket; `Lobby.reset()` sends raw `leave-room` without clearing `SignalingClient.currentRoomCode`; and `WebRTCClient.handleOffer` can run before `createPeerConnection`'s `fetchIceServers()` resolves.
- **Failure scenario:** If the guest's `fetch('/ice-servers')` takes longer than the host's when joining a room, the host's `'offer'` arrives while the guest's `this.peerConnection` is still `null`, throwing `Error: No peer connection` (`WebRTCClient.ts:150`). Similarly, if a dice request triggers `ensureConnected()` while `scheduleReconnect()`'s socket is still `CONNECTING`, `SignalingClient.connect()` overwrites `this.ws` with a second WebSocket, causing both sockets to send `reconnect-room` and kick each other in a loop.
- **Suggested fix:** Deduplicate in-flight connection promises on `SignalingClient` and `WebRTCClient` (`connectPromise` / `initPromise`), call `ensureConnected()` inside `SignalingDiceProvider`'s retry interval when disconnected, and call `this.signalingClient.leaveRoom()` in `Lobby.reset()`.

### G-25
- **ID:** G-25
- **Severity:** medium
- **Category:** security
- **Location:** `server/src/SignalingServer.ts:25, 39-47, 73-135`, `server/src/Room.ts:32-61, 143-156`
- **Status:** fixed in #387
- **Defect:** The signaling server sets no `maxPayload` on `WebSocketServer` (allowing 100 MB messages), enforces no cap on room creation or per-socket room membership, and never expires headless rooms while a remaining guest sends keep-alive pings.
- **Failure scenario:** When a host closes their tab and never returns, the guest's 25s `{ type: 'ping' }` calls `roomManager.updateActivity(roomCode)` (`SignalingServer.ts:97`), keeping `now - room.lastActivity < 25s` so `hostGoneLongEnough` (`!room.host && now - room.lastActivity > graceTimeout` at `Room.ts:147`) is never true and the room stays in memory for 3 hours; meanwhile, a single client can send repeated `create-room` messages or 99 MB WebSocket frames to exhaust server memory.
- **Suggested fix:** Configure `maxPayload: 64 * 1024` on `WebSocketServer`, track `hostDisconnectedAt` / `guestDisconnectedAt` timestamps separately from `lastActivity`, cap `this.rooms.size`, and clean up any previous room when a socket calls `create-room` or `join-room`.

### G-26
- **ID:** G-26
- **Severity:** medium
- **Category:** correctness
- **Location:** `client/src/renderer/MarkerRenderer.ts:1259-1275`, `client/src/renderer/ModelLoader.ts:179-220`, `client/src/editor/MapEditor.ts:499-525, 906-941`
- **Status:** fixed in #392
- **Defect:** `MarkerRenderer.showOutcome` hardcodes `y = 1.6` instead of `(position.y ?? 0) + 1.6`, `ModelLoader.addSwappingAsset` leaks cloned Three.js geometries and materials if a marker container is disposed before its GLB load resolves, and `MapEditor` leaks `gameView.onPick` on `dispose()` and omits `syncGameView()` on four inspector checkboxes.
- **Failure scenario:** When a unit standing on a 3"-high platform takes wounds, `showOutcome` spawns the floating wound token at `y = 1.6` underneath the platform deck; and in `MapEditor`, toggling `Provides Cover`, `Blocks Line of Sight`, `Impassable Obstacle`, or `Walkable Surface` mutates the piece without updating the 3D debug wireframe or validation badge.
- **Suggested fix:** Position outcome tokens at `(position.y ?? 0) + 1.6` in `MarkerRenderer.ts:1269`, mark disposed containers in `disposeObject3D` so `addSwappingAsset` disposes late-arriving GLB clones, and call `validateCurrentMap()` + `syncGameView()` on all `MapEditor` inspector checkboxes while unsubscribing `onPick` in `MapEditor.dispose()`.

### G-27
- **ID:** G-27
- **Severity:** medium
- **Category:** correctness
- **Location:** `tools/ux-inventory/catalog.js:8`, `tools/ux-inventory/build.js:6, 35-38`, `tools/ux-inventory/tojpg.js:8`, `tools/ux-inventory/scenes/10-setup-flow.js:12, 49`, `tools/ux-inventory/scenes/06-misc-endgame.js:7-25, 41-57`
- **Status:** fixed in #392
- **Defect:** The UX inventory tooling has an uncaptured `70b-lobby-waking-up` entry in `catalog.js`, wipes `doc/ux/inventory/img/` if `build.js && tojpg.js` is run when `out/` is only partially populated, omits `ux.force()` in `scenes/10-setup-flow.js`, and has duplicate conflicting screenshot filenames across `02`/`03` and `06`/`07`.
- **Failure scenario:** Running `node build.js && node tojpg.js` after running a single scene script (as documented in `tools/ux-inventory/README.md:15-17`) deletes all ~65 other committed JPEGs in `doc/ux/inventory/img/`; even on a full run, `70b-lobby-waking-up` is missing (causing `build.js:35` to skip `#02` and misnumber cards `01, 03..76`), `10-setup-flow.js` skips `s9-07-scout-stage-host` ~50% of the time when Guest wins the unforced deployment roll-off, and `06-misc-endgame.js` overwrites `43-jump-result` and `46-hazard-confirm` from `07-jump-hazard.js` with unrelated scenes.
- **Suggested fix:** Add the `70b-lobby-waking-up` capture to `08-lobby.js`, seed setup dice with `ux.force()` in `10-setup-flow.js`, remove the duplicate `09`–`13` and `40`–`47` captures from `02-move-shoot.js` and `06-misc-endgame.js`, and make `build.js` / `tojpg.js` abort with a non-zero exit code (instead of wiping `doc/ux/inventory/img/`) when any catalog image is missing.

### G-28
- **ID:** G-28
- **Severity:** medium
- **Category:** test-gap
- **Location:** `client/tests/network/Protocol.test.ts:1-15`, `client/tests/core/GameManager.test.ts:156-165`, `client/tests/network/WebRTCClient.test.ts:41-46`
- **Status:** fixed in #392
- **Defect:** Three client unit tests are tautological or call the wrong method, passing even if the underlying production code is broken or deleted.
- **Failure scenario:** `Protocol.test.ts` never imports `Protocol.ts` and asserts `typeof state === 'string'` on a local literal array; `GameManager.test.ts:156-165` (`should limit snapshots to maxSnapshots`) creates 60 actions in a loop without ever calling `sendAction` or `saveSnapshot` (`snapshots.length` stays `1`); and `WebRTCClient.test.ts:41-46` calls `handleMessage({ type: 'heartbeat-pong' })` instead of `dataChannel.onmessage`, leaving `lastPongTime` unchanged (`after === before`) and passing `toBeGreaterThanOrEqual(before)` tautologically.
- **Suggested fix:** Remove `Protocol.test.ts` (along with dead `Protocol.ts`), call `(gameManager as any).saveSnapshot(...)` inside the loop in `GameManager.test.ts:156`, and dispatch a `MessageEvent` on `dataChannel.onmessage` after advancing fake timers in `WebRTCClient.test.ts:41`.

### G-29
- **ID:** G-29
- **Severity:** medium
- **Category:** test-gap
- **Location:** `server/tests/RoomManager.test.ts:1-165`, `server/tests/DiceRoller.test.ts:1-60`, `server/tests/SignalingServer.integration.test.ts:1-168`
- **Status:** fixed in #387
- **Defect:** Server test suites lack tests for room expiration/grace cleanup (`RoomManager.cleanup`), invalid/malformed signaling and dice requests, `rollId` cache collisions, and disconnect/reconnect notifications, while `RoomManager.test.ts` leaks `setInterval` timers on every test.
- **Failure scenario:** Because `RoomManager.test.ts` never calls `roomManager.destroy()` in `afterEach` and has zero tests for `cleanup()`, the broken `hostGoneLongEnough` grace-window logic (`Room.ts:147`) and the missing input validation in `SignalingServer.ts` and `DiceRoller.ts` went undetected.
- **Suggested fix:** Add `afterEach(() => roomManager.destroy())` and fake-timer tests for `cleanup()` in `RoomManager.test.ts`, and add negative/boundary and reconnect/disconnect tests in `DiceRoller.test.ts` and `SignalingServer.integration.test.ts`.

### G-30
- **ID:** G-30
- **Severity:** low
- **Category:** stale-doc
- **Location:** `shared/src/data/terrainStructures.ts:137-139`, `shared/src/engine/spatial.ts:45-58, 85`
- **Status:** fixed in #392
- **Defect:** **[Known Item 2]** `terrainStructures.ts:138` contains a stale comment claiming `(crates keep the legacy inset footprint via the fallback body)`, while `spatial.ts:47-57` has a redundant branch in `terrainHalfExtents` and stale `0.7×0.7×0.7` crate metadata at `spatial.ts:85`.
- **Failure scenario:** A developer reading `terrainStructures.ts:138` or `TERRAIN_MODEL_META.crate` (`spatial.ts:85`) is misled into believing crates still use a `0.7 × 0.7` inset collision footprint, whereas `resolveTerrainStructure` (`terrainStructure.ts:80-84`) and `terrainHalfExtents` (`spatial.ts:45-58`) both use the full `[-0.5, 0.5]` unit-box footprint (`1" × 0.75" × 1"`).
- **Suggested fix:** Remove `(crates keep the legacy inset footprint via the fallback body)` from `terrainStructures.ts:138`, collapse `terrainHalfExtents` (`spatial.ts:45-58`) to `return { hx: 0.5 * sx, hz: 0.5 * sz }`, and update `TERRAIN_MODEL_META.crate` (`spatial.ts:85`).

### G-31
- **ID:** G-31
- **Severity:** low
- **Category:** correctness
- **Location:** `shared/src/engine/actions.ts:3694-3697`
- **Status:** fixed in `bugfix-2c-combat-morale` (PR 3)
- **Defect:** In `resolveShoot`, `primaryTargetDestroyed` and `primaryTargetShaken` are only assigned during the loop iteration where `i === 0`, ignoring later allocations in `resolveOrder` that hit the same primary target.
- **Failure scenario:** A unit fires two weapons at the same enemy unit `g1`, where allocation `0` is a `Deadly(3)` weapon and allocation `1` is a standard weapon; `resolveOrder` (`actions.ts:3560`) resolves `i = 0` first (wounding `g1`, so `primaryTargetDestroyed` is set to `false` at line 3695) and then resolves `i = 1` second (destroying `g1`), leaving `diceResolution.outcome.targetDestroyed` falsely set to `false`.
- **Suggested fix:** Compute `primaryTargetDestroyed = primaryTarget?.isDestroyed ?? false` and `primaryTargetShaken = primaryTarget?.status.includes('shaken') ?? false` once after the `for (const i of resolveOrder)` loop finishes (`actions.ts:3724`).

### G-32
- **ID:** G-32
- **Severity:** low
- **Category:** correctness
- **Location:** `client/src/storage/MapStore.ts:179-183`, `client/src/ui/GameHUD.ts:444-451, 555-610, 1354-1363`
- **Status:** fixed in #392
- **Defect:** `MapStore.importMapJson` defaults omitted board dimensions to `44×30` instead of `DEFAULT_BOARD_SIZE` (`48×48`), `GameHUD.getReactionRemainingSec` resets the displayed countdown to full `durationMs` after a page reload/state-sync, `GameHUD.notifyRejected` does not reset `rematchPending`, and `resetForNewMatch` does not clear `hoveredTerrainId` or `hoverNavMemo`.
- **Failure scenario:** Importing a custom map JSON without a `board` field creates an invalid rectangular `44" × 30"` board instead of `48" × 48"`; reloading the page 25s into a 30s reaction prompt resets the HUD countdown display to `30s` while the host times out 5s later; and if `request-rematch` is rejected, the "Play Again" button stays permanently disabled (`Waiting for opponent…`).
- **Suggested fix:** Use `DEFAULT_BOARD_SIZE` (`48`) as the fallback width and height in `MapStore.ts:180-181`, update `pending.durationMs` to the remaining time when syncing/saving snapshots, reset `this.rematchPending = false` in `notifyRejected()`, and clear `hoveredTerrainId` and memo caches in `resetForNewMatch()`.

### G-33
- **ID:** G-33
- **Severity:** low
- **Category:** dead-code
- **Location:** `shared/src/gameState.ts:129-176`, `shared/src/engine/traversal.ts:771-825`, `client/src/ui/GameHUD.ts:2902-2923, 3149, 3283, 4934-4961, 6208-6219`
- **Status:** fixed in #392
- **Defect:** `validateActionBasic` in `gameState.ts` and `allocateSquadCasualties` in `traversal.ts` are unused legacy functions that contradict current engine rules, and `GameHUD.ts` still contains dead `.sl-hud-casualty-selector` and `casualtyModelIds` code paths.
- **Failure scenario:** `validateActionBasic` (`gameState.ts:161`) rejects `hold` on an already-activated unit (`Unit already activated this round`), contradicting `validateAction` in `actions.ts:1005-1025`, while `allocateSquadCasualties` (`traversal.ts:793`) destroys a model on a single wound regardless of `Tough(X)`.
- **Suggested fix:** Remove `validateActionBasic`, `allocateSquadCasualties`, and the unused `selectedCasualtyModelId` / `casualtyModelIds` UI and payload fields in `GameHUD.ts`.

### G-34
- **ID:** G-34
- **Severity:** low
- **Category:** dead-code
- **Location:** `client/src/network/Protocol.ts:1-18`, `client/src/ui/connectionStatus.ts:27-72`, `shared/src/signaling.ts:21-36`, `server/src/Room.ts:9, 20, 135-141, 158-160`
- **Status:** fixed in #392 (partially confirmed: Protocol.ts, RoomManager dead fields/endGame, spatial dead exports, and DiceSpec duplication removed; ConnectionStatusBar already absent from connectionStatus.ts; 7 empty source directories not found; getRoomCount kept as used by #387 room limit)
- **Defect:** `client/src/network/Protocol.ts`, `ConnectionStatusBar` in `connectionStatus.ts`, `RoomManager.endGame`/`getRoomCount`, several legacy exports in `shared/src/engine/spatial.ts` (`addPlatformAscentPoints`, `findWalkablePlatformAt`, `settleMoveEnd`, `validateFormationMove`), and 7 empty source directories are unused dead code, while `DiceSpec` and `DiceResult` are duplicated in `shared/src/types.ts` and `shared/src/signaling.ts`.
- **Failure scenario:** Maintaining duplicate `DiceSpec`/`DiceResult` interfaces in `types.ts` and `signaling.ts` (both re-exported via `export *` in `shared/src/index.ts`) and dead modules/exports increases maintenance surface and confuses contributors.
- **Suggested fix:** Delete `Protocol.ts`, `ConnectionStatusBar`, unused `RoomManager` methods, dead `spatial.ts`/`traversal.ts` helpers, and the 7 empty directories, and import `DiceSpec`/`DiceResult` in `signaling.ts` from `./types`.

### G-35
- **ID:** G-35
- **Severity:** low
- **Category:** stale-doc
- **Location:** `doc/SYSTEMS.md:66, 69, 92, 98, 115, 269-270, 297, 305-309, 390`, `doc/RULES_SPECIFICATION.md:260, 303-332`, `doc/DATA_MODEL.md:112, 129, 143-149, 232-238, 362-382`
- **Status:** verified
- **Defect:** `doc/SYSTEMS.md`, `doc/RULES_SPECIFICATION.md`, and `doc/DATA_MODEL.md` contain stale pre-14C descriptions and type definitions that contradict the current v3.6 engine implementation.
- **Failure scenario:** `SYSTEMS.md` still refers to a `12" hero aura` (`6"` in code, line 69), a `1.0" center opening of wall-doorway` (`1.5"` in code, line 66), cover giving `+1 on the effective Quality needed to hit` (`+1 Defense` in code, lines 269–270), per-model `m1_gap_jump` dice and `3+` jump target (`2+` single unit roll in code, lines 305–309), and elimination-only v1 missions (line 390); `RULES_SPECIFICATION.md:260` lists Strider's trait ID as `pathfinder` (`strider` in code); and `DATA_MODEL.md` omits `'objectives'`, `'fatigued'`, `'push'`, and setup/push action types.
- **Suggested fix:** Update the stale paragraphs and schema blocks in `doc/SYSTEMS.md`, `doc/RULES_SPECIFICATION.md`, and `doc/DATA_MODEL.md` to match the current v3.6 implementation in `shared/src/`.

### G-36
- **ID:** G-36
- **Severity:** low
- **Category:** stale-doc
- **Location:** `doc/ARCHITECTURE.md:4, 29-62, 100`, `doc/NETWORKING.md:59-90, 302`, `doc/ASSETS.md:65-86, 120`, `doc/DEPLOYMENT.md:8, 13, 27, 98`, `doc/ux/README.md:3`
- **Status:** fixed in #389
- **Defect:** `doc/ARCHITECTURE.md`, `doc/NETWORKING.md`, `doc/ASSETS.md`, `doc/DEPLOYMENT.md`, and `doc/ux/README.md` contain outdated message schemas, colors, file paths, Node versions, and screenshot counts.
- **Failure scenario:** `NETWORKING.md` lists `heartbeatTimeout: 10000` (`6000` in `WebRTCClient.ts:24`), omits reconnect/ping signaling messages, and claims `"Any peer can request dice roll via signaling server"`; `ASSETS.md:65-86, 120` still documents the removed 14-piece `scenario.ts` terrain table and orange (`0xff7043`) aim lines (now green `0x66bb6a` in `MarkerRenderer.ts:67`); `DEPLOYMENT.md` specifies Node 20 LTS (`AGENTS.md` specifies Node 24 LTS); and `doc/ux/README.md:3` states `58 screenshots` (`75` in `index.html`).
- **Suggested fix:** Update `doc/ARCHITECTURE.md`, `doc/NETWORKING.md`, `doc/ASSETS.md`, `doc/DEPLOYMENT.md`, and `doc/ux/README.md` to reflect the current codebase.

---

## Rules Questions

1. **Fatigued timing when a defending unit has both Counter and non-Counter melee weapons (`shared/src/engine/actions.ts:3926-3937, 4240-4249`):** When a defending squad has one weapon with `Counter` and another melee weapon without `Counter`, `resolveChargeStrike` (`actions.ts:3932`) adds `'fatigued'` to `target.status` immediately after resolving the `Counter` weapon strike (before the charger strikes), so when the defender later strikes back with its remaining non-Counter melee weapons (`resolveRetaliationStrike` at `actions.ts:4241`), those non-Counter weapons only hit on unmodified 6s (`alreadyFatigued === true`). Should striking with a `Counter` weapon fatigue the entire defending unit before its normal `strike-back` in the same charge, or should `fatigued` only take effect after the defender completes its melee retaliation for that charge?
2. **Pushing a unit that failed a Morale Test caused by its own activation (`shared/src/engine/push.ts:60-69`, `shared/src/engine/actions.ts:4458-4462`):** In `pushAttackerFor` (`push.ts:63`), if the active unit itself fails a Morale Test at the end of its activation (for example, after taking dangerous-terrain wounds while moving or shooting without engaging in melee), `pushAttackerFor` returns `active` as the attacker of its own push (`attackerUnitId === targetUnitId`), prompting the player who owns the newly Shaken unit to roll 4+ to push their own unit 2" in any direction. In Firefight v3.6, is Push intended to trigger only when an enemy attack causes the Morale Test failure (or with the enemy opponent choosing the push direction), or also on self-inflicted dangerous-terrain morale failures?
3. **Simultaneous weapon resolution within a single shooting activation (`shared/src/engine/actions.ts:3604-3704`):** When a multi-model unit fires multiple weapons in a single `shoot` action, `resolveShoot` applies each weapon's wounds to the target immediately before resolving the next weapon in the same shooting action (so weapon 1 killing models reduces the target's `livingModels` count and `Blast(X)` hit cap for weapon 2 in the same salvo). Should all weapons declared in the same shooting action determine their Blast caps and target model counts simultaneously before casualties are removed?
4. **Prompting `pick-casualties` after Impact hits before checking whether a Counter weapon carrier survives (`shared/src/engine/actions.ts:3862-3892`):** In `resolveChargeStrike` (`actions.ts:3866`), `hasCounter` is evaluated *after* `resolveImpactStep`, and `resolveImpactStep` only pauses for `pick-casualties` when `findCounterWeapons(target).length > 0` (`actions.ts:3842`); however, `findCounterWeapons` (`specialRules.ts:65`) does not check `isCarried(target, w)`, so Impact hits pause for `pick-casualties` even when the only Counter carrier is already dead, and conversely if a multi-model squad has no Counter weapons, Impact casualties are auto-allocated without a `pick-casualties` prompt before the defender's `strike-back` (where model survival could determine which mixed-loadout weapons remain for `strike-back`). Should Impact wounds on a multi-loadout squad always allow the defender to choose casualties before `strike-back`?
5. **3" `melee-consolidation` reaction vs 1" separation move (`shared/src/engine/actions.ts:3233-3252, 4050-4058`):** When a charging unit destroys the defender (either via Impact hits at `actions.ts:4050` or melee strikes at `actions.ts:3244`), the engine triggers a `melee-consolidation` reaction allowing a 3" move (`CONSOLIDATION_MAX_DISTANCE = 3`), whereas if both units survive, the charger backs up 1". Is the 3" consolidation after wiping out an enemy in melee an intentional house/legacy rule kept alongside the v3.6 post-melee separation rules?

### Owner answers (2026-11-12)
These are agreed rules decisions; they go into **2F Rules fixes** (shared engine, after 2C; update `doc/RULES_SPECIFICATION.md` and `doc/SYSTEMS.md` with them):
1. **Counter and Fatigue:** a unit becomes Fatigued once the melee is resolved, not straight after its Counter strike. Its strike back with non-Counter weapons in the same melee hits normally (unless it was already Fatigued or is Shaken, as before).
2. **Pushing:** only an enemy that attacked the unit can push it. A unit made Shaken by its own activation (e.g. dangerous-terrain wounds) is not pushed. A charger that loses its melee can still be pushed by the unit it fought.
3. **One shooting action is one salvo:** every weapon's Blast caps and the units sharing its hits are worked out from the target as it stood when the shooting began; wounds are then applied in order (Deadly first, as now). This also fixes G-13.
4. **Impact casualties:** the defender picks which models are removed by Impact hits with the same prompt rules as any other attack (mixed loadouts or Tough above 1), whether or not it has a Counter weapon. `findCounterWeapons` ignores weapons whose carriers are dead (G-18).
5. **Consolidation:** no change. The 3" move when either unit is destroyed, and the 1" separation otherwise, are the v3.6 core rule, and the engine already lets whichever side survives make the 3" move.

---

## Not Reviewed / Ran Out of Time

None — all workspaces (`shared/`, `client/`, `server/`, `tools/ux-inventory/`, and `doc/`) were reviewed in full.
