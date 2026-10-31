# 3D Asset & Model Map (`client/public/models/`)

All `.glb` files and `Textures/colormap.png` in `client/public/models/` are from the **Kenney Prototype Kit** (https://kenney.nl, created 2024-08-28), distributed under the [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/) license — public domain, no attribution required.

They were curated from the raw pack staged in `assets-src/` (gitignored). Asset registration and scaling live in [`client/src/renderer/assetManifest.ts`](../client/src/renderer/assetManifest.ts).

## Complete Asset Mapping

### 1. Fighter Role Models (`UNIT_ASSETS`)
Used by `UnitRenderer` (via `unit.unitType`). Tinted per owning player (Host = Blue `0x3a7bd5`, Guest = Red `0xd54a3a`):

| Fighter Role (`unitType`) | GLB File | Manifest Scale | Fighters Using This Model |
| :--- | :--- | :---: | :--- |
| `leader` | `figurine-large.glb` | `1.0` | Warden Captain, Raid Boss |
| `trooper` | `figurine.glb` | `1.15` | Warden Trooper, Rust Runner |
| `specialist` | `figurine-cube.glb` | `0.95` | Warden Marksman, Warden Breacher, Rust Skirmisher, Rust Sapper |
| `heavy` | `figurine-cube-detailed.glb` | `1.0` | Warden Gun Crew, Rust Bruiser |

### 2. Battlefield Terrain (`TERRAIN_ASSETS`)
Used by `BoardRenderer` (via `piece.terrainType`), scaled by each piece's `scale` vector in the scenario data:

| Terrain Type (`terrainType`) | GLB File | Raw GLB Footprint (`X × Y × Z`) | Default Scenario Piece Scale | Mechanical Function & Apertures |
| :--- | :--- | :---: | :---: | :--- |
| `wall` | `wall.glb` | `0.2 × 1.0 × 1.0` | `3 × 1.5 × 0.5` | Solid obstacle: blocks movement and 100% of Line of Sight. |
| `wall-window` | `wall-window-medium.glb` | `0.3 × 1.0 × 1.0` | `3 × 1.5 × 0.5` | Firing port: blocks movement, but allows LoS through central 1.0" aperture when manned within 1.0" (granting +1 Defense against incoming fire). |
| `wall-doorway` | `wall-doorway.glb` | `0.3 × 1.0 × 1.0` | `3 × 1.5 × 0.5` | Door passage: central 1.0" doorway is open to both model movement and unobstructed Line of Sight. |
| `crate` | `crate.glb` | `0.5 × 0.5 × 0.5` | `1 × 1 × 1` (scaled to waist height `1.0` in manifest) | Low cover: blocks movement; grants +1 Defense to defenders positioned within 1.0" along the line of fire. |
| `column` | `column.glb` | `0.2 × 1.0 × 0.2` | `1 × 2.5 × 1` | Solid column: blocks movement and Line of Sight. |
| `platform` | `floor-square.glb` | `1.0 × 0.1 × 1.0` | `3 × 0.3 × 3` | Elevated walkable platform: fighters stand at `y = 2.5"`. Models within 1.0" of edge gain Parapet Cover (+1 Defense); models set back > 1.0" create floor blind spots from street. |
| `ladder` | `ladder.glb` | `0.5 × 2.0 × 0.2` | `0.5 × 2.5 × 1.0` | Vertical access ladder: climbed at 1:1 speed without Difficult Terrain penalty. |
| `stairs` | `stairs-small.glb` | `1.0 × 1.0 × 1.0` | `1.5 × 2.5 × 1.0` | Stair ramp access: ascended at 1:1 speed without Difficult Terrain penalty. |
| `wall-low` | `wall-low.glb` | `0.2 × 0.5 × 1.0` | `2 × 0.8 × 0.3` | Low barricade: low cover granting +1 Defense to defenders within 1.0" along line of fire; Plunging Fire (>= 2.0" above) looks over it. |
| `pipe` | `pipe.glb` | `0.8 × 0.8 × 1.0` | `3 × 0.8 × 0.8` | Industrial conduit: low cover obstacle providing cover to models behind it. |
| `toxic` | *(Procedural Plane)* | `1.0 × 0.05 × 1.0` | `2.5 × 0.05 × 2.5` | Dangerous & Difficult Terrain: entering or activating inside rolls 1d6 per model; 1s inflict unsaved wounds. Movement capped at 6.0". |

