// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CustomMapDefinition,
  createBlankMap,
  createStandardBattlefieldMap,
  TERRAIN_PALETTE_CATALOG,
} from '@skirmish-lab/shared';
import { legacyScenarioTerrain } from '../../../shared/tests/fixtures/legacyScenarioTerrain';
import { MapEditor } from '../../src/editor/MapEditor';
import { MapStore } from '../../src/storage/MapStore';

describe('MapEditor 3D Battlefield Builder', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('initializes with default map preset and renders hidden until show()', () => {
    const editor = new MapEditor(container);
    const overlay = container.querySelector('#map-editor-overlay') as HTMLElement;

    expect(overlay).toBeTruthy();
    expect(overlay.style.display).toBe('none');

    editor.show();
    expect(overlay.style.display).toBe('block');
    expect(overlay.textContent).toContain('Map Builder');
  });

  it('switches palette categories and lists matching terrain pieces', () => {
    const editor = new MapEditor(container);
    editor.show();

    // Default category is structures
    let paletteItems = container.querySelectorAll('.editor-palette-item');
    expect(paletteItems.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('L-Corner Ruin');

    // Click Walls category
    const wallsBtn = container.querySelector('button[data-category="walls"]') as HTMLButtonElement;
    expect(wallsBtn).toBeTruthy();
    wallsBtn.click();

    expect(container.textContent).toContain('Solid Wall');
    expect(container.textContent).toContain('Window Wall');

    // Objectives are placed by the players in the game, so the editor has no objective tool
    expect(container.querySelector('button[data-category="objectives"]')).toBeNull();
    expect(container.querySelector('.editor-palette-item[data-type="objective"]')).toBeNull();
    expect(container.querySelector('#autoObjBtn')).toBeNull();
    expect(container.textContent).not.toContain('Objective Beacon');
  });

  it('toggles placement mode when clicking a palette item', () => {
    const editor = new MapEditor(container);
    editor.show();

    const buildingItem = container.querySelector('.editor-palette-item[data-type="ruin-l"]') as HTMLButtonElement;
    expect(buildingItem).toBeTruthy();
    buildingItem.click();

    expect(editor.getActivePlacementType()).toBe('ruin-l');

    // Clicking again cancels placement
    buildingItem.click();
    expect(editor.getActivePlacementType()).toBeNull();
  });

  it('snaps coordinates to grid based on gridSnap setting (1.0", 0.5", Free)', () => {
    const editor = new MapEditor(container);

    // 1.0" snap
    editor.setGridSnap(1.0);
    expect(editor.snapCoord(2.3)).toBe(2.0);
    expect(editor.snapCoord(2.7)).toBe(3.0);

    // 0.5" snap
    editor.setGridSnap(0.5);
    expect(editor.snapCoord(2.3)).toBe(2.5);
    expect(editor.snapCoord(2.1)).toBe(2.0);
    expect(editor.snapCoord(2.7)).toBe(2.5);

    // Free snap
    editor.setGridSnap(0);
    expect(editor.snapCoord(2.34)).toBe(2.34);
  });

  it('places a terrain piece with smart defaults from catalog and selects it', () => {
    const editor = new MapEditor(container);
    editor.clearBoard();

    const placed = editor.placePieceAt('ruin-l', { x: 4.2, y: 0, z: -2.8 });

    expect(placed).toBeTruthy();
    expect(placed!.terrainType).toBe('ruin-l');
    expect(placed!.position.x).toBe(4.0); // snapped 1.0"
    expect(placed!.position.z).toBe(-3.0); // snapped 1.0"
    expect(placed!.blocksLineOfSight).toBe(true);
    expect(placed!.providesCover).toBe(true);
    expect(placed!.scale).toEqual({ x: 4, y: 4, z: 4 });

    const map = editor.getMap();
    expect(map.terrain).toHaveLength(1);
    expect(editor.getSelectedPieceId()).toBe(placed!.id);
  });

  it('supports surface auto-stacking on elevated platforms', () => {
    const editor = new MapEditor(container);
    editor.clearBoard();

    // Place ground platform at y = 2.5
    editor.placePieceAt('platform', { x: 0, y: 2.5, z: 0 });

    // Place crate on top at y = 2.5
    const crate = editor.placePieceAt('crate', { x: 0, y: 2.5, z: 0 }, 0, 2.5);

    expect(crate).toBeTruthy();
    expect(crate!.position.y).toBe(2.5);
  });

  it('rotates selected piece by 90 degrees with hotkey R or rotate button', () => {
    const editor = new MapEditor(container);
    editor.show();
    editor.clearBoard();
    const piece = editor.placePieceAt('wall', { x: 0, y: 0, z: 0 });
    expect(piece!.rotation.y).toBe(0);

    // Hotkey R
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    let updated = editor.getMap().terrain.find((t) => t.id === piece!.id);
    expect(updated!.rotation.y).toBeCloseTo(Math.PI / 2);

    // Rotate again
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    updated = editor.getMap().terrain.find((t) => t.id === piece!.id);
    expect(updated!.rotation.y).toBeCloseTo(Math.PI);
  });

  it('adjusts elevation with hotkeys E (+0.5") and Q (-0.5")', () => {
    const editor = new MapEditor(container);
    editor.show();
    editor.clearBoard();
    const piece = editor.placePieceAt('platform', { x: 0, y: 2.0, z: 0 }, 0, 2.0);

    // Press E to raise
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    let updated = editor.getMap().terrain.find((t) => t.id === piece!.id);
    expect(updated!.position.y).toBe(2.5);
    expect(updated!.elevation).toBe(2.5);

    // Press Q to lower
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    updated = editor.getMap().terrain.find((t) => t.id === piece!.id);
    expect(updated!.position.y).toBe(2.0);
  });

  it('duplicates selected piece with Ctrl+D', () => {
    const editor = new MapEditor(container);
    editor.show();
    editor.clearBoard();
    editor.placePieceAt('crate', { x: 2, y: 0, z: 2 });
    expect(editor.getMap().terrain).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));

    const terrain = editor.getMap().terrain;
    expect(terrain).toHaveLength(2);
    expect(terrain[1].position.x).toBe(3); // offset +1
    expect(terrain[1].position.z).toBe(3);
  });

  it('deletes selected piece with Delete key', () => {
    const editor = new MapEditor(container);
    editor.show();
    editor.clearBoard();
    editor.placePieceAt('column', { x: 0, y: 0, z: 0 });
    expect(editor.getMap().terrain).toHaveLength(1);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));

    expect(editor.getMap().terrain).toHaveLength(0);
    expect(editor.getSelectedPieceId()).toBeNull();
  });

  it('keeps no objectives: an old save loads, its markers are dropped, and nothing is saved or exported with them', () => {
    const old = createBlankMap('Old save');
    old.objectives = [{ id: 'o-1', name: 'Obj One', position: { x: 4, y: 0, z: 4 }, controllingPlayerId: null, isContested: false }];
    const editor = new MapEditor(container, { initialMap: old });
    expect(editor.getMap().objectives).toBeUndefined();
    editor.setMap(old);
    expect(editor.getMap().objectives).toBeUndefined();
    expect(editor.exportJson()).not.toContain('objectives');
    // No objective warnings either, even for a one-marker save
    editor.show();
    expect(container.textContent).not.toMatch(/objective/i);
  });

  it('validates map and updates warning badge dynamically', () => {
    const editor = new MapEditor(container);
    editor.clearBoard();

    // 0 terrain pieces generates warning
    let notices = editor.getValidationNotices();
    expect(notices.some((n) => n.message.includes('0 terrain pieces'))).toBe(true);

    const badge = container.querySelector('#validationBadgeBtn') as HTMLButtonElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Notice');

    // Place a valid preset map with 0 warnings
    editor.setMap({ ...createBlankMap(), terrain: legacyScenarioTerrain() });
    notices = editor.getValidationNotices();
    expect(notices).toHaveLength(0);

    const readyBadge = container.querySelector('#validationBadgeBtn') as HTMLButtonElement;
    expect(readyBadge.textContent).toContain('Ready');
  });

  it('allows map renaming and triggers onSave and onExit callbacks', () => {
    const onSaveSpy = vi.fn();
    const onExitSpy = vi.fn();

    const editor = new MapEditor(container, {
      onSave: onSaveSpy,
      onExit: onExitSpy,
    });
    editor.show();

    const nameInput = container.querySelector('#mapNameInput') as HTMLInputElement;
    nameInput.value = 'Outpost Sigma';
    nameInput.dispatchEvent(new Event('input'));

    expect(editor.getMap().name).toBe('Outpost Sigma');

    const saveBtn = container.querySelector('#saveMapBtn') as HTMLButtonElement;
    saveBtn.click();
    expect(onSaveSpy).toHaveBeenCalledTimes(1);
    expect(onSaveSpy.mock.calls[0][0].name).toBe('Outpost Sigma');

    const exitBtn = container.querySelector('#exitEditorBtn') as HTMLButtonElement;
    exitBtn.click();
    expect(onExitSpy).toHaveBeenCalledTimes(1);
  });

  it('nudges the selected piece', () => {
    const editor = new MapEditor(container);
    editor.show();

    const piece = editor.placePieceAt('building-a', { x: 0, y: 0, z: 0 });
    expect(piece).toBeDefined();

    editor.selectPiece(piece!.id);
    editor.nudgeSelected(1.0, -1.0);

    const updatedPiece = editor.getMap().terrain.find((t) => t.id === piece!.id);
    expect(updatedPiece?.position.x).toBe(1.0);
    expect(updatedPiece?.position.z).toBe(-1.0);
  });

  it('handles inspector buttons for rotation, elevation, duplicate, and nudge', () => {
    const editor = new MapEditor(container);
    editor.show();

    const piece = editor.placePieceAt('building-a', { x: 0, y: 0, z: 0 });
    editor.selectPiece(piece!.id);

    // Test nudge buttons
    const nudgeRightBtn = container.querySelector('#nudgeRightBtn') as HTMLButtonElement;
    expect(nudgeRightBtn).toBeTruthy();
    nudgeRightBtn.click();
    expect(editor.getMap().terrain.find((t) => t.id === piece!.id)?.position.x).toBe(1.0);

    // Test rotate button
    const rotBtn = container.querySelector('#inspectRotateBtn') as HTMLButtonElement;
    expect(rotBtn).toBeTruthy();
    rotBtn.click();
    expect(editor.getMap().terrain.find((t) => t.id === piece!.id)?.rotation.y).toBeCloseTo(Math.PI / 2);

    // Test elevation buttons
    const elevateBtn = container.querySelector('#inspectElevateBtn') as HTMLButtonElement;
    elevateBtn.click();
    expect(editor.getMap().terrain.find((t) => t.id === piece!.id)?.position.y).toBe(0.5);

    const lowerBtn = container.querySelector('#inspectLowerBtn') as HTMLButtonElement;
    lowerBtn.click();
    expect(editor.getMap().terrain.find((t) => t.id === piece!.id)?.position.y).toBe(0.0);

    // Test duplicate button
    const dupBtn = container.querySelector('#inspectDuplicateBtn') as HTMLButtonElement;
    dupBtn.click();
    expect(editor.getMap().terrain.length).toBeGreaterThan(1);
  });

  it('exports and imports custom map JSON definitions', () => {
    const editor = new MapEditor(container);
    editor.show();

    const json = editor.exportJson();
    expect(typeof json).toBe('string');
    expect(json).toContain('Empty Battlefield');

    const customJson = JSON.stringify({
      id: 'custom-export-test',
      name: 'Custom Refinery Zone',
      terrain: [
        {
          id: 'test-piece-1',
          type: 'building-c',
          position: { x: -5, y: 1.5, z: 2 },
          scale: { x: 5, y: 3, z: 5 },
          rotation: 0,
        },
      ],
      objectives: [],
    });

    const imported = editor.importJson(customJson);
    expect(imported.id).toBe('custom-export-test');
    expect(imported.name).toBe('Custom Refinery Zone');
    expect(editor.getMap().terrain).toHaveLength(1);
  });

  it('Climbable checkbox reflects the catalog default, writes piece.climbable and round-trips through export/import', () => {
    const editor = new MapEditor(container);
    editor.show();
    const crate = editor.placePieceAt('shipping-container', { x: 0, y: 0, z: 0 })!;
    editor.selectPiece(crate.id);
    let box = container.querySelector('#inspectClimbable') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.checked).toBe(true);

    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(editor.getMap().terrain.find((t) => t.id === crate.id)?.climbable).toBe(false);

    const json = editor.exportJson();
    editor.importJson(json);
    const back = editor.getMap().terrain.find((t) => t.id === crate.id);
    expect(back?.climbable).toBe(false);

    editor.selectPiece(crate.id);
    box = container.querySelector('#inspectClimbable') as HTMLInputElement;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(editor.getMap().terrain.find((t) => t.id === crate.id)?.climbable).toBe(true);
  });

  it('Climbable checkbox is hidden for pieces without a walkable floor', () => {
    const editor = new MapEditor(container);
    editor.show();
    const wall = editor.placePieceAt('wall', { x: 0, y: 0, z: 0 })!;
    editor.selectPiece(wall.id);
    expect(container.querySelector('#inspectClimbable')).toBeNull();
  });

  describe('area terrain palette and flags (13.6E)', () => {
    const toggle = (selector: string, on: boolean) => {
      const box = container.querySelector(selector) as HTMLInputElement;
      box.checked = on;
      box.dispatchEvent(new Event('change'));
    };

    it('the palette has an Area Terrain category listing both area pieces', () => {
      const editor = new MapEditor(container);
      editor.show();
      const btn = container.querySelector('button[data-category="area"]') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toContain('Area Terrain');
      btn.click();
      expect(container.textContent).toContain(TERRAIN_PALETTE_CATALOG['rubble-field'].displayName);
      expect(container.textContent).toContain(TERRAIN_PALETTE_CATALOG['hazard-pool'].displayName);
    });

    it('placing area pieces copies the catalog flags and gives no elevation', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      const rubble = editor.placePieceAt('rubble-field', { x: 0, y: 0, z: 0 })!;
      const pool = editor.placePieceAt('hazard-pool', { x: 8, y: 0, z: 0 })!;
      expect(rubble.isDifficult).toBe(true);
      expect(rubble.isDangerous).toBeUndefined();
      expect(rubble.elevation).toBeUndefined();
      expect(pool.isDangerous).toBe(true);
      expect(pool.isDifficult).toBeUndefined();
      expect(pool.elevation).toBeUndefined();
      // Ordinary pieces carry no explicit flags
      const crate = editor.placePieceAt('crate', { x: 0, y: 0, z: 8 })!;
      expect('isDifficult' in crate).toBe(false);
      expect('isDangerous' in crate).toBe(false);
    });

    it('the inspector shows the effective flags', () => {
      const editor = new MapEditor(container);
      editor.show();
      const rubble = editor.placePieceAt('rubble-field', { x: 0, y: 0, z: 0 })!;
      editor.selectPiece(rubble.id);
      expect((container.querySelector('#inspectDifficult') as HTMLInputElement).checked).toBe(true);
      expect((container.querySelector('#inspectDangerous') as HTMLInputElement).checked).toBe(false);
      const pool = editor.placePieceAt('hazard-pool', { x: 8, y: 0, z: 0 })!;
      editor.selectPiece(pool.id);
      expect((container.querySelector('#inspectDifficult') as HTMLInputElement).checked).toBe(false);
      expect((container.querySelector('#inspectDangerous') as HTMLInputElement).checked).toBe(true);
    });

    it('unchecking Difficult stores an explicit false; checking Dangerous on a crate stores true; both survive save and load', () => {
      const editor = new MapEditor(container);
      editor.show();
      const rubble = editor.placePieceAt('rubble-field', { x: 0, y: 0, z: 0 })!;
      editor.selectPiece(rubble.id);
      toggle('#inspectDifficult', false);
      expect(editor.getMap().terrain.find((t) => t.id === rubble.id)?.isDifficult).toBe(false);

      const crate = editor.placePieceAt('crate', { x: 0, y: 0, z: 8 })!;
      editor.selectPiece(crate.id);
      expect((container.querySelector('#inspectDangerous') as HTMLInputElement).checked).toBe(false);
      toggle('#inspectDangerous', true);
      expect(editor.getMap().terrain.find((t) => t.id === crate.id)?.isDangerous).toBe(true);

      editor.importJson(editor.exportJson());
      const terrain = editor.getMap().terrain;
      expect(terrain.find((t) => t.id === rubble.id)?.isDifficult).toBe(false);
      expect(terrain.find((t) => t.id === crate.id)?.isDangerous).toBe(true);
      editor.selectPiece(rubble.id);
      expect((container.querySelector('#inspectDifficult') as HTMLInputElement).checked).toBe(false);
    });

    it('area pieces follow the scatter stacking rule: ground stays ground, dropped on a deck sits on it', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      editor.placePieceAt('platform-small', { x: 0, y: 0, z: 0 });
      const onGround = editor.placePieceAt('rubble-field', { x: 10, y: 0, z: 10 })!;
      expect(onGround.position.y).toBe(0);
      const onDeck = editor.placePieceAt('hazard-pool', { x: 0, y: 2.9, z: 0 }, 0, 2.9)!;
      expect(onDeck.position.y).toBe(3.0);
      expect(onDeck.elevation).toBeUndefined();
    });
  });

  it('loadMap returns false for unknown ids', () => {
    const editor = new MapEditor(container);
    editor.show();
    expect(editor.loadMap('custom:does-not-exist')).toBe(false);
    expect(editor.loadMap('')).toBe(false);
  });

  describe('elevation: stacking and ladder snapping (13.6C)', () => {
    it('lists platforms and stairs & ladders categories in the palette', () => {
      const editor = new MapEditor(container);
      editor.show();
      const labels = Array.from(container.querySelectorAll('.editor-cat-btn')).map((b) => b.textContent ?? '');
      expect(labels.join('|').toLowerCase()).toContain('platforms');
      expect(labels.join('|').toLowerCase()).toContain('stairs');
    });

    it('a barricade dropped near a deck top sits exactly on it (3.0") without becoming a floor itself', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      editor.placePieceAt('platform-small', { x: 0, y: 0, z: 0 });
      const rail = editor.placePieceAt('barricade', { x: 0, y: 2.9, z: 0 }, 0, 2.9);
      expect(rail!.position.y).toBe(3.0);
      expect(rail!.elevation).toBeUndefined();
      expect(rail!.isWalkable).toBe(false);
    });

    it('floors, stairs and pillars are never auto-stacked', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      editor.placePieceAt('platform-small', { x: 0, y: 0, z: 0 });
      const pillar = editor.placePieceAt('support-pillar', { x: 0, y: 2.9, z: 0 }, 0, 2.9);
      expect(pillar!.position.y).toBe(2.9);
    });

    it('a ladder snaps onto the nearest deck face, facing the deck, climbing to its top', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      editor.placePieceAt('platform-small', { x: 0, y: 0, z: 0 }); // x/z in [-2, 2], top 3.0
      const ladder = editor.placePieceAt('ladder', { x: 3, y: 0, z: 1 })!;
      // Nearest face is the east face (x = 2): ladder centred on the face line, facing -x (into the deck)
      expect(ladder.position.x).toBeCloseTo(2);
      expect(ladder.position.z).toBeCloseTo(1);
      expect(ladder.rotation.y).toBeCloseTo(-Math.PI / 2);
      expect(ladder.scale.y).toBeCloseTo(3.0);
    });

    it('stairs snap to the nearest deck face: head end on the face, climbing toward the deck', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      editor.placePieceAt('platform-small', { x: 0, y: 0, z: 0 }); // x/z in [-2, 2], top 3.0
      const stairs = editor.placePieceAt('stairs', { x: 3, y: 0, z: 0 })!;
      // East face (x = 2): stairs are 4" long, so centre sits 2" out; head (local +Z) points -x into the deck
      expect(stairs.position.x).toBeCloseTo(4);
      expect(stairs.position.z).toBeCloseTo(0);
      expect(stairs.rotation.y).toBeCloseTo(-Math.PI / 2);
      expect(stairs.scale.y).toBeCloseTo(3.0);
    });

    it('a ladder far from any floor stays where it was placed', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      editor.placePieceAt('platform-small', { x: 0, y: 0, z: 0 });
      const ladder = editor.placePieceAt('ladder', { x: 9, y: 0, z: 9 })!;
      expect(ladder.position.x).toBe(9);
      expect(ladder.rotation.y).toBe(0);
    });

    it('a ladder snaps to the ruin ledge face inside the courtyard', () => {
      const editor = new MapEditor(container);
      editor.clearBoard();
      editor.placePieceAt('ruin-l', { x: 0, y: 0, z: 0 });
      const ladder = editor.placePieceAt('ladder', { x: 1, y: 0, z: -0.5 })!;
      // North ledge strip's south edge is at z = 0.5 (courtyard side)
      expect(ladder.position.z).toBeCloseTo(0.5);
      expect(ladder.scale.y).toBeCloseTo(3.0);
    });
  });
});

