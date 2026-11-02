# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Items the project owner already verified and retired: the whole terrain-structure checklist (movement, manned-port LoS, doorway cover, F9 boxes, grid/segmented-wall retest) and the Phase 13.5 combat/squad/ramp/ladder checks as of the playtests on 2026-10/11. They are kept below only where the rules have since changed and need a fresh look.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- [ ] Lobby → **Map Builder** opens the editor with the 3D grid; orbit (left-drag), pan (right-drag) and zoom (wheel) work.
- [ ] Palette categories show their pieces: Structures (L-Corner Ruin, Column), Walls & Doors (2", 4", 6" walls, Window Wall, Doorway Wall), Platforms & Decks, Stairs & Ladders, Cover & Pipes, Objectives. Categories with no pieces are hidden.
- [ ] Clicking a piece enters placement mode (highlighted); clicking the board places it, snapped to the grid setting (1.0" / 0.5" / Free).
- [ ] Hotkeys on a selected piece: **R** rotates 90°, **E** / **Q** raise/lower 0.5" (ground is the minimum), **Ctrl+D** duplicates, **Delete/Backspace** removes, **Esc** deselects.
- [ ] Property inspector shows name, ID, position and rotation; nudge buttons move by the grid step; the cover / blocks-LoS / obstacle / walkable toggles work.
- [ ] Objectives: **Objective Beacon** places a 3.0" control ring; **Auto Obj** places 4 balanced objectives; the validation badge shows ✓ Ready or ⚠️ notices (advisory only).
- [ ] Save / Export JSON / Clear / Import JSON round-trips a map; saved maps reload from the load menu. (Built-in presets no longer exist.)
- [ ] **Stacking:** a Barricade, Crate or wall dropped on a deck top sits exactly on it (3.0") and does not become a floor itself. Clicking the ruin ledge or a container roof also stacks at the right height; clicking the courtyard floor places at ground level.
- [ ] **Ladder snapping:** a Ladder placed near a deck/catwalk/ledge/container face snaps onto that face, facing it, tall enough to reach the top. Far from any floor it stays where placed.
- [ ] **Stairs snapping:** Stairs placed near a deck face snap so the top end meets the face and they climb toward the deck (the rendered wedge, F9 wireframe and pathing all agree, whichever side the deck is on).

## 2. Terrain structure (walls, windows, doors, ruin)
- [ ] Across the open ruin courtyard, shots are clear (no phantom wall block). *(carried over, not yet checked)*
- [ ] Low crates: cover only to a defender within 1" behind them, never to an open target downrange. *(carried over, not yet checked)*
- [ ] Meshes still line up with the F9 per-box wireframes for walls, windows, doorways and the ruin.

## 3. Elevation, ladders, stairs
- [ ] **Clicking** the top of a platform, catwalk, ruin ledge or container roof picks that floor height (3.0" / 2.25"), even on older saved maps. Hovering or clicking a pillar, wall side or the underside of a deck picks the ground (the cursor never floats in mid-air).
- [ ] Platforms (4×4 / 6×4) stand on corner pillars; models walk under the deck and under a catwalk; pillars block movement and sight.
- [ ] A model reaches a deck by stairs (continuous slope; can stop part-way) or by ladder (must reach the top; stops at the foot if the budget can't finish; never hangs on the rungs).
- [ ] **Ladder path:** the move preview walks to the ladder foot, climbs straight up the ladder's centre line to the head, then continues. Same going down. No slanted line beside the ladder.
- [ ] A model on the deck walks across it; a barricade stacked on the deck blocks movement through it.
- [ ] The ruin's 3.0" ledge is walkable along the north and west walls; the courtyard below stays walkable; ruin walls are 4" tall.
- [ ] Platform ↔ catwalk touching: stepping across is free; a gap of more than 1" needs a jump.
- [ ] **Elevation line of sight (F9):** a close ground shooter cannot see a model standing back from a deck edge, but a distant one can (the angle clears the edge); an elevated shooter sees far ground targets but not a model hugging the base of the deck.
- [ ] Walkable floors are purple in F9; the shooting ray rises/falls smoothly from the shooter's eye to the target (not one flat plane).

## 4. Drops, jumps and movement cost
- [ ] Stepping off a ledge of **3" or less** is regular movement: no test, no warning, and it costs only the horizontal distance walked.
- [ ] Dropping **3–6"**: the move preview warns **JUMP DOWN: roll 2 dice (3 for 6"), all 3+**; success lands with no damage and the activation continues; any failure falls: Falling damage and the activation ends. (Pathfinder needs 2+; Airborne auto-passes.)
- [ ] A drop **above 6"** warns it can't be jumped; the model falls (Falling damage, activation ends).
- [ ] A move can never end with the model hanging in mid-air (it stays at the edge if it can't finish).
- [ ] Climbing (ladders, stairs) still costs its full length; Difficult Terrain caps still apply.
- [ ] **Gap jumps** use the same test as drops: a horizontal gap of 1" or less is regular movement; 1-6" needs X+1 dice (1 die under 3", 2 from 3"), all 3+ (Pathfinder 2+, Airborne auto-passes); a failed jump falls into the gap (Falling damage if from 3"+ up, activation ends); a gap over 6" shows GAP TOO WIDE and the host rejects the move.
- [ ] Walking from a platform onto a flush catwalk (and across to the next platform) shows **no** gap warning; only real open air between decks does.
- [ ] **Dice log:** every jump, fall and dangerous-terrain roll appears in the Dice panel ("Movement hazards", with the rolled dice coloured pass/fail) and in the action log line ("moved X — Jump down 4.0" ... landed"). A move with no hazards shows nothing extra.

## 5. Low cover & scatter
- [ ] Barricade (0.5"), Crate (0.75") and Pipe (0.75"): you can see over them; they block movement; they give +1 Defense only to a defender within 1" behind them.
- [ ] Shipping Container (2.25"): blocks sight and movement; its flat roof is a walkable floor reached by ladder/stairs; you can stack pieces on it.
- [ ] A crate's collision footprint matches its visual size (1"×1"): units stop at its edge, not inside it.

## 6. Squads
- [ ] Squad roster and DataCard show model counts (`Models: 4/4`).
- [ ] Move/Rush on a squad shows model chips; clicking a chip or a model figurine selects which model to place next, in any order; staged models can be re-picked and repositioned.
- [ ] Coherency: every model within 1" of at least one other and within 6" of all others (two buddy pairs 4" apart is fine); violations toast the reason.
- [ ] After shooting, every model in the squad turns to face the target.
- [ ] Squad models can't be placed on top of each other and each has its own base ring/wireframe.

## 7. Movement, rush and shooting
- [ ] Hovering **Rush** shows the full 2×speed ring in amber; **Move** shows the speed ring.
- [ ] Incremental moves: a short move leaves the remaining budget on the card and ring; shooting ends the movement window.
- [ ] A unit with two ranged weapons shows two concentric range rings and separate weapon chips; allocating each weapon to a different target rolls and resolves each independently.
- [ ] A rush that would end in a climb or difficult terrain stops at the base instead of snapping back.

## 8. Melee & objectives
- [ ] Destroying an enemy in a charge offers a 3.0" consolidation move (confirm or stay).
- [ ] Objectives use a 3.0" horizontal radius and a vertical cylinder: a model on a rooftop more than 3" above a ground objective doesn't capture or contest it.

## 9. Multiplayer & custom maps
- [ ] Host selects a saved custom map, creates a room; the waiting card names the map. Guest joins with the code.
- [ ] Both windows render the identical terrain and objectives; deploying, moving, cover, ladders/stairs and objective control work on the custom map; LoS matches on both clients.
- [ ] Refreshing the Guest and clicking **Resume Match** reconnects within the grace window and restores the full custom battlefield.
