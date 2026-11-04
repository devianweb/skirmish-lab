import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, validateAction } from '../../src/engine/actions';
import {
  coherencyShortfall,
  isRegroupingMove,
  validateSquadCoherency,
} from '../../src/engine/spatial';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

function mkUnit(id: string, ownerId: string, spots: Array<[number, number]>, extra: Partial<Unit> = {}): Unit {
  const models = spots.map(([x, z], i) => ({
    id: `${id}-m${i}`, wounds: 1, maxWounds: 1, isDestroyed: false, position: P(x, z), rotation: { x: 0, y: 0, z: 0 },
  }));
  const cx = spots.reduce((a, s) => a + s[0], 0) / spots.length;
  const cz = spots.reduce((a, s) => a + s[1], 0) / spots.length;
  return {
    id, ownerId, armyId: 'a', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 4,
    position: P(cx, cz), rotation: { x: 0, y: 0, z: 0 }, status: [], wounds: spots.length, maxWounds: spots.length,
    isActivated: ownerId === HOST, isDestroyed: false, models,
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }, { ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [], hasMoved: false, remainingMovement: 6, ...extra,
  };
}

function mkState(units: Unit[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = 'h1';
  return state;
}

describe('coherencyShortfall', () => {
  it('is 0 for coherent squads, on one level and across levels', () => {
    expect(coherencyShortfall([P(0, 0), P(1, 0), P(2, 0), P(3, 0)])).toBe(0);
    expect(coherencyShortfall([P(0, 0, 0), P(0, 3, 3)])).toBe(0);
    expect(coherencyShortfall([P(0, 0)])).toBe(0);
  });

  it('gives the missing chain length for two pairs apart (centre gap minus the link limit)', () => {
    // pairs at x 0,1 and x 5,6: closest centres 4" apart, same-level link limit is 2" centre to centre
    expect(coherencyShortfall([P(0, 0), P(1, 0), P(5, 0), P(6, 0)])).toBeCloseTo(2, 5);
  });

  it('grows with the gap', () => {
    const near = coherencyShortfall([P(0, 0), P(1, 0), P(4, 0)]);
    const far = coherencyShortfall([P(0, 0), P(1, 0), P(6, 0)]);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('adds how far the widest pair exceeds the 6" spread', () => {
    // a connected chain of 9 models in a line spans 8" centre to centre; the spread limit is 7" centre to centre
    const line = Array.from({ length: 9 }, (_, i) => P(i, 0));
    expect(validateSquadCoherency(line).coherent).toBe(false);
    expect(coherencyShortfall(line)).toBeCloseTo(1, 5);
  });

  it('counts a split-level gap against the 3" limit', () => {
    // 5" centre apart across levels: limit 4" centre to centre
    expect(coherencyShortfall([P(0, 0, 0), P(0, 5, 3)])).toBeCloseTo(1, 5);
  });

  it('is 0 exactly when validateSquadCoherency accepts (random layouts, one and two levels)', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let coherentSeen = 0;
    let incoherentSeen = 0;
    for (let run = 0; run < 600; run++) {
      const n = 2 + Math.floor(rnd() * 5);
      const spread = 1 + rnd() * 4;
      const positions = Array.from({ length: n }, () => P(rnd() * spread * 1.6, rnd() * spread, rnd() < 0.3 ? 3 : 0));
      const coherent = validateSquadCoherency(positions).coherent;
      const shortfall = coherencyShortfall(positions);
      if (coherent) coherentSeen++;
      else incoherentSeen++;
      expect(shortfall === 0).toBe(coherent);
    }
    expect(coherentSeen).toBeGreaterThan(20);
    expect(incoherentSeen).toBeGreaterThan(20);
  });

  it('isRegroupingMove only applies to squads that started incoherent and got measurably closer', () => {
    const start = [P(0, 0), P(1, 0), P(0, 1), P(14, 0)];
    expect(isRegroupingMove(start, [P(0, 0), P(1, 0), P(0, 1), P(8, 0)])).toBe(true);
    expect(isRegroupingMove(start, [P(0, 0), P(1, 0), P(0, 1), P(13.98, 0)])).toBe(false);
    expect(isRegroupingMove([P(0, 0), P(1, 0)], [P(0, 0), P(4, 0)])).toBe(false);
  });
});

describe('regrouping an out-of-coherency squad (host)', () => {
  const stray = (x: number): Array<[number, number]> => [[0, 0], [1, 0], [0, 1], [x, 0]];
  const move = (type: 'move-unit' | 'rush', ends: Vector3[], starts: Vector3[]) =>
    createAction(HOST, type, {
      type, unitId: 'h1', path: [starts[0], ends[0]], finalPosition: ends[0],
      modelPositions: ends, modelPaths: starts.map((s, i) => [s, ends[i]]),
    } as any);
  const startsOf = (s: GameState) => s.units[0].models.map((m) => m.position!);
  const withStray = (x: number) => mkState([mkUnit('h1', HOST, stray(x), { speed: 6 }), mkUnit('g1', GUEST, [[0, 40]])]);

  it('accepts an Advance that brings the stray closer but still apart', () => {
    const state = withStray(14);
    const starts = startsOf(state);
    const ends = [starts[0], starts[1], starts[2], P(8, 0)];
    expect(validateSquadCoherency(ends).coherent).toBe(false);
    const action = move('move-unit', ends, starts);
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = applyAction(state, action);
    expect(out.ok).toBe(true);
    expect(out.state!.units[0].models[3].position).toEqual(P(8, 0));
  });

  it('accepts a move that makes the squad coherent', () => {
    const state = withStray(7);
    const starts = startsOf(state);
    const ends = [starts[0], starts[1], starts[2], P(2, 1)];
    expect(validateAction(state, move('move-unit', ends, starts)).valid).toBe(true);
  });

  it('rejects a move that leaves the shortfall the same or larger', () => {
    const state = withStray(14);
    const starts = startsOf(state);
    const same = [starts[0], starts[1], starts[2], P(14, 0.01)];
    expect(validateAction(state, move('move-unit', same, starts)).valid).toBe(false);
    const worse = [starts[0], starts[1], starts[2], P(14, 4)];
    const res = validateAction(state, move('move-unit', worse, starts));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/closer to coherent|coheren|spread/i);
  });

  it('closer counts for a Rush too', () => {
    const state = withStray(20);
    const starts = startsOf(state);
    const ends = [starts[0], starts[1], starts[2], P(8, 0)];
    expect(validateAction(state, move('rush', ends, starts)).valid).toBe(true);
  });

  it('compares a second move with the positions before it', () => {
    const state = withStray(14);
    const starts = startsOf(state);
    const first = applyAction(state, move('move-unit', [starts[0], starts[1], starts[2], P(10, 0)], starts));
    expect(first.ok).toBe(true);
    const mid = first.state!;
    const midStarts = startsOf(mid);
    // going back out is not closer than where the first move left it
    expect(validateAction(mid, move('move-unit', [midStarts[0], midStarts[1], midStarts[2], P(12, 0)], midStarts)).valid).toBe(false);
    expect(validateAction(mid, move('move-unit', [midStarts[0], midStarts[1], midStarts[2], P(9, 0)], midStarts)).valid).toBe(true);
  });

  it('a squad that started coherent must still end coherent', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [1, 0], [0, 1], [1, 1]], { speed: 6 }), mkUnit('g1', GUEST, [[0, 40]])]);
    const starts = startsOf(state);
    const ends = [starts[0], starts[1], starts[2], P(5, 1)];
    const res = validateAction(state, move('move-unit', ends, starts));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/coheren|nearest|split/i);
  });
});