describe('MapEditor selection and board size', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('a click on the board selects the terrain piece under it, and open ground deselects', () => {
    const editor = new MapEditor(container);
    editor.show();
    editor.handleBoardClick({ x: 4, y: 0, z: 4 }, 'some-terrain');
    expect(editor.getSelectedPieceId()).toBe('some-terrain');
    editor.handleBoardClick({ x: 5.1, y: 0, z: 4 });
    expect(editor.getSelectedPieceId()).toBeNull();
  });

  describe('board size control', () => {
    function memoryStorage(): Storage {
      const m = new Map<string, string>();
      return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
        clear: () => m.clear(),
        key: (i) => Array.from(m.keys())[i] ?? null,
        get length() {
          return m.size;
        },
      };
    }

    function pickPreset(id: string): void {
      const sel = container.querySelector('#boardPresetSelect') as HTMLSelectElement;
      sel.value = id;
      sel.dispatchEvent(new Event('change'));
    }

    function setInput(id: string, value: string): void {
      const el = container.querySelector(id) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new Event('change'));
    }

    it('starts on the 48x48 standard preset', () => {
      const editor = new MapEditor(container);
      editor.show();
      expect(editor.getBoardSize()).toEqual({ width: 48, height: 48 });
      expect((container.querySelector('#boardPresetSelect') as HTMLSelectElement).value).toBe('48x48');
    });

    it('selecting a preset resizes the map board and the live game view', () => {
      const syncFromState = vi.fn();
      const gameView = { syncFromState, onPick: vi.fn(), setTerrainDebugMarker: vi.fn() } as any;
      const editor = new MapEditor(container, { gameView });
      editor.show();
      pickPreset('24x36');
      expect(editor.getMap().board).toMatchObject({ width: 24, height: 36 });
      const last = syncFromState.mock.calls.at(-1)![0];
      expect(last.board.width).toBe(24);
      expect(last.board.height).toBe(36);
      expect((container.querySelector('#boardPresetSelect') as HTMLSelectElement).value).toBe('24x36');
    });

    it('Custom shows width/height inputs, applies them, and clamps to 24-72', () => {
      const editor = new MapEditor(container);
      editor.show();
      expect(container.querySelector('#boardWidthInput')).toBeNull();
      pickPreset('custom');
      expect(container.querySelector('#boardWidthInput')).toBeTruthy();
      setInput('#boardWidthInput', '40');
      expect(editor.getBoardSize()).toEqual({ width: 40, height: 48 });
      setInput('#boardHeightInput', '500');
      expect(editor.getBoardSize().height).toBe(72);
      setInput('#boardWidthInput', '3');
      expect(editor.getBoardSize().width).toBe(24);
    });

    it('custom entry equal to a preset keeps the custom inputs visible', () => {
      const editor = new MapEditor(container);
      editor.show();
      pickPreset('custom');
      setInput('#boardWidthInput', '36');
      setInput('#boardHeightInput', '36');
      expect(container.querySelector('#boardWidthInput')).toBeTruthy();
      expect(editor.getBoardSize()).toEqual({ width: 36, height: 36 });
    });

    it('terrain outside a smaller board raises a visible notice; growing the board clears it', () => {
      const editor = new MapEditor(container);
      editor.show();
      const map = editor.getMap();
      map.terrain = [{ ...legacyScenarioTerrain()[0], id: 'far', position: { x: 22, y: 0, z: 0 } }];
      editor.setMap(map);
      const outside = () =>
        editor.getValidationNotices().some((n) => n.message.includes('"far"') && n.message.includes('outside'));
      expect(outside()).toBe(false);
      pickPreset('36x36');
      expect(outside()).toBe(true);
      expect(container.querySelector('#validationBadgeBtn')!.textContent).toMatch(/Notice|Error/);
      pickPreset('48x48');
      expect(outside()).toBe(false);
    });

    it('persists the size through export/import and save/load', () => {
      const mapStore = new MapStore(memoryStorage());
      const editor = new MapEditor(container, { mapStore });
      editor.show();
      pickPreset('custom');
      setInput('#boardWidthInput', '60');
      setInput('#boardHeightInput', '30');

      const other = new MapEditor(document.createElement('div'), { mapStore: new MapStore(memoryStorage()) });
      other.importJson(editor.exportJson());
      expect(other.getBoardSize()).toEqual({ width: 60, height: 30 });

      editor.saveToStore();
      const reopened = new MapEditor(document.createElement('div'), { mapStore });
      expect(reopened.loadMap(editor.getMap().id)).toBe(true);
      expect(reopened.getBoardSize()).toEqual({ width: 60, height: 30 });
    });
  });

  describe('built-in maps', () => {
    function memoryStore(): MapStore {
      const mem = new Map<string, string>();
      return new MapStore({
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
        key: (i: number) => Array.from(mem.keys())[i] ?? null,
        get length() { return mem.size; },
      } as Storage);
    }

    it('Load list has a Built-in group with the Standard Battlefield', () => {
      const editor = new MapEditor(container, { mapStore: memoryStore() });
      editor.show();
      const select = container.querySelector('#loadMapSelect') as HTMLSelectElement;
      const group = Array.from(select.querySelectorAll('optgroup')).find((g) => g.label === 'Built-in');
      expect(group).toBeTruthy();
      expect((group!.querySelector('option') as HTMLOptionElement).value).toBe('builtin:standard-battlefield');
    });

    it('loading it gives a renamed deep copy with a fresh id', () => {
      const editor = new MapEditor(container, { mapStore: memoryStore() });
      editor.show();
      expect(editor.loadMap('builtin:standard-battlefield')).toBe(true);
      const map = editor.getMap();
      const original = JSON.parse(JSON.stringify(createStandardBattlefieldMap())); // JSON drops -0
      expect(map.id).toMatch(/^custom-\d+$/);
      expect(map.name).toBe('Standard Battlefield (copy)');
      expect(map.terrain).toEqual(original.terrain);
      expect(map.objectives).toEqual(original.objectives);
      expect(map.board).toEqual(original.board);
      // Mutating the loaded copy does not leak into the next load
      map.terrain!.length = 0;
      editor.loadMap('builtin:standard-battlefield');
      expect(editor.getMap().terrain?.length).toBe(original.terrain?.length);
    });

    it('loading via the select works and saving never stores the built-in id', () => {
      const mapStore = memoryStore();
      const editor = new MapEditor(container, { mapStore });
      editor.show();
      const select = container.querySelector('#loadMapSelect') as HTMLSelectElement;
      select.value = 'builtin:standard-battlefield';
      select.dispatchEvent(new Event('change'));
      editor.saveToStore();
      const saved = mapStore.getMaps();
      expect(saved).toHaveLength(1);
      expect(saved[0].name).toBe('Standard Battlefield (copy)');
      expect(saved[0].id).not.toBe('standard-battlefield');
    });

    it('unknown built-in ids fail to load', () => {
      const editor = new MapEditor(container, { mapStore: memoryStore() });
      expect(editor.loadMap('builtin:nope')).toBe(false);
    });
  });

  describe('cleanup and inspection reactivity (G-26)', () => {
    it('unsubscribes onPick listener when disposed', () => {
      const unsubscribe = vi.fn();
      const mockGameView = {
        onPick: vi.fn().mockReturnValue(unsubscribe),
        syncFromState: vi.fn(),
      } as any;

      const editor = new MapEditor(container, { gameView: mockGameView });
      expect(mockGameView.onPick).toHaveBeenCalledTimes(1);

      editor.dispose();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('syncs game view and revalidates map when inspector checkboxes are toggled', () => {
      const mockGameView = {
        onPick: vi.fn().mockReturnValue(() => {}),
        syncFromState: vi.fn(),
        setTerrainDebugMarker: vi.fn(),
      } as any;

      const editor = new MapEditor(container, { gameView: mockGameView });
      editor.show();
      const piece = editor.placePieceAt('crate', { x: 0, y: 0, z: 0 });
      expect(piece).toBeTruthy();

      mockGameView.syncFromState.mockClear();

      const coverCheck = container.querySelector('#inspectCover') as HTMLInputElement;
      expect(coverCheck).toBeTruthy();
      coverCheck.checked = false;
      coverCheck.dispatchEvent(new Event('change'));

      expect(piece!.providesCover).toBe(false);
      expect(mockGameView.syncFromState).toHaveBeenCalled();

      mockGameView.syncFromState.mockClear();
      const losCheck = container.querySelector('#inspectLos') as HTMLInputElement;
      expect(losCheck).toBeTruthy();
      losCheck.checked = true;
      losCheck.dispatchEvent(new Event('change'));

      expect(piece!.blocksLineOfSight).toBe(true);
      expect(mockGameView.syncFromState).toHaveBeenCalled();
    });

    it('renders a map name and piece ID containing <img src=x onerror=…> as text, not as an element (G-06)', () => {
      const memoryStorage = new Map<string, string>();
      const mockStorage: Storage = {
        getItem: (k: string) => memoryStorage.get(k) ?? null,
        setItem: (k: string, v: string) => memoryStorage.set(k, v),
        removeItem: (k: string) => memoryStorage.delete(k),
        clear: () => memoryStorage.clear(),
        key: (i: number) => Array.from(memoryStorage.keys())[i] ?? null,
        get length() {
          return memoryStorage.size;
        },
      };
      const mapStore = new MapStore(mockStorage);
      mapStore.saveMap({
        id: 'xss-saved-map',
        name: '<img src=x onerror=alert("map-name")>',
        board: { width: 48, height: 48 },
        terrain: [],
      });

      const editor = new MapEditor(container, { mapStore });
      editor.setMap({
        id: 'current-xss-map',
        name: '<img src=x onerror=alert("current-map")>',
        board: { width: 48, height: 48 },
        terrain: [
          {
            id: '<img src=x onerror=alert("piece-id")>',
            terrainType: 'crate',
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 0.75, z: 1 },
            providesCover: true,
            blocksLineOfSight: false,
            isObstacle: true,
          },
        ],
      });
      editor.show();

      // Select the piece to show the inspector
      editor.selectPiece('<img src=x onerror=alert("piece-id")>');

      // No <img> elements should have been created by innerHTML interpolation
      expect(container.querySelectorAll('img').length).toBe(0);

      // Verify the map name and piece ID render as text, not HTML elements
      const nameInput = container.querySelector('#mapNameInput') as HTMLInputElement;
      expect(nameInput.value).toBe('<img src=x onerror=alert("current-map")>');
      expect(container.textContent).toContain('<img src=x onerror=alert("map-name")>');
      expect(container.textContent).toContain('<img src=x onerror=alert("piece-id")>');
      expect(container.innerHTML).toContain('&lt;img src=x');
    });
  });
});
