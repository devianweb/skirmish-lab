# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, and the 1C/1D pass on 2026-11-04; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- [ ] Coherency is one chain (batch 1I PR 28): stage a 4-model squad move as two separate pairs about 3" apart (inside the 6" spread): placing the last model is refused with "Squad is split into 2 groups". Bring the pairs within 1" (edge to edge) of each other so they form a line: accepted. A link across levels (up to 3") still counts.
- [ ] Squad jump preview (retest after batch 1I PR 27): while placing a squad model at a deck edge, hovering across a 2-5" gap (or a 3-6" drop) shows the same red jump path, floating label and jump chip as a single model does, before you click. (Before the fix the jump only appeared after the click.)
- [ ] Too-wide gap hint (batch 1I PR 27): with a single model and with a squad model at a deck edge, hover across a gap of more than 6" to a deck: the chip reads "Too far to jump (N\", max 6\")" and no jump path is shown; clicking does not declare a jump. A 5" gap still shows the normal jump chip.
- [ ] Aim lines follow the clicked model (batch 1I PR 27): select Shoot with a squad and hover/click a far model of the enemy squad that your models can see: their aim lines go to that model (a model that cannot see or reach it keeps aiming at its nearest visible model); the "N of M models can fire" count and cover are the same as without the click.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- All items verified.

## 9. Multiplayer & custom maps
- All items verified.
