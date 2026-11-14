import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { TRAIT_REGISTRY, gateDistance, DistanceGate } from '../../src/rules/traits';
import { attackDistanceRules, gateApplies, ownThresholdRings } from '../../src/engine/distanceGates';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });

function weapon(id: string, base: keyof typeof WEAPONS, rules: string[] = []): Weapon {
  const w = WEAPONS[base];
  return { ...w, id, profile: { ...w.profile, specialRules: [...w.profile.specialRules, ...rules] } };
}

/** Squad of models at the given z positions (x = 0). Bases are 1" wide. */
function mk(
  id: string,
  owner: string,
  zs: number[],
  rules: string[] = [],
  weapons: Weapon[] = [weapon('rifle', 'rifle'), weapon('blade', 'blade')]
): Unit {
  return {
    id, ownerId: owner, armyId: 'a', unitType: 'trooper', name: id,
    quality: 4, defense: 5, speed: 6, position: P(0, zs[0]), rotation: { x: 0, y: 0, z: 0 },
    status: [], wounds: zs.length, maxWounds: zs.length, isActivated: false, isDestroyed: false,
    models: zs.map((z, i) => ({ id: `${id}-m${i}`, wounds: 1, maxWounds: 1, isDestroyed: false, position: P(0, z), rotation: { x: 0, y: 0, z: 0 } })),
    weapons, specialRules: rules, hasMoved: false, remainingMovement: 6,
  };
}

function mkState(units: Unit[]): GameState {
  const s = createInitialGameState(HOST, GUEST);
  s.units = units;
  s.terrain = [];
  s.status = 'in-progress';
  return s;
}

describe('registry distance gates', () => {
  const gatesOf = (id: string) => (TRAIT_REGISTRY as Record<string, { distanceGates?: DistanceGate[] }>)[id].distanceGates;
  it('declares exactly the agreed gates', () => {
    expect(gatesOf('relentless')).toEqual([
      { context: 'shooting', holder: 'attacker', comparison: 'beyond', distance: 9, effect: '6s add a hit' },
    ]);
    expect(gatesOf('ferocious')).toEqual([
      { context: 'shooting', holder: 'attacker', comparison: 'beyond', distance: 9, effect: '6s add a hit' },
      { context: 'charge', holder: 'attacker', comparison: 'beyond', distance: 6, effect: '6s add a hit' },
    ]);
    expect(gatesOf('stealth')).toEqual([
      { context: 'shooting', holder: 'target', comparison: 'beyond', distance: 9, effect: '-1 to hit' },
    ]);
    expect(gatesOf('hold-the-line')).toEqual([
      { context: 'shooting', holder: 'target', comparison: 'beyond', distance: 9, effect: '+1 morale' },
      { context: 'charge', holder: 'target', comparison: 'beyond', distance: 6, effect: '+1 morale' },
    ]);
    expect(gatesOf('hero')).toEqual([
      { context: 'morale-aura', holder: 'friendly', comparison: 'within', distance: 6, effect: 'lends Quality for Morale' },
    ]);
    expect(gatesOf('blast')).toEqual([
      { context: 'blast-spread', holder: 'target', comparison: 'within', distance: 3, effect: 'hits spread' },
    ]);
  });
  it('declares none for any other rule', () => {
    const listed = ['relentless', 'ferocious', 'stealth', 'hold-the-line', 'hero', 'blast'];
    for (const id of Object.keys(TRAIT_REGISTRY).filter((k) => !listed.includes(k))) {
      expect(gatesOf(id), id).toBeUndefined();
    }
  });
  it('gateDistance reads the registry', () => {
    expect(gateDistance('ferocious', 'charge')).toBe(6);
    expect(gateDistance('hero', 'morale-aura')).toBe(6);
    expect(gateDistance('blast', 'blast-spread')).toBe(3);
    expect(() => gateDistance('fearless', 'shooting')).toThrow();
  });
});

describe('gateApplies', () => {
  const beyond9: DistanceGate = { context: 'shooting', holder: 'attacker', comparison: 'beyond', distance: 9, effect: '' };
  const within6: DistanceGate = { context: 'morale-aura', holder: 'friendly', comparison: 'within', distance: 6, effect: '' };
  it('beyond is strict', () => {
    expect(gateApplies(beyond9, 9)).toBe(false);
    expect(gateApplies(beyond9, 9.01)).toBe(true);
    expect(gateApplies(beyond9, 8.99)).toBe(false);
  });
  it('within is inclusive with the existing tolerance', () => {
    expect(gateApplies(within6, 6)).toBe(true);
    expect(gateApplies(within6, 6.0005)).toBe(true);
    expect(gateApplies(within6, 6.01)).toBe(false);
  });
  it('blast spread keeps its wider tolerance', () => {
    const spread: DistanceGate = { context: 'blast-spread', holder: 'target', comparison: 'within', distance: 3, effect: '' };
    expect(gateApplies(spread, 3.005)).toBe(true);
    expect(gateApplies(spread, 3.02)).toBe(false);
  });
});

