import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG, isClimbable } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { classifySegment, pathMovementCost, SegmentKind } from '../../src/engine/traversal';
import { findNavPath, isSuspendedInMidAir } from '../../src/engine/spatial';
import { validateAction } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function makeUnit(id: string, position: Vector3, budget = 12, rules: string[] = []): Unit {
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
    wounds: 0,
    maxWounds: 3,
    isActivated: true,
    isDestroyed: false,
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: rules,
    hasMoved: false,
    remainingMovement: budget,
  };
}

const map = JSON.parse(readFileSync(join(__dirname, '../fixtures/testy-mctestface.json'), 'utf8'))[0];
const fixtureTerrain: TerrainPiece[] = map.terrain;

function makeState(unit: Unit, pieces: TerrainPiece[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = pieces;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  return state;
}

/** A lone piece of a catalog type at the origin (default scale), optionally with a climbable override. */
function lone(type: string, climbable?: boolean, at: Vector3 = P(0, 0, 0)): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id: `t-${type}-${at.x}-${at.y}`,
    terrainType: type,
    position: { ...at },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...(meta.isWalkable !== undefined ? { isWalkable: meta.isWalkable } : {}),
    ...(meta.elevation !== undefined ? { elevation: meta.elevation } : {}),
    ...(climbable !== undefined ? { climbable } : {}),
  };
}

const kindsOf = (state: GameState, unit: Unit, path: Vector3[]) =>
  path.slice(1).map((b, i) => classifySegment(state, path[i], b, unit, path[i - 1]).kind as SegmentKind);

function run(pieces: TerrainPiece[], from: Vector3, to: Vector3, budget = 12) {
  const unit = makeUnit('m', from, budget);
  const state = makeState(unit, pieces);
  const path = findNavPath(state, unit, to, budget);
  return { unit, state, path, kinds: kindsOf(state, unit, path), cost: pathMovementCost(state, path, unit), end: path[path.length - 1] };
}

describe('isClimbable', () => {
  it('catalog defaults: containers and ruins yes, decks and catwalks no, unknown types no', () => {
    expect(isClimbable({ terrainType: 'shipping-container' })).toBe(true);
    expect(isClimbable({ terrainType: 'ruin-l' })).toBe(true);
    expect(isClimbable({ terrainType: 'ruin' })).toBe(true);
    expect(isClimbable({ terrainType: 'platform-small' })).toBe(false);
    expect(isClimbable({ terrainType: 'platform-large' })).toBe(false);
    expect(isClimbable({ terrainType: 'catwalk' })).toBe(false);
    expect(isClimbable({ terrainType: 'custom-thing' })).toBe(false);
  });

  it('a per-piece override wins in both directions', () => {
    expect(isClimbable({ terrainType: 'shipping-container', climbable: false })).toBe(false);
    expect(isClimbable({ terrainType: 'platform-small', climbable: true })).toBe(true);
  });
});

describe('climbing a container (2.25")', () => {
  // container at the origin spans x -2.5..2.5, z -1.125..1.125; roof 2.25"
  const container = lone('shipping-container');
  const sides: Array<[string, Vector3, number]> = [
    ['north', P(0, 0, -5), 5],
    ['south', P(0, 0, 5), 5],
    ['west', P(-6, 0, 0), 6],
    ['east', P(6, 0, 0), 6],
  ];

  it.each(sides)('can be climbed from the %s without a ladder; cost is the walk plus the 2.25" rise', (_n, start, horizontal) => {
    const { path, kinds, cost, end, state } = run([container], start, P(0, 2.25, 0));
    expect(end).toMatchObject({ x: 0, y: 2.25, z: 0 });
    expect(kinds).toContain('climb');
    expect(kinds).not.toContain('ladder');
    expect(isSuspendedInMidAir(state, end)).toBe(false);
    // everything the climb adds is the rise; the walk is the horizontal distance to the middle of the roof
    expect(Math.abs(cost - (horizontal + 2.25))).toBeLessThan(0.3);
    // the climb is vertical, from a spot a full base off the face
    const i = path.findIndex((p, k) => k > 0 && p.y - path[k - 1].y > 2);
    expect(path[i].x).toBeCloseTo(path[i - 1].x, 2);
    expect(path[i].z).toBeCloseTo(path[i - 1].z, 2);
  });

  it('a budget too short to finish the climb stops at the stand-off spot on the ground', () => {
    // 1.325 to the stand-off spot, then 2.25 up and 0.55 to the roof's lip: 4.125 in all, and a full base
    // (a further 0.5") onto the roof makes 4.675 - stopping at the lip would leave the base over the edge
    for (const budget of [1.4, 2, 3, 3.9, 4.3]) {
      const { end, state } = run([container], P(0, 0, -3), P(0, 2.25, 0), budget);
      expect(end.y, `budget ${budget}`).toBe(0);
      expect(isSuspendedInMidAir(state, end)).toBe(false);
    }
    const ok = run([container], P(0, 0, -3), P(0, 2.25, 0), 4.7);
    expect(ok.end.y).toBeCloseTo(2.25);
    const stop = run([container], P(0, 0, -3), P(0, 2.25, 0), 3);
    expect(stop.end.z).toBeCloseTo(-1.675, 1); // the stand-off spot, a base off the north face
  });

  it('is not difficult terrain and the climb counts as ordinary movement', () => {
    const { state, unit, path } = run([container], P(0, 0, -3), P(0, 2.25, 0));
    expect(pathMovementCost(state, path, unit)).toBeGreaterThan(2.25);
  });

  it('a container with climbable false cannot be climbed', () => {
    const { end, kinds, state, unit, path } = run([lone('shipping-container', false)], P(0, 0, -5), P(0, 2.25, 0));
    expect(end.y).toBe(0);
    expect(kinds).not.toContain('climb');
    expect(classifySegment(state, P(0, 0, -1.675), P(0, 2.25, -1.675), unit).kind).toBe('blocked');
    expect(path.length).toBeGreaterThan(1);
  });
});