describe('regrouping while charging', () => {
  // cluster at the origin, a stray off to the side, target 9" ahead
  const build = () =>
    mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [0, 1], [5, -2]], { speed: 4, remainingMovement: 4 }),
      mkUnit('g1', GUEST, [[0, 9]]),
    ]);
  const chargeAction = (ends: Vector3[], starts: Vector3[], type: 'charge' | 'charge-leg') =>
    createAction(HOST, type, {
      type, attackerId: 'h1', ...(type === 'charge' ? { targetId: 'g1', weaponId: 'blade' } : {}),
      path: [starts[0], ends[0]], modelPositions: ends, modelPaths: starts.map((s, i) => [s, ends[i]]),
    } as any);
  const startsOf = (s: GameState) => s.units[0].models.map((m) => m.position!);

  it('a final charge may end apart if the whole squad ended closer to coherent', () => {
    const state = build();
    const starts = startsOf(state);
    const ends = [P(0, 8), P(1, 8), P(0, 7), P(4, 5.5)];
    expect(validateSquadCoherency(ends).coherent).toBe(false);
    expect(isRegroupingMove(starts, ends)).toBe(true);
    expect(validateAction(state, chargeAction(ends, starts, 'charge'))).toEqual({ valid: true });
  });

  it('a final charge that leaves the stray as far from the squad is rejected', () => {
    const state = build();
    const starts = startsOf(state);
    const ends = [P(0, 8), P(1, 8), P(0, 7), starts[3]];
    expect(isRegroupingMove(starts, ends)).toBe(false);
    const res = validateAction(state, chargeAction(ends, starts, 'charge'));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/coheren|nearest|split|spread/i);
  });

  it('a charge leg obeys the same rule against the positions before the leg', () => {
    const state = build();
    const declared = applyAction(state, createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' }));
    expect(declared.ok).toBe(true);
    const mid = declared.state!;
    const starts = startsOf(mid);
    const good = [starts[0], starts[1], starts[2], P(4, 0)];
    expect(validateAction(mid, chargeAction(good, starts, 'charge-leg')).valid).toBe(true);
    const bad = [P(0, 3), P(1, 3), P(0, 4), starts[3]];
    expect(validateAction(mid, chargeAction(bad, starts, 'charge-leg')).valid).toBe(false);
  });

  it('a squad that started coherent must still end a charge coherent', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [0, 1], [1, 1]], { speed: 4, remainingMovement: 4 }),
      mkUnit('g1', GUEST, [[0, 9]]),
    ]);
    const starts = startsOf(state);
    const res = validateAction(state, chargeAction([P(0, 8), P(1, 8), P(0, 7), P(5, 4)], starts, 'charge'));
    expect(res.valid).toBe(false);
  });
});