### 3. Gameplay UI Markers (`MARKER_ASSETS` & `OUTCOME_ASSETS`)
Used by `MarkerRenderer` for selection, targeting, range rings, and floating wound outcome numbers:

| Marker Key | GLB File | Manifest Scale | Purpose & Behavior |
| :--- | :--- | :---: | :--- |
| `selection` | `indicator-round-b.glb` | `1.4` | Flat blue (`0x29b6f6`) floor ring under the selected, active, or hovered friendly unit |
| `target` | `indicator-round-b.glb` | `1.4` | Bright red (`0xff5252`) floor ring under the hovered or selected enemy target |
| `reachable-target` | `indicator-round-b.glb` | `1.4` | Darker red (`0x8e2424`) floor ring under all reachable enemy targets within the attack range circle |
| `movement-range` | *(Procedural `RingGeometry`)* | `1.0` *(× `remainingMovement`)* | Crisp, constant-thickness (`0.08"` rim) blue (`0x29b6f6`) circle around the active unit showing remaining movement radius when `Move` is hovered or active |
| `attack-range` | *(Procedural `los-shadow-fan`)* | `1.0` *(× weapon/charge range)* | Dark transparent red (`0xb71c1c`) Line-of-Sight visibility fan sized to weapon/charge range, cut out where blocked by terrain or fighters |
| `outcome-0` | *(Procedural `TorusGeometry`)* | `1.0` | Floating neutral (`0xb0bec5`) 3D "0" digit above a target that received 0 wounds, giving clear attack feedback |
| `outcome-1` .. `outcome-5` | `number-1.glb` .. `number-5.glb` | `1.2` | Floating red (`0xef5350`) wound-count digit above a wounded target; oriented toward the camera each frame so digits never appear mirrored |

### 4. Mission Objective Markers (`ObjectiveRenderer`)
Rendered procedurally in Three.js by `ObjectiveRenderer` at each objective's coordinate (`Objective.position`), dynamically color-coded to reflect control status:

| Visual Element | Geometry | Dimensions | Dynamic Color & Behavior |
| :--- | :--- | :--- | :--- |
| `boundary-ring` | Procedural `RingGeometry` | Inner `2.92"`, Outer `3.0"` | Floor boundary indicating 3.0" control radius. Color-coded by controlling player: Neutral (`#ffd54f`), Host (`#29b6f6`), Guest (`#ef5350`), Contested (`#ff9800`). |
| `capture-zone` | Procedural `CircleGeometry` | Radius `2.92"` | Semi-transparent (`opacity: 0.08`) floor disc showing the capture zone. Matches controlling state color. |
| `beacon-base` | Procedural `CylinderGeometry` | Radius `0.4"`, Height `0.15"` | Central metallic pedestal anchor (`#546e7a`). |
| `light-pillar` | Procedural `CylinderGeometry` | Radius `0.18"`, Height `4.0"` | Semi-transparent (`opacity: 0.35`) vertical energy column rising from the center. Matches controlling state color. |
| `hover-crystal` | Procedural `OctahedronGeometry` | Radius `0.35"` | Floating diamond crystal at $y = 4.2"$. Matches controlling state color with high emissive glow (`0.4`). |

### Shared Texture
- `Textures/colormap.png`: Shared palette texture referenced by all Kenney Prototype Kit `.glb` materials.

Note: Kenney's assets are CC0 and are not game-rule artwork — they are generic prototype placeholders, consistent with this project's first-principles, no-publisher-content policy.
