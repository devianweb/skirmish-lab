// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CustomMapDefinition,
  createBlankMap,
  TERRAIN_PALETTE_CATALOG,
} from '@skirmish-lab/shared';
import { MapEditor } from '../../src/editor/MapEditor';

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
    expect(container.textContent).toContain('Industrial Warehouse');

    // Click Walls category
    const wallsBtn = container.querySelector('button[data-category="walls"]') as HTMLButtonElement;
    expect(wallsBtn).toBeTruthy();
    wallsBtn.click();

    expect(container.textContent).toContain('Solid Wall');
    expect(container.textContent).toContain('Corner Wall');

    // Click Objectives category
    const objBtn = container.querySelector('button[data-category="objectives"]') as HTMLButtonElement;
    expect(objBtn).toBeTruthy();
    objBtn.click();

    expect(container.textContent).toContain('Objective Beacon');
  });

  it('toggles placement mode when clicking a palette item', () => {
    const editor = new MapEditor(container);
    editor.show();

    const buildingItem = container.querySelector('.editor-palette-item[data-type="building-c"]') as HTMLButtonElement;
    expect(buildingItem).toBeTruthy();
    buildingItem.click();

    expect(editor.getActivePlacementType()).toBe('building-c');

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

    const placed = editor.placePieceAt('building-c', { x: 4.2, y: 0, z: -2.8 });

    expect(placed).toBeTruthy();
    expect(placed!.terrainType).toBe('building-c');
    expect(placed!.position.x).toBe(4.0); // snapped 1.0"
    expect(placed!.position.z).toBe(-3.0); // snapped 1.0"
    expect(placed!.blocksLineOfSight).toBe(true);
    expect(placed!.providesCover).toBe(true);
    expect(placed!.isWalkable).toBe(true);
    expect(placed!.elevation).toBe(3.0);

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

  it('places objective beacons and auto-distributes 4 quadrant objectives', () => {
    const editor = new MapEditor(container);
    editor.clearBoard();

    const obj = editor.placeObjectiveAt({ x: -5, y: 0, z: 4 });
    expect(obj).toBeTruthy();
    expect(editor.getMap().objectives).toHaveLength(1);
    expect(obj.name).toContain('Objective Alpha');

    // Auto distribute replaces with 4 standard objectives
    editor.autoDistributeObjectives();
    const objectives = editor.getMap().objectives!;
    expect(objectives).toHaveLength(4);

    const names = objectives.map((o) => o.name);
    expect(names.some((n) => n.includes('Alpha'))).toBe(true);
    expect(names.some((n) => n.includes('Bravo'))).toBe(true);
    expect(names.some((n) => n.includes('Charlie'))).toBe(true);
    expect(names.some((n) => n.includes('Delta'))).toBe(true);
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
    editor.setMap(createBlankMap());
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

  it('nudges selected piece and objective positions', () => {
    const editor = new MapEditor(container);
    editor.show();

    const piece = editor.placePieceAt('building-a', { x: 0, y: 0, z: 0 });
    expect(piece).toBeDefined();

    editor.selectPiece(piece!.id);
    editor.nudgeSelected(1.0, -1.0);

    const updatedPiece = editor.getMap().terrain.find((t) => t.id === piece!.id);
    expect(updatedPiece?.position.x).toBe(1.0);
    expect(updatedPiece?.position.z).toBe(-1.0);

    // Test objective nudge
    const obj = editor.placeObjectiveAt({ x: 2, y: 0, z: 2 });
    editor.selectObjective(obj.id);
    editor.nudgeSelected(-1.0, 1.0);

    const updatedObj = editor.getMap().objectives?.find((o) => o.id === obj.id);
    expect(updatedObj?.position.x).toBe(1.0);
    expect(updatedObj?.position.z).toBe(3.0);
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
    expect(json).toContain('Frontier Outpost');

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

  it('loadMap returns false for unknown ids', () => {
    const editor = new MapEditor(container);
    editor.show();
    expect(editor.loadMap('custom:does-not-exist')).toBe(false);
    expect(editor.loadMap('')).toBe(false);
  });
});
