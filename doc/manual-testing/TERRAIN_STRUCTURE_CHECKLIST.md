# Terrain Structure (Solids + Apertures) Playtest Checklist

**Scope:** 13.6C-0 — walls, window walls, doorway walls, columns and the L-corner ruin now share one solids + apertures structure; line of sight is traced in 3D from a 1.1" eye to any visible part of the target.

**Setup:** open the map builder (or a custom map) and place: a Solid Wall, a Window Wall, a Doorway Wall, a Column and an L-Corner Ruin with a few low crates. Press **F9** in game for the debugger.

## Movement
- [x] A model can walk into the L-corner ruin courtyard from the open south/east sides.
- [x] A model cannot walk through the ruin's north or west walls, or through a window (the sill blocks).
- [x] A model can walk through a doorway (1.4" opening) but not through the jambs.

## Line of sight (use F9 to confirm)
- [x] Shooting through a window from a model with its base within 1" of the window works; the same shot from further away is blocked.
- [x] The same applies at the L-corner ruin's windows (north and west).
- [x] The F9 ray starts at eye height (about 1.1") and the aperture (green box) is where the ray passes.
- [x] A target half-hidden under a doorway lintel is still visible if any part (feet/torso) is visible.
- [ ] Across the open ruin courtyard, shots are clear (no phantom wall block).
- Feedback: Can't test at this stage.
- [x] The LoS fan does not get shadowed by a doorway lintel; doorway gaps stay open.

## Cover
- [x] A defender manning a window port that the shot passes through gets +1 Defense.
- [x] Standing in a doorway gives no cover by itself; standing tucked behind a jamb does.
- [x] A model deep inside the ruin courtyard (far from any wall) gets no wall cover.
- [ ] Low crates still follow the old rule (cover only within 1" behind them).

## Visuals / F9 wireframes
- [x] Window, doorway and ruin meshes line up exactly with the F9 per-box wireframes (cyan solids, green apertures).
- Feedback: The longer wall seems to have slight gaps between the panels? Should we not have a 2" wall component that can be used to make 4" / 6" etc walls?
  - Addressed: new 2" wall component (`wall-short`); 4" = 2 flush segments, 6" = 3 (see retest section).
- [x] The L-corner ruin has no second-floor ledge any more (it returns with 13.6C).

## Retest after grid compliance & segmented walls (13.6C-1)
- [x] Solid walls of 2", 4" and 6" show no gaps between panels, and the collision/F9 boxes match the segments.
- [x] Place several 2" wall components end to end: they form a continuous wall (movement and LoS blocked along the whole length).
- [x] Doorway opening is now 1.5" wide (2.25" tall); a model still walks through it, and the jambs still block.
- [x] Window port is now 2.5" wide (sill 1.0", lintel from 2.25"); manned shots through it still work.
- [x] L-corner ruin is now 4" tall (sill 1.0", ports 1.0"-2.25"); movement into the courtyard and manned-port shots still work.
- [x] Walls, window walls and doorway walls are 0.25" thick; columns are 1.25" square.
