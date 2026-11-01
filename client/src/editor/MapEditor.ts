import {
  CustomMapDefinition,
  MapValidationNotice,
  Objective,
  createBlankMap,
  TerrainCategory,
  TERRAIN_PALETTE_CATALOG,
  TerrainPiece,
  validateMapDefinition,
  Vector3,
} from '@skirmish-lab/shared';
import { GameView, PickTarget } from '../renderer/GameView';
import { ModelLoader } from '../renderer/ModelLoader';
import { defaultMapStore, MapStore } from '../storage/MapStore';

export interface MapEditorOptions {
  gameView?: GameView;
  modelLoader?: ModelLoader;
  initialMap?: CustomMapDefinition;
  mapStore?: MapStore;
  onExit?: () => void;
  onSave?: (map: CustomMapDefinition) => void;
  onPlay?: (map: CustomMapDefinition) => void;
}

export type GridSnapSetting = 1.0 | 0.5 | 0;

/**
 * 3D Map Builder & Battlefield Editor overlay.
 * Allows tabletop players to visually place, snap, rotate, elevate, and customize
 * modular terrain pieces and objectives on a 44" x 30" skirmish battlefield.
 */
export class MapEditor {
  private container: HTMLElement;
  private rootElement: HTMLElement;
  private options: MapEditorOptions;
  private gameView?: GameView;
  private mapStore: MapStore;

  private currentMap: CustomMapDefinition;
  private selectedPieceId: string | null = null;
  private selectedObjectiveId: string | null = null;
  private activePlacementType: string | null = null;
  private activeCategory: TerrainCategory | 'objectives' = 'structures';
  private gridSnap: GridSnapSetting = 1.0;

  private placementRotationY: number = 0;
  private placementElevation: number = 0;
  private validationNotices: MapValidationNotice[] = [];
  private isVisible: boolean = false;

  private keydownHandler?: (e: KeyboardEvent) => void;
  private pickHandler?: (target: PickTarget) => void;

  constructor(container: HTMLElement, options: MapEditorOptions = {}) {
    this.container = container;
    this.options = options;
    this.gameView = options.gameView;
    this.mapStore = options.mapStore ?? defaultMapStore;

    this.currentMap = options.initialMap
      ? JSON.parse(JSON.stringify(options.initialMap))
      : createBlankMap();

    this.rootElement = document.createElement('div');
    this.rootElement.id = 'map-editor-overlay';
    this.rootElement.style.position = 'fixed';
    this.rootElement.style.inset = '0';
    this.rootElement.style.zIndex = '100';
    this.rootElement.style.pointerEvents = 'none'; // pass clicks through to 3D canvas except on panels
    this.rootElement.style.display = 'none';
    this.container.appendChild(this.rootElement);

    this.setupKeyboardListeners();
    this.setupViewPicking();
  }

  show(): void {
    this.isVisible = true;
    this.rootElement.style.display = 'block';
    this.validateCurrentMap();
    this.render();
    this.syncGameView();
  }

  hide(): void {
    this.isVisible = false;
    this.rootElement.style.display = 'none';
    this.activePlacementType = null;
    this.selectedPieceId = null;
    this.selectedObjectiveId = null;
  }

  getMap(): CustomMapDefinition {
    return JSON.parse(JSON.stringify(this.currentMap));
  }

  setMap(map: CustomMapDefinition): void {
    this.currentMap = JSON.parse(JSON.stringify(map));
    this.selectedPieceId = null;
    this.selectedObjectiveId = null;
    this.activePlacementType = null;
    this.validateCurrentMap();
    this.render();
    this.syncGameView();
  }

  getActivePlacementType(): string | null {
    return this.activePlacementType;
  }

  setPlacementType(type: string | null): void {
    this.activePlacementType = type;
    this.selectedPieceId = null;
    this.selectedObjectiveId = null;
    this.render();
  }

  getSelectedPieceId(): string | null {
    return this.selectedPieceId;
  }

  getSelectedObjectiveId(): string | null {
    return this.selectedObjectiveId;
  }

  getGridSnap(): GridSnapSetting {
    return this.gridSnap;
  }

  setGridSnap(snap: GridSnapSetting): void {
    this.gridSnap = snap;
    this.render();
  }

  getValidationNotices(): MapValidationNotice[] {
    return [...this.validationNotices];
  }

  // --- Grid & Coordinate Snapping ------------------------------------------

  snapCoord(val: number): number {
    if (this.gridSnap === 0) return Math.round(val * 100) / 100;
    return Math.round(val / this.gridSnap) * this.gridSnap;
  }

