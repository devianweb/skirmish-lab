# 3D Asset & Model Map (`client/public/models/`)

All `.glb` files and `Textures/colormap.png` in `client/public/models/` are from the **Kenney Prototype Kit** (https://kenney.nl, created 2024-08-28), distributed under the [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/) license — public domain, no attribution required.

Asset registration, scaling, and orientation live in [`client/src/renderer/assetManifest.ts`](../client/src/renderer/assetManifest.ts).

All terrain pieces are generated procedurally by [`client/src/renderer/ModelLoader.ts`](../client/src/renderer/ModelLoader.ts) at exact 1:1 wargaming scale ($1.0\text{ unit} = 1.0\text{ inch}$), ensuring absolute alignment with mathematical collision boxes, ramp physics, and F9 debug wireframes.

**Terrain structure parity:** window walls, doorway walls and the L-corner ruin are built directly from the shared solid boxes in [`shared/src/data/terrainStructures.ts`](../shared/src/data/terrainStructures.ts) (apertures/firing ports are open air and have no mesh), so the mesh, the collision and the F9 per-box wireframes are the same geometry. Doorway openings are 1.5" wide × 2.25" tall. **Grid rule:** every height, thickness and opening at a piece's default scale is a multiple of 0.25" (guarded by `shared/tests/data/terrainStructures.test.ts`). Solid walls are built from 2" segments (`wall-short` = 1, `wall` = 2, `wall-long` = 3) with no gaps between them. The L-corner ruin's second-floor ledge is deferred to 13.6C.

---

## Complete 3D Asset Inventory (`client/public/models/`)

| File Name | Size | Category | Asset Manifest Key | Description & Role |
| :--- | :---: | :--- | :--- | :--- |
| `crate-medium.glb` | 59 KB | Objective | `OBJECTIVE_ASSETS.beacon` | Central tactical objective container marker beacon. |
| `indicator-round-b.glb` | 4.5 KB | Marker | `MARKER_ASSETS.selection` / `target` | Flat circular floor beacon used for selection (blue) and enemy target (red). |
| `indicator-round-a.glb` | 6.4 KB | Marker | *(Alternate Indicator)* | Thick rim alternate circular floor marker. |
| `indicator-square-a.glb` | 2.0 KB | Marker | *(Alternate Indicator)* | Square perimeter floor marker. |
| `number-1.glb` .. `number-5.glb` | 4–7 KB | Outcome | `OUTCOME_ASSETS['outcome-N']` | 3D billboard digits (1 to 5) indicating wound damage count dealt on attack. |
| `Textures/colormap.png` | 4.0 KB | Texture | *(Shared Texture)* | Global texture palette referenced by marker materials. |

---

## 1. Fighter 3D Model Mapping (Procedural Hero Scale)

Fighters in SkirmishLab are rendered procedurally by [`client/src/renderer/ModelLoader.ts`](../client/src/renderer/ModelLoader.ts) at true **28–32mm Hero Scale** mounted on **1.0" tournament wargaming bases**. Meshes are instantiated by [`client/src/renderer/UnitRenderer.ts`](../client/src/renderer/UnitRenderer.ts).

- **Standard 1.0" Base:** $1.0"$ diameter ($25.4\text{ mm}$, radius $0.50"$) with beveled tournament lip (height $0.10"$). Base top surface is dark tournament slate (`#212529`).
- **Squad Rim Identification:** Each unit/squad receives a distinct, high-contrast base rim accent color generated deterministically from its `unit.id` via `getUnitRimColor()` in [`client/src/renderer/rimColors.ts`](../client/src/renderer/rimColors.ts).
- **Team Tinting:** Miniature body/armor dynamically tints to the player's team color (Host = Blue `#29b6f6` / `0x3a7bd5`, Guest = Red `#ef5350` / `0xd54a3a`).
- **Dimensions:** Standing height $1.12"$ above base $\implies$ **total model height $\approx 1.22"$ ($31\text{ mm}$)** with $0.72"$ shoulder span, fitting $1:1$ with terrain doorframes, window sills, and elevations.

| Role (`modelType`) | Geometry Type | Dimensions | Frontier Wardens Units | Rust Raiders Units |
| :--- | :--- | :---: | :--- | :--- |
| **`leader`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | **Warden Captain** (`warden-captain`), **Warden Storm Commander** (`warden-storm-commander`), **Marshal Vance** (`marshal-vance`) | **Raid Boss** (`raider-boss`) |
| **`trooper`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | **Warden Trooper** (`warden-trooper`), **Warden Patrol Squad** (`warden-patrol-squad`), **Line Trooper Squad** (`line-trooper-squad`), **Sentry Automaton** (`sentry-automaton`), **Warden Veteran** (`warden-veteran`) | **Rust Runner** (`raider-trooper`), **Rust Patrol Mob** (`raider-patrol-mob`) |
| **`specialist`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | **Warden Marksman** (`warden-marksman`), **Warden Breacher** (`warden-breacher`), **Warden Demolitionist** (`warden-demolitionist`), **Shock Trooper** (`shock-trooper`), **Warden Sharpshooter** (`warden-sharpshooter`) | **Rust Skirmisher** (`raider-skirmisher`), **Rust Sapper** (`raider-sapper`) |
| **`heavy`** | Procedural Hero Mini + 1.0" Base | $1.0" \times 1.22" \times 1.0"$ | **Warden Gun Crew** (`warden-gun-crew`), **Heavy Ordnance Crew** (`heavy-ordnance-crew`), **Goliath Automaton** (`goliath-automaton`) | **Rust Bruiser** (`raider-bruiser`) |

---

## 2. Default Battlefield Scenario Terrain Mapping

The default testing map layout is defined in [`shared/src/data/scenario.ts`](../shared/src/data/scenario.ts) and rendered by [`client/src/renderer/BoardRenderer.ts`](../client/src/renderer/BoardRenderer.ts) via procedural geometry:

| Piece ID | Display Name | `terrainType` | Procedural Geometry | World Position (`x, y, z`) | Dimensions / Scale (`W × H × D`) | Mechanical Attributes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `terrain-wall-north` | North Solid Wall | `wall` | Procedural Wall Block | `(0, 0, 8)` | `4.0 × 2.0 × 0.5` | Solid wall: 100% LoS obstruction & movement blocking. |
| `terrain-wall-south` | South Window Wall | `wall-window` | Procedural Wall Block | `(0, 0, -8)` | `4.0 × 2.0 × 0.5` | Window wall: blocks movement, 1.0" center aperture grants Cover (+1 Def). |
| `terrain-door-east` | East Doorway Wall | `wall-doorway` | Procedural Wall Block | `(8, 0, 0)` | `4.0 × 2.0 × 0.5` | Doorway wall: 1.0" center doorway permits model passage and clear LoS. |
| `terrain-crate-sw` | SW Low Crate | `crate` | Procedural Crate Block | `(-5, 0, -4)` | `1.0 × 1.0 × 1.0` | Low cover: blocks movement; defenders within 1.0" gain +1 Defense. |
| `terrain-crate-ne` | NE Low Crate | `crate` | Procedural Crate Block | `(5, 0, 4)` | `1.0 × 1.0 × 1.0` | Low cover: blocks movement; defenders within 1.0" gain +1 Defense. |
| `terrain-col-nw` | NW Column | `column` | Procedural Pillar | `(-8, 0, 6)` | `1.0 × 2.5 × 1.0` | Architectural column: solid sight-blocker and movement obstruction. |
| `terrain-col-se` | SE Column | `column` | Procedural Pillar | `(8, 0, -6)` | `1.0 × 2.5 × 1.0` | Architectural column: solid sight-blocker and movement obstruction. |
| `terrain-platform-west` | West Overlook Platform | `platform` | Procedural Deck Platform | `(-9, 2.5, -2)` | `3.5 × 0.3 × 3.5` | Walkable elevation ($y = 2.5″$): Parapet Cover within 1.0" of edge; floor blind spot $> 1.0″$. |
| `terrain-ladder-west` | West Access Ladder | `ladder` | Procedural Ladder Strip | `(-7.1, 0, -2)` | `0.5 × 2.5 × 0.5` | Ladder access: 1:1 climb speed onto West Platform without Difficult Terrain penalty. |
| `terrain-platform-east` | East Catwalk Platform | `platform` | Procedural Deck Platform | `(9, 2.5, 2)` | `3.5 × 0.3 × 3.5` | Walkable catwalk ($y = 2.5″$): elevated vantage point overlooking East lane. |
| `terrain-stairs-east` | East Access Stairs | `stairs` | Procedural Triangular Wedge (1:1 with collision math) | `(7.1, 0, 2)` | `1.8 × 2.5 × 1.2` | Stair ramp: 1:1 movement onto East Catwalk without Difficult Terrain penalty. |
| `terrain-wall-low-north` | North Low Barricade | `wall-low` | Procedural Low Barricade | `(-3, 0, 3)` | `2.5 × 0.8 × 0.4` | Low cover barricade: Plunging Fire from $y \ge 2.0″$ overlooks it against ground targets. |
| `terrain-pipe-center` | Center Industrial Pipe | `pipe` | Procedural Conduit | `(3, 0, -2)` | `3.0 × 0.8 × 0.8` | Industrial conduit: low cover waist-height obstacle. |
| `terrain-toxic-sludge` | Toxic Sludge Hazard | `toxic` | Procedural Hazard Plane | `(0, 0, 0)` | `3.0 × 0.05 × 3.0` | Dangerous & Difficult Terrain: 1d6 hazard check per model (1s inflict unsaved wounds); 6.0" movement speed cap. |
| `terrain-toxic-sludge` | Toxic Sludge Hazard | `toxic` | *(Procedural Green Plane)* | `(0, 0, 0)` | `3.0 × 0.05 × 3.0` | Dangerous & Difficult Terrain: 1d6 hazard check per model (1s inflict unsaved wounds); 6.0" movement speed cap. |

---

## 3. UI & Gameplay Markers (`MarkerRenderer`)

Rendered dynamically by [`client/src/renderer/MarkerRenderer.ts`](../client/src/renderer/MarkerRenderer.ts):

| Marker Type | Asset / Geometry | Base Height ($y$) | Color & Visual Appearance | Trigger Condition |
| :--- | :--- | :---: | :--- | :--- |
| **Unit Selection** | `indicator-round-b.glb` | Unit $y + 0.02″$ | Blue (`0x29b6f6`) rotating glow ring | Active unit, selected unit, or hovered friendly unit |
| **Target Indicator** | `indicator-round-b.glb` | Unit $y + 0.02″$ | Red (`0xff5252`) rotating glow ring | Hovered enemy target or selected attack target |
| **Reachable Targets** | `indicator-round-b.glb` | Unit $y + 0.018″$ | Dark Red (`0x8e2424`) flat rings | All enemy units currently within range of selected weapon/charge |
| **Movement Range** | Procedural `RingGeometry` | Unit $y + 0.03″$ | Blue (`0x29b6f6`), constant 0.08" thickness | Hovering or preparing Move / Rush action |
| **Line-of-Sight Fan** | Procedural `los-shadow-fan` | Ground $y + 0.01″$ | Semi-transparent dark red (`0xb71c1c`) | Hovering or preparing Shoot / Charge action |
| **Move Path Preview** | Procedural `LineBasicMaterial` | Interpolated 3D $y$ | Orange/Cyan path line with waypoint dot rings and terminal destination disc | Dragging or picking destination for Move, Rush, or Charge |
| **Melee Contact Ring** | Procedural Concentric Rings | Unit $y + 0.02″$ | Dual Amber (`0xff7043` & `0xffab40`) rings | Target unit actively engaged in close-quarters melee combat |
| **Wound Outcome (0)** | Procedural `TorusGeometry` | Unit $y + 2.0″$ | Neutral grey (`0xb0bec5`) floating 3D "0" | Attack resolved with 0 unsaved wounds |
| **Wound Outcome (1–5)** | `number-1.glb` .. `number-5.glb` | Unit $y + 2.0″$ | Red (`0xef5350`) floating 3D billboard digits | Attack resolved dealing 1 to 5 unsaved wounds |

---

## 4. Mission Objective Beacons (`ObjectiveRenderer`)

Rendered procedurally by [`client/src/renderer/ObjectiveRenderer.ts`](../client/src/renderer/ObjectiveRenderer.ts) at each objective location:

| Element | Geometry | Dimensions | Dynamic Color Scheme |
| :--- | :--- | :--- | :--- |
| **Control Radius Ring** | Procedural `RingGeometry` | Inner `2.92"`, Outer `3.0"` | Neutral = Yellow (`#ffd54f`), Host = Blue (`#29b6f6`), Guest = Red (`#ef5350`), Contested = Orange (`#ff9800`) |
| **Capture Zone Disc** | Procedural `CircleGeometry` | Radius `2.92"`, opacity `0.08` | Matches controlling player color |
| **Metallic Pedestal** | Procedural `CylinderGeometry` | Radius `0.4"`, Height `0.15"` | Fixed gunmetal pedestal (`#546e7a`) |
| **Light Pillar** | Procedural `CylinderGeometry` | Radius `0.18"`, Height `4.0"`, opacity `0.35` | Glowing vertical energy beam matching control state |
| **Hover Crystal** | Procedural `OctahedronGeometry` | Radius `0.35"`, Height $y = 4.2″$ | Floating diamond crystal matching control state with `0.4` emissive glow |
