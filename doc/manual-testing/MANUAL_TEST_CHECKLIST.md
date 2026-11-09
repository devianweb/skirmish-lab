# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, and the 14A concede/results pass the same day; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- All items verified.

## 6. Squads
- All items verified.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- [ ] **Abandon charge button (squad charge):** declare a charge with a squad. While placing models, the highlighted button is **Confirm charge** (once a model is placed); abandoning is a plain, non-highlighted **Abandon charge** button. Placing models into contact and confirming resolves the melee; Abandon charge asks to confirm and then ends the activation with no melee.

## 9. Multiplayer & custom maps
- [ ] **Toast under the banner (retest after the 14A feedback fix):** as the guest, kill the host's tab and concede. After about 5 s the "Couldn't reach your opponent" toast shows **below** the "Opponent disconnected" banner, fully readable.
- [ ] **Rematch (14B):** play to the end or concede, then both press Play Again (try both orders). The same map, armies and starting positions come back at round 1 (or deployment) with the original starting player, a toast reads "Rematch started — same armies, same map", and there are no leftover markers, outcome tokens or log lines.
- [ ] **Rematch request:** one player presses Play Again. They see "Waiting for <name>…" (disabled); the other sees "<name> wants a rematch" and a primary Accept rematch button.
- [ ] **Rematch after leaving:** one player presses Return to Lobby. The other's button reads "Opponent has left" and is disabled.
- [ ] **Reload during a rematch:** reload the host's tab during the rematch. It resumes the rematch, not the old match.
