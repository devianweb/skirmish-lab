# Manual Test Checklist (consolidated)

One living checklist for things automated tests can't prove: feel, visuals, and two-player flows. It replaces the older per-phase checklists (Phase 13 map builder, Phase 13.5 playtest, terrain structure, elevation), which were audited against the current rules and folded in here. Verified items are removed once the owner ticks them (last passes: 2026-11-02, batch 1A the same evening, and batches 1B/1E, 1F, 1H and 1G on 2026-11-03/04; which retired the map builder/editor, terrain structure, elevation picking/LoS, squads, movement & shooting, melee & objectives, and multiplayer/custom-map checks). Earlier retirements: the terrain-structure checklist and the Phase 13.5 combat/squad/ramp/ladder checks. If a later change touches a retired area, add a fresh item here.

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
- [ ] Barricades, crates and pipes (1" tall or less) are stepped over: a move straight across one has no detour and costs only the straight-line distance, also for a barricade stacked on a deck. A move that would stop on or inside one is pulled back to just before it (or rejected). Walls, columns and the container still block. Cover from a low piece (+1 within 1" behind it) and sight over it are unchanged.

## 6. Squads
- [ ] Squad jumps: with a 3+ model squad on a deck, start a Move and place a model at the deck edge next to a 2-5" gap (or a 3-6" drop). Placing it across the gap shows that model's jump chip (toast and confirm summary "Model N: Jump gap ..."); the other models walk normally. Confirm: only that model rolls (the dice panel/log say "Model N"). Pass: everyone is placed and the squad can still shoot after a Move. Fail: only that model is removed, it lands below, and the activation ends. With one model left, a failed jump takes the normal falling damage instead. A drop over 6" for one squad model removes that model (not the first one in the list).
- [ ] Confirm early: start a Move (and a Rush) with a 4-model squad, place just one model, and a **Confirm move** button appears next to Reset Placement. Clicking it summarises the move with the other models left where they were. If leaving them behind would break coherency you get a toast instead. After the move is applied, a Rush still can't shoot.
- [ ] Out of coherency at activation: a squad that has been split by casualties (models more than 1" apart) shows "Squad is out of coherency..." with Hold disabled; Move/Rush back together works, then Shoot is available; trying End Activation before moving is refused.
- [ ] Split-level coherency: move a squad so some models stay on a deck and others drop below. Placement is accepted up to about 3" apart edge to edge, but refused (toast mentions the 3" allowance) beyond that; two models on the same level still need to be within 1" of a squadmate.

## 7. Movement, rush and shooting
- [ ] Base-edge measuring: select a shooter and open the Shoot range ring. The ring is drawn one base radius (0.5") outside the weapon range from the model centre. An enemy whose base edge just touches the inside of the ring (centre up to 25.0" from the shooter for a 24" rifle) can be shot and is outlined as reachable; at a centre distance of 25.1" you get "Out of range".
- [ ] Deployment keeps enemy bases more than 1" apart edge to edge (centre 2.1" away works, 1.9" is refused).
- [ ] Squad shooting (per model): shoot a multi-model squad that is partly behind a wall or barricade. The shot is accepted when any one of your models can see and reach any one of theirs (even if the squad's middle is hidden), is refused when every target model is hidden, and the dice summary counts attacks only for your models that can see and reach (a shooter model with a wall in front of it adds none). Your own squad-mates never block your sight; another unit standing in the line does. Cover (+1 Defense) shows only when most target models are behind cover (3 of 4 yes, 2 of 4 no).
- [ ] Squad aim lines: with a multi-model squad, pick Shoot and hover an enemy squad. Each of your models draws its own orange line to the nearest enemy model it can see (not one line from the squad middle to the target middle); a model with no sight or range gets a faint red line. The enemy model under the cursor gets a yellow ring when one of your firing models can see it. A chip reads "N of M models can fire" and matches the attacks in the confirm summary. A single-model shooter shows one line and no chip. F9 on the same shot shows a ray per model, "N of M models fire" and the target-models-in-cover count (cover only when more than half are covered).

- [ ] 1" keep-away: with another unit (yours or the enemy's) in the way, plan a Move or Rush toward it. The path stops 1" (base edge to base edge) short of it, or routes around it, and a move you try to force closer than 1" is refused. A model that starts already within 1" of a friend can walk away from it. Squeezing between two units whose base edges are less than 3" apart is not possible (1" clear on each side plus the 1" base).
- [ ] Models never pass through other models: a lone enemy model standing mid-route (squad anchor far away) blocks the path and the pathfinder detours.

## 8. Melee & objectives
- [ ] Squad objective control is per model: a squad with one model's base edge within 3" of a marker captures it at end of round even if the squad's middle is far away; a squad whose models ring a marker from outside 3" does not.
- [ ] Objective capture matches base-edge measuring: a model whose base edge just touches the 3" objective ring (centre about 3.4" from the marker) captures it at end of round; a model clearly outside (centre 3.6" or more) does not. The ring itself is still drawn at 3" around the marker.
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
