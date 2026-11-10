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
- [ ] **Group gap jump, diagonal and corner layouts (playtest fix).** Repeat the group gap jump with the four models in a diagonal line, and with the leader at the deck corner jumping to a spot on the far deck that is not straight across. Every other model should be routed along the edge (no red cross); if one truly cannot reach, its chip tooltip says how far the edge is and how much move it has left.
- [ ] **Flying squad across a gap (playtest fix).** With "Test Flyers" on deck A, place Models 1-3 one at a time on deck B (about 5" away, over the gap), also after an earlier Advance of the same activation: every placement is accepted with no jump and no roll. A refused spot explains why (no move left, blocked, out of reach).
- [ ] **Separation never leaves a model in the air (playtest fix).** Charge a unit standing on a 3" deck with your models near the deck edge and let both survive: after the melee no model is hanging past the edge (a model that cannot step back 1" on the deck stays where it is).
- [ ] **Fall wounds stay on the faller (playtest fix).** Make a squad model fall (fail a jump down the tall deck, or push one off an edge) and check that only that model takes the fall wounds: with Tough 1, one model dies even on 3 wounds and the rest of the squad is untouched.
- [ ] **Strider and Flying.** Repeat the 4" gap with "Test Striders" (half the dice, rounded up) and with "Test Flyers" (no jump option appears and nothing is rolled).
- [ ] **Charge leg.** Put an enemy squad on deck C and declare a charge from deck B across the 4" gap; the leg carries all models across with one roll.

## 5. Low cover & scatter
- All items verified.

- Push prompt (14C-2 PR 5). Setup: press F9 in the lobby (Developer mode), pick the army **TEST: Rules Check (Hero, Blast, Indirect, multi-weapon)** for both players and the built-in map **Jump Range**. The two "Test Squad" units are Quality 6+, so they fail Morale on a 1-5. The guest walks "Test Squad A" (4 models) up the stairs onto the nearest 3" deck (the mirror of deck A: x 7..11, z 2..10; stairs at x 9, z 12), or up the ladder to the 4.5" deck (x 16..20, z 2..10; ladder on its east face) for a 5-dice fall. Then, on the host's turn, shoot that squad with "Test Squad B", the Hero and the Heavy Gunner (keep shooting over a few rounds if needed) until it has 2 models left (half strength), and end the activation. The squad fails Morale and becomes Shaken, but the attacker's push die is random (needs 4+), so it may take several tries (repeat with the other squad, or rematch).
- [ ] **Push prompt buttons.** When the push die shows 4+, the attacker's dock shows "Push" with **Auto**, **Confirm** and **Don't push** and a countdown; the other player sees "Waiting for opponent: Push". Don't push: nothing moves, the log says the push was declined, play continues. Letting the timer run out applies Auto.
- [ ] **Confirm: pick a model and a spot.** Press Confirm, click one model of the Shaken squad (or its button): an amber ring of 2" shows around it. Hover a spot: a line from the model to the spot (pulled back onto the ring if you are further), and the dock says "Push 1.5"". Click the spot, then **Push**: the model moves, only the models cut off from it step in. A spot on top of another model or inside terrain is refused with a message. **Back** returns to the buttons.
- [ ] **Push off an edge.** With the squad on the 3" deck, hover a spot 1-2" past the deck edge: the dock says it falls 3.0" (3 dice, 1-3 wound). Push it: the dice panel shows the fall dice and wounds (the log entry carries them for both players), and every other living model of the squad ends at the bottom within 1" (edge to edge) of the fallen model. Nobody's activation ends. Repeat from the 4.5" deck (5 dice).

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- All earlier items verified.

## 9. Multiplayer & custom maps
- All items verified.
- [ ] **Spawn off terrain (deployment off):** untick the deployment phase, pick the built-in map **Jump Range** and any army (e.g. TEST: Jump Check): every model starts on open ground inside its 12" zone (none inside stairs, ladders, deck legs or under a deck leg), squads keep more than 1" from each other. During a normal deployment, a squad that would put a model on stairs or a deck leg is refused ("Cannot deploy inside a terrain obstacle").
