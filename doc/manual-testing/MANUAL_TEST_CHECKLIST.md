# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, the 1C/1D pass on 2026-11-04, the batch 1I pass on 2026-11-05, the 13.6E pass (area terrain, Standard Battlefield) and the rush-past-rubble / activation hazard / squad charge ring retests on 2026-11-09, the 14A concede/results pass the same day, the 14B rematch pass on 2026-11-10, and the 14C-2 passes the same day (jumps and group crossing, push, keep-away in 3D, flying indicator, squad follow-through, dangerous terrain dice), the 14C-2 PR 7/7B special rules pass on 2026-11-11 (Fast/Slow, Impact, Counter, Assault, Shred, dangerous terrain wording, activation casualty pick), and the 14C-2 PR 8 + 9 setup pass on 2026-11-11 (objective placement and roll-offs, Scout and Ambush steps, map editor objectives removed) and the PR 9B retest the same day (reserve units, objectives without deployment, Fear wording), and the PR 10 Blast split pass the same day, and the 14C-3 PR 1G / 1H pass (grouped model headings, wound order in squads) on 2026-11-11, and the 14C-3 PR 2 / 2B pass (Orc Marauders, Bad Shot, Ferocious, two-army lobby) on 2026-11-12; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

**How to use:** tick items as you check them. When a sub-phase changes behaviour, update or add the matching item here (don't create a new per-phase file). When a change alters what a screen, panel or prompt looks like, also re-take its screenshots in the UI inventory (`doc/ux/inventory/index.html`, see `doc/ux/README.md`).

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
- [ ] **Dangerous terrain highlight during move planning (14G).** Setup: built-in map hazard-range with the dev-mode army test-hazard-army. Select the 5-model waders squad and click Advance or Rush. Plan a path crossing hazard pool A: verify pool A is outlined with a pulsing hazard lime border, matching the "Dangerous terrain: 5 dice, each 1 is a wound" note. Plan a path avoiding the pool: verify the outline disappears. Cancel or Confirm the move: verify the outline clears.
- [ ] **Flying units immune to hazard highlight (14G).** Setup: built-in map hazard-range with the dev-mode army test-hazard-army. Select the Flying squad and plan an Advance or Rush crossing a hazard pool: verify no hazard outline is drawn and no dangerous terrain note appears.
- [ ] **Dangerous terrain hover highlight and label (14G).** Setup: built-in map hazard-range with the dev-mode army test-hazard-army. Hover the cursor over a hazard pool at rest (no move being planned, outside F9): verify it pulses in hazard lime and displays a floating label "Hazard pool · dangerous: roll per wound, each 1 is a wound". Move the pointer away: verify the highlight and label clear. Hover non-dangerous terrain or clear ground: verify no highlight or label appears.

## 8. Melee, objectives & setup
- All items verified.

## 9. Multiplayer & custom maps
- All earlier items verified. Verified items removed (owner pass, 2026-11-12): build stamp, new-version banner, no banner in a game, and the four wake-up indicator checks; later the same day the bugfix 2A checks (resume after a reload, occupied seat refused).
- [ ] **Visual animations and reduced motion (15D).** Setup: Start a 2-player match (`npm run dev`, two windows). Perform an Advance, Rush, or Charge move with a single-model unit or multi-model squad: verify both windows show the models gliding smoothly along their movement path over ~0.4s (ease in-out) rather than teleporting. Shoot an enemy unit so a surviving model takes wounds: verify the wounded model flashes a red tint for ~0.25s before returning to its normal team color. Destroy an enemy model: verify the removed model sinks 0.3" and fades out over 0.4s before being removed from the scene. Submit actions in quick succession: verify game state and HUD update immediately with no lag in input, and any mid-flight tween snaps to its target position without stalling subsequent moves. Enable 'prefers-reduced-motion' in the browser or OS: verify moves, casualties, and hits snap instantaneously as before without easing or delays.

- [ ] **Host reconnects after leaving (open bug, owner pass 2026-11-12).** After a finished match the host left, then tried to reconnect to the room and couldn't. Probably finding G-09 (joining a room as host never starts the WebRTC offer, batch 2D); confirm with exact steps and fix in 2D. The other ticked checks from this pass were removed: 2A, how-to-play, cleanup (G-26, G-32), sounds, labels and HTML map names.

## 10. Armies and faction rules (14C-3)
- Verified items removed (owner pass, 2026-11-11): Repel Ambushers, Hold the Line, loadout counts, Blast on the launcher only, two-weapon melee and strike-back, HDF list, squad-mates don't block sight, which model has which weapon, Deadly first, per-model weapon sub-headings in the data card (PR 1F). Follow-up from the PR 1F pass: identical models share one sub-heading, each model shows its wounds, and the hover line in the card header goes (plan PR 1G).

- Verified items removed (owner pass, 2026-11-11, later the same day): grouped model headings and per-model wounds in the data card (PR 1G), ordered wound assignment with the locked wounded model, Deadly, timeout, Tough 1 unchanged and the melee pause (PR 1H, Decision 3g).


- Verified items removed (owner pass, 2026-11-12, evening): the 14G polish checks (dashed side-coloured Hero aura, Blast outline and sharing ring, Hero ring vs objectives). Follow-ups from that pass: aura labels float and face the camera instead of lying flat, overlapping labels stack instead of covering each other (also the per-weapon aim-line labels), and the Blast outline shows when the weapon that would fire is a Blast weapon even if it isn't the first weapon (Grenade Launcher on the Veterans).

- Verified items removed (owner pass, 2026-11-12, later): every 14G distance-indicator check (badges, 9" and 6" rings, HDF cases, Hero aura, Blast outline, nothing floating elsewhere). Follow-ups from that pass (aura style and label, Blast sharing mark) are plan `doc/plans/14G-indicator-polish.md`.

- Verified items removed (owner pass, 2026-11-12): the Orc Marauders list and data cards, Bad Shot, Ferocious when shooting and charging, Heavy Flamer-Mod Limited, Orc Biker Fast (PR 2), and the two-army pickers with the HDF vs Orc Marauders default (PR 2B).


