import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { DiceSpec } from '../../src/types';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import {
  applyEndOfActivationMorale,
  getUnitsRequiringMorale,
  isAtHalfOrLess,
  isUnitInObjectiveRange,
  recordWoundBaseline,
} from '../../src/engine/activation';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });

function weapon(id: keyof typeof WEAPONS): Weapon {
  return { ...WEAPONS[id], profile: { ...WEAPONS[id].profile } };
}

/** A unit of `count` Tough-`tough` models standing in a row from (x, z), 1" apart. */
function mkUnit(
  id: string,
  ownerId: string,
  x: number,
  z: number,
  opts: { count?: number; tough?: number; quality?: number; rules?: string[]; weapons?: string[] } = {}
): Unit {
  const count = opts.count ?? 1;
  const tough = opts.tough ?? 1;
  const models = Array.from({ length: count }, (_, i) => ({
    id: `${id}-m${i}`,
    wounds: tough,
    maxWounds: tough,
    isDestroyed: false,
    position: P(x + i, z),
    rotation: { x: 0, y: 0, z: 0 },
  }));
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: opts.quality ?? 4,
    defense: 5,
    speed: 6,
    position: P(x + (count - 1) / 2, z),
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: count * tough,
    maxWounds: tough,
    isActivated: false,
    isDestroyed: false,
    models,
    weapons: (opts.weapons ?? ['rifle']).map(weapon),
    specialRules: opts.rules ?? [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function mkState(units: Unit[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = [];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  return state;
}

const unitOf = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

/** Take `n` wounds off a unit's models in order (a model dies when its wounds run out). */
function wound(unit: Unit, n: number): void {
  let left = n;
  for (const m of unit.models) {
    while (left > 0 && !m.isDestroyed) {
      m.wounds -= 1;
      left -= 1;
      if (m.wounds <= 0) m.isDestroyed = true;
    }
  }
  unit.wounds = unit.models.filter((m) => !m.isDestroyed).reduce((sum, m) => sum + m.wounds, 0);
}

/** The state at the moment the active unit (h1) ends its activation, with the given units wounded after it began. */
function endOfActivation(units: Unit[], woundBy: Record<string, number>): GameState {
  const state = mkState(units);
  state.turnState.activeUnitId = 'h1';
  unitOf(state, 'h1').isActivated = true;
  recordWoundBaseline(state);
  for (const [id, n] of Object.entries(woundBy)) wound(unitOf(state, id), n);
  return state;
}

const endAction = () => createAction(HOST, 'end-activation', { type: 'end-activation' });

/** End the activation, answering each requested die from `answers` (by purpose). */
function endWith(state: GameState, answers: Record<string, number[]> = {}) {
  const specs = getDiceSpecs(state, endAction()) ?? [];
  const dice = specs.map((s: DiceSpec) => roll(s.purpose, answers[s.purpose] ?? Array(s.count).fill(1)));
  const out = applyAction(state, endAction(), dice);
  if (!out.ok) throw new Error(out.reason);
  return out;
}

describe('wounds kill at Tough', () => {
  it('a Tough 3 model survives two wounds and is killed by the third, with no roll', () => {
    const unit = mkUnit('g1', GUEST, 0, 10, { tough: 3, rules: ['tough(3)'] });
    const state = mkState([mkUnit('h1', HOST, 0, 0, { weapons: ['carbine'] }), unit]);
    state.turnState.activeUnitId = 'h1';
    unitOf(state, 'h1').isActivated = true;
    const shoot = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'carbine' });

    const two = applyAction(state, shoot, [roll('to-hit', [6, 6]), roll('defense', [1, 1])]);
    expect(two.ok).toBe(true);
    expect(unitOf(two.state!, 'g1').isDestroyed).toBe(false);
    expect(unitOf(two.state!, 'g1').models[0].wounds).toBe(1);

    unitOf(two.state!, 'h1').hasAttacked = false;
    const third = applyAction(two.state!, shoot, [roll('to-hit', [6, 1]), roll('defense', [1, 1])]);
    expect(unitOf(third.state!, 'g1').isDestroyed).toBe(true);
  });
});

describe('half strength', () => {
  it('a 5-model unit is at half with 2 living, not with 3', () => {
    const unit = mkUnit('g1', GUEST, 0, 10, { count: 5 });
    wound(unit, 2);
    expect(isAtHalfOrLess(unit)).toBe(false); // 3 living: 3 x 2 = 6 > 5
    wound(unit, 1);
    expect(isAtHalfOrLess(unit)).toBe(true); // 2 living: 4 <= 5
  });

  it('a 10-model unit is at half with exactly 5 living', () => {
    const unit = mkUnit('g1', GUEST, 0, 10, { count: 10 });
    wound(unit, 4);
    expect(isAtHalfOrLess(unit)).toBe(false);
    wound(unit, 1);
    expect(isAtHalfOrLess(unit)).toBe(true);
  });

  it('a single Tough 3 model is at half with 1 wound left, not with 2', () => {
    const unit = mkUnit('g1', GUEST, 0, 10, { tough: 3 });
    wound(unit, 1);
    expect(isAtHalfOrLess(unit)).toBe(false);
    wound(unit, 1);
    expect(isAtHalfOrLess(unit)).toBe(true);
  });
});

describe('end-of-activation morale trigger', () => {
  const squad = (count = 5) => mkUnit('g1', GUEST, 0, 10, { count });

  it('a 5-model unit wounded down to 2 tests; wounded down to 3 does not', () => {
    const tests = getUnitsRequiringMorale(endOfActivation([mkUnit('h1', HOST, 0, 0), squad()], { g1: 3 }));
    expect(tests.map((u) => u.id)).toEqual(['g1']);
    const none = getUnitsRequiringMorale(endOfActivation([mkUnit('h1', HOST, 0, 0), squad()], { g1: 2 }));
    expect(none).toEqual([]);
  });

  it('a single Tough 3 model with 2 wounds tests; with 1 wound it does not', () => {
    const boss = () => mkUnit('g1', GUEST, 0, 10, { tough: 3 });
    expect(getUnitsRequiringMorale(endOfActivation([mkUnit('h1', HOST, 0, 0), boss()], { g1: 2 }))).toHaveLength(1);
    expect(getUnitsRequiringMorale(endOfActivation([mkUnit('h1', HOST, 0, 0), boss()], { g1: 1 }))).toHaveLength(0);
  });

  it('a unit already at half that took no wound this activation does not test', () => {
    const g1 = squad();
    wound(g1, 3); // already at 2 of 5 before the activation
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0), g1], {});
    expect(getUnitsRequiringMorale(state)).toEqual([]);
  });

  it('a further wound on a unit already at half does test it', () => {
    const g1 = squad();
    wound(g1, 3);
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0), g1], { g1: 1 });
    expect(getUnitsRequiringMorale(state).map((u) => u.id)).toEqual(['g1']);
  });

  it('the active unit tests too when it wounded itself down to half', () => {
    const h1 = mkUnit('h1', HOST, 0, 0, { count: 4 });
    const state = endOfActivation([h1, mkUnit('g1', GUEST, 0, 10)], { h1: 2 });
    expect(getUnitsRequiringMorale(state).map((u) => u.id)).toEqual(['h1']);
  });

  it('a unit that was in melee this activation skips the wound test', () => {
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0), squad()], { g1: 3 });
    state.turnState.meleeUnitIds = ['g1'];
    expect(getUnitsRequiringMorale(state)).toEqual([]);
  });
});

