# Curated 3D Models (`client/public/models/`)

All `.glb` files and `Textures/colormap.png` in this directory are from the **Kenney Prototype Kit** (https://kenney.nl, created 2024-08-28), distributed under the [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/) license — public domain, no attribution required.

They were curated from the raw pack staged in `assets-src/` (gitignored). Asset registration and scaling live in [`client/src/renderer/assetManifest.ts`](../../src/renderer/assetManifest.ts).

## Complete Asset Mapping

### 1. Fighter Role Models (`UNIT_ASSETS`)
Used by `UnitRenderer` (via `unit.unitType`). Tinted per owning player (Host = Blue `0x3a7bd5`, Guest = Red `0xd54a3a`):

| Fighter Role (`unitType`) | GLB File | Manifest Scale | Fighters Using This Model |
| :--- | :--- | :---: | :--- |
| `leader` | `figurine-large.glb` | `1.0` | Warden Captain, Raid Boss |
| `trooper` | `figurine.glb` | `0.9` | Warden Trooper, Rust Runner |
| `specialist` | `figurine-cube.glb` | `0.9` | Warden Marksman, Warden Breacher, Rust Skirmisher, Rust Sapper |
| `heavy` | `figurine-cube-detailed.glb` | `1.0` | Warden Gun Crew, Rust Bruiser |

### 2. Battlefield Terrain (`TERRAIN_ASSETS`)
Used by `BoardRenderer` (via `piece.terrainType`), scaled by each piece's `scale` vector in the scenario data:

| Terrain Type (`terrainType`) | GLB File | Raw GLB Footprint (`X × Y × Z`) | Default Scenario Piece Scale |
| :--- | :--- | :---: | :---: |
| `wall` | `wall.glb` | `0.2 × 1.0 × 1.0` | `3 × 1.5 × 0.5` |
| `wall-window` | `wall-window-medium.glb` | `0.3 × 1.0 × 1.0` | `3 × 1.5 × 0.5` |
| `wall-doorway` | `wall-doorway.glb` | `0.3 × 1.0 × 1.0` | `3 × 1.5 × 0.5` |
| `crate` | `crate.glb` | `0.5 × 0.5 × 0.5` | `1 × 1 × 1` |
| `column` | `column.glb` | `0.2 × 1.0 × 0.2` | `1 × 2.5 × 1` |

### 3. Gameplay UI Markers (`MARKER_ASSETS` & `OUTCOME_ASSETS`)
Used by `MarkerRenderer` for selection, targeting, range rings, and floating wound outcome numbers:

| Marker Key | GLB File | Manifest Scale | Purpose & Behavior |
| :--- | :--- | :---: | :--- |
| `selection` | `indicator-round-b.glb` | `1.4` | Flat blue (`0x29b6f6`) floor ring under the selected, active, or hovered friendly unit |
| `target` | `indicator-round-b.glb` | `1.4` | Bright red (`0xff5252`) floor ring under the hovered or selected enemy target |
| `reachable-target` | `indicator-round-b.glb` | `1.4` | Darker red (`0x8e2424`) floor ring under all reachable enemy targets within the attack range circle |
| `movement-range` | *(Procedural `RingGeometry`)* | `1.0` *(× `remainingMovement`)* | Crisp, constant-thickness (`0.08"` rim) blue (`0x29b6f6`) circle around the active unit showing remaining movement radius when `Move` is hovered or active |
| `attack-range` | *(Procedural `los-shadow-fan`)* | `1.0` *(× weapon/charge range)* | Dark transparent red (`0xb71c1c`) Line-of-Sight visibility fan sized to weapon/charge range, cut out where blocked by terrain or fighters |
| `outcome-1` .. `outcome-5` | `number-1.glb` .. `number-5.glb` | `1.2` | Floating red (`0xef5350`) wound-count digit above a wounded target; oriented toward the camera each frame so digits never appear mirrored |

### Shared Texture
- `Textures/colormap.png`: Shared palette texture referenced by all Kenney Prototype Kit `.glb` materials.

Note: Kenney's assets are CC0 and are not game-rule artwork — they are generic prototype placeholders, consistent with this project's first-principles, no-publisher-content policy.
