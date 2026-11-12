# 3D Asset & Model Map (`client/public/models/`)

All `.glb` files and `Textures/colormap.png` in `client/public/models/` are from the **Kenney Prototype Kit** (https://kenney.nl, created 2024-08-28), distributed under the [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/) license — public domain, no attribution required.

Asset registration, scaling, and orientation live in [`client/src/renderer/assetManifest.ts`](../client/src/renderer/assetManifest.ts).

All terrain pieces are generated procedurally by [`client/src/renderer/ModelLoader.ts`](../client/src/renderer/ModelLoader.ts) at exact 1:1 wargaming scale ($1.0\text{ unit} = 1.0\text{ inch}$), ensuring absolute alignment with mathematical collision boxes, ramp physics, and F9 debug wireframes.

**Terrain structure parity:** window walls, doorway walls and the L-corner ruin are built directly from the shared solid boxes in [`shared/src/data/terrainStructures.ts`](../shared/src/data/terrainStructures.ts) (apertures/firing ports are open air and have no mesh), so the mesh, the collision and the F9 per-box wireframes are the same geometry. Cosmetic detail (bevels, rounded pipes, trim) may differ slightly from the collision boxes, like a game hitbox, but only **inside** them and by at most about 0.2" (owner, 2026-11-12); the visible shape is never bigger than the collision, and openings (windows, doors, gaps) always match exactly. Doorway openings are 1.5" wide × 2.25" tall. **Grid rule:** every height, thickness and opening at a piece's default scale is a multiple of 0.25" (guarded by `shared/tests/data/terrainStructures.test.ts`). Solid walls are built from 2" segments (`wall-short` = 1, `wall` = 2, `wall-long` = 3) with no gaps between them. The L-corner ruin's second-floor ledge is a walkable solid at 3.0" (13.6C). F9 colour legend: cyan = sight blockers, amber = low cover, purple = walkable floor, green = firing ports, orange outline = climbable floor (catalog default or per-piece `climbable` override; editor Climbable checkbox).

---

## Complete 3D Asset Inventory (`client/public/models/`)

| File Name | Size | Category | Asset Manifest Key | Description & Role |
| :--- | :---: | :--- | :--- | :--- |
| `crate-medium.glb` | 59 KB | Objective | `OBJECTIVE_ASSETS.beacon` | Central tactical objective container marker beacon. |
| `indicator-round-b.glb` | 4.5 KB | Marker | `MARKER_ASSETS.selection` / `target` | Flat circular floor beacon used for selection (blue) and enemy target (red). |
| `indicator-round-a.glb` | 6.4 KB | Marker | *(Alternate Indicator)* | Thick rim alternate circular floor marker. |
| `indicator-square-a.glb` | 2.0 KB | Marker | *(Alternate Indicator)* | Square perimeter floor marker. |
| `number-0.glb` .. `number-5.glb` | 4–7 KB | Outcome | `OUTCOME_ASSETS['outcome-N']` | 3D billboard digits (0 to 5) indicating wound damage count dealt on attack. |
| `Textures/colormap.png` | 4.0 KB | Texture | *(Shared Texture)* | Global texture palette referenced by marker materials. |

---

## 1. Fighter 3D Model Mapping (Procedural Hero Scale)

Fighters in SkirmishLab are rendered procedurally by [`client/src/renderer/ModelLoader.ts`](../client/src/renderer/ModelLoader.ts) at true **28–32mm Hero Scale** mounted on **1.0" tournament wargaming bases**. Meshes are instantiated by [`client/src/renderer/UnitRenderer.ts`](../client/src/renderer/UnitRenderer.ts).

- **Standard 1.0" Base:** $1.0"$ diameter ($25.4\text{ mm}$, radius $0.50"$) with beveled tournament lip (height $0.10"$). Base top surface is dark tournament slate (`#212529`).
- **Squad Rim Identification:** Each unit/squad receives a distinct, high-contrast base rim accent color generated deterministically from its `unit.id` via `getUnitRimColor()` in [`client/src/renderer/rimColors.ts`](../client/src/renderer/rimColors.ts).
- **Team Tinting:** Miniature body/armor dynamically tints to the player's team color (Host = Blue `#29b6f6` / `0x3a7bd5`, Guest = Red `#ef5350` / `0xd54a3a`).
- **Dimensions:** Standing height $1.12"$ above base $\implies$ **total model height $\approx 1.22"$ ($31\text{ mm}$)** with $0.72"$ shoulder span, fitting $1:1$ with terrain doorframes, window sills, and elevations.

| Role (`modelType`) | Geometry Type | Dimensions | Dev-only TEST units |
| :--- | :--- | :---: | :--- |
| **`leader`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | `test-hero`, `test-hazard-hero`, `test-loadout-leader` |
| **`trooper`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | **Test Runner** (`test-runner`, TEST army only, speed 24"), **Test Squad** (`test-squad`, 4 models, TEST squad army only, speed 12"), and the other TEST squads |
| **`specialist`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | the `test-special-*` and `test-setup-*` units |
| **`heavy`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | `test-heavy-gunner` |

The ready-made armies (Human Defense Force and Orc Marauders) map their units to these four roles below. Frontier Wardens and Rust Raiders were removed in 14C-3 PR 2B.

**Human Defense Force (`hdf`, 14C-3 PR 1D)** reuses these roles; no new models. Squads show one mini per model, all alike (per-model weapons are not drawn differently).

| Unit (`id`) | Role (`modelType`) | Models |
| :--- | :--- | :---: |
| **Company Leader** (`hdf-company-leader`) | `leader` | 1 |
| **Veterans** (`hdf-veterans`) | `trooper` | 3 |
| **Infantry Squad** (`hdf-infantry-squad`) | `trooper` | 3 |
| **Sniper** (`hdf-sniper`) | `specialist` | 1 |

**Orc Marauders (`orc-marauders`, 14C-3 PR 2)** reuses these roles; no new models. There is no bike model yet, so the Orc Biker uses the largest existing role (`heavy`); Fast is a rule, not a look.

| Unit (`id`) | Role (`modelType`) | Models |
| :--- | :--- | :---: |
| **Orc Leader** (`orc-leader`) | `leader` | 1 |
| **Orc Biker** (`orc-biker`) | `heavy` | 1 |
| **Veteran** (`orc-veteran`) | `trooper` | 1 |
| **Infiltrator** (`orc-infiltrator`) | `specialist` | 1 |
| **Specialist** (`orc-specialist`) | `specialist` | 1 |

---

## 2. Terrain Palette & Structure Mapping

Battlefield terrain is ruleset-agnostic and fully data-driven. The default match scenario ([`shared/src/data/scenario.ts`](../shared/src/data/scenario.ts)) initializes a blank 48"×48" battlefield (`createBlankMap()` with an empty terrain array `terrain: []`), while ready-made layouts are provided by built-in maps ([`shared/src/data/builtinMaps.ts`](../shared/src/data/builtinMaps.ts), such as `Standard Battlefield` and `The Jump Range`) or custom maps created in the Map Builder.

All terrain pieces are instances of types registered in `TERRAIN_PALETTE_CATALOG` ([`shared/src/data/mapSchema.ts`](../shared/src/data/mapSchema.ts)) and constructed procedurally by [`client/src/renderer/BoardRenderer.ts`](../client/src/renderer/BoardRenderer.ts) using the shared solid and aperture definitions in [`shared/src/data/terrainStructures.ts`](../shared/src/data/terrainStructures.ts) (mesh = collision geometry; elevated deck floors sit at the 3.0" tier):

| `terrainType` | Display Name | Category | Default Scale (`W × H × D`) | Walkable / Climbable | Mechanical Attributes |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `wall-short` | Solid Wall (2") | `walls` | `2 × 2.5 × 0.25` | no | Short solid wall: 100% LoS obstruction, cover, and movement blocking. |
| `wall` | Solid Wall (4") | `walls` | `4 × 2.5 × 0.25` | no | Solid wall: 100% LoS obstruction, cover, and movement blocking. |
| `wall-long` | Solid Wall (6") | `walls` | `6 × 2.5 × 0.25` | no | Long solid wall: 100% LoS obstruction, cover, and movement blocking. |
| `wall-window` | Window Wall | `walls` | `4 × 2.5 × 0.25` | no | Window wall: blocks movement, lower breastwork + open upper window aperture grants cover (+1 Def) and permits LoS. |
| `wall-doorway` | Doorway Wall | `walls` | `4 × 2.5 × 0.25` | no | Doorway wall: 1.5" center doorway opening permits model passage and clear LoS. |
| `column` | Structural Column | `structures` | `1.25 × 3 × 1.25` | no | Square architectural pillar with plinth and cap: solid sight-blocker, cover, and movement obstruction. |
| `ruin-l` | L-Corner Ruin | `structures` | `4 × 4 × 4` | climbable | Two perpendicular ruined walls with firing ports around an open courtyard, plus a walkable L-ledge at 3.0" inside the north and west walls. |
| `platform-small` | Platform (4"×4") | `platforms` | `4 × 3 × 4` | walkable (not climbable) | Walkable deck (top 3.0", 0.25" thick) on four 0.5" corner pillars; models walk beneath. Needs ladder or stairs to climb. |
| `platform-large` | Platform (6"×4") | `platforms` | `6 × 3 × 4` | walkable (not climbable) | Same as small platform, with a larger 6"×4" deck. |
| `catwalk` | Catwalk (6"×2") | `platforms` | `6 × 3 × 2` | walkable (not climbable) | Bare walkable deck (top 3.0", 0.25" thick, no legs) spanning between platforms. |
| `support-pillar` | Support Pillar | `platforms` | `0.5 × 2.75 × 0.5` | no | 0.5" pillar matching platform legs, extending from ground to deck underside. |
| `stairs` | Stairs (2"×4") | `stairs-ladders` | `2 × 3 × 4` | walkable | Continuous ramp wedge (wedge physics) rising up to 3.0"; 1:1 movement onto decks without climbing penalty. |
| `ladder` | Wall Ladder | `stairs-ladders` | `0.5 × 3 × 0.25` | walkable | Rails and rungs; snaps to the nearest deck/ledge face; allows vertical ladder climbs. |
| `barricade` | Barricade (3") | `scatter` | `3 × 0.5 × 0.25` | no | Low 0.5" cover; does not block sight; can be stepped over or stacked on decks. |
| `crate` | Supply Crate | `scatter` | `1 × 0.75 × 1` | no | Low 0.75" cover; does not block sight (full 1"×1" collision footprint). |
| `industrial-pipe` | Industrial Pipe (4") | `scatter` | `4 × 0.75 × 0.75` | no | Low 0.75" waist-height conduit obstacle providing cover. |
| `shipping-container` | Shipping Container (5") | `scatter` | `5 × 2.25 × 2.25` | walkable & climbable | Solid sight blocker and obstacle with a walkable 2.25" roof. |
| `rubble-field` | Rubble Field (6"×4") | `area` | `6 × 0.25 × 4` | area (walkable) | Difficult area terrain: 6.0" movement speed cap, grants cover to models inside; no collision solids. |
| `hazard-pool` | Hazard Pool (4"×4") | `area` | `4 × 0.1 × 4` | area (walkable) | Dangerous area terrain: 1d6 hazard check per model on crossing or activating (1s inflict unsaved wounds); no cover; no collision solids. |

---

## 3. UI & Gameplay Markers (`MarkerRenderer`)

Rendered dynamically by [`client/src/renderer/MarkerRenderer.ts`](../client/src/renderer/MarkerRenderer.ts):

| Marker Type | Asset / Geometry | Base Height ($y$) | Color & Visual Appearance | Trigger Condition |
| :--- | :--- | :---: | :--- | :--- |
| **Unit Selection** | `indicator-round-b.glb` | Unit $y + 0.02″$ | Blue (`0x29b6f6`) rotating glow ring | Active unit, selected unit, or hovered friendly unit |
| **Target Indicator** | `indicator-round-b.glb` | Unit $y + 0.02″$ | Red (`0xff5252`) rotating glow ring | Hovered enemy target or selected attack target |
| **Reachable Targets** | `indicator-round-b.glb` | Unit $y + 0.018″$ | Dark Red (`0x8e2424`) flat rings | All enemy units currently within range of selected weapon/charge |
| **Aim Lines** | Procedural `LineBasicMaterial` + flat ring | Eye height ($y + 1.1″$); ring at model $y + 0.03″$ | Green (`0x66bb6a`) line per firing attacker model to its target model; faint red (`0xef5350`, 30%) for a model that cannot fire; yellow (`0xffeb3b`) ring under the aimed-at target model | Shoot targeting with an enemy hovered, and while confirming a shot (F9 adds cyan per-model rays) |
| **Movement Range** | Procedural `RingGeometry` | Unit $y + 0.03″$ | Gold/amber (`0xffd54f`, or `0xffb74d` for Rush), constant 0.08" thickness | Hovering or preparing Move / Rush action |
| **Line-of-Sight Fan** | Procedural `los-shadow-fan` | Ground $y + 0.01″$ | Semi-transparent dark red (`0xb71c1c`) | Hovering or preparing Shoot / Charge action |
| **Move Path Preview** | Procedural `LineBasicMaterial` | Interpolated 3D $y$ | Green (`0x69f0ae`) / Cyan (`0x4dd0e1` for Flying) / Orange (`0xff7043` for Melee contact) path line with leg colors (orange climb `0xff9800`, amber drop `0xffc107`, red jump `0xf44336`), waypoint dot rings and terminal destination disc | Dragging or picking destination for Move, Rush, or Charge |
| **Move path labels** | `CSS2DObject` (HTML `div`, `three/examples/jsm/renderers/CSS2DRenderer.js`) | Leg midpoint $y + 0.6″$ | Dark HUD-chip pill, border in the leg colour (orange climb, amber drop, red jump/fall); text "climb 2.3″", "drop 3.0″", "jump 4.9″ · 2 dice" | One per labelled preview leg of a move path (none for plain walking); removed with the preview. `SceneManager` renders the CSS2D layer each frame (`pointer-events: none`). Overlapping marker CSS2D labels stack upward via per-frame layout. |
| **Target badge** | `CSS2DObject` (HTML `div` with one `span` per segment) | Target centre $y + 2.5″$ | Dark HUD-chip pill, fan-red border; distance, then one entry per distance rule: bright bold (applies), dim (does not apply), struck through (negated by Unstoppable) | Shoot targeting (hovered enemy and every weapon-assigned target), shoot confirm, charge targeting and the declared charge target; never in Fight. `pointer-events: none`; rebuilt only when the data changes; overlapping marker CSS2D labels stack upward |
| **Threshold rings** | Procedural dashed `Line` (`LineDashedMaterial`) + one `CSS2DObject` label per ring at far side (host: +z, guest: -z) | Attacker $y + 0.045″$ | Fan red (`0xff7961`); label e.g. `9": Ferocious, Relentless`; stacks upward if overlapping | While the shoot / charge range fan is shown and the attacker has own distance rules within the fan radius; radius = switch distance + attacker base radius |
| **Hero aura** | Procedural dashed `Line` (`LineDashedMaterial`) + floating `CSS2DObject` label at far side (host: +z, guest: -z) | Model $y + 0.04″$ | Hero's side colour (host blue `0x29b6f6`, guest red `0xef5350`), dashed; 85% opacity when lending Quality to the selected/hovered unit, 25% otherwise; radius 6″ + base radius; floating camera-facing `Hero 6"` label placed on the ring at the far side from the local player. (The aura ring sits one Hero base radius outside 6″ because it is measured base edge to base edge, showing where the other unit's nearest base edge has to be.) Overlapping labels stack upward. | A unit is selected or hovered: one ring per living model of each friendly (that unit's side) non-Shaken Hero unit (first living model carries the label) |
| **Blast outline** | Procedural dashed `Line` (`LineDashedMaterial`) + floating `CSS2DObject` label at far side (host: +z, guest: -z) | Model $y + 0.04″$ | Orange (`0xff9800`) dashed ring, radius 3″ + base radius; floating camera-facing `Blast 3"` label placed on the ring at the far side from the local player. Overlapping labels stack upward. | Shoot targeting with any weapon that would fire carrying Blast (or allocated) and an enemy hovered (first living model carries the label) |
| **Blast sharing ring** | `indicator-round-b.glb` / flat ring fallback | Unit $y + 0.025″$ | Orange (`0xff9800`) flat rings (same style as Target Indicator) | Units that would share the hits of the Blast shot being aimed (removed from the Reachable Targets list) |
| **Casualty Picks** | Procedural flat `RingGeometry` pair | Model $y + 0.03″$ (floor) and $y + 1.3″$ (head) | Orange (`0xff9800`) rings, one pair per model picked to be removed | The owner of a damaged squad has a pending casualty pick and has toggled models |
| **Keep-away zones** | Procedural `CircleGeometry` disc + `RingGeometry` outline per model (shared geometry, 3 pooled materials), `renderOrder` 1 | Centred on every model of every other living unit near the mover at its height $+ 0.03″$; radius = their base radius $+ 1″ +$ the mover's base radius (the engine's `KEEP_AWAY_CENTRE_DISTANCE`, so the moving model's centre must stay outside) | Red (`0xe53935`) translucent disc and ring; green (`0x66bb6a`) for the declared charge target / pile-in charger (the rule does not apply to it); very faint red for a model on another tier (1.8" or more apart in height, which does not block) | A move, rush, charge (declared, incl. legs), squad model pick, group-crossing placement, push or pile-in is being planned; rebuilt only when the zone list changes |
| **Setup placement preview** | `MarkerRenderer.setPlacement`: a `RingGeometry` + `CircleGeometry` pair per ring, `renderOrder` 1-2 | Cursor ring (radius 0.5" objective, 0.8" unit) at the pointer, on the surface under it; 9" `spacing` circles around each placed objective; `exclusion` circles (9", or 12" from Repel Ambushers, plus both base radii) around every enemy model for a held Scout (non-Scout enemies only) and an Ambush arrival | Cursor: green (`0x69f0ae`) where the host would accept the spot, red (`0xef5350`) where not; spacing: gold (`0xffd54f`); exclusion: orange (`0xff9800`) | Objectives phase (your turn), deployment, the held-Scout stage and the Ambush step; rebuilt on every pointer move over the board |
| **Flying path line / stop marker** | `MarkerRenderer.setMovePath` (`flying`, `stop` fields of `MovePathMarker`): a `LineDashedMaterial` line; a flat ring plus a CSS2D label (same style as the leg labels) | Flying: every leg of the previewed path (the whole line when unclassified), except a fall. Stop: the end of the planned path when it falls short of the cursor | Flying: dashed cyan (`FLYING_PATH_COLOR`, `0x4dd0e1`), so it reads as passing over things. Stop: blue (`0x29b6f6`) ring and a label "Stopped: ..." 1.1" above the stop | A Flying unit's move, rush or charge leg is being planned (also squad model picks); the stop marker for any of them whose path ends short of the cursor; rebuilt with the path line, no extra per-move work |
| **Melee Contact Ring** | Procedural Concentric Rings | Unit $y + 0.02″$ | Dual Red & Amber (`0xff5252` & `0xffab40`) rings | Target unit actively engaged in close-quarters melee combat |
| **Wound Outcome (0)** | `number-0.glb` (same digit model as 1–5) | Unit $y + 1.6″$ | Neutral grey (`0xb0bec5`) floating 3D billboard "0" | Attack resolved with 0 unsaved wounds |
| **Wound Outcome (1–5)** | `number-1.glb` .. `number-5.glb` | Unit $y + 1.6″$ | Red (`0xef5350`) floating 3D billboard digits | Attack resolved dealing 1 to 5 unsaved wounds |

---

## 4. Mission Objective Beacons (`ObjectiveRenderer`)

Rendered procedurally by [`client/src/renderer/ObjectiveRenderer.ts`](../client/src/renderer/ObjectiveRenderer.ts) at each objective location:

| Element | Geometry | Dimensions | Dynamic Color Scheme |
| :--- | :--- | :--- | :--- |
| **Control Radius Ring** | Procedural `RingGeometry` | Inner `2.96"`, Outer `3.0"`, on the marker's surface $+ 0.015″$ | Neutral = Yellow (`#ffd54f`), Host = Blue (`#29b6f6`), Guest = Red (`#ef5350`), Contested = Orange (`#ff9800`) |
| **Capture Zone Disc** | Procedural `RingGeometry` (filled) | Radius `2.96"`, opacity `0.08` | Matches controlling player color |
| **Centre Pip** | Procedural `CircleGeometry` | Radius `0.3"`, opacity `0.6` | Matches controlling player color |

Objectives are placed by the players during the objectives phase (14C-2), so markers appear one at a time as they are placed. A marker placed on a deck sits at that surface's height (`Objective.position.y`).
