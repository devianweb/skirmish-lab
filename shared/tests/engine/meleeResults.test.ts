import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { DiceSpec } from '../../src/types';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import {
  getMeleeResults,
  getUnitsRequiringMorale,
  markInMelee,
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
function endOfActivation(units: Unit[], woundBy: Record<string, number>, pairs: [string, string][] = [['h1', 'g1']]): GameState {
  const state = mkState(units);
  state.turnState.activeUnitId = 'h1';
  unitOf(state, 'h1').isActivated = true;
  recordWoundBaseline(state);
  for (const [a, b] of pairs) markInMelee(state, a, b);
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

const squad = (id = 'g1', count = 4) => mkUnit(id, GUEST, 0, 1, { count });

describe('melee results: who loses', () => {
  it('the side that took more wounds loses and tests; the winner does not', () => {
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0, { count: 3 }), squad()], { h1: 1, g1: 2 });
    const [result] = getMeleeResults(state);
    expect(result.sides.map((s) => s.wounds)).toEqual([1, 2]);
    expect(result.loserId).toBe('g1');
    expect(getUnitsRequiringMorale(state).map((u) => u.id)).toEqual(['g1']);
  });

  it('a tie means nobody tests, and the result is still reported', () => {
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0, { count: 3 }), squad()], { h1: 1, g1: 1 });
    expect(getMeleeResults(state)[0].loserId).toBeUndefined();
    expect(getUnitsRequiringMorale(state)).toEqual([]);
    const out = endWith(state);
    expect(out.logEntry?.dice?.outcome.meleeResults).toHaveLength(1);
    expect(out.logEntry?.dice?.outcome.moraleTests).toBeUndefined();
  });

  it('wounds taken before the activation do not count', () => {
    const h1 = mkUnit('h1', HOST, 0, 0, { count: 3 });
    wound(h1, 2); // wounded earlier
    const state = endOfActivation([h1, squad()], { g1: 1 });
    const [result] = getMeleeResults(state);
    expect(result.sides[0].wounds).toBe(0);
    expect(result.loserId).toBe('g1');
  });

  it('Fear(X) adds X wounds to the enemy and can turn a tie into a loss', () => {
    const state = endOfActivation(
      [mkUnit('h1', HOST, 0, 0, { count: 3, rules: ['fear(2)'] }), squad()],
      { h1: 1, g1: 1 }
    );
    const [result] = getMeleeResults(state);
    expect(result.sides[1].fearBonus).toBe(4); // Fear(2) on each of its 2 living models (the wound killed one)
    expect(result.sides[0].fearBonus).toBeUndefined();
    expect(result.loserId).toBe('g1');
  });

  it('Fear(X) counts per living model: dead models add nothing', () => {
    const state = endOfActivation(
      [mkUnit('h1', HOST, 0, 0, { count: 3, rules: ['fear(1)'] }), squad()],
      { h1: 1, g1: 1 }
    );
    expect(unitOf(state, 'h1').models.filter((m) => !m.isDestroyed)).toHaveLength(2);
    const [result] = getMeleeResults(state);
    expect(result.sides[1].fearBonus).toBe(2); // two living models x Fear(1)
  });

  it('Fear adds to the real wounds of the enemy side: 3 wounds plus Fear(1) per model against 1', () => {
    const state = endOfActivation(
      [mkUnit('h1', HOST, 0, 0, { count: 5 }), mkUnit('g1', GUEST, 0, 1, { count: 5, rules: ['fear(1)'] })],
      { h1: 3, g1: 1 }
    );
    const [result] = getMeleeResults(state);
    expect(result.sides.map((s) => s.fearBonus)).toEqual([4, undefined]); // g1 lost a model: 4 left
    expect(result.loserId).toBe('h1'); // 3 + Fear(1) x 4 living models against 1
  });

  it('Fear counts once per unit, however many melees it fought', () => {
    const state = endOfActivation(
      [
        mkUnit('h1', HOST, 0, 0, { count: 4, rules: ['fear(2)'] }),
        squad('g1'),
        squad('g2'),
      ],
      { g1: 1, g2: 1 },
      [['h1', 'g1'], ['h1', 'g2']]
    );
    const results = getMeleeResults(state);
    expect(results[0].sides[1].fearBonus).toBe(8); // Fear(2) x 4 models
    expect(results[1].sides[1].fearBonus).toBeUndefined();
  });

  it('a unit wiped out no longer causes Fear, and a destroyed loser owes no test', () => {
    const feared = mkUnit('g1', GUEST, 0, 1, { count: 1, rules: ['fear(3)'] });
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0, { count: 3 }), feared], { g1: 1 });
    expect(unitOf(state, 'g1').models.every((m) => m.isDestroyed)).toBe(true);
    unitOf(state, 'g1').isDestroyed = true;
    const [result] = getMeleeResults(state);
    expect(result.sides[0].fearBonus).toBeUndefined();
    expect(getUnitsRequiringMorale(state)).toEqual([]);
  });
});