describe('end-activation: the test itself', () => {
  const setup = (extra: Partial<Unit> = {}) => {
    const g1 = mkUnit('g1', GUEST, 0, 10, { count: 4, quality: 4 });
    Object.assign(g1, extra);
    return endOfActivation([mkUnit('h1', HOST, 0, 0), g1], { g1: 2 });
  };

  it('requests one die per testing unit and none when nobody tests', () => {
    expect(getDiceSpecs(setup(), endAction())).toEqual([{ count: 1, sides: 6, purpose: 'morale' }]);
    const calm = endOfActivation([mkUnit('h1', HOST, 0, 0), mkUnit('g1', GUEST, 0, 10, { count: 4 })], { g1: 1 });
    expect(getDiceSpecs(calm, endAction())).toBeNull();
  });

  it('a pass leaves the unit as it was; a fail makes it Shaken (and only Shaken)', () => {
    const passed = endWith(setup(), { morale: [4] });
    expect(unitOf(passed.state!, 'g1').status).toEqual([]);
    expect(passed.logEntry.dice?.outcome.moraleTests?.[0]).toMatchObject({ unitId: 'g1', roll: 4, passed: true, outcome: 'passed' });

    const failed = endWith(setup(), { morale: [3] });
    expect(unitOf(failed.state!, 'g1').status).toEqual(['shaken']);
    expect(unitOf(failed.state!, 'g1').isDestroyed).toBe(false);
    expect(failed.logEntry.dice?.outcome.moraleTests?.[0]).toMatchObject({ roll: 3, passed: false, outcome: 'shaken' });
  });

  it('a 6 always passes and a 1 always fails', () => {
    const lowQ = endOfActivation([mkUnit('h1', HOST, 0, 0), mkUnit('g1', GUEST, 0, 10, { count: 4, quality: 6 })], { g1: 2 });
    expect(unitOf(endWith(lowQ, { morale: [6] }).state!, 'g1').status).toEqual([]);
    const highQ = endOfActivation([mkUnit('h1', HOST, 0, 0), mkUnit('g1', GUEST, 0, 10, { count: 4, quality: 2 })], { g1: 2 });
    expect(unitOf(endWith(highQ, { morale: [1] }).state!, 'g1').status).toEqual(['shaken']);
  });

  it('a unit that is already Shaken always fails without a die, and stays Shaken', () => {
    const state = setup({ status: ['shaken'] });
    expect(getDiceSpecs(state, endAction())).toBeNull();
    const out = endWith(state);
    expect(unitOf(out.state!, 'g1').status).toEqual(['shaken']);
    expect(out.logEntry.dice?.outcome.moraleTests?.[0]).toMatchObject({ unitId: 'g1', passed: false });
    expect(out.logEntry.dice?.outcome.moraleTests?.[0].roll).toBeUndefined();
  });

  it('two units testing consume dice in unit order, each unit once', () => {
    const state = endOfActivation(
      [mkUnit('h1', HOST, 0, 0, { count: 4 }), mkUnit('g1', GUEST, 0, 10, { count: 4 })],
      { h1: 2, g1: 2 }
    );
    expect(getDiceSpecs(state, endAction())).toEqual([{ count: 2, sides: 6, purpose: 'morale' }]);
    const out = endWith(state, { morale: [6, 2] });
    expect(unitOf(out.state!, 'h1').status).toEqual([]);
    expect(unitOf(out.state!, 'g1').status).toEqual(['shaken']);
  });

  it('the baseline and melee list do not outlive the activation', () => {
    const out = endWith(setup(), { morale: [4] });
    expect(out.state!.turnState.woundBaseline).toBeUndefined();
    expect(out.state!.turnState.meleeUnitIds).toBeUndefined();
  });
});

