import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import {
  DROP_STANDOFF,
  findMoveBlocker,
  findNavPath,
  getStairSurfaceHeight,
  isSegmentOnRampOrStairs,
} from '../../src/engine/spatial';

const HOST = 'host-1';
const GUEST = 'guest-1';

function makeUnit(id: string, position: Vector3): Unit {
  return {
    id,
    ownerId: HOST,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function piece(type: string, x: number, z: number, rotY = 0, id = `${type}-${x}-${z}`): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id,
    terrainType: type,
    position: { x, y: 0, z },
    rotation: { x: 0, y: rotY, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...(meta.isWalkable ? { isWalkable: true } : {}),
    ...(meta.climbType ? { climbType: meta.climbType } : {}),
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  return state;
}

const drop = (x: number, z: number, from = 3, to = 0): Vector3[] => [
  { x, y: from, z },
  { x, y: to, z },
];

describe('fall column: a drop is collision-checked', () => {
  const deckPiece = piece('platform-small', 0, 0, 0, 'deck'); // 4x4, top 3
  const mover = makeUnit('m', { x: 0, y: 3, z: 0 });

  it('cannot fall through the deck it stands on', () => {
    const state = makeState([mover], [deckPiece]);
    expect(findMoveBlocker(state, mover, drop(0, 0)).blocked).toBe(true);
    expect(findMoveBlocker(state, mover, drop(1.5, 1.5)).blocked).toBe(true);
  });

  it('cannot drop with part of the base still over the deck edge', () => {
    const state = makeState([mover], [deckPiece]);
    expect(findMoveBlocker(state, mover, drop(2.0, 0)).blocked).toBe(true);
    expect(findMoveBlocker(state, mover, drop(2.3, 0)).blocked).toBe(true);
  });

  it('can drop once the whole base is a stand-off beyond the edge', () => {
    const state = makeState([mover], [deckPiece]);
    expect(findMoveBlocker(state, mover, drop(2 + DROP_STANDOFF, 0)).blocked).toBe(false);
  });

  it('cannot fall onto or through scatter', () => {
    const crate = piece('crate', 4, 0);
    const state = makeState([mover], [deckPiece, crate]);
    expect(findMoveBlocker(state, mover, drop(4, 0)).blocked).toBe(true);
    expect(findMoveBlocker(state, mover, drop(2 + DROP_STANDOFF, 3)).blocked).toBe(false);
  });

  it('a short vertical step (not a drop) is unaffected', () => {
    const state = makeState([mover], [deckPiece]);
    expect(findMoveBlocker(state, mover, drop(1, 1, 0.4, 0)).blocked).toBe(false);
  });

  it('a diagonal slide down past the deck edge is a drop too: the take-off base must be clear', () => {
    const state = makeState([mover], [deckPiece]);
    const slide = [{ x: 2, y: 3, z: 0 }, { x: 2 + DROP_STANDOFF, y: 0, z: 0 }];
    expect(findMoveBlocker(state, mover, slide).blocked).toBe(true);
    const stepThenFall = [{ x: 2, y: 3, z: 0 }, { x: 2 + DROP_STANDOFF, y: 3, z: 0 }, { x: 2 + DROP_STANDOFF, y: 0, z: 0 }];
    expect(findMoveBlocker(state, mover, stepThenFall).blocked).toBe(false);
  });

  it('cannot fall through the stair wedge but can step off its open side', () => {
    // stairs at the origin, head toward local +Z, 2 wide: wedge x -1..1, z -2..2
    const stairs = piece('stairs', 0, 0, 0, 'stairs');
    const state = makeState([mover], [stairs]);
    const slope = getStairSurfaceHeight(stairs, { x: 0, y: 0, z: 1 }, state)!;
    expect(slope).toBeGreaterThan(1);
    expect(findMoveBlocker(state, mover, drop(0, 1, slope, 0)).blocked).toBe(true);
    expect(findMoveBlocker(state, mover, drop(1 + DROP_STANDOFF, 1, slope, 0)).blocked).toBe(false);
    // stepping off sideways from the slope height, then falling beside it
    const step = [{ x: 0.5, y: slope, z: 1 }, { x: 1 + DROP_STANDOFF, y: slope, z: 1 }, { x: 1 + DROP_STANDOFF, y: 0, z: 1 }];
    expect(findMoveBlocker(state, mover, step).blocked).toBe(false);
  });
});

describe('nav drop points sit a stand-off beyond the floor edge', () => {
  it('walks off the deck edge and drops with the base clear', () => {
    const deckPiece = piece('platform-small', 0, 0, 0, 'deck');
    const mover = makeUnit('m', { x: 0, y: 3, z: 0 });
    const state = makeState([mover], [deckPiece]);
    const path = findNavPath(state, mover, { x: 5, y: 0, z: 0 }, 12);
    const end = path[path.length - 1];
    expect(end.y).toBeCloseTo(0);
    expect(Math.hypot(end.x - 5, end.z)).toBeLessThan(0.1);
    expect(findMoveBlocker(state, mover, path).blocked).toBe(false);
    const i = path.findIndex((p, k) => k > 0 && (path[k - 1].y ?? 0) - (p.y ?? 0) > 0.5);
    expect(i).toBeGreaterThan(0);
    const d = Math.max(Math.abs(path[i].x), Math.abs(path[i].z));
    expect(d).toBeGreaterThanOrEqual(2 + 0.45);
  });
});

describe('fixture: testy-mctestface', () => {
  const map = JSON.parse(readFileSync(join(__dirname, '../fixtures/testy-mctestface.json'), 'utf8'))[0];
  const terrain: TerrainPiece[] = map.terrain;
  const stairs = terrain.find((t) => t.id === 'terrain-stairs-mvzofx6t-538')!; // x 6..8, z 1..5, head z=1
  const inWedge = (p: Vector3, state: GameState) => {
    const slope = getStairSurfaceHeight(stairs, p, state);
    return (
      Math.abs(p.x - 7) < 1 - 0.05 && p.z > 1.05 && p.z < 4.95 && slope !== null && (p.y ?? 0) < slope - 0.3
    );
  };

  it('platform A to the ground never passes through the stair wedge', () => {
    const mover = makeUnit('m', { x: 7, y: 3, z: 0 });
    const state = makeState([mover], terrain);
    const path = findNavPath(state, mover, { x: 3, y: 0, z: 0.5 }, 14);
    expect(findMoveBlocker(state, mover, path).blocked).toBe(false);
    for (let i = 1; i < path.length; i++) {
      for (let t = 0; t <= 1; t += 0.05) {
        const a = path[i - 1];
        const b = path[i];
        const pt = {
          x: a.x + (b.x - a.x) * t,
          y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t,
          z: a.z + (b.z - a.z) * t,
        };
        expect(inWedge(pt, state)).toBe(false);
      }
    }
  });

  it('the old diagonal from platform A down through the wedge high end is blocked', () => {
    const mover = makeUnit('m', { x: 7, y: 3, z: 0 });
    const state = makeState([mover], terrain);
    const through = [{ x: 7, y: 3, z: 0.8 }, { x: 6.32, y: 0, z: 1.32 }]; // from the stair head spot
    expect(findMoveBlocker(state, mover, through).blocked).toBe(true);
  });

  it('walking at ground level from the stair foot straight under the slope is blocked', () => {
    const mover = makeUnit('m', { x: 7, y: 0, z: 5.2 });
    const state = makeState([mover], terrain);
    expect(findMoveBlocker(state, mover, [{ x: 7, y: 0, z: 5.2 }, { x: 7, y: 0, z: -1 }]).blocked).toBe(true);
  });

  it('mid-slope to the ground beyond the head never goes back under the slope', () => {
    const mover = makeUnit('m', { x: 7, y: 1.5, z: 3 });
    const state = makeState([mover], terrain);
    const path = findNavPath(state, mover, { x: 7, y: 0, z: -1 }, 20);
    expect(findMoveBlocker(state, mover, path).blocked).toBe(false);
    for (let i = 1; i < path.length; i++) {
      for (let t = 0; t <= 1; t += 0.02) {
        const a = path[i - 1];
        const b = path[i];
        const pt = {
          x: a.x + (b.x - a.x) * t,
          y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t,
          z: a.z + (b.z - a.z) * t,
        };
        expect(inWedge(pt, state)).toBe(false);
      }
    }
  });

  it('a unit mid-slope cannot go straight through the wedge to the ground at the stair head', () => {
    const mover = makeUnit('m', { x: 7, y: 1.5, z: 3 });
    const state = makeState([mover], terrain);
    const through = [mover.position, { x: 7, y: 0, z: 1 }];
    expect(findMoveBlocker(state, mover, through).blocked).toBe(true);
    const path = findNavPath(state, mover, { x: 7, y: 0, z: 1 }, 14);
    const end = path[path.length - 1];
    // the ground under the wedge is not reachable by cutting through it
    expect(end.y < 0.5 && Math.abs(end.x - 7) < 1 && end.z > 1.05 && end.z < 4.95).toBe(false);
  });

  it('segments that follow the slope still count as on the stairs; a diagonal through the body does not', () => {
    const state = makeState([], terrain);
    expect(isSegmentOnRampOrStairs(state, { x: 7, y: 1.5, z: 3 }, { x: 7, y: 2.25, z: 2.25 })).toBe(true);
    expect(isSegmentOnRampOrStairs(state, { x: 7, y: 3, z: 1.1 }, { x: 7, y: 0, z: 1.1 })).toBe(false);
  });
});

describe('stairs and ladders still work', () => {
  it('walks up the stairs onto the deck', () => {
    const deckPiece = piece('platform-small', 0, 0, 0, 'deck');
    const stairs = piece('stairs', 0, 4, Math.PI, 'stairs'); // head toward -Z, at the deck face
    const mover = makeUnit('m', { x: 0, y: 0, z: 8 });
    const state = makeState([mover], [deckPiece, stairs]);
    const path = findNavPath(state, mover, { x: 0, y: 3, z: 0 }, 20);
    const end = path[path.length - 1];
    expect(end.y).toBeCloseTo(3);
    expect(findMoveBlocker(state, mover, path).blocked).toBe(false);
  });
});
