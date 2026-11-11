# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, the 14B rematch pass on 2026-11-10, and the 14C-2 passes the same day (jumps and group crossing, push, keep-away in 3D, flying indicator, squad follow-through, dangerous terrain dice); which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

Items marked **(known bug)** have a fix planned in `doc/plans/bugfix-playtest-batch-1.md`; retest them after that PR lands.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, climbable floors outlined orange, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- All items verified.

## 2. Terrain structure (walls, windows, doors, ruin)
- All items verified.

## 3. Elevation, ladders, stairs
- All items verified.

## 4. Drops, jumps and movement cost
- All items verified.

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- All earlier items verified.

### 14C-2 PR 7: special rules
**Setup:** dev mode (F9 in the lobby), both players pick army `TEST: Special Rules Check` (`test-special-rules-army`: Fast and Slow runners, Impact(3) brutes, Counter Blade guard, Assault Rifle troops, Shred Blade fighters) on the Standard Battlefield or any open map. For the casualty-pick items use the `Hazard Range` map and `TEST: Hazard Check` (`test-hazard-army`).
- [ ] Fast: the Fast runners show Advance 8" / Rush 16" (data card and move ring); the host refuses an Advance of more than 8". Slow walkers: 4" / 8".
- [ ] Impact: the Impact brutes (3 models, Impact(3)) charging a fresh unit show an "Impact" line rolling 3 dice per model in melee reach (9 with all three in reach), with hits, blocked and wounds in the dice panel before the melee strike.
- [ ] Impact skipped when Fatigued: charge once (Fatigued), then charge again next round while still Fatigued (e.g. after a strike back): no Impact line appears.
- [ ] Counter: charge the Counter guard with another unit. Its "Counter strike first" line appears before your own strike, no Strike Back prompt follows for the Counter Blade, and it ends Fatigued. Charge it while it is Fatigued: no Counter line and the normal Strike Back prompt appears.
- [ ] Counter does not reduce your Impact hits: charge the Counter guard with the Impact brutes; all Impact dice still count.
- [ ] Assault: the Assault troops can pick the Assault Rifle both for Shoot and for a charge/fight (the data card lists it as "Ranged + Melee").
- [ ] Shred: the Shred fighters strike; every Defense die showing 1 against them adds an extra wound ("Shred: N extra wounds" under the dice).
- [ ] Dangerous terrain wording: on Hazard Range, plan an Advance of the 5-model squad through a pool. The confirm summary reads "Dangerous terrain: 5 dice, each 1 is a wound" (a Tough 3 Hero shows 3 dice, or 2 once it has taken a wound), the selector reads "Dangerous terrain wounds go first to:", and nothing says "Hazard test".
- [ ] Activation casualty pick: move the 5-model squad into a pool, then activate it again next round. If the test rolls 1s, the squad's owner gets "Remove Casualties" (Auto pick or a chosen model) instead of models vanishing; the unit cannot move until picked. A Shaken squad that Holds in the pool finishes its activation (Shaken cleared, turn passes) only after the pick. A single Hero in the pool gets no prompt.

## 9. Multiplayer & custom maps
- All items verified.
