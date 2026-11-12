import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs } from '../../src/engine/actions';
import { recordWoundBaseline } from '../../src/engine/activation';
import { computeCombatModifiers, getAttackDiceSpecs, resolveAttack } from '../../src/engine/combat';
import { describeTrait, formatTraitLabel } from '../../src/rules/traits';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });
const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

const FEROCIOUS_NOTE = 'Ferocious (6s add a hit)';

describe('Bad Shot and Ferocious in the combat maths', () => {
  const bad = ['bad-shot'];
  const fero = ['ferocious'];

  it('Bad Shot is -1 to hit when shooting: a 4 misses at Q4+ and the breakdown says so', () => {
    const mods = computeCombatModifiers({ quality: 4, specialRules: bad, distance: 5 }, { defense: 5 });
    expect(mods.effectiveQuality).toBe(5);
    expect(mods.hitModifiers).toContain('-1 Bad Shot');
    const out = resolveAttack({ quality: 4, specialRules: bad, distance: 5 }, { defense: 5 }, 3, {
      toHit: [4, 5, 1],
      defense: [1, 1, 1],
    });
    expect(out.hitRolls).toEqual([false, true, false]);
  });

  it('Bad Shot does nothing in melee', () => {
    const mods = computeCombatModifiers({ quality: 4, specialRules: bad, isMelee: true, isCharging: true }, { defense: 5 });
    expect(mods.effectiveQuality).toBe(4);
    expect(mods.hitModifiers).toEqual([]);
  });

  it('a natural 6 still hits with Bad Shot at Q6+', () => {
    const out = resolveAttack({ quality: 6, specialRules: bad, distance: 5 }, { defense: 5 }, 2, { toHit: [6, 5], defense: [1, 1] });
    expect(out.hitRolls).toEqual([true, false]);
  });

  describe('Ferocious when shooting', () => {
    const shoot = (distance: number, toHit: number[]) =>
      resolveAttack({ quality: 4, specialRules: fero, distance }, { defense: 5 }, toHit.length, {
        toHit,
        defense: new Array(toHit.length * 3).fill(1),
      });

    it('adds one hit per unmodified 6 at over 9"', () => {
      const out = shoot(9.1, [6, 6, 4, 2]);
      expect(out.bonusHits).toBe(2);
      expect(out.hitCount).toBe(5); // 3 hits + 2 extra
      expect(out.hitModifiers).toContain(FEROCIOUS_NOTE);
    });
    it('adds nothing at exactly 9" or closer', () => {
      expect(shoot(9, [6, 6]).bonusHits).toBe(0);
      expect(shoot(9, [6, 6]).hitCount).toBe(2);
      expect(shoot(3, [6]).hitCount).toBe(1);
      expect(shoot(9, [6]).hitModifiers).not.toContain(FEROCIOUS_NOTE);
    });
    it('a roll that only becomes a hit through a modifier is not an unmodified 6', () => {
      // Q4+ with +1 from Thrust on a charge: a 5 is a hit, but it is not a 6
      const out = resolveAttack(
        { quality: 4, specialRules: [...fero, 'thrust'], isMelee: true, isCharging: true, chargedFrom: 8 },
        { defense: 5 },
        2,
        { toHit: [5, 5], defense: [1, 1, 1, 1] }
      );
      expect(out.hitCount).toBe(2);
      expect(out.bonusHits).toBe(0);
    });
    it('with Bad Shot a 6 still hits and adds a hit; a 5 no longer hits at Q5', () => {
      const out = resolveAttack({ quality: 5, specialRules: [...bad, ...fero], distance: 12 }, { defense: 5 }, 3, {
        toHit: [6, 5, 4],
        defense: [1, 1, 1, 1, 1, 1],
      });
      expect(out.hitRolls).toEqual([true, false, false]);
      expect(out.hitCount).toBe(2);
    });
    it('the extra hit is not a 6 for other rules: Rending gives AP(4) to the original hit only', () => {
      // Defense 3+, defense roll 5: blocked normally, but the AP(4) hit is not
      const out = resolveAttack(
        { quality: 4, specialRules: fero, weaponRules: ['rending'], distance: 12 },
        { defense: 3 },
        1,
        { toHit: [6], defense: [5, 5] }
      );
      expect(out.hitCount).toBe(2);
      expect(out.blockedRolls).toEqual([false, true]);
    });
  });

  describe('Ferocious on a charge', () => {
    const strike = (chargedFrom: number | undefined, isCharging = true) =>
      resolveAttack(
        { quality: 4, specialRules: fero, isMelee: true, isCharging, distance: 1, ...(chargedFrom !== undefined ? { chargedFrom } : {}) },
        { defense: 5 },
        2,
        { toHit: [6, 3], defense: [1, 1, 1, 1] }
      );
    it('adds a hit per 6 when the charge started over 6" away', () => {
      const out = strike(6.1);
      expect(out.bonusHits).toBe(1);
      expect(out.hitCount).toBe(2);
      expect(out.hitModifiers).toContain(FEROCIOUS_NOTE);
    });
    it('adds nothing for a charge started at exactly 6"', () => {
      expect(strike(6).bonusHits).toBe(0);
    });
    it('adds nothing when the start distance is unknown or the attacker did not charge', () => {
      expect(strike(undefined).bonusHits).toBe(0);
      expect(strike(20, false).bonusHits).toBe(0);
    });
  });

  it('defense dice are sized for the extra hits', () => {
    const defenseDice = (rules: string[]) =>
      getAttackDiceSpecs(4, { attackerRules: rules, defenderRules: [], defenderModelCount: 1, distance: 12 }).find(
        (d) => d.purpose === 'defense'
      )!.count;
    expect(defenseDice([])).toBe(4);
    expect(defenseDice(fero)).toBe(8);
  });
});

