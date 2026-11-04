# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, and batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- [ ] Barricades, crates and pipes (1" tall or less) are stepped over: a move straight across one has no detour and costs only the straight-line distance, also for a barricade stacked on a deck. A move that would stop on or inside one is pulled back to just before it (or rejected). Walls, columns and the container still block. Cover from a low piece (+1 within 1" behind it) and sight over it are unchanged.

## 6. Squads
- [ ] Split-level coherency: move a squad so some models stay on a deck and others drop below. Placement is accepted up to about 3" apart edge to edge, but refused (toast mentions the 3" allowance) beyond that; two models on the same level still need to be within 1" of a squadmate.

## 7. Movement, rush and shooting
- [ ] Base-edge measuring: select a shooter and open the Shoot range ring. The ring is drawn one base radius (0.5") outside the weapon range from the model centre. An enemy whose base edge just touches the inside of the ring (centre up to 25.0" from the shooter for a 24" rifle) can be shot and is outlined as reachable; at a centre distance of 25.1" you get "Out of range".
- [ ] Deployment keeps enemy bases more than 1" apart edge to edge (centre 2.1" away works, 1.9" is refused).
- [ ] Squad shooting (per model): shoot a multi-model squad that is partly behind a wall or barricade. The shot is accepted when any one of your models can see and reach any one of theirs (even if the squad's middle is hidden), is refused when every target model is hidden, and the dice summary counts attacks only for your models that can see and reach (a shooter model with a wall in front of it adds none). Your own squad-mates never block your sight; another unit standing in the line does. Cover (+1 Defense) shows only when most target models are behind cover (3 of 4 yes, 2 of 4 no).

## 8. Melee & objectives
- [ ] Objective capture matches base-edge measuring: a model whose base edge just touches the 3" objective ring (centre about 3.4" from the marker) captures it at end of round; a model clearly outside (centre 3.6" or more) does not. The ring itself is still drawn at 3" around the marker.
- [ ] Charges still finish in base contact and the fight is allowed; a normal move or rush that would end with the base edge within 0.5" of an enemy is refused (the move preview shows the contact styling at the same spot).

## 9. Multiplayer & custom maps
- All items verified.
