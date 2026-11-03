import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { findJumpOption, pathMovementCost } from '../../src/engine/traversal';
import { findNavPath } from '../../src/engine/spatial';

const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function makeUnit(position: Vector3, budget = 20): Unit {
  return {
    id: 'm',
    ownerId: 'host-1',
    armyId: 'army-1',
    unitType: 'trooper',
    name: 'm',
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: 0,
    maxWounds: 3,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: budget,
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

const plan = (from: Vector3, to: Vector3, pieces: TerrainPiece[] = terrain, budget = 20) => {
  const unit = makeUnit(from, budget);
  const state = makeState(unit, pieces);
  const path = findNavPath(state, unit, to, budget);
  return { state, unit, path, end: path[path.length - 1], cost: pathMovementCost(state, path, unit) };
};
const reaches = (r: { end: Vector3 }, to: Vector3) =>
  Math.hypot(r.end.x - to.x, r.end.z - to.z) < 0.15 && Math.abs((r.end.y ?? 0) - (to.y ?? 0)) < 0.15;
const horizontal = (path: Vector3[]) =>
  path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : s), 0);

describe('stacked levels: climb and drop between a deck and a piece stacked on it', () => {
  const deckSpot = P(5.2, 6, 0); // on the 6" deck beside the container (container spans x 5.875..8.125)
  const roofSpot = P(7, 8.25, 0);

  it('climbs from the 6" deck onto the stacked container (walk + 2.25")', () => {
    const r = plan(deckSpot, roofSpot);
    expect(reaches(r, roofSpot)).toBe(true);
    expect(r.cost).toBeCloseTo(horizontal(r.path) + 2.25, 1);
  });

  it('drops from the container roof back onto the 6" deck for free (horizontal cost only)', () => {
    const r = plan(roofSpot, deckSpot);
    expect(reaches(r, deckSpot)).toBe(true);
    expect(r.cost).toBeCloseTo(horizontal(r.path), 1);
  });

  it('a non-climbable piece stacked on a deck cannot be climbed', () => {
    const pieces = terrain.map((p) => (p.id === 'container-top' ? { ...p, climbable: false } : p));
    const r = plan(deckSpot, roofSpot, pieces);
    expect(reaches(r, roofSpot)).toBe(false);
  });

  // container-b in the fixture covers container-a's whole roof, so shift it 2" east to leave a ledge to stand on
  const shifted = terrain.map((p) => (p.id === 'container-b' ? { ...p, position: { ...p.position, x: 7 } } : p));
  const aRoof = P(3.3, 2.25, -6);
  const bRoof = P(7, 4.5, -6);

  it('container-a roof to the stacked container-b roof is climbable (2.25" rise)', () => {
    const r = plan(aRoof, bRoof, shifted);
    expect(reaches(r, bRoof)).toBe(true);
    expect(r.cost).toBeCloseTo(horizontal(r.path) + 2.25, 1);
  });

  it('container-b cannot be climbed straight from the ground (4.5" rise)', () => {
    const to = P(5, 4.5, -6); // container-b sits exactly on container-a: no ledge to climb in two steps
    const r = plan(P(5, 0, -9), to);
    expect(reaches(r, to)).toBe(false);
  });

  it('with a ledge on container-a, container-b is reached in two legal 2.25" climbs', () => {
    const r = plan(P(3.3, 0, -9), bRoof, shifted);
    expect(reaches(r, bRoof)).toBe(true);
  });

  it('container-b roof drops back to container-a roof for free', () => {
    const r = plan(bRoof, aRoof, shifted);
    expect(reaches(r, aRoof)).toBe(true);
    expect(r.cost).toBeCloseTo(horizontal(r.path), 1);
  });

  it('from the upper deck edge over open ground a drop of 6" is a jump-drop with 3 dice', () => {
    const from = P(7, 6, 1.75);
    const unit = makeUnit(from);
    const state = makeState(unit, terrain.filter((p) => p.id !== 'container-top'));
    const opt = findJumpOption(state, unit, from, P(7, 0, 3.5));
    expect(opt?.kind).toBe('jump-drop');
    expect(opt?.dice).toBe(3);
  });

  it('from the stacked container roof, a leap down to open ground (8.25") is a fall', () => {
    const from = P(8.0, 8.25, 0);
    const unit = makeUnit(from);
    const state = makeState(unit, terrain);
    const opt = findJumpOption(state, unit, from, P(9.5, 0, 0));
    expect(opt?.kind).toBe('fall');
  });
});
