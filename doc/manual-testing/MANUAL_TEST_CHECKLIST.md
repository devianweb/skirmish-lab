# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last pass: 2026-11-02, which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

Items marked **(known bug)** have a fix planned in `doc/plans/bugfix-playtest-batch-1.md`; retest them after that PR lands.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- All items verified 2026-11-02.

## 2. Terrain structure (walls, windows, doors, ruin)
- All items verified 2026-11-02.

## 3. Elevation, ladders, stairs
- [ ] **Stairs look solid:** the stair wedge renders with properly lit outer faces (no see-through or inside-out sides, step lines visible on the slope and sides), and its F9 wireframe slopes the same way as the mesh at every rotation (0°, 90°, 180°, 270°).

## 4. Drops, jumps and movement cost
- [ ] **(known bug, plan PR 3/5)** Stepping off a ledge of **3" or less** is regular movement: no test, no warning, and it costs only the horizontal distance walked.
- [ ] Dropping **3–6"**: the move preview warns **JUMP DOWN: roll 2 dice (3 for 6"), all 3+**; success lands with no damage and the activation continues; any failure falls: Falling damage and the activation ends. (Pathfinder needs 2+; Airborne auto-passes.)
- [ ] A drop **above 6"** warns it can't be jumped; the model falls (Falling damage, activation ends).
- [ ] **(known bug, plan PR 1/3)** A move can never end with the model hanging in mid-air (it stays at the edge if it can't finish).
- [ ] Climbing (ladders, stairs) still costs its full length; Difficult Terrain caps still apply.
- [ ] **Gap jumps** use the same test as drops: a horizontal gap of 1" or less is regular movement; 1-6" needs X+1 dice (1 die under 3", 2 from 3"), all 3+ (Pathfinder 2+, Airborne auto-passes); a failed jump falls into the gap (Falling damage if from 3"+ up, activation ends); a gap over 6" shows GAP TOO WIDE and the host rejects the move.
- [ ] Walking from a platform onto a flush catwalk (and across to the next platform) shows **no** gap warning; only real open air between decks does.
- [ ] **Dice log:** every jump, fall and dangerous-terrain roll appears in the Dice panel ("Movement hazards", with the rolled dice coloured pass/fail) and in the action log line ("moved X — Jump down 4.0" ... landed"). A move with no hazards shows nothing extra.

## 5. Low cover & scatter
- [ ] Shipping Container (2.25"): blocks sight and movement; its flat roof is a walkable floor reached by ladder/stairs **(ladder climb is a known bug, plan PR 1)**; you can stack pieces on it.

## 6. Squads
- All items verified 2026-11-02.

## 7. Movement, rush and shooting
- All items verified 2026-11-02.
- [ ] A 0-wound attack shows a "0" digit in the same style and size as the 1-5 digits (neutral grey rather than red), floating over the target.

## 8. Melee & objectives
- All items verified 2026-11-02.

## 9. Multiplayer & custom maps
- All items verified 2026-11-02.
