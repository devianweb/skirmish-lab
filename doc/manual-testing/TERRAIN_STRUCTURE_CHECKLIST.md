# Terrain Structure (Solids + Apertures) Playtest Checklist

**Scope:** 13.6C-0 — walls, window walls, doorway walls, columns and the L-corner ruin now share one solids + apertures structure; line of sight is traced in 3D from a 1.1" eye to any visible part of the target.

**Setup:** open the map builder (or a custom map) and place: a Solid Wall, a Window Wall, a Doorway Wall, a Column and an L-Corner Ruin with a few low crates. Press **F9** in game for the debugger.

## Movement
- [ ] A model can walk into the L-corner ruin courtyard from the open south/east sides.
- [ ] A model cannot walk through the ruin's north or west walls, or through a window (the sill blocks).
- [ ] A model can walk through a doorway (1.4" opening) but not through the jambs.

## Line of sight (use F9 to confirm)
- [ ] Shooting through a window from a model with its base within 1" of the window works; the same shot from further away is blocked.
- [ ] The same applies at the L-corner ruin's windows (north and west).
- [ ] The F9 ray starts at eye height (about 1.1") and the aperture (green box) is where the ray passes.
- [ ] A target half-hidden under a doorway lintel is still visible if any part (feet/torso) is visible.
- [ ] Across the open ruin courtyard, shots are clear (no phantom wall block).
- [ ] The LoS fan does not get shadowed by a doorway lintel; doorway gaps stay open.

## Cover
- [ ] A defender manning a window port that the shot passes through gets +1 Defense.
- [ ] Standing in a doorway gives no cover by itself; standing tucked behind a jamb does.
- [ ] A model deep inside the ruin courtyard (far from any wall) gets no wall cover.
- [ ] Low crates still follow the old rule (cover only within 1" behind them).

## Visuals / F9 wireframes
- [ ] Window, doorway and ruin meshes line up exactly with the F9 per-box wireframes (cyan solids, green apertures).
- [ ] The L-corner ruin has no second-floor ledge any more (it returns with 13.6C).
