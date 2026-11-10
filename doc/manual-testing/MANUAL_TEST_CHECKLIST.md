# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, and the 14B rematch pass on 2026-11-10; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- All items verified except the squad group-crossing items below (14C-2 PR 4C). Setup for all of them: press F9 in the lobby (Developer mode), pick the army **TEST: Jump Check (squad, Strider squad, Flying squad)** for both players and the built-in map **Jump Range**. Deploy "Test Jumpers" near the stairs at x -9, z -12 (host side), then walk it up the stairs onto the first 3" deck (deck A, x -11..-7, z -10..-2).

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.
- [ ] **Squad follow-through** (Developer mode, `TEST: Jump Check` map or the TEST squad army, any squad of 3+ models on open ground): Advance, place ONE model, and the other models show rings where they will go; the instruction line says the others will follow. Click Confirm move: the confirmation lists every model and the move is accepted. Repeat with Rush (12") and with a charge on a distant target (a leg: nobody ends touching by accident).
- [ ] Squad follow-through keeps formation: place one model 5" ahead and the rest end 5" ahead of where each stood, in the same shape. Select a chip and place another model by hand before Confirm: that model is exactly where you put it, and the rest re-form around the two.
- [ ] Squad follow-through with an obstacle (an enemy unit or a wall in a follower's lane): the follower stops at the farthest legal point (never within 1" of the enemy, never overlapping), or takes a spot next to a squad-mate. If a model really cannot follow and the squad would lose coherency, Confirm is refused with a message naming that model and its chip turns red.
- [ ] Squad follow-through with a jump: declaring a jump with one model still carries the others across (group crossing); unplaced models do not follow on their own in that case.

## 7. Movement, rush and shooting
- All earlier items verified. New (keep-away measured in 3D, 14C-2 bugfix). Setup: F9 in the lobby (Developer mode), army **TEST: Jump Check** for both players, map **Jump Range**, Deploy off or place the squads by hand.

## 8. Melee & objectives
- All earlier items verified.

## 9. Multiplayer & custom maps
- All items verified.
