import { AssetDefinition, ModelLoader } from './ModelLoader';

/**
 * Curated asset manifest for the Kenney prototype kit (CC0 —
 * https://kenney.nl, no attribution required). GLBs live in
 * `client/public/models/` and are served from the Vite base path so the
 * GitHub Pages deployment resolves them correctly.
 *
 * Curation (Phase 5):
 *   - units:    the four figurine shapes map to fighter roles
 *   - terrain:  walls, crates, and columns for the default scenario layout
 *   - markers:  indicator/target/number models drive the gameplay UI —
 *               selection ring, movement range, attack target, wound tokens
 */
const MODELS_BASE = `${import.meta.env.BASE_URL ?? '/'}models/`;

function model(file: string, scale?: number): AssetDefinition {
  return { url: `${MODELS_BASE}${file}`, scale };
}

export const UNIT_ASSETS: Record<string, AssetDefinition> = {
  trooper: model('figurine.glb', 1.15),
  specialist: model('figurine-cube.glb', 0.95),
  heavy: model('figurine-cube-detailed.glb', 1.0),
  leader: model('figurine-large.glb', 1.0),
};

export const TERRAIN_ASSETS: Record<string, AssetDefinition> = {
  // Kenney wall GLBs are authored with length (1.0) along Z and thickness (0.2 or 0.3)
  // along X. Normalize thickness to 1.0 and rotate 90° around Y so the unscaled
  // container is a 1×1×1 unit block with the wall running along local X, matching
  // piece.scale (e.g. 3 × 1.5 × 0.5) and spatial.ts collision/LoS bounds identically.
  wall: {
    url: `${MODELS_BASE}wall.glb`,
    scaleVector: { x: 5, y: 1, z: 1 },
    rotationY: Math.PI / 2,
  },
  'wall-window': {
    url: `${MODELS_BASE}wall-window-medium.glb`,
    scaleVector: { x: 1 / 0.3, y: 1, z: 1 },
    rotationY: Math.PI / 2,
  },
  'wall-doorway': {
    url: `${MODELS_BASE}wall-doorway.glb`,
    scaleVector: { x: 1 / 0.3, y: 1, z: 1 },
    rotationY: Math.PI / 2,
  },
  crate: model('crate-medium.glb', 1.0),
  'crate-medium': model('crate-medium.glb', 1.0),
  column: {
    url: `${MODELS_BASE}column.glb`,
    scaleVector: { x: 2.5, y: 1, z: 2.5 },
  },
  ladder: model('ladder.glb', 1.0),
  stairs: model('stairs-small.glb', 1.0),
  platform: model('floor-square.glb', 1.0),
  'wall-low': {
    url: `${MODELS_BASE}wall-low.glb`,
    scaleVector: { x: 5, y: 1, z: 1 },
    rotationY: Math.PI / 2,
  },
  pipe: model('pipe.glb', 1.0),
  // Heavy Industrial Buildings
  'building-a': model('building-a.glb', 1.0),
  'building-c': model('building-c.glb', 1.0),
  'building-f': model('building-f.glb', 1.0),
  'building-h': model('building-h.glb', 1.0),
  'building-l': model('building-l.glb', 1.0),
  // Modular Walls, Doorways & Roofs
  'wall-doorway-square': model('wall-doorway-square.glb', 1.0),
  'wall-corner': model('wall-corner.glb', 1.0),
  'wall-half': model('wall-half.glb', 1.0),
  'roof-flat-side': model('roof-flat-side.glb', 1.0),
  'roof-flat-corner': model('roof-flat-corner.glb', 1.0),
  'roof-flat-patch-large': model('roof-flat-patch-large.glb', 1.0),
  // Stairs & Traversal
  'stairs-open': model('stairs-open.glb', 1.0),
  'stairs-closed-short': model('stairs-closed-short.glb', 1.0),
  'stairs-sides': model('stairs-sides.glb', 1.0),
  // Barricades & Scatter
  'barricade-doorway': model('barricade-doorway-a.glb', 1.0),
  'barricade-window': model('barricade-window-b.glb', 1.0),
  'column-wide': model('column-wide.glb', 1.0),
  'detail-pipe': model('detail-pipe.glb', 1.0),
};

export const MARKER_ASSETS: Record<string, AssetDefinition> = {
  selection: model('indicator-round-b.glb', 1.4),
  target: model('indicator-round-b.glb', 1.4),
  'reachable-target': model('indicator-round-b.glb', 1.4),
};

/** Wound-count outcome tokens: number-N models (0..5). */
export function outcomeMarkerKey(wounds: number): string {
  return `outcome-${Math.max(0, Math.min(5, Math.round(wounds)))}`;
}

export const OUTCOME_ASSETS: Record<string, AssetDefinition> = {
  'outcome-1': model('number-1.glb', 1.2),
  'outcome-2': model('number-2.glb', 1.2),
  'outcome-3': model('number-3.glb', 1.2),
  'outcome-4': model('number-4.glb', 1.2),
  'outcome-5': model('number-5.glb', 1.2),
};

/** Register every curated asset with a ModelLoader (GLB swap-in support). */
export function registerAssetManifest(loader: ModelLoader): void {
  for (const [unitType, asset] of Object.entries(UNIT_ASSETS)) {
    loader.registerUnitAsset(unitType, asset);
  }
  for (const [terrainType, asset] of Object.entries(TERRAIN_ASSETS)) {
    loader.registerTerrainAsset(terrainType, asset);
  }
  for (const [key, asset] of Object.entries({ ...MARKER_ASSETS, ...OUTCOME_ASSETS })) {
    loader.registerMarkerAsset(key, asset);
  }
}
