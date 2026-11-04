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

- [ ] Regrouping a split squad (batch 1I PR 29): split a squad (remove the middle model of five, or make a model fall away) so it starts its next activation out of coherency. Hold and Shoot are disabled with the "out of coherency" hint. Advance the stray as far as it can go: the move is accepted even though it is still apart (it ended closer), and a placement that leaves it no closer is refused with a toast. After that Advance the squad can shoot. A squad that started coherent still cannot end a move apart.
- [ ] Per-model distance across legs (batch 1I PR 30): Advance a squad in two legs, moving different models each time (e.g. leg 1 moves only the front models by their full 6", leg 2 moves the rear models). Each model can use its full distance, a model that already used all its distance is refused if moved again (even though a squad-mate can still move), and when you pick a model the ring and the bar ("within N\"") show that model's own distance left. Repeat with a Rush and with a declared squad charge in legs: a model that walked furthest in one leg does not stop a squad-mate from using its own leftover to reach contact.
- [ ] Failed squad jump stops the later jumpers (batch 1I PR 31): declare jumps for two models of a squad at a deck edge (the other models walk). If the first jump fails (it falls and is lost, the activation ends) the second model stays at its edge spot instead of landing across the gap, the walking models still reach their spots, and the log reads "Model N: jump not attempted (activation ended)". If the first jump passes and the second fails, both resolve as rolled. Try it once as a rush.
- [ ] Distance left on split moves (batch 1I PR 30): with a single model, make a second Advance leg or a second Rush leg: the bar reads "... — N.N\" left" and the ring matches.
- [ ] Squad chargers get as close as they can (batch 1I PR 32): declare a charge with a squad of 3 or more and place only one model in base contact, then Confirm charge: the unplaced models move up automatically (named "moved up as close as they can" in the confirmation) into contact or as near as the route and coherency allow; the host accepts it. Then try placing a second model well short of the target with open ground ahead: the toast reads "Model N could get closer to the target". A model that could only get nearer by jumping is not forced to (it may stay at the edge). The defenders place their own pile-in (see section 8).

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- [ ] Defender pile-in (batch 1I PR 34): charge a squad with a squad so only some defenders touch. The defender gets a "Pile in" prompt with a countdown (the charger sees "Waiting for <name> to pile in" and cannot act). Only the models not in contact can be picked; picking one shows a 3" ring and hover path. **Auto place** moves the others into contact or as close as they can; you can then pick any of them and click a different spot within 3" instead. Placing a model too far short of its best spot, or breaking coherency, shows the host's reason as a toast on Confirm and sends nothing. After **Confirm** the attacks are rolled from the new positions. Letting the timer run out, or pressing "Let the host place them", piles in automatically.

## 9. Multiplayer & custom maps
- All items verified.
