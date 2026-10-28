# Curated 3D models

All `.glb` files in this directory are from the **Kenney Prototype Kit**
(https://kenney.nl, created 2024-08-28), distributed under the
[Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/)
license — public domain, no attribution required.

They were curated from the raw pack staged in `assets-src/` (gitignored)
during Phase 5. Mapping lives in `src/renderer/assetManifest.ts`:

| Asset | Use |
| --- | --- |
| `figurine*.glb` | Fighter roles (trooper, specialist, heavy, leader) |
| `wall*.glb`, `crate.glb`, `column.glb` | Default scenario terrain |
| `indicator-square-a.glb` | Selected/active unit indicator |
| `indicator-round-a.glb` | Movement-range ring |
| `target-a-round.glb` | Attack target indicator |
| `number-1..5.glb` | Wound-count outcome tokens |

Note: Kenney's assets are CC0 and are not game-rule artwork — they are
generic prototype placeholders, consistent with this project's
first-principles, no-publisher-content policy.