describe('trait registry', () => {
  it('names and describes the two Orc rules in our own words', () => {
    expect(formatTraitLabel('bad-shot')).toBe('Bad Shot');
    expect(formatTraitLabel('ferocious')).toBe('Ferocious');
    expect(describeTrait('bad-shot')).toMatch(/-1/);
    expect(describeTrait('ferocious')).toMatch(/9"/);
    expect(describeTrait('ferocious')).toMatch(/6"/);
  });
});

/** One-model unit; a centre gap of d + 1 is a base-edge distance of d. */
function mk(id: string, owner: string, z: number, rules: string[], weapons: string[], tough = 3): Unit {
  return {
    id, ownerId: owner, armyId: 'a', unitType: 'trooper', name: id,
    quality: 4, defense: 5, speed: 6, position: P(0, z), rotation: { x: 0, y: 0, z: 0 },
    status: [], wounds: tough, maxWounds: tough, isActivated: false, isDestroyed: false,
    models: [{ id: `${id}-m0`, wounds: tough, maxWounds: tough, isDestroyed: false, position: P(0, z), rotation: { x: 0, y: 0, z: 0 } }],
    weapons: weapons.map((w) => ({ ...WEAPONS[w], profile: { ...WEAPONS[w].profile } })),
    specialRules: [...rules, `tough(${tough})`],
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

describe('Orc rules through real actions', () => {
  function shotAt(gap: number, rules: string[], toHit: number[]) {
    const state = mkState([mk('h1', HOST, 0, rules, ['rifle-twin']), mk('g1', GUEST, gap + 1, [], ['rifle'], 30)]);
    state.units[0].weapons[0].profile.attacks = toHit.length;
    const shoot = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'rifle-twin' });
    const specs = getDiceSpecs(state, shoot)!;
    const defCount = specs.find((s) => s.purpose === 'defense')!.count;
    const res = applyAction(state, shoot, [roll('to-hit', toHit), roll('defense', new Array(defCount).fill(6))]);
    if (!res.ok) throw new Error(res.reason);
    return res.state!.actionLog[res.state!.actionLog.length - 1].dice!.outcome;
  }

  it('a shot at 9.1" with Ferocious: both 6s add a hit and the log carries the count', () => {
    const o = shotAt(9.1, ['ferocious'], [6, 6]);
    expect(o.hitCount).toBe(4);
    expect(o.bonusHits).toBe(2);
    expect(o.hitModifiers).toContain(FEROCIOUS_NOTE);
  });
  it('a shot at exactly 9.0" gets no extra hits', () => {
    const o = shotAt(9, ['ferocious'], [6, 6]);
    expect(o.hitCount).toBe(2);
    expect(o.bonusHits ?? 0).toBe(0);
  });
  it('Bad Shot appears in the log and turns a 4 into a miss at Q4+', () => {
    const o = shotAt(5, ['bad-shot'], [4, 5]);
    expect(o.hitCount).toBe(1);
    expect(o.hitModifiers).toContain('-1 Bad Shot');
  });

  function charged(gap: number, split: boolean) {
    const h1 = mk('h1', HOST, 0, ['ferocious'], ['blade']);
    h1.speed = 12;
    h1.remainingMovement = 12;
    let state = mkState([h1, mk('g1', GUEST, gap + 1, [], ['rifle'], 30)]);
    if (split) {
      const begin = applyAction(state, createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' }));
      if (!begin.ok) throw new Error(begin.reason);
      state = begin.state!;
    }
    const path = [P(0, 0), P(0, gap - 0.05)];
    const charge = createAction(HOST, 'charge', { type: 'charge', attackerId: 'h1', targetId: 'g1', path, weaponId: 'blade' });
    const specs = getDiceSpecs(state, charge)!;
    const defCount = specs.find((s) => s.purpose === 'defense')!.count;
    const res = applyAction(state, charge, [roll('to-hit', [6, 3]), roll('defense', new Array(defCount).fill(6))]);
    if (!res.ok) throw new Error(res.reason);
    return res.state!.actionLog[res.state!.actionLog.length - 1].dice!.outcome;
  }

  for (const split of [false, true]) {
    const label = split ? 'declared' : 'one-click';
    it(`${label} charge started from 6.1": the 6 adds a hit`, () => {
      const o = charged(6.1, split);
      expect(o.hitCount).toBe(2);
      expect(o.bonusHits).toBe(1);
    });
    it(`${label} charge started from exactly 6": no extra hit`, () => {
      const o = charged(6, split);
      expect(o.hitCount).toBe(1);
      expect(o.bonusHits ?? 0).toBe(0);
    });
  }
});
