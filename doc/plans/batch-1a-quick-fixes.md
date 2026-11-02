# Batch 1A: quick fixes (picking, editor objectives, zero marker)
Status: approved (2026-11-02)
Index: [bugfix-playtest-batch-1.md](bugfix-playtest-batch-1.md). Read its **Decisions (agreed)**, **Out of scope** and **Background** first: decision numbers below refer to it.

Small, independent client fixes. Each one is its own PR and can go in any order.

## PR 4: Move target snaps to the stairs' top corners (branch: `fix/pick-ignores-lines`)
**Owner report:** "When on the platform, the move target seems to snap to the top corners of the stairs mesh."

- **Cause (found by reading the code, verify with a test first):** `BoardRenderer.raycastTerrainHit` raycasts every child of the terrain group, including the stairs' decorative step lines (`THREE.LineSegments` for treads, risers and stringers in `createProceduralStairWedge`). Three.js raycasts lines with a default `params.Line.threshold` of **1 world unit = 1"**. Any ray passing within 1" of a step line "hits" it, and the hit point is the nearest point on that line. From a deck the camera ray passes near the top tread and stringer ends, so the target snaps to the top corners of the stairs. Any future line decor (ladder rails if built from lines, F9-style helpers parented to terrain) would do the same.
- **Layer:** client renderer only. No rules change.
- **Files:** `client/src/renderer/BoardRenderer.ts` (`raycastTerrainHit`), test in `client/tests/renderer/`.
- **Tests first:**
  1. A board with stairs. A ray that passes within 0.5" of a step line but hits nothing solid returns null (or the ground in `GameView`), not a point on the line.
  2. A ray that hits the stair slope still returns the slope point (stairs remain pickable).
- **Implementation steps:** in `raycastTerrainHit`, ignore hits whose object isn't a `THREE.Mesh` (`(hit.object as THREE.Mesh).isMesh`). Optionally also mark decor-only meshes (kick-plates, tread ridges) with `userData.decor = true` and skip them, so picks only land on real structure. This also helps PR 3's side-face/kick-plate suspicion.
- **Docs:** none beyond a ROADMAP fix bullet.
- **Manual checks:** §3 add: hovering near stairs from a deck never snaps the target to the stair corners. Hovering the stair slope still targets the slope.
- **Independent** of PRs 1–3. A quick win that can go first.

---

## PR 12: Preplaced objectives can't be removed in the map editor (branch: `fix/editor-select-objectives`)
**Owner report:** "Preplaced objectives in map editor cannot be removed."

- **Cause (found by reading the code):** `MapEditor` can only select an objective right after placing it (`placeObjectiveAt` sets `selectedObjectiveId`, ~l.299). The board click handler (`setupPicking`, ~l.540) only ever calls `selectPiece(...)`, and nothing calls `selectObjective(...)`. So objectives from **Auto Obj**, a loaded or imported map, or one you deselected can never be selected again, and Delete / **Remove Objective** (`deleteSelected`, ~l.413) never sees them.
- **Layer:** client editor only.
- **Fix:**
  1. In selection mode, a board click within ~1.0" (horizontal) of an objective's position selects that objective (objectives win over terrain when both are hit, since the beacon sits on the ground).
  2. Also list the map's objectives in the **Objectives** palette tab with a select and a remove button each, so they're reachable even if hidden under terrain.
- **Tests first (`client/tests/editor/MapEditor.test.ts`):** after Auto Obj, clicking at an objective's position selects it and Delete removes it; after importing a map with objectives, same; the list's remove button deletes the right one; clicking open ground still deselects.
- **Manual checks:** §1 add: objectives placed by Auto Obj or loaded with a map can be selected (click or list) and removed.

---

## PR 13: The "0" wound marker looks different from 1–5 (branch: `fix/outcome-zero-marker`)
**Owner report:** "0 is rendered differently to the other numbers."

- **Cause:** 1–5 are Kenney prototype-kit digit models (`number-1..5.glb`, `client/src/renderer/assetManifest.ts` `outcome-1..5`). "0" has no model registered, so `MarkerRenderer` builds a procedural grey torus instead (~l.950). The kit **does** include `number-0.glb` (CC0, same set): `assets-src/kenney_prototype-kit/Models/GLB format/number-0.glb`.
- **Layer:** client renderer + assets.
- **Fix:** copy `number-0.glb` into `client/public/models/`, register `'outcome-0': model('number-0.glb', 1.2)`, and delete the torus fallback branch (keep the generic procedural fallback the loader uses before any GLB has loaded). Keep the same scale and float height as the other digits. Tint it neutral grey (Decision 13).
- **Tests first:** `outcomeMarkerKey(0)` resolves to a registered asset; the outcome marker for 0 wounds is built from the same loader path as 1–5 (no torus).
- **Docs:** `doc/ASSETS.md` asset inventory row for `number-0.glb` and the marker table ("Wound Outcome (0)").
- **Manual checks:** §7 add: a 0-wound attack shows a "0" digit in the same style as 1–5.