  // --- Terrain Placement & Manipulation ------------------------------------

  placePieceAt(type: string, pos: Vector3, rotationY = 0, customElevation?: number): TerrainPiece | null {
    const meta = TERRAIN_PALETTE_CATALOG[type];
    const defaultScale = meta?.defaultScale ?? { x: 2, y: 1, z: 2 };

    const pieceId = `terrain-${type}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    const newPiece: TerrainPiece = {
      id: pieceId,
      terrainType: type,
      position: {
        x: this.snapCoord(pos.x),
        y: customElevation !== undefined ? customElevation : (pos.y || 0),
        z: this.snapCoord(pos.z),
      },
      rotation: { x: 0, y: rotationY, z: 0 },
      scale: { ...defaultScale },
      blocksLineOfSight: meta ? meta.blocksLineOfSight : true,
      providesCover: meta ? meta.providesCover : true,
      isObstacle: meta ? meta.isObstacle : true,
      isWalkable: meta?.isWalkable ?? false,
      elevation: customElevation !== undefined ? customElevation : (meta?.elevation ?? undefined),
      climbType: meta?.climbType,
    };

    this.currentMap.terrain.push(newPiece);
    this.selectedPieceId = pieceId;
    this.selectedObjectiveId = null;
    this.validateCurrentMap();
    this.render();
    this.syncGameView();
    return newPiece;
  }

  placeObjectiveAt(pos: Vector3): Objective {
    const objectives = this.currentMap.objectives ?? [];
    const index = objectives.length + 1;
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
    const letter = names[objectives.length] ?? `Objective ${index}`;

    const newObj: Objective = {
      id: `objective-${Date.now().toString(36)}-${index}`,
      name: `Objective ${letter}`,
      position: {
        x: this.snapCoord(pos.x),
        y: pos.y || 0,
        z: this.snapCoord(pos.z),
      },
      controllingPlayerId: null,
      isContested: false,
    };

    if (!this.currentMap.objectives) {
      this.currentMap.objectives = [];
    }
    this.currentMap.objectives.push(newObj);
    this.selectedObjectiveId = newObj.id;
    this.selectedPieceId = null;
    this.validateCurrentMap();
    this.render();
    this.syncGameView();
    return newObj;
  }

  autoDistributeObjectives(): void {
    // 4 standard balanced objectives in quadrant open spaces outside z = ±12
    this.currentMap.objectives = [
      {
        id: `objective-alpha-${Date.now()}`,
        name: 'Objective Alpha (North-West)',
        position: { x: -9, y: 0, z: 5 },
        controllingPlayerId: null,
        isContested: false,
      },
      {
        id: `objective-bravo-${Date.now()}`,
        name: 'Objective Bravo (South-East)',
        position: { x: 9, y: 0, z: -5 },
        controllingPlayerId: null,
        isContested: false,
      },
      {
        id: `objective-charlie-${Date.now()}`,
        name: 'Objective Charlie (Center Catwalk)',
        position: { x: 0, y: 0, z: 0 },
        controllingPlayerId: null,
        isContested: false,
      },
      {
        id: `objective-delta-${Date.now()}`,
        name: 'Objective Delta (South-West)',
        position: { x: -4, y: 0, z: -8.5 },
        controllingPlayerId: null,
        isContested: false,
      },
    ];
    this.validateCurrentMap();
    this.render();
    this.syncGameView();
  }

  clearBoard(): void {
    this.currentMap.terrain = [];
    this.currentMap.objectives = [];
    this.selectedPieceId = null;
    this.selectedObjectiveId = null;
    this.activePlacementType = null;
    this.validateCurrentMap();
    this.render();
    this.syncGameView();
  }

  selectPiece(pieceId: string | null): void {
    this.selectedPieceId = pieceId;
    this.selectedObjectiveId = null;
    this.render();
    this.syncGameView();
  }

  selectObjective(objectiveId: string | null): void {
    this.selectedObjectiveId = objectiveId;
    this.selectedPieceId = null;
    this.render();
    this.syncGameView();
  }

  rotateSelected(): void {
    if (this.selectedPieceId) {
      const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
      if (piece) {
        piece.rotation.y = (piece.rotation.y + Math.PI / 2) % (Math.PI * 2);
        this.syncGameView();
        this.render();
      }
    } else if (this.activePlacementType) {
      this.placementRotationY = (this.placementRotationY + Math.PI / 2) % (Math.PI * 2);
      this.render();
    }
  }

  adjustElevation(delta: number): void {
    if (this.selectedPieceId) {
      const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
      if (piece) {
        piece.position.y = Math.max(0, Math.round((piece.position.y + delta) * 10) / 10);
        if (piece.elevation !== undefined) {
          piece.elevation = Math.max(0, Math.round((piece.elevation + delta) * 10) / 10);
        }
        this.syncGameView();
        this.render();
      }
    } else if (this.activePlacementType) {
      this.placementElevation = Math.max(0, Math.round((this.placementElevation + delta) * 10) / 10);
      this.render();
    }
  }

  duplicateSelected(): TerrainPiece | null {
    if (!this.selectedPieceId) return null;
    const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
    if (!piece) return null;

    const offsetPos: Vector3 = {
      x: this.snapCoord(piece.position.x + 1.0),
      y: piece.position.y,
      z: this.snapCoord(piece.position.z + 1.0),
    };
    return this.placePieceAt(piece.terrainType, offsetPos, piece.rotation.y, piece.elevation);
  }

  deleteSelected(): void {
    if (this.selectedPieceId) {
      this.currentMap.terrain = this.currentMap.terrain.filter((t) => t.id !== this.selectedPieceId);
      this.selectedPieceId = null;
      this.validateCurrentMap();
      this.render();
      this.syncGameView();
    } else if (this.selectedObjectiveId) {
      this.currentMap.objectives = (this.currentMap.objectives ?? []).filter(
        (o) => o.id !== this.selectedObjectiveId
      );
      this.selectedObjectiveId = null;
      this.validateCurrentMap();
      this.render();
      this.syncGameView();
    }
  }

  nudgeSelected(deltaX: number, deltaZ: number): void {
    if (this.selectedPieceId) {
      const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
      if (piece) {
        piece.position.x = this.snapCoord(piece.position.x + deltaX);
        piece.position.z = this.snapCoord(piece.position.z + deltaZ);
        this.validateCurrentMap();
        this.syncGameView();
        this.render();
      }
    } else if (this.selectedObjectiveId) {
      const obj = (this.currentMap.objectives ?? []).find((o) => o.id === this.selectedObjectiveId);
      if (obj) {
        obj.position.x = this.snapCoord(obj.position.x + deltaX);
        obj.position.z = this.snapCoord(obj.position.z + deltaZ);
        this.validateCurrentMap();
        this.syncGameView();
        this.render();
      }
    }
  }

  exportJson(): string {
    return this.mapStore.exportMapJson(this.currentMap);
  }

  importJson(jsonString: string): CustomMapDefinition {
    const imported = this.mapStore.importMapJson(jsonString);
    this.setMap(imported);
    return imported;
  }

  downloadMapJson(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const jsonStr = this.exportJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (this.currentMap.name || 'custom-map')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .toLowerCase();
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  loadMap(idOrCustom: string): boolean {
    if (!idOrCustom) return false;
    const customId = idOrCustom.startsWith('custom:')
      ? idOrCustom.replace('custom:', '')
      : idOrCustom;
    const custom = this.mapStore.getMap(customId);
    if (!custom) return false;
    this.setMap(custom);
    return true;
  }

  saveToStore(): void {
    this.mapStore.saveMap(this.currentMap);
    this.options.onSave?.(this.getMap());
  }

  // --- Keyboard & 3D Canvas Pick Listeners ----------------------------------

  private setupKeyboardListeners(): void {
    if (typeof window === 'undefined') return;

    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.isVisible) return;
      // Don't intercept typing in input fields
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select') return;

      const key = e.key.toLowerCase();

      if (key === 'r') {
        e.preventDefault();
        this.rotateSelected();
      } else if (key === 'e') {
        e.preventDefault();
        this.adjustElevation(0.5);
      } else if (key === 'q') {
        e.preventDefault();
        this.adjustElevation(-0.5);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteSelected();
      } else if (key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.duplicateSelected();
      } else if (key === 'escape') {
        e.preventDefault();
        if (this.activePlacementType) {
          this.setPlacementType(null);
        } else {
          this.selectPiece(null);
        }
      }
    };

    window.addEventListener('keydown', this.keydownHandler);
  }

  private setupViewPicking(): void {
    if (!this.gameView) return;

    this.pickHandler = (target: PickTarget) => {
      if (!this.isVisible) return;

      if (this.activePlacementType) {
        if (target.kind === 'position') {
          if (this.activePlacementType === 'objective') {
            this.placeObjectiveAt(target.position);
          } else {
            this.placePieceAt(
              this.activePlacementType,
              target.position,
              this.placementRotationY,
              target.position.y > 0 ? target.position.y : undefined
            );
          }
        }
      } else {
        // Selection mode
        if (target.kind === 'position' && target.terrainId) {
          this.selectPiece(target.terrainId);
        } else {
          this.selectPiece(null);
        }
      }
    };

    this.gameView.onPick(this.pickHandler);
  }

  private validateCurrentMap(): void {
    this.validationNotices = validateMapDefinition(this.currentMap);
  }

  private syncGameView(): void {
    if (!this.gameView) return;

    // Render the current map's board, terrain, and objectives
    this.gameView.syncFromState({
      version: '1.0.0',
      gameId: 'map-editor-state',
      createdAt: 0,
      lastActionId: '',
      hostId: 'editor-host',
      guestId: 'editor-guest',
      players: [],
      status: 'in-progress',
      board: {
        width: this.currentMap.board?.width ?? 44,
        height: this.currentMap.board?.height ?? 30,
        gridSize: 1,
        scale: 1,
        terrain: [],
      },
      units: [],
      terrain: this.currentMap.terrain,
      objectives: this.currentMap.objectives ?? [],
      markers: [],
      actionLog: [],
      turnState: {
        roundNumber: 0,
        phase: 'deployment',
        activeUnitId: null,
        startingPlayerId: 'editor-host',
        currentPlayerId: 'editor-host',
        unitsActivatedThisRound: [],
      },
    });

    // Update selection highlight marker on selected piece
    if (this.selectedPieceId) {
      const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
      if (piece) {
        this.gameView.setTerrainDebugMarker([piece]);
      } else {
        this.gameView.setTerrainDebugMarker(null);
      }
    } else {
      this.gameView.setTerrainDebugMarker(null);
    }
  }

  // --- HTML Overlay Rendering ----------------------------------------------

  render(): void {
    const noticesCount = this.validationNotices.length;
    const warningBadgeColor = noticesCount === 0 ? '#4caf50' : '#ff9800';
    const warningBadgeText = noticesCount === 0 ? '✓ Ready' : `⚠️ ${noticesCount} Notice${noticesCount > 1 ? 's' : ''}`;

    const categories: Array<{ id: TerrainCategory | 'objectives'; label: string; icon: string }> = [
      { id: 'structures', label: 'Structures', icon: '🏢' },
      { id: 'walls', label: 'Walls & Doors', icon: '🧱' },
      { id: 'platforms', label: 'Catwalks', icon: '🔲' },
      { id: 'stairs-ladders', label: 'Stairs & Ladders', icon: '🪜' },
      { id: 'scatter', label: 'Cover & Pipes', icon: '📦' },
      { id: 'objectives', label: 'Objectives', icon: '🎯' },
    ];

    // Hide categories that have no procedural pieces yet (objectives always shown).
    const visibleCategories = categories.filter(
      (cat) =>
        cat.id === 'objectives' ||
        Object.values(TERRAIN_PALETTE_CATALOG).some((m) => m.category === cat.id)
    );
    const categoryButtonsHtml = visibleCategories
      .map(
        (cat) => `
        <button class="editor-cat-btn" data-category="${cat.id}" style="
          padding: 8px 12px; font-size: 13px; font-weight: 600; border-radius: 6px; cursor: pointer;
          background: ${this.activeCategory === cat.id ? '#29b6f6' : '#263238'};
          color: ${this.activeCategory === cat.id ? '#12161c' : '#cfd8dc'};
          border: 1px solid #37474f; transition: all 0.15s ease;
        ">
          ${cat.icon} ${cat.label}
        </button>
      `
      )
      .join('');

    // Items for active category
    let paletteItemsHtml = '';
    if (this.activeCategory === 'objectives') {
      paletteItemsHtml = `
        <button class="editor-palette-item" data-type="objective" style="
          padding: 10px; background: ${this.activePlacementType === 'objective' ? '#ffd54f' : '#1e2630'};
          color: ${this.activePlacementType === 'objective' ? '#12161c' : '#eee'};
          border: 1px solid #37474f; border-radius: 6px; text-align: left; cursor: pointer;
        ">
          <div style="font-weight: bold; font-size: 13px;">🎯 Objective Beacon</div>
          <div style="font-size: 11px; opacity: 0.8;">3.0" control radius marker</div>
        </button>
      `;
    } else {
      const items = Object.values(TERRAIN_PALETTE_CATALOG).filter(
        (meta) => meta.category === this.activeCategory
      );
      paletteItemsHtml = items
        .map(
          (meta) => `
          <button class="editor-palette-item" data-type="${meta.type}" style="
            padding: 10px; background: ${this.activePlacementType === meta.type ? '#29b6f6' : '#1e2630'};
            color: ${this.activePlacementType === meta.type ? '#12161c' : '#eee'};
            border: 1px solid #37474f; border-radius: 6px; text-align: left; cursor: pointer;
          ">
            <div style="font-weight: bold; font-size: 13px;">${meta.displayName}</div>
            <div style="font-size: 11px; opacity: 0.8;">${meta.description ?? ''}</div>
          </button>
        `
        )
        .join('');
    }

    // Selected piece property inspector
    const selectedPiece = this.selectedPieceId
      ? this.currentMap.terrain.find((t) => t.id === this.selectedPieceId)
      : null;
    const selectedObjective = this.selectedObjectiveId
      ? (this.currentMap.objectives ?? []).find((o) => o.id === this.selectedObjectiveId)
      : null;

    let inspectorHtml = '';
    if (selectedPiece) {
      const pieceMeta = TERRAIN_PALETTE_CATALOG[selectedPiece.terrainType];
      const displayName = pieceMeta?.displayName ?? selectedPiece.terrainType;
      inspectorHtml = `
        <div style="background: rgba(18, 22, 28, 0.95); border: 1px solid #37474f; border-radius: 8px; padding: 14px; width: 280px; pointer-events: auto; color: #eee; font-family: Arial, sans-serif;">
          <div style="font-size: 13px; font-weight: bold; color: #90caf9; margin-bottom: 4px; text-transform: uppercase;">
            ${displayName}
          </div>
          <div style="font-size: 11px; color: #78909c; margin-bottom: 8px;">ID: ${selectedPiece.id} (${selectedPiece.terrainType})</div>
          <div style="font-size: 12px; margin-bottom: 4px;">Pos: (${selectedPiece.position.x.toFixed(1)}, ${selectedPiece.position.y.toFixed(1)}, ${selectedPiece.position.z.toFixed(1)})</div>
          
          <div style="display: flex; gap: 4px; margin-bottom: 8px; align-items: center;">
            <span style="font-size: 11px; color: #90caf9; width: 44px;">Nudge:</span>
            <button id="nudgeLeftBtn" title="Move -X" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">← X-</button>
            <button id="nudgeRightBtn" title="Move +X" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">→ X+</button>
            <button id="nudgeUpBtn" title="Move -Z" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">↑ Z-</button>
            <button id="nudgeDownBtn" title="Move +Z" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">↓ Z+</button>
          </div>

          <div style="font-size: 12px; margin-bottom: 8px;">Rot: ${Math.round((selectedPiece.rotation.y * 180) / Math.PI)}°</div>

          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px; margin-bottom: 12px;">
            <label><input type="checkbox" id="inspectCover" ${selectedPiece.providesCover ? 'checked' : ''} /> Provides Cover (+1 Def)</label>
            <label><input type="checkbox" id="inspectLos" ${selectedPiece.blocksLineOfSight ? 'checked' : ''} /> Blocks Line of Sight</label>
            <label><input type="checkbox" id="inspectObstacle" ${selectedPiece.isObstacle ? 'checked' : ''} /> Impassable Obstacle</label>
            <label><input type="checkbox" id="inspectWalkable" ${selectedPiece.isWalkable ? 'checked' : ''} /> Walkable Surface</label>
          </div>

          <div style="display: flex; gap: 4px; margin-bottom: 6px;">
            <button id="inspectRotateBtn" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 600; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">Rotate (R)</button>
            <button id="inspectDuplicateBtn" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 600; background: #37474f; color: #ffd54f; border: none; border-radius: 4px; cursor: pointer;">Duplicate (Ctrl+D)</button>
          </div>
          <div style="display: flex; gap: 4px;">
            <button id="inspectLowerBtn" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 600; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">-H (Q)</button>
            <button id="inspectElevateBtn" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 600; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">+H (E)</button>
            <button id="inspectDeleteBtn" style="padding: 6px 10px; font-size: 11px; font-weight: 600; background: #c62828; color: #eee; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
          </div>
        </div>
      `;
    } else if (selectedObjective) {
      inspectorHtml = `
        <div style="background: rgba(18, 22, 28, 0.95); border: 1px solid #ffd54f; border-radius: 8px; padding: 14px; width: 280px; pointer-events: auto; color: #eee; font-family: Arial, sans-serif;">
          <div style="font-size: 13px; font-weight: bold; color: #ffd54f; margin-bottom: 8px; text-transform: uppercase;">
            ${selectedObjective.name}
          </div>
          <div style="font-size: 12px; margin-bottom: 4px;">Pos: (${selectedObjective.position.x.toFixed(1)}, ${selectedObjective.position.y.toFixed(1)}, ${selectedObjective.position.z.toFixed(1)})</div>
          
          <div style="display: flex; gap: 4px; margin-bottom: 8px; align-items: center;">
            <span style="font-size: 11px; color: #ffd54f; width: 44px;">Nudge:</span>
            <button id="nudgeObjLeftBtn" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">← X-</button>
            <button id="nudgeObjRightBtn" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">→ X+</button>
            <button id="nudgeObjUpBtn" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">↑ Z-</button>
            <button id="nudgeObjDownBtn" style="flex: 1; padding: 4px; font-size: 11px; background: #37474f; color: #eee; border: none; border-radius: 4px; cursor: pointer;">↓ Z+</button>
          </div>

          <div style="font-size: 12px; margin-bottom: 12px; color: #b0bec5;">Control radius: 3.0"</div>
          <button id="inspectDeleteObjBtn" style="width: 100%; padding: 6px; font-size: 11px; font-weight: 600; background: #c62828; color: #eee; border: none; border-radius: 4px; cursor: pointer;">Remove Objective</button>
        </div>
      `;
    }

    const customMaps = this.mapStore.getMaps();
    const savedMapsGroupHtml =
      customMaps.length > 0
        ? `
          <optgroup label="Saved Custom Maps">
            ${customMaps.map((m) => `<option value="custom:${m.id}">${m.name} (${m.terrain?.length ?? 0} pieces)</option>`).join('')}
          </optgroup>
        `
        : '';

    this.rootElement.innerHTML = `
      <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%; pointer-events: none; font-family: Arial, sans-serif;">
        <!-- Top Toolbar -->
        <div style="pointer-events: auto; background: rgba(18, 22, 28, 0.95); border-bottom: 1px solid #37474f; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-weight: bold; font-size: 16px; color: #ffd54f;">Map Builder</span>
            <input id="mapNameInput" value="${this.currentMap.name}" placeholder="Map Name" style="padding: 6px 10px; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 4px; font-size: 13px; width: 170px;" />
            <div style="display: flex; align-items: center; background: #263238; border-radius: 4px; padding: 2px;">
              <span style="font-size: 11px; color: #90caf9; padding: 0 6px;">Snap:</span>
              <button id="snap1Btn" style="padding: 4px 6px; font-size: 11px; font-weight: 600; border: none; border-radius: 3px; cursor: pointer; background: ${this.gridSnap === 1.0 ? '#29b6f6' : 'transparent'}; color: ${this.gridSnap === 1.0 ? '#12161c' : '#cfd8dc'};">1.0"</button>
              <button id="snap05Btn" style="padding: 4px 6px; font-size: 11px; font-weight: 600; border: none; border-radius: 3px; cursor: pointer; background: ${this.gridSnap === 0.5 ? '#29b6f6' : 'transparent'}; color: ${this.gridSnap === 0.5 ? '#12161c' : '#cfd8dc'};">0.5"</button>
              <button id="snapFreeBtn" style="padding: 4px 6px; font-size: 11px; font-weight: 600; border: none; border-radius: 3px; cursor: pointer; background: ${this.gridSnap === 0 ? '#29b6f6' : 'transparent'}; color: ${this.gridSnap === 0 ? '#12161c' : '#cfd8dc'};">Free</button>
            </div>
            <select id="loadMapSelect" style="padding: 6px 8px; background: #12161c; border: 1px solid #37474f; color: #eee; border-radius: 4px; font-size: 12px;">
              <option value="">Load Map...</option>
              ${savedMapsGroupHtml}
            </select>
            <button id="validationBadgeBtn" style="padding: 5px 8px; font-size: 11px; font-weight: bold; background: ${warningBadgeColor}; color: #12161c; border: none; border-radius: 4px; cursor: pointer;">
              ${warningBadgeText}
            </button>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <button id="importJsonBtn" style="padding: 6px 10px; font-size: 11px; font-weight: 600; background: #37474f; color: #eee; border: 1px solid #455a64; border-radius: 4px; cursor: pointer;">Import JSON</button>
            <input type="file" id="importJsonFileInput" accept=".json" style="display: none;" />
            <button id="exportJsonBtn" style="padding: 6px 10px; font-size: 11px; font-weight: 600; background: #37474f; color: #eee; border: 1px solid #455a64; border-radius: 4px; cursor: pointer;">Export JSON</button>
            <button id="autoObjBtn" style="padding: 6px 10px; font-size: 11px; font-weight: 600; background: #37474f; color: #ffd54f; border: 1px solid #455a64; border-radius: 4px; cursor: pointer;">Auto Obj</button>
            <button id="clearBtn" style="padding: 6px 10px; font-size: 11px; font-weight: 600; background: #37474f; color: #ef5350; border: 1px solid #455a64; border-radius: 4px; cursor: pointer;">Clear</button>
            <button id="saveMapBtn" style="padding: 6px 12px; font-size: 11px; font-weight: 600; background: #29b6f6; color: #12161c; border: none; border-radius: 4px; cursor: pointer;">Save Map</button>
            <button id="exitEditorBtn" style="padding: 6px 12px; font-size: 11px; font-weight: 600; background: #455a64; color: #eee; border: none; border-radius: 4px; cursor: pointer;">Exit</button>
          </div>
        </div>

        <!-- Middle Inspector Section (Positioned Floating Top-Right) -->
        <div style="position: absolute; top: 65px; right: 20px; z-index: 101;">
          ${inspectorHtml}
        </div>

        <!-- Bottom Palette Dock -->
        <div style="pointer-events: auto; background: rgba(18, 22, 28, 0.95); border-top: 1px solid #37474f; padding: 12px 20px;">
          <!-- Category Tabs -->
          <div style="display: flex; gap: 8px; margin-bottom: 10px; overflow-x: auto;">
            ${categoryButtonsHtml}
          </div>

          <!-- Items Row -->
          <div style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px;">
            ${paletteItemsHtml}
          </div>

          <!-- Hint Footer -->
          <div style="margin-top: 6px; font-size: 11px; color: #78909c; display: flex; gap: 16px;">
            <span>💡 <strong>Click</strong> to place/select</span>
            <span><strong>R</strong>: Rotate 90°</span>
            <span><strong>Q / E</strong>: Lower/Raise Height</span>
            <span><strong>Ctrl+D</strong>: Duplicate</span>
            <span><strong>Del</strong>: Remove</span>
            <span><strong>Esc</strong>: Deselect</span>
          </div>
        </div>
      </div>
    `;

    this.wireEventHandlers();
  }

  private wireEventHandlers(): void {
    // Map Name Input
    const nameInput = this.rootElement.querySelector<HTMLInputElement>('#mapNameInput');
    nameInput?.addEventListener('input', () => {
      this.currentMap.name = nameInput.value;
    });

    // Snap buttons
    this.rootElement.querySelector('#snap1Btn')?.addEventListener('click', () => this.setGridSnap(1.0));
    this.rootElement.querySelector('#snap05Btn')?.addEventListener('click', () => this.setGridSnap(0.5));
    this.rootElement.querySelector('#snapFreeBtn')?.addEventListener('click', () => this.setGridSnap(0));

    // Load map dropdown
    const loadSelect = this.rootElement.querySelector<HTMLSelectElement>('#loadMapSelect');
    loadSelect?.addEventListener('change', () => {
      if (loadSelect.value) {
        this.loadMap(loadSelect.value);
      }
    });

    // Import / Export JSON
    const fileInput = this.rootElement.querySelector<HTMLInputElement>('#importJsonFileInput');
    this.rootElement.querySelector('#importJsonBtn')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const content = e.target?.result as string;
            this.importJson(content);
          } catch (err: any) {
            alert(`Failed to import map: ${err.message}`);
          }
        };
        reader.readAsText(file);
      }
    });

    this.rootElement.querySelector('#exportJsonBtn')?.addEventListener('click', () => {
      this.downloadMapJson();
    });

    // Category buttons
    this.rootElement.querySelectorAll<HTMLButtonElement>('.editor-cat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-category') as TerrainCategory | 'objectives';
        if (cat) {
          this.activeCategory = cat;
          this.render();
        }
      });
    });

    // Palette items
    this.rootElement.querySelectorAll<HTMLButtonElement>('.editor-palette-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type');
        if (type) {
          this.setPlacementType(this.activePlacementType === type ? null : type);
        }
      });
    });

    // Top action buttons
    this.rootElement.querySelector('#autoObjBtn')?.addEventListener('click', () => this.autoDistributeObjectives());
    this.rootElement.querySelector('#clearBtn')?.addEventListener('click', () => this.clearBoard());
    this.rootElement.querySelector('#saveMapBtn')?.addEventListener('click', () => {
      this.saveToStore();
    });
    this.rootElement.querySelector('#exitEditorBtn')?.addEventListener('click', () => {
      this.options.onExit?.();
    });

    // Validation badge click (alert notices)
    this.rootElement.querySelector('#validationBadgeBtn')?.addEventListener('click', () => {
      if (this.validationNotices.length === 0) {
        alert('✓ Map validation passed with 0 issues! All objectives and terrain are standard-compliant.');
      } else {
        const report = this.validationNotices.map((n) => `• ${n.message}`).join('\n');
        alert(`Map Validation Advisory Notices (${this.validationNotices.length}):\n\n${report}`);
      }
    });

    // Inspector piece handlers
    const coverCheck = this.rootElement.querySelector<HTMLInputElement>('#inspectCover');
    coverCheck?.addEventListener('change', () => {
      if (this.selectedPieceId) {
        const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
        if (piece) piece.providesCover = coverCheck.checked;
      }
    });

    const losCheck = this.rootElement.querySelector<HTMLInputElement>('#inspectLos');
    losCheck?.addEventListener('change', () => {
      if (this.selectedPieceId) {
        const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
        if (piece) piece.blocksLineOfSight = losCheck.checked;
      }
    });

    const obstacleCheck = this.rootElement.querySelector<HTMLInputElement>('#inspectObstacle');
    obstacleCheck?.addEventListener('change', () => {
      if (this.selectedPieceId) {
        const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
        if (piece) piece.isObstacle = obstacleCheck.checked;
      }
    });

    const walkableCheck = this.rootElement.querySelector<HTMLInputElement>('#inspectWalkable');
    walkableCheck?.addEventListener('change', () => {
      if (this.selectedPieceId) {
        const piece = this.currentMap.terrain.find((t) => t.id === this.selectedPieceId);
        if (piece) {
          piece.isWalkable = walkableCheck.checked;
          if (walkableCheck.checked && piece.elevation === undefined) {
            piece.elevation = piece.scale.y;
          }
        }
      }
    });

    this.rootElement.querySelector('#nudgeLeftBtn')?.addEventListener('click', () => this.nudgeSelected(-this.gridSnap || -0.5, 0));
    this.rootElement.querySelector('#nudgeRightBtn')?.addEventListener('click', () => this.nudgeSelected(this.gridSnap || 0.5, 0));
    this.rootElement.querySelector('#nudgeUpBtn')?.addEventListener('click', () => this.nudgeSelected(0, -this.gridSnap || -0.5));
    this.rootElement.querySelector('#nudgeDownBtn')?.addEventListener('click', () => this.nudgeSelected(0, this.gridSnap || 0.5));

    this.rootElement.querySelector('#inspectRotateBtn')?.addEventListener('click', () => this.rotateSelected());
    this.rootElement.querySelector('#inspectDuplicateBtn')?.addEventListener('click', () => this.duplicateSelected());
    this.rootElement.querySelector('#inspectLowerBtn')?.addEventListener('click', () => this.adjustElevation(-0.5));
    this.rootElement.querySelector('#inspectElevateBtn')?.addEventListener('click', () => this.adjustElevation(0.5));
    this.rootElement.querySelector('#inspectDeleteBtn')?.addEventListener('click', () => this.deleteSelected());

    // Inspector objective handlers
    this.rootElement.querySelector('#nudgeObjLeftBtn')?.addEventListener('click', () => this.nudgeSelected(-this.gridSnap || -0.5, 0));
    this.rootElement.querySelector('#nudgeObjRightBtn')?.addEventListener('click', () => this.nudgeSelected(this.gridSnap || 0.5, 0));
    this.rootElement.querySelector('#nudgeObjUpBtn')?.addEventListener('click', () => this.nudgeSelected(0, -this.gridSnap || -0.5));
    this.rootElement.querySelector('#nudgeObjDownBtn')?.addEventListener('click', () => this.nudgeSelected(0, this.gridSnap || 0.5));
    this.rootElement.querySelector('#inspectDeleteObjBtn')?.addEventListener('click', () => this.deleteSelected());
  }

  dispose(): void {
    if (typeof window !== 'undefined' && this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    this.rootElement.remove();
  }
}
