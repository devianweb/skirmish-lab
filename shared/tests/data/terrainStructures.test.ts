import { describe, it, expect } from 'vitest';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { TERRAIN_STRUCTURES } from '../../src/data/terrainStructures';
import { resolveTerrainStructure } from '../../src/engine/terrainStructure';
import { TerrainPiece } from '../../src/gameTypes';

const GRID = 0.25;
const onGrid = (v: number) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-9;

function pieceAtDefaultScale(type: string): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id: `p-${type}`,
    terrainType: type,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
  };
}

describe('terrain structure grid', () => {
  const types = Object.keys(TERRAIN_PALETTE_CATALOG).filter((t) => TERRAIN_STRUCTURES[t]);

  it('covers every structured palette piece', () => {
    expect(types).toEqual(expect.arrayContaining(['wall-short', 'wall', 'wall-long', 'wall-window', 'wall-doorway', 'column', 'ruin-l']));
  });

  for (const type of types) {
    it(`${type}: heights, widths and thicknesses are multiples of 0.25" at the default scale`, () => {
      const { solids, apertures } = resolveTerrainStructure(pieceAtDefaultScale(type));
      for (const b of [...solids, ...apertures]) {
        for (const [name, v] of Object.entries({
          minY: b.minY,
          maxY: b.maxY,
          width: b.maxX - b.minX,
          depth: b.maxZ - b.minZ,
        })) {
          expect(onGrid(v), `${type} ${b.id} ${name}=${v}`).toBe(true);
        }
      }
    });
  }
});

describe('segmented walls', () => {
  it('2", 4" and 6" walls are 1, 2 and 3 identical 2" segments', () => {
    for (const [type, n] of [['wall-short', 1], ['wall', 2], ['wall-long', 3]] as const) {
      const { solids } = resolveTerrainStructure(pieceAtDefaultScale(type));
      expect(solids).toHaveLength(n);
      for (const s of solids) expect(s.maxX - s.minX).toBeCloseTo(2);
    }
  });

  it('segments tile the wall with no gaps', () => {
    const { solids } = resolveTerrainStructure(pieceAtDefaultScale('wall-long'));
    const sorted = [...solids].sort((a, b) => a.minX - b.minX);
    expect(sorted[0].minX).toBeCloseTo(-3);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].minX).toBeCloseTo(sorted[i - 1].maxX);
    expect(sorted[sorted.length - 1].maxX).toBeCloseTo(3);
  });
});