describe('melee', () => {
  it('both units of a fight count as in melee, so the wound test is skipped for them', () => {
    const h1 = mkUnit('h1', HOST, 0, 0, { weapons: ['blade'] });
    h1.status = ['engaged'];
    const g1 = mkUnit('g1', GUEST, 0, 1, { count: 4 });
    g1.status = ['engaged'];
    const state = mkState([h1, g1]);
    state.turnState.activeUnitId = 'h1';
    h1.isActivated = true;
    recordWoundBaseline(state);
    const fight = createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId: unitOf(state, 'h1').weapons[0].id });
    const dice = (getDiceSpecs(state, fight) ?? []).map((sp) => roll(sp.purpose, Array(sp.count).fill(sp.purpose === 'to-hit' ? 6 : 1)));
    const out = applyAction(state, fight, dice);
    expect(out.ok).toBe(true);
    const after = out.state!;
    // Whatever the blade did, melee units are not wound-tested at the end of the activation
    expect(after.turnState.meleeUnitIds).toEqual(expect.arrayContaining(['h1', 'g1']));
    expect(getUnitsRequiringMorale(after)).toEqual([]);
  });
});

describe('Hero', () => {
  /** A Q5 squad at half after a wound, a Q2 Hero at the given centre distance (base edge = centre - 1). */
  const withHero = (centre: number, heroStatus: Unit['status'] = []) => {
    const hero = mkUnit('hero', GUEST, 2, 10 + centre, { quality: 2, rules: ['hero'] });
    hero.status = heroStatus;
    return endOfActivation([mkUnit('h1', HOST, 0, 0), mkUnit('g1', GUEST, 0, 10, { count: 4, quality: 5 }), hero], { g1: 2 });
  };

  it('a Hero exactly 6.0" away (edge to edge) lends its Quality: a 3 passes', () => {
    const out = endWith(withHero(7.0), { morale: [3] });
    // the hero stands 7" from the nearest model centre: 6" edge to edge
    expect(unitOf(out.state!, 'g1').status).toEqual([]);
  });

  it('a Hero at 6.1" gives nothing: the same 3 fails against Quality 5', () => {
    const out = endWith(withHero(7.1), { morale: [3] });
    expect(unitOf(out.state!, 'g1').status).toEqual(['shaken']);
  });

  it('a Shaken Hero gives nothing', () => {
    const out = endWith(withHero(3, ['shaken']), { morale: [3] });
    expect(unitOf(out.state!, 'g1').status).toEqual(['shaken']);
  });

  it('an enemy Hero gives nothing', () => {
    const state = withHero(3);
    unitOf(state, 'hero').ownerId = HOST;
    const out = endWith(state, { morale: [3] });
    expect(unitOf(out.state!, 'g1').status).toEqual(['shaken']);
  });
});