describe('decks are not climbable unless overridden', () => {
  it.each(['platform-small', 'platform-large', 'catwalk'])('%s stays unclimbable (use the ladder or stairs)', (type) => {
    const piece = lone(type, undefined, P(0, 0, 0));
    const walkable = piece;
    const { end, kinds } = run([walkable], P(0, 0, -9), P(0, 3, 0));
    expect(end.y).toBe(0);
    expect(kinds).not.toContain('climb');
  });

  it('a platform with climbable true can be climbed (3.0" rise)', () => {
    const { end, kinds, cost } = run([lone('platform-small', true)], P(0, 0, -6), P(0, 3, 0));
    expect(end).toMatchObject({ x: 0, y: 3, z: 0 });
    expect(kinds).toContain('climb');
    expect(cost).toBeGreaterThan(5);
  });
});

describe('rise limit', () => {
  it('a floor 4.5" up is not climbable even when climbable is true', () => {
    // a container stacked on another: its top is 4.5" above the ground
    const lower = lone('shipping-container', true, P(0, 0, 0));
    const upper = { ...lone('shipping-container', true, P(0, 2.25, 0)), id: 'upper' };
    const { end, state, unit } = run([lower, upper], P(0, 0, -5), P(0, 4.5, 0));
    expect(end.y).toBeLessThan(4);
    expect(classifySegment(state, P(0, 0, -1.675), P(0, 4.5, -1.675), unit).kind).toBe('blocked');
  });

  it('exactly 3.0" is climbable', () => {
    const { state, unit } = run([lone('platform-small', true)], P(0, 0, -6), P(0, 3, 0));
    expect(classifySegment(state, P(0, 0, -2.55), P(0, 3, -2.55), unit).kind).toBe('climb');
  });
});

describe('ruin ledge (3.0")', () => {
  const ruin = fixtureTerrain.find((p) => p.terrainType === 'ruin-l')!;
  const others: TerrainPiece[] = [ruin];

  it('can be climbed from the courtyard', () => {
    const { end, kinds, state } = run(others, P(-1, 0, -2.5), P(-1, 3, 0));
    expect(end).toMatchObject({ x: -1, y: 3, z: 0 });
    expect(kinds).toContain('climb');
    expect(isSuspendedInMidAir(state, end)).toBe(false);
  });

  it('cannot be climbed from outside past the 4" wall', () => {
    // north of the ruin, behind the back wall the ledge adjoins
    const { end, kinds, state, unit } = run(others, P(-1, 0, 3.5), P(-1, 3, 0), 3);
    expect(end.y).toBe(0);
    expect(kinds).not.toContain('climb');
    expect(classifySegment(state, P(-1, 0, 1.3), P(-1, 3, 1.3), unit).kind).toBe('blocked');
  });
});

describe('ruin ledge, long way round', () => {
  it('with the budget to go round, the climb is made from the open end, never from behind the north wall', () => {
    const ruin = fixtureTerrain.find((p) => p.terrainType === 'ruin-l')!;
    const { path, kinds } = run([ruin], P(-1, 0, 3.5), P(-1, 3, 0), 14);
    const i = kinds.indexOf('climb');
    expect(i).toBeGreaterThanOrEqual(0);
    // never from behind the 4" back wall (z 0.75..1.0): it goes round to the open east end of the ledge
    expect(path[i].z).toBeLessThan(0.75);
    expect(path[i].x).toBeGreaterThan(0.4);
  });
});

describe('host validation', () => {
  const moveAction = (path: Vector3[]) =>
    createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'm',
      path,
      finalPosition: path[path.length - 1],
    });

  it('accepts the planned container climb', () => {
    const container = lone('shipping-container');
    const { state, path } = run([container], P(0, 0, -3), P(0, 2.25, 0));
    expect(validateAction(state, moveAction(path)).valid).toBe(true);
  });

  it('rejects a sheer climb onto a piece that is not climbable', () => {
    const unit = makeUnit('m', P(0, 0, -1.675));
    const state = makeState(unit, [lone('shipping-container', false)]);
    const v = validateAction(state, moveAction([P(0, 0, -1.675), P(0, 2.25, -1.675), P(0, 2.25, -1.1)]));
    expect(v.valid).toBe(false);
    expect((v as { reason: string }).reason).toMatch(/cannot climb/i);
  });

  it('rejects a climb taller than 3"', () => {
    const unit = makeUnit('m', P(0, 0, -1.675));
    const tall = { ...lone('platform-small', true), position: P(0, 3.5, 0) };
    const state = makeState(unit, [tall]);
    const v = validateAction(state, moveAction([P(0, 0, -2.55), P(0, 3.5, -2.55), P(0, 3.5, -1.9)]));
    expect(v.valid).toBe(false);
  });

  it('rejects a climb that ends part-way up', () => {
    const unit = makeUnit('m', P(0, 0, -1.675));
    const state = makeState(unit, [lone('shipping-container')]);
    const v = validateAction(state, moveAction([P(0, 0, -1.675), P(0, 1.2, -1.675)]));
    expect(v.valid).toBe(false);
  });
});