describe('melee results: the loser tests Morale', () => {
  // h1 (3 models) took nothing; g1 is the loser
  const losing = (g1Wounds: number, g1Count = 4) =>
    endOfActivation([mkUnit('h1', HOST, 0, 0, { count: 3 }), squad('g1', g1Count)], { g1: g1Wounds });

  it('a pass leaves the loser as it was', () => {
    const out = endWith(losing(1), { morale: [5] });
    expect(unitOf(out.state!, 'g1').status).not.toContain('shaken');
    expect(out.logEntry?.dice?.outcome.moraleTests?.[0].outcome).toBe('passed');
  });

  it('a failed test above half strength only Shakes the loser', () => {
    const out = endWith(losing(1), { morale: [1] }); // 3 of 4 models left
    const g1 = unitOf(out.state!, 'g1');
    expect(g1.isDestroyed).toBe(false);
    expect(g1.status).toContain('shaken');
    expect(out.logEntry?.dice?.outcome.moraleTests?.[0].outcome).toBe('shaken');
  });

  it('a failed test at exactly half strength Routs the loser: all models removed', () => {
    const out = endWith(losing(2), { morale: [1] }); // 2 of 4 left
    const g1 = unitOf(out.state!, 'g1');
    expect(g1.isDestroyed).toBe(true);
    expect(g1.status).toContain('routed');
    expect(g1.models.every((m) => m.isDestroyed)).toBe(true);
    expect(out.logEntry?.dice?.outcome.moraleTests?.[0].outcome).toBe('routed');
  });

  it('a passed test at half strength keeps the loser on the board', () => {
    const out = endWith(losing(2), { morale: [6] });
    const g1 = unitOf(out.state!, 'g1');
    expect(g1.isDestroyed).toBe(false);
    expect(g1.status).not.toContain('routed');
  });

  it('a Fearless save (4+) after a failure stops the Rout', () => {
    const state = endOfActivation(
      [mkUnit('h1', HOST, 0, 0, { count: 3 }), mkUnit('g1', GUEST, 0, 1, { count: 4, rules: ['fearless'] })],
      { g1: 2 }
    );
    const out = endWith(state, { morale: [1], fearless: [4] });
    expect(unitOf(out.state!, 'g1').isDestroyed).toBe(false);
  });

  it('a loser that was already Shaken fails without a die, and Routs at half strength', () => {
    const state = losing(2);
    unitOf(state, 'g1').status = ['shaken'];
    const specs = getDiceSpecs(state, endAction());
    expect(specs).toBeNull();
    const out = endWith(state);
    expect(unitOf(out.state!, 'g1').status).toContain('routed');
  });

  it('a single Tough 3 model that loses at 1 wound left Routs on a failure; with 2 left it is Shaken', () => {
    const lone = (hits: number) =>
      endOfActivation([mkUnit('h1', HOST, 0, 0, { count: 3 }), mkUnit('g1', GUEST, 0, 1, { tough: 3, rules: ['tough(3)'] })], { g1: hits });
    expect(unitOf(endWith(lone(2), { morale: [1] }).state!, 'g1').status).toContain('routed');
    const shaken = unitOf(endWith(lone(1), { morale: [1] }).state!, 'g1');
    expect(shaken.status).toEqual(['shaken']);
  });

  it('the attacker can lose too (strike back wounds beat the charge strike)', () => {
    const state = endOfActivation([mkUnit('h1', HOST, 0, 0, { count: 4 }), squad('g1', 5)], { h1: 2, g1: 1 });
    const out = endWith(state, { morale: [1] });
    expect(unitOf(out.state!, 'h1').status).toContain('routed');
    expect(unitOf(out.state!, 'g1').status).toEqual([]);
  });

  it('the melee lists do not outlive the activation', () => {
    const out = endWith(losing(1), { morale: [5] });
    expect(out.state!.turnState.meleePairs).toBeUndefined();
  });
});

