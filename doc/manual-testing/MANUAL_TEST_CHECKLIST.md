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
- All items verified except the squad follow-the-leader jumps below (14C-2 PR 4B). Setup for all of them: press F9 in the lobby (Developer mode), pick the army **TEST: Jump Check (squad, Strider squad, Flying squad)** for both players and the built-in map **Jump Range**. Deploy "Test Jumpers" near the stairs at x -9, z -12 (host side), then walk it up the stairs onto the first 3" deck (deck A, x -11..-7, z -10..-2).
- [ ] **Group gap jump.** With "Test Jumpers" on deck A, move one model to deck A's east edge (x about -7.5) so it is the only one at the edge, then click the far side on deck B (x about -4.5, a 2" gap). The other three models should snap into the preview and be staged automatically (toast: "Models 2, 3, 4 follow across (one roll for the squad)"), each at its own spot along the edge. Confirm: one jump roll (2 dice+) in the dice panel, all four models land on deck B, and the activation continues.
- [ ] **Failed group jump.** Repeat until a roll fails (or use a larger gap: deck B east edge x -1.5 to deck C x 3.5, a 4" gap, about 5 dice). The model you declared the jump with falls to the ground (fall dice shown); the other three stay standing at their edge spots on the deck; the activation ends.
- [ ] **A model that cannot reach the edge.** Rush "Test Jumpers" first (leave one model about 5" of its move used), then declare the jump: that model's chip turns red with a cross and a tooltip explaining why, and the squad is not split silently. Confirming with the squad split across the gap is refused with a message naming the model.
- [ ] **Drop.** Walk "Test Jumpers" up the ladder on the tall deck (x -20, z -6; the ladder is on its west face) and jump down from its east edge (x about -16): the 4.5" drop rolls about 5 dice for the group; the followers drop with the leader.
- [ ] **Strider and Flying.** Repeat the 4" gap with "Test Striders" (half the dice, rounded up) and with "Test Flyers" (no jump option appears and nothing is rolled).
- [ ] **Charge leg.** Put an enemy squad on deck C and declare a charge from deck B across the 4" gap; the leg carries all models across with one roll.

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- All earlier items verified.

## 9. Multiplayer & custom maps
- All items verified.
