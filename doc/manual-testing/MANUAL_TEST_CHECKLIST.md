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
- All items verified.

## 8. Melee, objectives & setup
- All items verified.

## 9. Multiplayer & custom maps
- All earlier items verified.
- [ ] **Build stamp (14G).** Setup: the deployed site after a release, no army or map needed. The lobby footer shows `Build <hash> · <time> UTC` under the disclaimer, and the hash matches the release's commit on GitHub. On a local dev server it reads `Build dev`, and the browser console shows the same line once at start-up.
- [ ] **New-version banner (14G).** Keep a lobby tab open, deploy a new release, then return to the lobby (or reload from cache): a banner "A newer version of SkirmishLab is available." appears with Reload; Reload brings the new build, the banner is gone and the stamp shows the new hash. A dev server never shows the banner.
- [ ] **No banner in a game (14G).** Start a match from a tab that is behind the deployed build: no banner or reload prompt appears during play.

## 10. Armies and faction rules (14C-3)
- Verified items removed (owner pass, 2026-11-11): Repel Ambushers, Hold the Line, loadout counts, Blast on the launcher only, two-weapon melee and strike-back, HDF list, squad-mates don't block sight, which model has which weapon, Deadly first, per-model weapon sub-headings in the data card (PR 1F). Follow-up from the PR 1F pass: identical models share one sub-heading, each model shows its wounds, and the hover line in the card header goes (plan PR 1G).

- Verified items removed (owner pass, 2026-11-11, later the same day): grouped model headings and per-model wounds in the data card (PR 1G), ordered wound assignment with the locked wounded model, Deadly, timeout, Tough 1 unchanged and the melee pause (PR 1H, Decision 3g).

- [ ] **Distance badge and 9" ring when shooting (14G).** Setup: Orc Marauders (host) vs Human Defense Force (guest), Standard Battlefield. Aim the Orc Leader's Carbine at an HDF unit more than 9" away: the badge above it reads the distance, `Ferocious ✓ (beyond 9")` and `Hold the Line +1 morale (beyond 9")`; from within 9" both read `✗ (needs beyond 9")` and are dim. The shooting fan has a dashed ring labelled `9": Ferocious`.
- [ ] **Badges on each assigned target (14G).** Assign the Carbine to one HDF unit and the Heavy Flamer-Mod to another: both targets carry a badge.
- [ ] **Charge badge and 6" ring (14G).** Choose Charge with the Orc Leader: the charge fan has a dashed `6": Ferocious` ring; hovering a target over 6" away shows `Ferocious ✓ (beyond 6")`.
- [ ] **HDF badge cases (14G).** As HDF, aim at the Orc Veteran: the badge shows the distance only. Aim at the Orc Infiltrator from more than 9": `Stealth −1 to hit (beyond 9")`. The HDF fan has no dashed ring.
- [ ] **Hero aura (14G).** Select an HDF unit near the Company Leader: a gold 6" ring around the Leader, bright when the unit is within 6", faint when not.
- [ ] **Blast outline (14G).** Aim the Heavy Flamer-Mod at a unit with another HDF unit close by: orange 3" outlines around the target's models and the nearby unit wears the dark red target ring (shares the hits).
- [ ] **No floating badges elsewhere (14G).** Nothing floats over the board in Fight, setup placement or the opponent's turn (apart from the Hero aura on select/hover); badges never block clicking the units under them.

- Verified items removed (owner pass, 2026-11-12): the Orc Marauders list and data cards, Bad Shot, Ferocious when shooting and charging, Heavy Flamer-Mod Limited, Orc Biker Fast (PR 2), and the two-army pickers with the HDF vs Orc Marauders default (PR 2B).