describe('melee results from a real fight', () => {
  it('a fight that wounds only the defender makes the defender the loser at the end of the activation', () => {
    const h1 = mkUnit('h1', HOST, 0, 0, { weapons: ['blade'] });
    h1.status = ['engaged'];
    const g1 = mkUnit('g1', GUEST, 0, 1, { tough: 6, rules: ['tough(6)'] }); // one model: no casualty pick
    g1.status = ['engaged'];
    const state = mkState([h1, g1]);
    state.turnState.activeUnitId = 'h1';
    h1.isActivated = true;
    recordWoundBaseline(state);
    const fight = createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId: h1.weapons[0].id });
    const dice = (getDiceSpecs(state, fight) ?? []).map((sp) => roll(sp.purpose, Array(sp.count).fill(sp.purpose === 'to-hit' ? 6 : 1)));
    const out = applyAction(state, fight, dice);
    if (!out.ok) throw new Error(out.reason);
    const after = out.state!;
    expect(after.units.find((u) => u.id === 'g1')!.wounds).toBeLessThan(6);
    const [result] = getMeleeResults(after);
    expect(result.loserId).toBe('g1');
    expect(result.sides[0].wounds).toBe(0);
    expect(result.sides[1].wounds).toBeGreaterThan(0);
  });
});

describe('Fear counts only models in the fight (14C-2 PR 7B, Decision 46)', () => {
  /** A 4-model Fear(x) unit whose models stand at the given spots, against a lone model at the origin. */
  const feared = (spots: Vector3[], x = 1) => {
    const g1 = mkUnit('g1', GUEST, 0, 1, { count: 4, rules: [`fear(${x})`] });
    g1.models.forEach((m, i) => (m.position = spots[i]));
    return endOfActivation([mkUnit('h1', HOST, 0, 0, { count: 1 }), g1], {});
  };
  const far = P(30, 30);

  it('only the models within 3" of the enemy add Fear, 3.0" yes and 3.1" no', () => {
    // Centre-to-centre 4.0" is 3.0" between 1"-wide bases; 4.1" is just out of reach
    const state = feared([P(0, 4.0), P(0, -4.0), P(0, 4.1), P(0, -4.1)]);
    expect(getMeleeResults(state)[0].sides[0].fearBonus).toBe(2);
  });

  it('multiplies by X: Fear(2) with 3 models in reach adds 6', () => {
    const state = feared([P(1, 1), P(2, 1), P(0, 2), far], 2);
    expect(getMeleeResults(state)[0].sides[0].fearBonus).toBe(6);
  });

  it('a Fear unit that fought counts at least one model even when none is in reach', () => {
    const state = feared([far, P(31, 30), P(32, 30), P(33, 30)]);
    expect(getMeleeResults(state)[0].sides[0].fearBonus).toBe(1);
  });
});
