# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04, and a partial 1C/1D pass on 2026-11-04; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- [ ] **TEST squad army:** in the lobby, "TEST: Single Squad (4 models, speed 12")" is selectable for host and guest; each side gets one 4-model squad (Advance 12", Rush 24").
- [ ] Squad jumps: with a 3+ model squad on a deck, start a Move and place a model at the deck edge next to a 2-5" gap edge to edge (or a 3-6" drop). The jump is measured spot to spot (about gap + 1"), so a gap wider than about 5" is never offered (nothing appears when you hover across it). Placing it across the gap shows that model's jump chip (toast and confirm summary "Model N: Jump gap ..."); the other models walk normally. Confirm: only that model rolls (the dice panel/log say "Model N"). Pass: everyone is placed and the squad can still shoot after a Move. Fail: only that model is removed, it lands below, and the activation ends. With one model left, a failed jump takes the normal falling damage instead. A drop over 6" for one squad model removes that model (not the first one in the list).
- [ ] Out of coherency at activation: a squad that has been split by casualties (models more than 1" apart) shows "Squad is out of coherency..." with Hold disabled; Move/Rush back together works, then Shoot is available; trying End Activation before moving is refused.

## 7. Movement, rush and shooting
- All items verified.

## 8. Melee & objectives
- [ ] Charging a squad: you can charge when ANY of its models is within reach, even if the squad's middle is further than 12" (the path ends in contact with the closest model). The charge is refused if a different unit is within 1" of the finishing spot, and a charge cannot pass through one of the target's models.
- [ ] Who strikes: charge or fight with a squad and read the dice summary. Only models whose bases are within 2" of an enemy model add attacks (a 4-model squad with 2 models in the fray rolls 2 models' worth), same for the defenders' strike-back. A lone fighter always rolls its full attacks.
- [ ] After a charge, defending squad models that were not touching walk up to 3" into contact with the charger (they never stack on a friend and the squad stays together).
- [ ] Charges still finish in base contact and the fight is allowed; a normal move or rush that would end with the base edge within 0.5" of an enemy is refused (the move preview shows the contact styling at the same spot).
- [ ] Split charge (single model): put a fighter on a platform edge with an enemy on a deck across a gap and press Charge, then click the enemy. The prompt offers to declare the charge (a charge you can reach in one safe path still goes straight to Confirm). After declaring, the bar reads "Charge declared on ...: N" left" with an **End (no melee)** button and no Cancel; the red range ring is the budget left. Walk a leg to the edge, hover across the gap (jump chip), confirm the jump: pass = no movement spent, then click the enemy to make contact and melee resolves; fail = the fighter falls, the activation ends and there is no melee. Running out of budget, or End (no melee), ends the activation with no melee. Legs refuse to come within 1" of any other enemy (or friend), and you cannot Move/Rush/Shoot after declaring.
- [ ] Per-model squad charge: with a 3+ model squad press Charge and click an enemy unit. The prompt declares the charge; after Confirm the bar asks for Model 1 of N. Click a spot to place each model, or click the target to move the selected model into base contact; the chips mark placed models. Models that cannot reach still move closer and are accepted as long as the squad stays in coherency; a placement that breaks coherency or goes through a model is refused with a toast. When a placed model touches the target the confirmation reads "charges ... N of M models within 2" strike"; otherwise it is a "Charge leg" and the remaining budget is shown. **Confirm charge** early leaves unplaced models where they stand.
- [ ] After a squad charge: only the models within 2" of an enemy strike (check the dice count), the defenders not touching pile in up to 3", and if both units survive every charging model steps back to a clear 1" gap from every enemy model (no model left touching, none inside terrain, the squad still together).
- [ ] Squad charge in legs with a jump: declare, walk part of the squad to an edge, have one model declare the jump chip and the others walk; only that model rolls jump dice (failed = that model falls, the activation ends, no melee).

## 9. Multiplayer & custom maps
- All items verified.
