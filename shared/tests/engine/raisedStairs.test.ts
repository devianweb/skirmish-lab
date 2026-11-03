import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { pathMovementCost } from '../../src/engine/traversal';
import { findNavPath, findMoveBlocker, isSegmentOnRampOrStairs, getStairSurfaceHeight } from '../../src/engine/spatial';

const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function makeUnit(position: Vector3, budget: number): Unit {
  return {
    id: 'm', ownerId: 'host-1', armyId: 'army-1', unitType: 'trooper', name: 'm',
    quality: 4, defense: 5, speed: 6, position: { ...position }, rotation: { x: 0, y: 0, z: 0 },
    status: [], wounds: 0, maxWounds: 3, isActivated: false, isDestroyed: false, models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [], hasMoved: false, remainingMovement: budget,
  };
}
function makeState(unit: Unit, pieces: TerrainPiece[]): GameState {
  const state = createInitialGameState('host-1', 'guest-1');
  state.units = [unit];
  state.terrain = pieces;
  state.status = 'in-progress';
  return state;
}
const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/testy-mctestface-2.json'), 'utf8'));
const terrain: TerrainPiece[] = fixture.terrain;

const plan = (from: Vector3, to: Vector3, budget = 48) => {
  const unit = makeUnit(from, budget);
  const state = makeState(unit, terrain);
  const path = findNavPath(state, unit, to, budget);
  return { state, unit, path, end: path[path.length - 1], cost: pathMovementCost(state, path, unit) };
};
const near = (a: Vector3, b: Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z) < 0.15 && Math.abs((a.y ?? 0) - (b.y ?? 0)) < 0.15;

describe('raised stairs (stairs standing on a deck)', () => {
  const upper = terrain.find((p) => p.id === 'stairs-upper')!;

  it('a segment along the raised slope counts as on the stairs', () => {
    const state = makeState(makeUnit(P(0, 3, 0), 10), terrain);
    const y = (x: number) => getStairSurfaceHeight(upper, P(x, 0, 0), state)!;
    expect(isSegmentOnRampOrStairs(state, P(1, y(1), 0), P(2, y(2), 0))).toBe(true);
    // flat through the wedge is not on the stairs
    expect(isSegmentOnRampOrStairs(state, P(1, 3, 0), P(2, 3, 0))).toBe(false);
  });

  it('ground to a spot on the upper slope reaches it', () => {
    const r = plan(P(-10, 0, 0), P(2, 4.5, 0));
    expect(near(r.end, P(2, 4.5, 0))).toBe(true);
  });

  it('ground to the 6" deck goes up both staircases and reaches it', () => {
    const r = plan(P(-10, 0, 0), P(5.2, 6, 0));
    expect(near(r.end, P(5.2, 6, 0))).toBe(true);
    const horiz = r.path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - r.path[i - 1].x, p.z - r.path[i - 1].z) : s), 0);
    expect(r.cost).toBeGreaterThan(horiz);
    expect(r.cost).toBeLessThan(horiz + 6.5);
  });

  it('ground stairs: a model can stop part-way up the slope too', () => {
    const r = plan(P(-10, 0, 0), P(-6, 1.5, 0));
    expect(near(r.end, P(-6, 1.5, 0))).toBe(true);
  });

  it('a short budget stops part-way up the raised slope', () => {
    const r = plan(P(-1, 3, 0), P(2, 4.5, 0), 2);
    expect(r.end.y).toBeGreaterThan(3.1);
    expect(r.end.y).toBeLessThan(4.5);
  });

  it('the raised wedge still blocks walking through it on the 3" deck', () => {
    const unit = makeUnit(P(-1, 3, 0), 20);
    const state = makeState(unit, terrain);
    const res = findMoveBlocker(state, unit, [P(-1, 3, 0), P(3, 3, 0)]);
    expect(res.blocked).toBe(true);
  });
});
