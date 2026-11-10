import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { createJumpRangeMap } from '../../src/data/builtinMaps';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { pathMovementCost } from '../../src/engine/traversal';
import { findMoveBlocker, findNavPath } from '../../src/engine/spatial';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

/** The Jump Range: host decks at x -9 / -3 / 5, z -10..-2 (3" high), stairs at z -12. */
function setup(extra: Array<{ at: Vector3[]; owner?: string }> = []) {
  const state: GameState = createInitialGameState(HOST, GUEST, 'A', 'B');
  state.status = 'in-progress';
  state.terrain = createJumpRangeMap().terrain;
  const flyer = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST)[2] as Unit;
  const spots = [P(-9, 0, -15), P(-10, 0, -16), P(-8, 0, -16), P(-9, 0, -17)];
  flyer.models.forEach((m, i) => (m.position = { ...spots[i] }));
  flyer.position = { ...spots[0] };
  flyer.isDeployed = true;
  const others = extra.map((e, k) => {
    const u = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], e.owner ?? HOST)[0] as Unit;
    u.id = `other-${k}`;
    u.models.forEach((m, i) => (m.position = { ...(e.at[i] ?? P(30 + i, 0, 30)) }));
    u.position = { ...u.models[0].position! };
    u.isDeployed = true;
    return u;
  });
  state.units = [flyer, ...others];
  return { state, flyer, others };
}

describe('Flying movement is a straight line', () => {
  it('ground to a 3" deck top beside the stairs is a two-point path', () => {
    const { state, flyer } = setup();
    const path = findNavPath(state, flyer, P(-9, 3, -8), 12, { keepAway: true });
    expect(path).toEqual([P(-9, 0, -15), P(-9, 3, -8)]);
    expect(pathMovementCost(state, path, flyer)).toBeCloseTo(Math.hypot(7, 3), 1);
  });

  it('ground to a deck top off to the side does not detour via the stairs', () => {
    const { state, flyer } = setup();
    const path = findNavPath(state, flyer, P(-3, 3, -8), 12, { keepAway: true });
    expect(path).toHaveLength(2);
    expect(path[1]).toMatchObject({ x: -3, y: 3, z: -8 });
  });

  it('flies over a deck to the ground on its far side in one leg', () => {
    const { state, flyer } = setup();
    const path = findNavPath(state, flyer, P(-9, 0, 0), 20, { keepAway: true });
    expect(path).toEqual([P(-9, 0, -15), P(-9, 0, 0)]);
  });

  it('the host accepts the straight path through the deck body (no terrain block)', () => {
    const { state, flyer } = setup();
    expect(findMoveBlocker(state, flyer, [P(-9, 0, -15), P(-9, 3, -8)], { keepAway: true })).toEqual({ blocked: false });
  });

  it('a ground walker is still blocked by the same deck body', () => {
    const { state, flyer } = setup();
    flyer.specialRules = [];
    expect(findMoveBlocker(state, flyer, [P(-9, 0, -12), P(-9, 0, -8)]).blocked).toBe(true);
  });

  it('flies over and through another unit but may not end within 1" of it', () => {
    const { state, flyer, others } = setup([{ at: [P(-9, 0, -13), P(-9, 0, -12)] }]);
    expect(others).toHaveLength(1);
    const through = findNavPath(state, flyer, P(-9, 0, -8), 20, { keepAway: true });
    expect(through).toEqual([P(-9, 0, -15), P(-9, 0, -8)]);
    expect(findMoveBlocker(state, flyer, through, { keepAway: true })).toEqual({ blocked: false });
    // stopping right beside the models is refused at the end spot
    expect(findMoveBlocker(state, flyer, [P(-9, 0, -15), P(-9, 0, -13.8)], { keepAway: true }).blocked).toBe(true);
    // and so is landing on top of one
    expect(findMoveBlocker(state, flyer, [P(-9, 0, -15), P(-9, 0, -13)], { keepAway: true }).blocked).toBe(true);
  });

  it('flying over an enemy model is allowed but not ending on it', () => {
    const { state, flyer } = setup([{ at: [P(-9, 0, -12)], owner: GUEST }]);
    expect(findMoveBlocker(state, flyer, [P(-9, 0, -15), P(-9, 0, -8)]).blocked).toBe(false);
    expect(findMoveBlocker(state, flyer, [P(-9, 0, -15), P(-9, 0, -12.2)]).blocked).toBe(true);
  });

  it('the budget still caps the straight line', () => {
    const { state, flyer } = setup();
    const path = findNavPath(state, flyer, P(-9, 0, 10), 6, { keepAway: true });
    expect(path).toHaveLength(2);
    expect(pathMovementCost(state, path, flyer)).toBeLessThanOrEqual(6.01);
    expect(path[1].z).toBeCloseTo(-9, 0);
  });
});
