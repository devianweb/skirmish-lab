# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, and batches 1B/1E on 2026-11-03; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- [ ] Climb onto the ruin ledge (or any deck) from the ground, with the cursor on or just past the lip: the preview says "climb 3.0\"" with no "gap 0.6\"", and the model ends with its whole base on the floor, never half over the edge. With too little movement left it stays at the foot of the wall instead.
- [ ] Climb from a deck onto a climbable piece stacked on it (e.g. a shipping container on a 6" deck reached by stairs): the preview says "climb 2.3\"" and the model ends on the roof; moving back to the deck is a free drop. A container stacked on another container cannot be climbed from the ground (4.5" rise) but can from the lower container's roof when part of it is exposed.
- [ ] Hover on a deck within 0.5" of its edge: the cursor snaps to a spot a full base inside the edge (the ghost base is entirely on the deck), and a jump from a deck edge is still offered.

## 4. Drops, jumps and movement cost
Movement model (batch 1E): the pathfinder only plans ordinary movement (walking, stairs, ladders, drops of 3" or less, gaps of 1" or less). Jumps and falls are never planned: the player declares them from where the model stands at an edge. The move preview styles each leg by how it is traversed: walking, stairs and ladders normal, climbs orange, safe drops amber, jumps dashed red, with a label and cost in the summary chip ("climb 2.3"", "drop 3.0"", "jump 4.9" · 2 dice"). Squads cannot declare jumps yet (the host rejects them), so jump chips are offered to single-model units only.
- [ ] A drop **above 6"** is offered from an edge (to test it, stand on the roof of a container stacked on a 6" deck (8.25") at an edge over open ground, or stack a third platform reached by stairs from a 6" deck so its top is 9") with a red chip: **Drop 7.0": too high to jump — the model will fall (falling damage, activation ends)**. Confirming it makes the model fall.

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- All items verified.

## 9. Multiplayer & custom maps
- All items verified 2026-11-02.
- [ ] **Board size:** a custom map plays on the same board size as in the map builder (44" × 30" by default): terrain near the long edges is inside the board and reachable.
- [ ] **Deployment zones (interactive deployment on):** each zone runs from your table edge to 12" from the centre line, so the two zones are 24" apart (3" deep on a 30"-deep board).
- [ ] **TEST army:** in the lobby, pick "TEST: Single Runner (speed 24")" for one or both sides: each side gets one fighter that can Advance 24" / Rush 48".
