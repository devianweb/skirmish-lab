# Elevation (13.6C) Playtest Checklist

**Scope:** 3.0" floor tier — platforms, catwalks, support pillars, rails/parapets, stairs, ladders, and the ruin's ledge. Elevation is now plain 3D geometry (no setback/parapet special rules).

**Setup:** in the map builder, open **Platforms & Decks** and **Stairs & Ladders**. Place a Platform (4"×4"), a Catwalk flush against it, a Stairs and a Ladder, plus an L-Corner Ruin. Press **F9** in game.

## Editor
- [ ] Platforms & Decks and Stairs & Ladders categories show their pieces.
- [ ] Clicking on a deck top and placing a Deck Railing or Parapet sits it exactly on the deck (3.0"); it doesn't turn into a floor itself.
- [ ] Placing a Ladder near a deck face snaps it onto that face, facing the deck, with its height reaching the deck top.
- [ ] A Ladder placed far from any deck stays where you put it.
- [ ] A Ladder placed in the ruin courtyard near the ledge snaps to the ledge edge.
- [ ] Clicking the ruin's ledge top places pieces at 3.0"; clicking the courtyard floor places at ground level.

## Movement
- [ ] Models walk under a platform deck and under a catwalk; the four corner pillars block.
- [ ] Models reach a deck via stairs (continuous slope, can stop part-way) and via ladder (must reach the top; can't stop on the rungs).
- [ ] A model on the deck can walk across it; rails and parapets on the deck block movement through them.
- [ ] A model can walk along the ruin's ledge (3.0") and the courtyard below it stays walkable.
- [ ] Platform ↔ catwalk touching: stepping across is free; a 3" gap needs a jump.

## Line of sight / cover (use F9)
- [ ] A ground shooter standing close cannot see a model standing back from the deck edge; a distant shooter can (the angle clears the edge).
- [ ] A model at the deck edge hit by a close ground shooter gets cover from the deck edge.
- [ ] An elevated shooter on the deck sees far ground targets but not a model hugging the base.
- [ ] A 1.0" railing is seen over (low cover within 1" behind it); a 1.5" parapet hides the model behind it.
- [ ] F9 draws floors in purple, solids cyan, ports green; pillar legs and deck match the mesh.

## Visuals
- [ ] Deck shows kick-plates around the edge and tread ridges; ladder has rails and rungs; stairs show risers and stringers.
- [ ] Ruin ledge is visible inside the north and west walls at 3.0" and ruin walls are 4" tall.
