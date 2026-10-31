# Phase 13 Manual Testing Verification Checklist: 3D Map Builder & Battlefield Editor

This checklist guides manual verification of the **3D Map Builder & Battlefield Editor** (Phase 13), covering 3D palette placement, surface auto-stacking, grid snapping, hotkeys, property inspection, map persistence (`MapStore`), JSON import/export, and multiplayer WebRTC custom battlefield synchronization.

---

## Prerequisites
- Run two browser tabs / windows (Chrome, Edge, Firefox, or Brave):
  - **Tab A:** Host
  - **Tab B:** Guest
- Dev server running (`npm run dev`) or production build served.

---

## 1. Map Builder Launch & Viewport Navigation
- [ ] In Tab A, open the lobby at `http://localhost:5173/` (or deployed URL).
- [ ] Observe the `[🛠️ Map Builder]` button at the bottom of the Lobby card.
- [ ] Click `[🛠️ Map Builder]`:
  - [ ] Lobby overlay fades/hides.
  - [ ] Map builder UI overlay appears with top toolbar, bottom palette dock, and hint footer.
  - [ ] 3D battlefield grid (44" x 30") renders with the default `frontier-outpost` preset terrain.
- [ ] Test 3D camera controls:
  - [ ] Left-click and drag on empty canvas to orbit the camera.
  - [ ] Right-click and drag to pan across the battlefield.
  - [ ] Scroll wheel to zoom in and out.

---

