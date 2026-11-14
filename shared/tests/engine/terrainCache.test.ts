import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { BUILTIN_MAPS } from '../../src/data/builtinMaps';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import {
  findMoveBlocker,
  findNavPath,
  findTerrainSegmentBlocker,
  findUnitSegmentBlocker,
  KEEP_AWAY_REASON,
} from '../../src/engine/spatial';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

function mkUnit(id: string, ownerId: string, pos: Vector3, extra: Partial<Unit> = {}): Unit {
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...pos },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models: [
      {
        id: `${id}-m0`,
        wounds: 1,
        maxWounds: 1,
        isDestroyed: false,
        position: { ...pos },
        rotation: { x: 0, y: 0, z: 0 },
      },
    ],
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 12,
    ...extra,
  };
}

function mkPiece(id: string, type: keyof typeof TERRAIN_PALETTE_CATALOG, x: number, z: number, extra: Partial<TerrainPiece> = {}): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id,
    terrainType: type,
    position: P(x, z),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...extra,
  } as TerrainPiece;
}

function mkState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = units[0]?.id ?? null;
  return state;
}

describe('terrain geometry & blocker split', () => {
  it('separates terrain obstacle blocking from unit blocking', () => {
    const wall = mkPiece('w1', 'wall', 0, 4);
    const mover = mkUnit('h1', HOST, P(0, 0));
    const state = mkState([mover], [wall]);

    const tBlk = findTerrainSegmentBlocker(state, false, P(0, 0), P(0, 8));
    const uBlk = findUnitSegmentBlocker(state, mover, false, P(0, 0), P(0, 8), P(0, 0));
    const combined = findMoveBlocker(state, mover, [P(0, 0), P(0, 8)]);

    expect(tBlk).toEqual({ blocked: true, reason: 'Move path is blocked by terrain' });
    expect(uBlk).toBeNull();
    expect(combined).toEqual(tBlk);
  });

  it('separates unit separation, ignoreUnitId, and keepAway from terrain', () => {
    const mover = mkUnit('h1', HOST, P(0, 0));
    const enemy = mkUnit('g1', GUEST, P(0, 5));
    const state = mkState([mover, enemy]);

    // Normal move through enemy: blocked by unit separation
    expect(findTerrainSegmentBlocker(state, false, P(0, 0), P(0, 8))).toBeNull();
    expect(findUnitSegmentBlocker(state, mover, false, P(0, 0), P(0, 8), P(0, 0))).toEqual({
      blocked: true,
      reason: 'Move path is blocked by another fighter',
    });
    expect(findMoveBlocker(state, mover, [P(0, 0), P(0, 8)])).toEqual({
      blocked: true,
      reason: 'Move path is blocked by another fighter',
    });

    // Charge target exempt: base contact is clear, passing straight through centre is blocked
    expect(
      findMoveBlocker(state, mover, [P(0, 0), P(0, 3.8)], { ignoreUnitId: 'g1', keepAway: true })
    ).toEqual({ blocked: false });
    expect(
      findMoveBlocker(state, mover, [P(0, 0), P(0, 8)], { ignoreUnitId: 'g1', keepAway: true })
    ).toEqual({ blocked: true, reason: 'Move path is blocked by another fighter' });

    // Non-ignored keepAway against bystander within 1" edge gap
    const bystander = mkUnit('h2', HOST, P(3, 5));
    state.units.push(bystander);
    expect(
      findMoveBlocker(state, mover, [P(0, 0), P(3, 3.5)], { ignoreUnitId: 'g1', keepAway: true })
    ).toEqual({ blocked: true, reason: KEEP_AWAY_REASON });
  });

  it('lets flying movers pass intermediate terrain and checks landing keep-away', () => {
    const wall = mkPiece('w1', 'wall', 0, 4);
    const mover = mkUnit('h1', HOST, P(0, 0), { specialRules: ['flying'] });
    const foe = mkUnit('g1', GUEST, P(0, 9));
    const state = mkState([mover, foe], [wall]);

    expect(findTerrainSegmentBlocker(state, true, P(0, 0), P(0, 7))).toBeNull();
    expect(findMoveBlocker(state, mover, [P(0, 0), P(0, 7)], { keepAway: true })).toEqual({
      blocked: false,
    });
    expect(findMoveBlocker(state, mover, [P(0, 0), P(0, 7.5)], { keepAway: true })).toEqual({
      blocked: true,
      reason: KEEP_AWAY_REASON,
    });
  });
});

describe('findNavPath terrain graph cache & invalidation', () => {
  it('reuses cached terrain across cloned terrain arrays while still respecting moved units', () => {
    const std = BUILTIN_MAPS['standard-battlefield']();
    const mover = mkUnit('h1', HOST, P(-8, -8));
    const enemy = mkUnit('g1', GUEST, P(12, 12));
    const cloneTerrain = (terrain: TerrainPiece[]): TerrainPiece[] =>
      terrain.map((t) => ({
        ...t,
        position: { ...t.position },
        rotation: { ...t.rotation },
        scale: { ...t.scale },
      }));
    const state1 = mkState([mover, enemy], cloneTerrain(std.terrain));

    const path1 = findNavPath(state1, mover, P(0, 0), 12);

    // Clone terrain array + piece objects: identical terrain layout
    const state2: GameState = {
      ...state1,
      terrain: cloneTerrain(state1.terrain),
    };
    const path2 = findNavPath(state2, mover, P(0, 0), 12);
    expect(path2).toEqual(path1);

    // Now move the enemy onto a point along path1, keeping state.terrain identical
    const blockerState = mkState([mover, mkUnit('g1', GUEST, P(-4, -4))], state1.terrain);
    const pathWithUnit = findNavPath(blockerState, mover, P(0, 0), 12, { keepAway: true });
    expect(pathWithUnit).not.toEqual(path1);
    const blk = findMoveBlocker(blockerState, mover, pathWithUnit, { keepAway: true });
    expect(blk.blocked).toBe(false);
  });

  it('invalidates the terrain cache immediately when state.terrain is mutated', () => {
    const wall = mkPiece('w1', 'wall', 0, 10); // initially clear of the direct line x=0 -> x=8 at z=0
    const mover = mkUnit('h1', HOST, P(0, 0));
    const state = mkState([mover], [wall]);

    const clearPath = findNavPath(state, mover, P(8, 0), 12);
    expect(clearPath).toEqual([P(0, 0), P(8, 0)]);

    // Mutate the existing piece position directly in state.terrain
    wall.position = P(4, 0);
    const detouredPath = findNavPath(state, mover, P(8, 0), 12);
    expect(detouredPath.length).toBeGreaterThan(2);
    expect(findMoveBlocker(state, mover, detouredPath).blocked).toBe(false);

    // Rotate / rescale / add pieces in-place on the same array reference
    wall.scale = { ...wall.scale, z: wall.scale.z + 4 };
    const widerDetour = findNavPath(state, mover, P(8, 0), 16);
    expect(widerDetour).not.toEqual(detouredPath);
    expect(findMoveBlocker(state, mover, widerDetour).blocked).toBe(false);

    state.terrain.push(mkPiece('w2', 'wall', 4, -4));
    const extraDetour = findNavPath(state, mover, P(8, 0), 16);
    expect(findMoveBlocker(state, mover, extraDetour).blocked).toBe(false);
  });
});
