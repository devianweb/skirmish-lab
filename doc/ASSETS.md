# 3D Asset & Model Map (`client/public/models/`)

All `.glb` files and `Textures/colormap.png` in `client/public/models/` are from the **Kenney Prototype Kit** (https://kenney.nl, created 2024-08-28), distributed under the [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/) license — public domain, no attribution required.

Asset registration, scaling, and orientation live in [`client/src/renderer/assetManifest.ts`](../client/src/renderer/assetManifest.ts).

---

## Complete 3D Asset Inventory (`client/public/models/`)

| File Name | Size | Category | Asset Manifest Key | Description & Role |
| :--- | :---: | :--- | :--- | :--- |
| `figurine-large.glb` | 118 KB | Fighter | `UNIT_ASSETS.leader` | Heavy commander figurine with raised shoulder armor and distinct silhouette. |
| `figurine.glb` | 117 KB | Fighter | `UNIT_ASSETS.trooper` | Standard infantry figurine with rounded helmet. |
| `figurine-cube.glb` | 118 KB | Fighter | `UNIT_ASSETS.specialist` | Specialist figurine with angular visor and modular combat frame. |
| `figurine-cube-detailed.glb` | 125 KB | Fighter | `UNIT_ASSETS.heavy` | Armored heavy trooper figurine with reinforced back battery and plating. |
| `floor-square.glb` | 2.3 KB | Terrain | `TERRAIN_ASSETS.platform` | Walkable metal floor tile used for elevated platforms and catwalks ($y = 2.5″$). |
| `ladder.glb` | 22 KB | Terrain | `TERRAIN_ASSETS.ladder` | Vertical industrial ladder providing 1:1 traversal access to elevated platforms. |
| `stairs-small.glb` | 7.5 KB | Terrain | `TERRAIN_ASSETS.stairs` | Industrial stair flight providing 1:1 ramp traversal up to elevated platforms. |
| `pipe.glb` | 3.5 KB | Terrain | `TERRAIN_ASSETS.pipe` | Horizontal industrial conduit / pipeline providing low waist-height cover. |
| `wall.glb` | 2.8 KB | Terrain | `TERRAIN_ASSETS.wall` | Solid perimeter wall block (100% LoS obstruction & movement blocking). |
| `wall-low.glb` | 2.8 KB | Terrain | `TERRAIN_ASSETS['wall-low']` | Low barricade waist-high wall providing Cover (+1 Defense); plunged over from $y \ge 2.0″$. |
| `wall-window-medium.glb` | 8.8 KB | Terrain | `TERRAIN_ASSETS['wall-window']` | Wall with central firing aperture granting +1 Defense to manned defenders. |
| `wall-doorway.glb` | 14 KB | Terrain | `TERRAIN_ASSETS['wall-doorway']` | Wall with central walk-through doorway opening (full LoS and movement passage). |
| `crate.glb` | 18 KB | Terrain | `TERRAIN_ASSETS.crate` | Waist-height storage crate providing low cover (+1 Defense within $1.0″$). |
| `column.glb` | 2.9 KB | Terrain | `TERRAIN_ASSETS.column` | Solid architectural column (blocks LoS and movement). |
| `indicator-round-b.glb` | 4.5 KB | Marker | `MARKER_ASSETS.selection` / `target` | Flat circular floor beacon used for selection (blue) and enemy target (red). |
| `indicator-round-a.glb` | 6.4 KB | Marker | *(Alternate Indicator)* | Thick rim alternate circular floor marker. |
| `indicator-square-a.glb` | 2.0 KB | Marker | *(Alternate Indicator)* | Square perimeter floor marker. |
| `number-1.glb` .. `number-5.glb` | 4–7 KB | Outcome | `OUTCOME_ASSETS['outcome-N']` | 3D billboard digits (1 to 5) indicating wound damage count dealt on attack. |
| `Textures/colormap.png` | 4.0 KB | Texture | *(Shared Texture)* | Global texture palette referenced by all Kenney Prototype Kit materials. |

---

## 1. Fighter 3D Model Mapping

Fighters are mapped to 3D models via their `modelType` attribute defined in [`shared/src/data/armies.ts`](../shared/src/data/armies.ts). Meshes are instantiated by [`client/src/renderer/UnitRenderer.ts`](../client/src/renderer/UnitRenderer.ts) and tinted dynamically per owning player (Host = Blue `#29b6f6` / `0x3a7bd5`, Guest = Red `#ef5350` / `0xd54a3a`):

| Role (`modelType`) | 3D Model File | Manifest Scale | Frontier Wardens Units | Rust Raiders Units |
| :--- | :--- | :---: | :--- | :--- |
| **`leader`** | `figurine-large.glb` | `1.0` | **Warden Captain** (`warden-captain`), **Warden Storm Commander** (`warden-storm-commander`), **Marshal Vance** (`marshal-vance`) | **Raid Boss** (`raider-boss`) |
| **`trooper`** | `figurine.glb` | `1.15` | **Warden Trooper** (`warden-trooper`), **Warden Patrol Squad** (`warden-patrol-squad`), **Line Trooper Squad** (`line-trooper-squad`), **Sentry Automaton** (`sentry-automaton`), **Warden Veteran** (`warden-veteran`) | **Rust Runner** (`raider-trooper`), **Rust Patrol Mob** (`raider-patrol-mob`) |
| **`specialist`** | `figurine-cube.glb` | `0.95` | **Warden Marksman** (`warden-marksman`), **Warden Breacher** (`warden-breacher`), **Warden Demolitionist** (`warden-demolitionist`), **Shock Trooper** (`shock-trooper`), **Warden Sharpshooter** (`warden-sharpshooter`) | **Rust Skirmisher** (`raider-skirmisher`), **Rust Sapper** (`raider-sapper`) |
| **`heavy`** | `figurine-cube-detailed.glb` | `1.0` | **Warden Gun Crew** (`warden-gun-crew`), **Heavy Ordnance Crew** (`heavy-ordnance-crew`), **Goliath Automaton** (`goliath-automaton`) | **Rust Bruiser** (`raider-bruiser`) |

---

## 2. Default Battlefield Scenario Terrain Mapping

The default testing map layout is defined in [`shared/src/data/scenario.ts`](../shared/src/data/scenario.ts) and rendered by [`client/src/renderer/BoardRenderer.ts`](../client/src/renderer/BoardRenderer.ts):

| Piece ID | Display Name | `terrainType` | 3D Model File | World Position (`x, y, z`) | Dimensions / Scale (`W × H × D`) | Mechanical Attributes |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `terrain-wall-north` | North Solid Wall | `wall` | `wall.glb` | `(0, 0, 8)` | `4.0 × 2.0 × 0.5` | Solid wall: 100% LoS obstruction & movement blocking. |
| `terrain-wall-south` | South Window Wall | `wall-window` | `wall-window-medium.glb` | `(0, 0, -8)` | `4.0 × 2.0 × 0.5` | Window wall: blocks movement, 1.0" center aperture grants Cover (+1 Def). |
| `terrain-door-east` | East Doorway Wall | `wall-doorway` | `wall-doorway.glb` | `(8, 0, 0)` | `4.0 × 2.0 × 0.5` | Doorway wall: 1.0" center doorway permits model passage and clear LoS. |
| `terrain-crate-sw` | SW Low Crate | `crate` | `crate.glb` | `(-5, 0, -4)` | `1.0 × 1.0 × 1.0` | Low cover: blocks movement; defenders within 1.0" gain +1 Defense. |
| `terrain-crate-ne` | NE Low Crate | `crate` | `crate.glb` | `(5, 0, 4)` | `1.0 × 1.0 × 1.0` | Low cover: blocks movement; defenders within 1.0" gain +1 Defense. |
| `terrain-col-nw` | NW Column | `column` | `column.glb` | `(-8, 0, 6)` | `1.0 × 2.5 × 1.0` | Architectural column: solid sight-blocker and movement obstruction. |
| `terrain-col-se` | SE Column | `column` | `column.glb` | `(8, 0, -6)` | `1.0 × 2.5 × 1.0` | Architectural column: solid sight-blocker and movement obstruction. |
| `terrain-platform-west` | West Overlook Platform | `platform` | `floor-square.glb` | `(-9, 2.5, -2)` | `3.5 × 0.3 × 3.5` | Walkable elevation ($y = 2.5″$): Parapet Cover within 1.0" of edge; floor blind spot $> 1.0″$. |
| `terrain-ladder-west` | West Access Ladder | `ladder` | `ladder.glb` | `(-7.1, 0, -2)` | `0.5 × 2.5 × 0.5` | Ladder access: 1:1 climb speed onto West Platform without Difficult Terrain penalty. |
| `terrain-platform-east` | East Catwalk Platform | `platform` | `floor-square.glb` | `(9, 2.5, 2)` | `3.5 × 0.3 × 3.5` | Walkable catwalk ($y = 2.5″$): elevated vantage point overlooking East lane. |
| `terrain-stairs-east` | East Access Stairs | `stairs` | `stairs-small.glb` | `(7.1, 0, 2)` | `1.8 × 2.5 × 1.2` | Stair ramp: 1:1 movement onto East Catwalk without Difficult Terrain penalty. |
| `terrain-wall-low-north` | North Low Barricade | `wall-low` | `wall-low.glb` | `(-3, 0, 3)` | `2.5 × 0.8 × 0.4` | Low cover barricade: Plunging Fire from $y \ge 2.0″$ overlooks it against ground targets. |
| `terrain-pipe-center` | Center Industrial Pipe | `pipe` | `pipe.glb` | `(3, 0, -2)` | `3.0 × 0.8 × 0.8` | Industrial conduit: low cover waist-height obstacle. |
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
