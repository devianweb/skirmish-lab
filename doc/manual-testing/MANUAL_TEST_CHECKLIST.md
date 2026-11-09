# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, and the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

Items marked **(known bug)** have a fix planned in `doc/plans/bugfix-playtest-batch-1.md`; retest them after that PR lands.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file).

**Setup:** two browser windows (Host and Guest) against the dev server (`npm run dev`) or the deployed build. Press **F9** in game for the LoS/cover debugger (solids cyan, low cover amber, walkable floors purple, climbable floors outlined orange, firing ports green, eye-level ray).

---

## 1. Map builder & editor
- All items verified.
- [ ] **14A Concede (guest, mid-turn):** the guest clicks Concede in the header and confirms. The guest sees "Defeat" and "<guest> conceded"; the host sees "Victory" with the same reason. Both see the rounds played and a losses line per side. The guest presses Return to Lobby: the host sees "<guest> has left." and no "Opponent disconnected" banner.
- [ ] **14A Concede (host, during a reaction):** the host concedes while the guest has a reaction prompt open. Same result, mirrored; the prompt disappears.
- [ ] **14A Full game to round 4:** play to the end of round 4. The results screen shows the right winner or "Draw", the objective breakdown, rounds played and the losses lines.
- [ ] **14A Concede with no connection:** as the guest, kill the host's tab, then concede. After about 5 s the Concede button comes back and the toast "Couldn't reach your opponent; the concede wasn't sent." shows.

## 2. Terrain structure (walls, windows, doors, ruin)
- All items verified.

## 3. Elevation, ladders, stairs
- All items verified.

## 4. Drops, jumps and movement cost
- All items verified.

## 5. Low cover & scatter
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- All items verified.

## 9. Multiplayer & custom maps
- All items verified.
