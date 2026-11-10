import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { createJumpRangeMap } from '../../src/data/builtinMaps';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { findMoveBlocker, findNavPath } from '../../src/engine/spatial';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

/** `side` 'guest' uses the mirrored stairs (x 9, z 12, yaw pi); 'host' the originals (x -9, z -12). */
function setup(side: 'host' | 'guest', friendAt: Vector3[] | null) {
  const s = side === 'guest' ? 1 : -1;
  const owner = side === 'guest' ? GUEST : HOST;
  const state: GameState = createInitialGameState(HOST, GUEST, 'A', 'B');
  state.status = 'in-progress';
  state.terrain = createJumpRangeMap().terrain;
  const strider = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], owner)[1] as Unit;
  const spots = [P(s * 9, 0, s * 15), P(s * 10, 0, s * 16), P(s * 8, 0, s * 16), P(s * 9, 0, s * 17)];
  strider.models.forEach((m, i) => (m.position = { ...spots[i] }));
  strider.position = { ...spots[0] };
  const units = [strider];
  if (friendAt) {
    const friend = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], owner)[0] as Unit;
    friend.id = 'friend';
    friend.models.forEach((m, i) => (m.position = { ...friendAt[i] }));
    friend.position = { ...friendAt[0] };
    units.push(friend);
  }
  state.units = units;
  return { state, strider, s };
}

describe.each(['host', 'guest'] as const)('%s side climbing its own stairs', (side) => {
  it('a Rush-length path reaches the 3" deck top', () => {
    const { state, strider, s } = setup(side, null);
    const path = findNavPath(state, strider, P(s * 9, 3, s * 6), 12, { keepAway: true, stopBeforeDifficult: true });
    expect(path[path.length - 1]).toMatchObject({ x: s * 9, y: 3, z: s * 6 });
    expect(findMoveBlocker(state, strider, path, { keepAway: true })).toEqual({ blocked: false });
  });

  it('a friendly unit at the foot closes the entry: the planner stays put instead of drawing a path through the stairs', () => {
    const f = (x: number, z: number): Vector3 => P(x, 0, z);
    const s = side === 'guest' ? 1 : -1;
    const { state, strider } = setup(side, [f(s * 9, s * 14.2), f(s * 10.5, s * 14.2), f(s * 7.5, s * 14.2), f(s * 9, s * 13.5)]);
    const path = findNavPath(state, strider, P(s * 9, 3, s * 6), 12, { keepAway: true, stopBeforeDifficult: true });
    expect(findMoveBlocker(state, strider, path, { keepAway: true })).toEqual({ blocked: false });
    expect(path[path.length - 1].y ?? 0).toBeLessThan(0.5); // never gets onto the deck
  });
});
