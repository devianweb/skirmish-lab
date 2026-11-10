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
- [ ] **Group jump next to another unit.** With "Test Jumpers" on deck A and "Test Striders" (or any friendly model) standing on the far deck, click a landing within 1" of that model: the hover chip turns red ("Cannot jump there: Models cannot come within 1" of another unit ...") and the click is refused with the same toast, instead of staging four models that the host rejects at Confirm. Click a landing 2" or more clear of it: the carried models are placed on spots that also keep 1" clear, and Confirm is accepted.

- [ ] **Rush up your own stairs as the guest and as the host (pathing bugfix).** Developer mode, "TEST: Jump Check" both sides, map Jump Range. As the **guest**, Rush "Test Striders" from near the foot of a stairs (e.g. x 9, z 16): pick Model 1 and hover the deck top: the preview climbs the stairs and ends on the deck. Repeat as the **host** at the mirrored spot (x -9, z -16).
- [ ] **A unit at the foot of the stairs closes the way, and says so.** Park another friendly unit (e.g. "Test Jumpers") at the foot of the stairs, then Rush a squad model toward the deck top: the preview does not draw a path through the stairs, and the note reads "Blocked by another unit..." (not "Can't reach that height"). Clicking the spot gives the same reason. Move the other unit 2" aside and the climb works again.
- [ ] **Flying squad flies straight (pathing bugfix).** With "Test Flyers", pick a model on the ground near the stairs and hover the top of a deck: the preview is one straight line from the model to the spot (no detour to another deck or the stairs). Flying over another unit's models is allowed, but a spot within 1" of any of them is refused. A far spot is cut off at the model's remaining move.

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- [ ] **Keep-away zones:** click Advance (then Rush, a declared Charge incl. later legs, a squad model pick after the leader's jump, a push and a pile-in): red translucent discs with a ring appear round every model of other units near you (friends too), the legend "Red rings: 1" zone around other units..." shows, and they vanish on Confirm/Cancel. A destination just outside a disc is accepted, just inside is refused/stops short; the disc edge matches where the path detours. During a charge the target's discs are green, not red. A model on another deck/tier more than ~1.8" away in height shows a very faint disc. No visible lag while moving the mouse.
- All items verified.

## 8. Melee & objectives
- All earlier items verified.

## 9. Multiplayer & custom maps
- All items verified.
