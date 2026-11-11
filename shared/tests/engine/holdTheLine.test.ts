import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction } from '../../src/engine/actions';
import { applyEndOfActivationMorale, recordWoundBaseline } from '../../src/engine/activation';
import { distantAttackMoraleBonus, resolveMoraleTest } from '../../src/engine/combat';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });
const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

/** One-model unit. Bases are 1" wide, so a centre gap of d + 1 is a base-edge distance of d. */
function mk(id: string, owner: string, z: number, opts: { rules?: string[]; tough?: number; weapon?: string } = {}): Unit {
  const tough = opts.tough ?? 2;
  const w = WEAPONS[opts.weapon ?? 'rifle'];
  return {
    id, ownerId: owner, armyId: 'a', unitType: 'trooper', name: id,
    quality: 4, defense: 5, speed: 6, position: P(0, z), rotation: { x: 0, y: 0, z: 0 },
    status: [], wounds: tough, maxWounds: tough, isActivated: owner === HOST, isDestroyed: false,
    models: [{ id: `${id}-m0`, wounds: tough, maxWounds: tough, isDestroyed: false, position: P(0, z), rotation: { x: 0, y: 0, z: 0 } }],
    weapons: [{ ...w, profile: { ...w.profile } }, { ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [...(opts.rules ?? []), `tough(${tough})`],
    hasMoved: false, remainingMovement: 6,
  };
}

function mkState(units: Unit[]): GameState {
  const s = createInitialGameState(HOST, GUEST);
  s.units = units;
  s.terrain = [];
  s.status = 'in-progress';
  s.turnState.phase = 'activation';
  s.turnState.currentPlayerId = HOST;
  s.turnState.activeUnitId = 'h1';
  recordWoundBaseline(s);
  return s;
}

const END = () => createAction(HOST, 'end-activation', { type: 'end-activation' });

describe('distantAttackMoraleBonus', () => {
  const htl = ['hold-the-line'];
  it('needs the rule', () => {
    expect(distantAttackMoraleBonus([], { shot: 20 })).toBe(0);
    expect(distantAttackMoraleBonus(htl, { shot: 20 })).toBe(1);
  });
  it('shot: more than 9" counts, exactly 9" does not', () => {
    expect(distantAttackMoraleBonus(htl, { shot: 9.1 })).toBe(1);
    expect(distantAttackMoraleBonus(htl, { shot: 9 })).toBe(0);
  });
  it('charged: more than 6" counts, exactly 6" does not', () => {
    expect(distantAttackMoraleBonus(htl, { charged: 6.1 })).toBe(1);
    expect(distantAttackMoraleBonus(htl, { charged: 6 })).toBe(0);
  });
  it('a shot from 7" is not a charge from 7"', () => {
    expect(distantAttackMoraleBonus(htl, { shot: 7 })).toBe(0);
    expect(distantAttackMoraleBonus(htl, { charged: 7 })).toBe(1);
  });
  it('adds to the Morale Test roll: a 3 passes Q4+ with the bonus and fails without', () => {
    const base = { quality: 4, roll: 3, specialRules: htl };
    expect(resolveMoraleTest({ ...base, attackedFrom: { shot: 12 } })).toMatchObject({ passed: true, modifier: 1 });
    expect(resolveMoraleTest({ ...base, attackedFrom: { shot: 9 } })).toMatchObject({ passed: false, modifier: 0 });
    expect(resolveMoraleTest({ ...base })).toMatchObject({ passed: false });
  });
});

describe('Hold the Line through a real shot', () => {
  /** h1 shoots g1 (Tough 2) from a base-edge distance `gap`; the unsaved hit wounds it; its Morale roll is `moraleRoll`. */
  function shotThenMorale(gap: number, moraleRoll: number, rules = ['hold-the-line']) {
    const state = mkState([mk('h1', HOST, 0, { weapon: 'long-rifle' }), mk('g1', GUEST, gap + 1, { rules, tough: 2 })]);
    const shoot = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'long-rifle' });
    const shot = applyAction(state, shoot, [roll('to-hit', [6]), roll('defense', [1])]);
    if (!shot.ok) throw new Error(shot.reason);
    return { shot: shot.state!, end: applyAction(shot.state!, END(), [roll('morale', [moraleRoll]), roll('fearless', [1])]) };
  }

  it('shot from 9.1": a roll of 3 holds a Q4+ unit', () => {
    const { end } = shotThenMorale(9.1, 3);
    expect(end.ok).toBe(true);
    expect(end.state!.units[1].status).not.toContain('shaken');
  });
  it('shot from exactly 9": a roll of 3 fails', () => {
    expect(shotThenMorale(9, 3).end.state!.units[1].status).toContain('shaken');
  });
  it('without the rule a roll of 3 fails even at long range', () => {
    expect(shotThenMorale(20, 3, []).end.state!.units[1].status).toContain('shaken');
  });
  it('the distance is carried in state, then cleared when the activation ends', () => {
    const { shot, end } = shotThenMorale(20, 3);
    expect(shot.turnState.attackedFrom?.g1.shot).toBeCloseTo(20);
    expect(end.state!.turnState.attackedFrom).toBeUndefined();
  });
  it('the Morale log entry shows the +1', () => {
    const { shot } = shotThenMorale(20, 3);
    const records = applyEndOfActivationMorale(shot, [3]);
    expect(records[0]).toMatchObject({ unitId: 'g1', modifier: 1, passed: true });
  });
});

describe('Hold the Line through a charge', () => {
  /** h1 charges g1 from a base-edge gap; with `split` the charge is declared first. */
  function charged(gap: number, split: boolean): GameState {
    const h1 = mk('h1', HOST, 0, { tough: 3 });
    h1.speed = 12;
    h1.remainingMovement = 12;
    let state = mkState([h1, mk('g1', GUEST, gap + 1, { rules: ['hold-the-line'], tough: 2 })]);
    if (split) {
      const begin = applyAction(state, createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' }));
      if (!begin.ok) throw new Error(begin.reason);
      state = begin.state!;
    }
    const path = [P(0, 0), P(0, gap - 0.05)];
    const charge = createAction(HOST, 'charge', { type: 'charge', attackerId: 'h1', targetId: 'g1', path, weaponId: 'blade' });
    const res = applyAction(state, charge, [roll('to-hit', [6, 6]), roll('defense', [1, 1])]);
    if (!res.ok) throw new Error(res.reason);
    return res.state!;
  }

  for (const split of [false, true]) {
    const label = split ? 'declared' : 'one-click';
    it(`${label} charge from 6.1" counts as over 6"`, () => {
      const from = charged(6.1, split).turnState.attackedFrom?.g1;
      expect(from?.charged).toBeCloseTo(6.1);
      expect(distantAttackMoraleBonus(['hold-the-line'], from)).toBe(1);
    });
    it(`${label} charge from exactly 6" gets no bonus`, () => {
      const from = charged(6, split).turnState.attackedFrom?.g1;
      expect(from?.charged).toBeCloseTo(6);
      expect(distantAttackMoraleBonus(['hold-the-line'], from)).toBe(0);
    });
  }
});