describe('attackDistanceRules', () => {
  it('reports the distance and unit-level attacker rules before target rules', () => {
    const a = mk('a', HOST, [0], ['ferocious']);
    const t = mk('t', GUEST, [13], ['stealth', 'hold-the-line']);
    const r = attackDistanceRules({ state: mkState([a, t]), attacker: a, target: t, context: 'shooting' });
    expect(r.distance).toBeCloseTo(12);
    expect(r.entries.map((e) => [e.traitId, e.holder, e.applies])).toEqual([
      ['ferocious', 'attacker', true],
      ['stealth', 'target', true],
      ['hold-the-line', 'target', true],
    ]);
    expect(r.entries[0].displayName).toBe('Ferocious');
    expect(r.entries[0].gate.distance).toBe(9);
  });

  it('does not apply at exactly 9" or inside it', () => {
    const a = mk('a', HOST, [0], ['ferocious']);
    const exact = mk('t', GUEST, [10], ['stealth']);
    expect(attackDistanceRules({ state: mkState([a, exact]), attacker: a, target: exact, context: 'shooting' }).entries.map((e) => e.applies)).toEqual([false, false]);
    const far = mk('t', GUEST, [10.05], ['stealth']);
    expect(attackDistanceRules({ state: mkState([a, far]), attacker: a, target: far, context: 'shooting' }).entries.map((e) => e.applies)).toEqual([true, true]);
  });

  it('counts a weapon rule only when that weapon is in the attack', () => {
    const relentless = weapon('rel', 'rifle', ['relentless']);
    const a = mk('a', HOST, [0], [], [relentless, weapon('plain', 'carbine')]);
    const t = mk('t', GUEST, [13]);
    const s = mkState([a, t]);
    const ids = (weaponIds?: string[]) =>
      attackDistanceRules({ state: s, attacker: a, target: t, context: 'shooting', weaponIds }).entries.map((e) => e.traitId);
    expect(ids(['plain'])).toEqual([]);
    expect(ids(['rel'])).toEqual(['relentless']);
    expect(ids(['rel', 'plain'])).toEqual(['relentless']);
    expect(ids()).toEqual([]);
  });

  it('lists a rule once when the unit and a weapon both carry it', () => {
    const a = mk('a', HOST, [0], ['relentless'], [weapon('rel', 'rifle', ['relentless'])]);
    const t = mk('t', GUEST, [13]);
    const r = attackDistanceRules({ state: mkState([a, t]), attacker: a, target: t, context: 'shooting', weaponIds: ['rel'] });
    expect(r.entries.filter((e) => e.traitId === 'relentless')).toHaveLength(1);
  });

  it('Unstoppable marks Stealth as negated but still reports it', () => {
    const a = mk('a', HOST, [0], ['unstoppable']);
    const t = mk('t', GUEST, [13], ['stealth']);
    const r = attackDistanceRules({ state: mkState([a, t]), attacker: a, target: t, context: 'shooting' });
    const stealth = r.entries.find((e) => e.traitId === 'stealth')!;
    expect(stealth.applies).toBe(true);
    expect(stealth.negatedBy).toBe('unstoppable');
    const hold = mk('h', GUEST, [13], ['hold-the-line']);
    expect(attackDistanceRules({ state: mkState([a, hold]), attacker: a, target: hold, context: 'shooting' }).entries[0].negatedBy).toBeUndefined();
  });

  it('charge uses the recorded start distance when present, else the current one', () => {
    const a = mk('a', HOST, [0], ['ferocious']);
    const t = mk('t', GUEST, [9], ['hold-the-line']); // 8" apart now
    const s = mkState([a, t]);
    const before = attackDistanceRules({ state: s, attacker: a, target: t, context: 'charge' });
    expect(before.distance).toBeCloseTo(8);
    expect(before.entries.map((e) => e.applies)).toEqual([true, true]);
    s.turnState.attackedFrom = { t: { charged: 5 } };
    const after = attackDistanceRules({ state: s, attacker: a, target: t, context: 'charge' });
    expect(after.distance).toBe(5);
    expect(after.entries.map((e) => e.applies)).toEqual([false, false]);
    expect(after.entries[0].gate.distance).toBe(6);
  });

  it('charge counts the unit melee weapons and ignores shooting gates', () => {
    const a = mk('a', HOST, [0], ['relentless'], [weapon('rifle', 'rifle'), weapon('blade', 'blade', ['ferocious'])]);
    const t = mk('t', GUEST, [10], ['stealth']);
    const r = attackDistanceRules({ state: mkState([a, t]), attacker: a, target: t, context: 'charge' });
    expect(r.entries.map((e) => e.traitId)).toEqual(['ferocious']);
  });

  it('squads measure the closest living models', () => {
    const a = mk('a', HOST, [0, -3], ['ferocious']);
    const t = mk('t', GUEST, [20, 10.5]);
    const s = mkState([a, t]);
    expect(attackDistanceRules({ state: s, attacker: a, target: t, context: 'shooting' }).distance).toBeCloseTo(9.5);
    t.models![1].isDestroyed = true;
    expect(attackDistanceRules({ state: s, attacker: a, target: t, context: 'shooting' }).distance).toBeCloseTo(19);
  });
});