describe('Fearless', () => {
  const fearless = (extra: Partial<Unit> = {}) =>
    endOfActivation(
      [mkUnit('h1', HOST, 0, 0), Object.assign(mkUnit('g1', GUEST, 0, 10, { count: 4, rules: ['fearless'] }), extra)],
      { g1: 2 }
    );

  it('asks for a Fearless die alongside the test', () => {
    expect(getDiceSpecs(fearless(), endAction())).toEqual([
      { count: 1, sides: 6, purpose: 'morale' },
      { count: 1, sides: 6, purpose: 'fearless' },
    ]);
  });

  it('a failed test is saved on 4+ and stays failed on 3-', () => {
    expect(unitOf(endWith(fearless(), { morale: [2], fearless: [4] }).state!, 'g1').status).toEqual([]);
    expect(unitOf(endWith(fearless(), { morale: [2], fearless: [3] }).state!, 'g1').status).toEqual(['shaken']);
  });

  it('while Shaken the automatic failure also gets the 4+ chance, and needs no test die', () => {
    const shaken = fearless({ status: ['shaken'] });
    expect(getDiceSpecs(shaken, endAction())).toEqual([{ count: 1, sides: 6, purpose: 'fearless' }]);
    const saved = endWith(shaken, { fearless: [5] });
    expect(saved.logEntry.dice?.outcome.moraleTests?.[0]).toMatchObject({ passed: true, fearlessRoll: 5 });
    // a pass does not remove Shaken; only the unit's own idle activation does
    expect(unitOf(saved.state!, 'g1').status).toEqual(['shaken']);
    const failed = endWith(fearless({ status: ['shaken'] }), { fearless: [2] });
    expect(failed.logEntry.dice?.outcome.moraleTests?.[0].passed).toBe(false);
  });
});

describe('Shaken units', () => {
  const shakenState = () => {
    const state = mkState([mkUnit('h1', HOST, 0, 0, { count: 2 }), mkUnit('g1', GUEST, 0, 10)]);
    unitOf(state, 'h1').status = ['shaken'];
    return state;
  };

  it('can be activated but may only end the activation; that clears Shaken and passes play on', () => {
    const state = shakenState();
    const activated = applyAction(state, createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' }));
    expect(activated.ok).toBe(true);

    const shoot = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'rifle' });
    expect(validateAction(activated.state!, shoot).valid).toBe(false);
    const advance = createAction(HOST, 'advance', {
      type: 'advance', unitId: 'h1', path: [P(0, 0), P(0, 2)], finalPosition: P(0, 2),
    });
    expect(validateAction(activated.state!, advance).valid).toBe(false);
    const charge = createAction(HOST, 'charge', { type: 'charge', attackerId: 'h1', targetId: 'g1', path: [P(0, 9)] });
    expect(validateAction(activated.state!, charge).valid).toBe(false);

    const ended = applyAction(activated.state!, endAction());
    expect(ended.ok).toBe(true);
    expect(unitOf(ended.state!, 'h1').status).not.toContain('shaken');
    expect(ended.state!.turnState.activeUnitId).toBeNull();
    expect(ended.state!.turnState.currentPlayerId).toBe(GUEST);
  });

  it('a Shaken unit that is hit before its activation stays Shaken until it spends one', () => {
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0), mkUnit('g1', GUEST, 0, 10, { count: 4 })], { g1: 1 });
    unitOf(state, 'g1').status = ['shaken'];
    // not at half: no test, but still Shaken
    const out = endWith(state);
    expect(unitOf(out.state!, 'g1').status).toEqual(['shaken']);
  });

  it('cannot seize or contest an objective', () => {
    const unit = mkUnit('h1', HOST, 0, 0);
    const objective = { id: 'o1', position: P(1, 0), controllingPlayerId: null, isContested: false } as any;
    expect(isUnitInObjectiveRange(unit, objective)).toBe(true);
    unit.status = ['shaken'];
    expect(isUnitInObjectiveRange(unit, objective)).toBe(false);
  });
});

describe('applying the morale step directly', () => {
  it('runs out of dice without inventing results', () => {
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0), mkUnit('g1', GUEST, 0, 10, { count: 4 })], { g1: 2 });
    expect(applyEndOfActivationMorale(state, [])).toEqual([]);
    expect(unitOf(state, 'g1').status).toEqual([]);
  });
});