describe('no shooting in place for an out-of-coherency squad', () => {
  const shoot = () => createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'rifle' });
  const build = (extra: Partial<Unit> = {}) =>
    mkState([mkUnit('h1', HOST, [[0, 0], [1, 0], [0, 1], [5, 5]], extra), mkUnit('g1', GUEST, [[0, 15]])]);

  it('rejects shooting before moving, with a reason that says it must move back together', () => {
    const res = validateAction(build(), shoot());
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/coheren/i);
    expect(res.reason).toMatch(/move/i);
  });

  it('allows shooting after an Advance (even if still apart)', () => {
    const state = build();
    const starts = state.units[0].models.map((m) => m.position!);
    const ends = [starts[0], starts[1], starts[2], P(3, 4)];
    const moved = applyAction(
      state,
      createAction(HOST, 'move-unit', {
        type: 'move-unit', unitId: 'h1', path: [starts[0], ends[0]], finalPosition: ends[0],
        modelPositions: ends, modelPaths: starts.map((s, i) => [s, ends[i]]),
      } as any)
    );
    expect(moved.ok).toBe(true);
    expect(validateAction(moved.state!, shoot()).valid).toBe(true);
  });

  it('a coherent squad can shoot in place', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [1, 0], [0, 1], [1, 1]]), mkUnit('g1', GUEST, [[0, 15]])]);
    expect(validateAction(state, shoot()).valid).toBe(true);
  });

  it('exempts stunned units from the coherency block', () => {
    const res = validateAction(build({ status: ['stunned'] }), shoot());
    expect(res.reason ?? '').not.toMatch(/coheren/i);
  });

  it('does not affect a lone model', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0]]), mkUnit('g1', GUEST, [[0, 15]])]);
    expect(validateAction(state, shoot()).valid).toBe(true);
  });
});