describe('ownThresholdRings', () => {
  it('lists distinct distances with rule names from unit and ranged weapon rules', () => {
    const u = mk('u', HOST, [0], ['ferocious'], [weapon('rel', 'rifle', ['relentless']), weapon('blade', 'blade')]);
    expect(ownThresholdRings(u, 'shooting')).toEqual([
      { distance: 9, traitIds: ['ferocious', 'relentless'], names: ['Ferocious', 'Relentless'], label: '9": Ferocious, Relentless' },
    ]);
  });
  it('charge uses 6" and melee weapons only', () => {
    const u = mk('u', HOST, [0], ['ferocious'], [weapon('rel', 'rifle', ['relentless']), weapon('blade', 'blade')]);
    expect(ownThresholdRings(u, 'charge').map((r) => [r.distance, r.names])).toEqual([[6, ['Ferocious']]]);
    const v = mk('v', HOST, [0], [], [weapon('rifle', 'rifle', ['relentless']), weapon('blade', 'blade')]);
    expect(ownThresholdRings(v, 'charge')).toEqual([]);
  });
  it('is empty for a unit with no gates, and ignores target-held gates', () => {
    expect(ownThresholdRings(mk('u', HOST, [0]), 'shooting')).toEqual([]);
    expect(ownThresholdRings(mk('u', HOST, [0], ['stealth', 'hold-the-line', 'hero']), 'shooting')).toEqual([]);
  });
});

describe('G-18: distanceGates filters by isEquipped, isCarried, and isMeleeWeapon', () => {
  it('ignores unequipped and dead-carrier weapons in attackDistanceRules and ownThresholdRings', () => {
    const deadCarrierRifle = weapon('dead-rifle', 'rifle', ['relentless']);
    const unequippedRifle = { ...weapon('spent-rifle', 'rifle', ['ferocious']), isEquipped: false };
    const a = mk('a', HOST, [0, -1], [], [deadCarrierRifle, unequippedRifle]);
    a.models![0].weaponIds = ['spent-rifle'];
    a.models![1].weaponIds = ['dead-rifle'];
    a.models![1].isDestroyed = true;
    const t = mk('t', GUEST, [15]);
    const s = mkState([a, t]);

    expect(attackDistanceRules({ state: s, attacker: a, target: t, context: 'shooting' }).entries).toEqual([]);
    expect(ownThresholdRings(a, 'shooting')).toEqual([]);
  });

  it('includes equipped carried Assault ranged weapons in charge context', () => {
    const carbine = weapon('carbine', 'rifle', ['assault', 'ferocious']);
    const blade = weapon('blade', 'blade');
    const a = mk('a', HOST, [0], [], [carbine, blade]);
    a.models![0].weaponIds = ['carbine', 'blade'];
    const t = mk('t', GUEST, [10]);
    const s = mkState([a, t]);

    expect(ownThresholdRings(a, 'charge').map((r) => r.traitIds)).toEqual([['ferocious']]);
    const rules = attackDistanceRules({ state: s, attacker: a, target: t, context: 'charge' });
    expect(rules.entries.map((e) => e.traitId)).toEqual(['ferocious']);
  });
});