## 2. Category Palette & Piece Placement
- [ ] In the bottom palette dock, cycle through the category tabs:
  - [ ] **🏢 Structures:** Shows Industrial Warehouse, Refinery Facility, Chemical Silo, Service Workshop, Two-Story Factory.
  - [ ] **🧱 Walls & Doors:** Shows Solid Wall, Wall Doorway, Wall Window, Short Segment, Low Parapet.
  - [ ] **🔲 Catwalks:** Shows Elevated Platform, Large Catwalk Deck, Walkway Bridge, Corner Deck.
  - [ ] **🪜 Stairs & Ladders:** Shows Metal Stairs, Open Stairs, Compact Steps, Railed Stairs, Ladder.
  - [ ] **📦 Cover & Pipes:** Shows Pillar, Support Column, Conduits, Door/Window Barricades.
  - [ ] **🎯 Objectives:** Shows Objective Beacon (3.0" control radius).
- [ ] Click **Industrial Warehouse** in Structures:
  - [ ] Button highlights blue indicating placement mode.
- [ ] Click on the battlefield grid:
  - [ ] Warehouse piece is placed at the clicked position, snapped to the nearest 1.0" coordinate.
- [ ] Test grid snapping settings in the top toolbar:
  - [ ] Click `0.5"`: place a wall piece; verify position snaps to half-inch increments (e.g. `x = 2.5`).
  - [ ] Click `Free`: place a piece; verify position places at exact floating coordinates.
  - [ ] Click `1.0"`: verify snapping returns to whole inches.

---

## 3. Surface Auto-Stacking (Multi-Tier Terrain)
- [ ] Select **Large Catwalk Deck** (`roof-flat-patch-large`) or **Low Parapet** (`wall-low`) from the palette.
- [ ] Click directly on top of a placed Industrial Warehouse ($y = 3.5″$):
  - [ ] The platform/parapet is placed elevated on the warehouse roof rather than sinking into ground level ($y = 0$).
  - [ ] Inspect coordinates; verify elevation equals rooftop surface height.

---

## 4. Keyboard Shortcuts & Selection Manipulation
- [ ] Click to select a placed terrain piece:
  - [ ] Yellow highlight debug marker appears under the selected piece.
  - [ ] Floating Property Inspector drawer appears in top-right corner.
- [ ] Test manipulation hotkeys:
  - [ ] Press **`R`**: piece rotates 90° clockwise around Y-axis.
  - [ ] Press **`E`**: piece elevation raises by +0.5".
  - [ ] Press **`Q`**: piece elevation lowers by -0.5" (clamped at ground $y = 0$).
  - [ ] Press **`Ctrl+D`**: duplicates the selected piece, placing a clone offset by +1.0" with identical rotation.
  - [ ] Press **`Delete`** or **`Backspace`**: selected piece is removed from the battlefield.
  - [ ] Press **`Esc`**: deselects piece.

---

## 5. Property Inspector & Precision Nudge
- [ ] Select a placed piece (e.g. Refinery Facility) to open Property Inspector:
  - [ ] Displays piece friendly name, ID, position `(X, Y, Z)`, and rotation angle.
- [ ] Test Nudge Controls:
  - [ ] Click `← X-`: piece moves left by the current grid snap step.
  - [ ] Click `→ X+`: piece moves right.
  - [ ] Click `↑ Z-`: piece moves toward North.
  - [ ] Click `↓ Z+`: piece moves toward South.
- [ ] Test Trait Toggles:
  - [ ] Toggle `Provides Cover (+1 Def)` on/off.
  - [ ] Toggle `Blocks Line of Sight` on/off.
  - [ ] Toggle `Impassable Obstacle` on/off.
  - [ ] Toggle `Walkable Surface` on/off.

---

## 6. Objectives & Advisory Validation
- [ ] Click the **🎯 Objectives** category and select **Objective Beacon**.
- [ ] Click on the battlefield:
  - [ ] Objective placed with a 3.0" control radius ring marker.
- [ ] Select objective to open Objective Inspector:
  - [ ] Displays name and position with nudge buttons and `[Remove Objective]`.
- [ ] Test **`[Auto Obj]`** button in top toolbar:
  - [ ] Automatically places 4 balanced tactical objectives across quadrants outside deployment zones ($z = \pm 12″$).
- [ ] Test Advisory Validation Badge:
  - [ ] If all 4 objectives are balanced with $> 9″$ separation and outside deployment zones, badge reads `✓ Ready` in green.
  - [ ] Move an objective inside a deployment zone ($z > 12″$) or within 8″ of another:
    - [ ] Badge turns orange reading `⚠️ X Notices`.
    - [ ] Click the badge: an advisory dialog lists all playability notices without blocking sandbox creativity.

---

## 7. Storage, JSON Import/Export & Presets
- [ ] In the Map Name input, change name to `"Sector 9 Outpost"`.
- [ ] Click **`[Save Map]`**:
  - [ ] Confirmation alert appears: `"Map saved successfully to local storage!"`.
- [ ] Click **`[Export JSON]`**:
  - [ ] Browser initiates download of `sector_9_outpost.json`.
  - [ ] Open the JSON file in an editor; verify clean schema with `id`, `name`, `terrain`, and `objectives`.
- [ ] Click **`[Clear]`**:
  - [ ] All terrain and objectives are wiped; board is blank.
- [ ] Test Preset Loading via `[Load Map / Preset...]` dropdown:
  - [ ] Choose **Industrial Refinery**: 3D scene populates with refineries, chemical silos, catwalks, and pipelines.
  - [ ] Choose **Sector 7 Catwalks**: 3D scene populates with multi-tiered walkways and stairs.
- [ ] Test Saved Custom Map Loading:
  - [ ] In `[Load Map / Preset...]`, select `"Saved Custom Maps" -> "Sector 9 Outpost"`:
    - [ ] Your custom map is re-loaded from `MapStore` into the 3D scene!
- [ ] Test **`[Import JSON]`**:
  - [ ] Click `[Clear]` to wipe board.
  - [ ] Click `[Import JSON]` and upload `sector_9_outpost.json`.
  - [ ] Verify imported map layout loads seamlessly into the editor.

---

## 8. Multiplayer WebRTC Custom Map Synchronization
- [ ] Click **`[Exit]`** in the editor toolbar:
  - [ ] Editor closes and returns to the pre-match Lobby.
- [ ] In Tab A (Host):
  - [ ] Inspect the **Battlefield Map** dropdown:
    - [ ] Displays `Frontier Outpost (Preset)`, `Industrial Refinery (Preset)`, `Sector 7 Catwalks (Preset)`.
    - [ ] Displays your saved map: `Sector 9 Outpost (X pieces)`.
  - [ ] Select **`Sector 9 Outpost`**.
  - [ ] Click **`Create Room (Host)`**.
  - [ ] Room code is generated (e.g. `ABC-XYZ`).
  - [ ] Waiting card shows `Map: Custom: Sector 9 Outpost`.
- [ ] In Tab B (Guest):
  - [ ] Enter room code `ABC-XYZ` and click **`Join Room (Guest)`**.
- [ ] Peer connection handshakes over WebRTC:
  - [ ] Host validates scenario with custom map and broadcasts initial `state-update`.
  - [ ] **Tab A (Host) and Tab B (Guest) BOTH render the identical custom battlefield terrain and objectives!**
- [ ] Verify gameplay over custom map:
  - [ ] Models can deploy, move behind custom walls for cover, climb stairs, and control custom objectives.
  - [ ] Line of sight properly respects custom building and wall positions on both clients.
- [ ] Test Reconnection on Custom Map:
  - [ ] Refresh Tab B (Guest).
  - [ ] Click `[Resume Match]`.
  - [ ] Guest reconnects within grace window and receives authoritative `state-sync`.
  - [ ] Entire custom terrain and objective layout is perfectly restored!
