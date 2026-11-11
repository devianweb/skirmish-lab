import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, DiceSpec, GameState, TerrainPiece, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { TRAIT_REGISTRY } from '../../src/rules/traits';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { getEffectiveMaxMovement } from '../../src/engine/traversal';
import { getEffectiveSpeed, findMeleeWeapon, impactDiceCount } from '../../src/engine/specialRules';
import { resolveAttack, resolveImpact } from '../../src/engine/combat';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

const weapon = (id: string, extraRules: string[] = []): Weapon => ({
  ...WEAPONS[id],
  profile: { ...WEAPONS[id].profile, specialRules: [...WEAPONS[id].profile.specialRules, ...extraRules] },
});

interface UnitOpts {
  rules?: string[];
  weapons?: Weapon[];
  models?: number;
  tough?: number;
  status?: Unit['status'];
  speed?: number;
  at?: Vector3;
}

function mkUnit(id: string, ownerId: string, opts: UnitOpts = {}): Unit {
  const at = opts.at ?? P(0, 0);
  const count = opts.models ?? 1;
  const tough = opts.tough ?? 1;
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: opts.speed ?? 6,
    position: { ...at },
    rotation: { x: 0, y: 0, z: 0 },
    status: opts.status ?? [],
    wounds: count * tough,
    maxWounds: count * tough,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      wounds: tough,
      maxWounds: tough,
      isDestroyed: false,
      position: { x: at.x + i * 1.2, y: at.y, z: at.z },
      rotation: { x: 0, y: 0, z: 0 },
    })),
    weapons: opts.weapons ?? [weapon('rifle'), weapon('blade')],
    specialRules: opts.rules ?? [],
    hasMoved: false,
    remainingMovement: opts.speed ?? 6,
  };
}

function mkState(units: Unit[], terrain: TerrainPiece[] = [], activeId: string | null = 'h1'): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = activeId;
  return state;
}

/** Server-style dice for a spec list: every die of a purpose shows `values[purpose]` (default 1). */
function diceFor(specs: DiceSpec[], values: Record<string, number | number[]> = {}): DiceResult[] {
  return specs.map((spec) => {
    const v = values[spec.purpose] ?? 1;
    const rolls = Array.isArray(v)
      ? Array.from({ length: spec.count }, (_, i) => v[i] ?? 1)
      : Array(spec.count).fill(v);
    const total = rolls.reduce((a: number, b: number) => a + b, 0);
    return { rolls, total, finalTotal: total, purpose: spec.purpose };
  });
}

const advance = (unitId: string, dist: number) =>
  createAction(HOST, 'advance', {
    type: 'advance',
    unitId,
    path: [P(0, 0), P(0, dist)],
    finalPosition: P(0, dist),
  });
const rush = (unitId: string, dist: number) =>
  createAction(HOST, 'rush', { type: 'rush', unitId, path: [P(0, 0), P(0, dist)], finalPosition: P(0, dist) });

describe('Fast and Slow', () => {
  it('Fast adds 2" to the Advance and 4" to the Rush and Charge', () => {
    const fast = mkUnit('f', HOST, { rules: ['fast'] });
    expect(getEffectiveSpeed(fast)).toBe(8);
    expect(getEffectiveMaxMovement(fast, 'move', false)).toBe(8);
    expect(getEffectiveMaxMovement(fast, 'rush', false)).toBe(16);
    expect(getEffectiveMaxMovement(fast, 'charge', false)).toBe(16);
  });

  it('Slow takes 2" off the Advance and 4" off the Rush and Charge', () => {
    const slow = mkUnit('s', HOST, { rules: ['slow'] });
    expect(getEffectiveSpeed(slow)).toBe(4);
    expect(getEffectiveMaxMovement(slow, 'move', false)).toBe(4);
    expect(getEffectiveMaxMovement(slow, 'rush', false)).toBe(8);
  });

  it('Fast and Slow together cancel out', () => {
    expect(getEffectiveSpeed(mkUnit('x', HOST, { rules: ['fast', 'slow'] }))).toBe(6);
  });

  it('the host accepts a Fast advance of 8" but not 8.5", and a Slow advance of 4" but not 5"', () => {
    const fast = mkState([mkUnit('h1', HOST, { rules: ['fast'] }), mkUnit('g1', GUEST, { at: P(0, 40) })]);
    fast.units[0].remainingMovement = 8;
    expect(validateAction(fast, advance('h1', 8)).valid).toBe(true);
    expect(validateAction(fast, advance('h1', 8.5)).valid).toBe(false);
    const slow = mkState([mkUnit('h1', HOST, { rules: ['slow'] }), mkUnit('g1', GUEST, { at: P(0, 40) })]);
    slow.units[0].remainingMovement = 4;
    expect(validateAction(slow, advance('h1', 4)).valid).toBe(true);
    expect(validateAction(slow, advance('h1', 5)).valid).toBe(false);
  });

  it('rush allowances follow the same shift (16" Fast, 8" Slow)', () => {
    const fast = mkState([mkUnit('h1', HOST, { rules: ['fast'] }), mkUnit('g1', GUEST, { at: P(0, 40) })]);
    expect(validateAction(fast, rush('h1', 16)).valid).toBe(true);
    expect(validateAction(fast, rush('h1', 17)).valid).toBe(false);
    const slow = mkState([mkUnit('h1', HOST, { rules: ['slow'] }), mkUnit('g1', GUEST, { at: P(0, 40) })]);
    expect(validateAction(slow, rush('h1', 8)).valid).toBe(true);
    expect(validateAction(slow, rush('h1', 9)).valid).toBe(false);
  });
});

describe('Shred', () => {
  const attackerStats = (weaponRules: string[]) => ({ quality: 4, weaponRules, isMelee: true });
  const defender = { defense: 5, modelCount: 5 };

  it('adds one wound for each unmodified Defense roll of 1 that fails', () => {
    const out = resolveAttack(attackerStats(['shred']), defender, 4, { toHit: [6, 6, 6, 6], defense: [1, 1, 2, 6] });
    // 4 hits: two 1s fail (+1 extra each), the 2 fails against Defense 5+, the 6 blocks
    expect(out.wounds).toBe(5);
    expect(out.shredWounds).toBe(2);
  });

  it('adds nothing without the rule, and nothing on a 2-5 even if it fails', () => {
    const plain = resolveAttack(attackerStats([]), defender, 3, { toHit: [6, 6, 6], defense: [1, 2, 3] });
    expect(plain.wounds).toBe(3);
    expect(plain.shredWounds).toBeUndefined();
    const shred = resolveAttack(attackerStats(['shred']), defender, 3, { toHit: [6, 6, 6], defense: [2, 3, 4] });
    expect(shred.wounds).toBe(3);
    expect(shred.shredWounds).toBeUndefined();
  });

  it('is not triggered by a modified 1 (AP cannot make a 2 a "1")', () => {
    const out = resolveAttack(attackerStats(['shred', 'ap(2)']), defender, 1, { toHit: [6], defense: [2] });
    expect(out.wounds).toBe(1);
  });

  it('the extra wound can still be shrugged off by Regeneration', () => {
    const out = resolveAttack(
      attackerStats(['shred']),
      { ...defender, specialRules: ['regeneration'] },
      1,
      { toHit: [6], defense: [1], regeneration: [6, 1] }
    );
    expect(out.wounds).toBe(1);
    expect(out.shredWounds).toBe(1);
    expect(out.regenerationSavedCount).toBe(1);
  });

  it('is its own rule, not Rending', () => {
    expect(TRAIT_REGISTRY.shred.displayName).toBe('Shred');
    expect(TRAIT_REGISTRY.shred.description).toMatch(/1/);
  });
});

describe('Impact on a charge', () => {
  const CHARGE = () =>
    createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
      path: [P(0, 0), P(0, 4)],
    } as any);
  const setup = (chargerOpts: UnitOpts = {}, targetOpts: UnitOpts = {}) =>
    mkState([
      mkUnit('h1', HOST, { rules: ['impact(3)'], ...chargerOpts }),
      mkUnit('g1', GUEST, { at: P(0, 5), tough: 6, ...targetOpts }),
    ]);

  it('rolls X dice, each 2+ is a hit that must get past Defense, before the melee strike', () => {
    const state = setup();
    const specs = getDiceSpecs(state, CHARGE())!;
    expect(specs.find((s) => s.purpose === 'impact')?.count).toBe(3);
    expect(specs.find((s) => s.purpose === 'impact-defense')?.count).toBe(3);
    // Dice 2, 1, 6 -> two hits; both defense rolls fail; the strike itself misses (to-hit 1)
    const out = applyAction(state, CHARGE(), diceFor(specs, { impact: [2, 1, 6], 'impact-defense': 1, 'to-hit': 1 }));
    expect(out.ok).toBe(true);
    expect(out.state!.units[1].wounds).toBe(4);
    expect(out.logEntry!.dice!.outcome.impact).toMatchObject({ attackCount: 3, hitCount: 2, wounds: 2 });
  });

  it('a defense roll can stop an Impact hit', () => {
    const state = setup();
    const specs = getDiceSpecs(state, CHARGE())!;
    const out = applyAction(state, CHARGE(), diceFor(specs, { impact: 6, 'impact-defense': 6, 'to-hit': 1 }));
    expect(out.state!.units[1].wounds).toBe(6);
  });

  it('gives no Impact dice when the charging unit is Fatigued', () => {
    const state = setup({ status: ['fatigued'] });
    expect(impactDiceCount(state.units[0], state.units[0].weapons[1])).toBe(0);
    const specs = getDiceSpecs(state, CHARGE())!;
    expect(specs.some((s) => s.purpose.startsWith('impact'))).toBe(false);
    const out = applyAction(state, CHARGE(), diceFor(specs, { 'to-hit': 1 }));
    expect(out.ok).toBe(true);
    expect(out.state!.units[1].wounds).toBe(6);
    expect(out.logEntry!.dice!.outcome.impact).toBeUndefined();
  });

  it('rolls X dice per striking model of a squad', () => {
    const state = setup({ models: 3 });
    expect(getDiceSpecs(state, CHARGE())!.find((s) => s.purpose === 'impact')?.count).toBe(9);
  });

  it('Impact on the weapon counts too', () => {
    const state = setup({ rules: [], weapons: [weapon('blade', ['impact(2)'])] });
    expect(getDiceSpecs(state, CHARGE())!.find((s) => s.purpose === 'impact')?.count).toBe(2);
  });

  it('resolveImpact: hits are dice showing 2+, Regeneration saves on 5+', () => {
    const out = resolveImpact(3, { defense: 5, specialRules: ['regeneration'] }, { impact: [1, 3, 4], defense: [1, 1], regeneration: [5, 1] });
    expect(out.hitCount).toBe(2);
    expect(out.regenerationSavedCount).toBe(1);
    expect(out.wounds).toBe(1);
  });
});

describe('Counter', () => {
  const COUNTER_BLADE = () => weapon('blade', ['counter']);
  const CHARGE = () =>
    createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
      path: [P(0, 0), P(0, 4)],
    } as any);
  const setup = (chargerOpts: UnitOpts = {}, targetOpts: UnitOpts = {}) =>
    mkState([
      mkUnit('h1', HOST, { tough: 2, ...chargerOpts }),
      mkUnit('g1', GUEST, { at: P(0, 5), tough: 3, weapons: [COUNTER_BLADE()], ...targetOpts }),
      mkUnit('h2', HOST, { at: P(-20, -20) }), // keeps the match going when the charger falls
    ]);

  it('the charged unit strikes first and its strike replaces the strike back', () => {
    const state = setup();
    const specs = getDiceSpecs(state, CHARGE())!;
    expect(specs.find((s) => s.purpose === 'counter0-to-hit')?.count).toBe(2);
    // Counter hits twice and wounds twice; the charger (2 wounds) is gone before it can strike
    const out = applyAction(state, CHARGE(), diceFor(specs, { 'counter0-to-hit': 6, 'counter0-defense': 1, 'to-hit': 6, defense: 1 }));
    expect(out.ok).toBe(true);
    const [h1, g1] = out.state!.units;
    expect(h1.isDestroyed).toBe(true);
    expect(g1.wounds).toBe(3); // the dead charger never struck
    expect(out.logEntry!.dice!.outcome.counterStrikes).toMatchObject([{ wounds: 2, targetDestroyed: true }]);
    // The winner may consolidate; there is no strike-back prompt
    expect(out.state!.turnState.pendingReaction?.type).toBe('melee-consolidation');
  });

  it('a surviving charger then strikes, and there is no strike-back prompt for the Counter weapon', () => {
    const state = setup({ tough: 5 });
    const specs = getDiceSpecs(state, CHARGE())!;
    const out = applyAction(state, CHARGE(), diceFor(specs, { 'counter0-to-hit': [6, 1], 'counter0-defense': 1, 'to-hit': [6, 6], defense: 1 }));
    expect(out.ok).toBe(true);
    const [h1, g1] = out.state!.units;
    expect(h1.wounds).toBe(4); // one Counter wound
    expect(g1.wounds).toBe(1); // two wounds from the charge strike
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(out.logEntry!.dice!.outcome.pushedBack).toBe(true);
    expect(g1.status).toContain('fatigued');
  });

  it('does not strike first when the charged unit is Fatigued: the normal strike-back prompt follows', () => {
    const state = setup({ tough: 5 }, { status: ['fatigued'] });
    const specs = getDiceSpecs(state, CHARGE())!;
    expect(specs.some((s) => s.purpose.startsWith('counter'))).toBe(false);
    const out = applyAction(state, CHARGE(), diceFor(specs, { 'to-hit': 6, defense: 1 }));
    expect(out.ok).toBe(true);
    expect(out.logEntry!.dice!.outcome.counterStrikes).toBeUndefined();
    expect(out.state!.units[0].wounds).toBe(5);
    expect(out.state!.turnState.pendingReaction?.type).toBe('melee-retaliation');
  });

  it('does not reduce the charger\'s Impact hits', () => {
    const state = setup({ tough: 9, rules: ['impact(3)'] });
    const specs = getDiceSpecs(state, CHARGE())!;
    expect(specs.find((s) => s.purpose === 'impact')?.count).toBe(3);
    const out = applyAction(
      state,
      CHARGE(),
      diceFor(specs, { impact: 6, 'impact-defense': 1, 'counter0-to-hit': 1, 'to-hit': 1 })
    );
    expect(out.logEntry!.dice!.outcome.impact).toMatchObject({ hitCount: 3, wounds: 3 });
    expect(out.state!.units[1].isDestroyed).toBe(true);
  });

  it('Impact that destroys the target ends the exchange before any Counter or strike', () => {
    const state = setup({ rules: ['impact(3)'] }, { tough: 2 });
    const specs = getDiceSpecs(state, CHARGE())!;
    const out = applyAction(state, CHARGE(), diceFor(specs, { impact: 6, 'impact-defense': 1, 'counter0-to-hit': 6, 'counter0-defense': 1 }));
    expect(out.state!.units[1].isDestroyed).toBe(true);
    expect(out.state!.units[0].wounds).toBe(2);
    expect(out.logEntry!.dice!.outcome.counterStrikes).toBeUndefined();
  });
});

describe('Assault', () => {
  const assaultRifle = () => weapon('rifle', ['assault']);

  it('an Assault weapon is also a melee weapon (and only a unit with one is offered it)', () => {
    const unit = mkUnit('u', HOST, { weapons: [assaultRifle()] });
    expect(findMeleeWeapon(unit)?.id).toBe('rifle');
    expect(findMeleeWeapon(mkUnit('v', HOST, { weapons: [weapon('rifle')] }))).toBeUndefined();
  });

  it('prefers a true melee weapon over an Assault weapon for the default strike', () => {
    const unit = mkUnit('u', HOST, { weapons: [assaultRifle(), weapon('blade')] });
    expect(findMeleeWeapon(unit)?.id).toBe('blade');
  });

  it('can charge and fight with the Assault weapon, and still shoot with it', () => {
    const state = mkState([
      mkUnit('h1', HOST, { weapons: [assaultRifle()], at: P(0, 0) }),
      mkUnit('g1', GUEST, { at: P(0, 5) }),
    ]);
    const charge = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
      path: [P(0, 0), P(0, 4)],
    } as any);
    expect(validateAction(state, charge).valid).toBe(true);
    const out = applyAction(state, charge, diceFor(getDiceSpecs(state, charge)!, { 'to-hit': 6, defense: 1 }));
    expect(out.ok).toBe(true);
    expect(out.state!.units[1].isDestroyed).toBe(true);

    const shootState = mkState([
      mkUnit('h1', HOST, { weapons: [assaultRifle()], at: P(0, 0) }),
      mkUnit('g1', GUEST, { at: P(0, 10) }),
    ]);
    const shoot = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'rifle' } as any);
    expect(validateAction(shootState, shoot).valid).toBe(true);
  });

  it('a plain rifle still cannot be used in melee', () => {
    const state = mkState([
      mkUnit('h1', HOST, { weapons: [weapon('rifle')], at: P(0, 0) }),
      mkUnit('g1', GUEST, { at: P(0, 5) }),
    ]);
    const charge = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'rifle',
      path: [P(0, 0), P(0, 4)],
    } as any);
    expect(validateAction(state, charge).valid).toBe(false);
  });
});

describe('registry descriptions', () => {
  it('describe the v3.6 behaviour of the reworked rules', () => {
    expect(TRAIT_REGISTRY.counter.description).not.toMatch(/loses one Impact/i);
    expect(TRAIT_REGISTRY.counter.description).toMatch(/Fatigued/);
    expect(TRAIT_REGISTRY.impact.description).toMatch(/Fatigued/);
    expect(TRAIT_REGISTRY.hero.description).toMatch(/6"/);
    expect(TRAIT_REGISTRY.assault.displayName).toBe('Assault');
    expect(TRAIT_REGISTRY.assault.description).toMatch(/melee/);
    expect(TRAIT_REGISTRY.indirect.description).toMatch(/did not move/);
  });
});

describe('squad activation test in dangerous terrain: casualty pick (Decision 42)', () => {
  const pool = (): TerrainPiece => {
    const meta = TERRAIN_PALETTE_CATALOG['hazard-pool'];
    return {
      id: 'pool-0',
      terrainType: 'hazard-pool',
      position: P(0, 0),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { ...meta.defaultScale },
      blocksLineOfSight: meta.blocksLineOfSight,
      providesCover: meta.providesCover,
      isObstacle: meta.isObstacle,
    };
  };
  const activate = (unitId: string) => createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId });
  const hold = (unitId: string) => createAction(HOST, 'hold', { type: 'hold', unitId });
  const poolState = (squad: Unit) => {
    const s = mkState([squad, mkUnit('g1', GUEST, { at: P(0, 30) })], [pool()], null);
    squad.isActivated = false;
    return s;
  };
  const pick = (unitId: string, modelIds: string[]) =>
    createAction(HOST, 'pick-casualties', { type: 'pick-casualties', unitId, modelIds } as any);

  it('a squad that loses a model gets the pick, and the picked model is the one removed', () => {
    const state = poolState(mkUnit('h1', HOST, { models: 3 }));
    const specs = getDiceSpecs(state, activate('h1'))!;
    const out = applyAction(state, activate('h1'), diceFor(specs, { [specs[0].purpose]: [1, 5, 5] }));
    expect(out.ok).toBe(true);
    const pending = out.state!.turnState.pendingReaction!;
    expect(pending.type).toBe('pick-casualties');
    expect(pending.promptingPlayerId).toBe(HOST);
    expect(out.state!.units[0].models.every((m) => !m.isDestroyed)).toBe(true);
    expect(out.state!.turnState.activeUnitId).toBe('h1');
    // moving is blocked while the pick is pending
    expect(validateAction(out.state!, advance('h1', 2)).valid).toBe(false);

    const done = applyAction(out.state!, pick('h1', ['h1-m2']));
    expect(done.ok).toBe(true);
    const models = done.state!.units[0].models;
    expect(models.find((m) => m.id === 'h1-m2')!.isDestroyed).toBe(true);
    expect(models.filter((m) => m.isDestroyed)).toHaveLength(1);
    expect(done.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(done.state!.turnState.activeUnitId).toBe('h1'); // activate-unit: the activation carries on
  });

  it('on timeout the host\'s auto pick removes the casualties', () => {
    const state = poolState(mkUnit('h1', HOST, { models: 3 }));
    const specs = getDiceSpecs(state, activate('h1'))!;
    const out = applyAction(state, activate('h1'), diceFor(specs, { [specs[0].purpose]: [1, 1, 5] }));
    const auto = createAction(HOST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: out.state!.turnState.pendingReaction!.id,
      choiceId: 'auto-pick-casualties',
    });
    const done = applyAction(out.state!, auto);
    expect(done.ok).toBe(true);
    expect(done.state!.units[0].models.filter((m) => m.isDestroyed)).toHaveLength(2);
  });

  it('no prompt when the test wounds nobody, wipes the squad out, or the unit is a single model', () => {
    const none = poolState(mkUnit('h1', HOST, { models: 3 }));
    const noneSpecs = getDiceSpecs(none, activate('h1'))!;
    const unhurt = applyAction(none, activate('h1'), diceFor(noneSpecs, { [noneSpecs[0].purpose]: 6 }));
    expect(unhurt.state!.turnState.pendingReaction ?? null).toBeNull();

    const wipe = poolState(mkUnit('h1', HOST, { models: 3 }));
    const wipeSpecs = getDiceSpecs(wipe, activate('h1'))!;
    const wiped = applyAction(wipe, activate('h1'), diceFor(wipeSpecs, { [wipeSpecs[0].purpose]: 1 }));
    expect(wiped.state!.units[0].isDestroyed).toBe(true);
    expect(wiped.state!.turnState.pendingReaction ?? null).toBeNull();

    const single = poolState(mkUnit('h1', HOST, { models: 1, tough: 3 }));
    const singleSpecs = getDiceSpecs(single, activate('h1'))!;
    const hurt = applyAction(single, activate('h1'), diceFor(singleSpecs, { [singleSpecs[0].purpose]: [1, 5, 5] }));
    expect(hurt.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(hurt.state!.units[0].wounds).toBe(2);
  });

  it('a Shaken squad holding in the pool finishes its activation only after the pick', () => {
    const squad = mkUnit('h1', HOST, { models: 3, status: ['shaken'] });
    const state = poolState(squad);
    const specs = getDiceSpecs(state, hold('h1'))!;
    const out = applyAction(state, hold('h1'), diceFor(specs, { [specs[0].purpose]: [1, 5, 5], morale: 6 }));
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).toBe('pick-casualties');
    expect(out.state!.turnState.activeUnitId).toBe('h1'); // not finished yet
    expect(out.state!.units[0].status).toContain('shaken');

    const done = applyAction(out.state!, pick('h1', ['h1-m0']));
    expect(done.ok).toBe(true);
    const next = done.state!;
    expect(next.turnState.activeUnitId).toBeNull();
    expect(next.units[0].status).not.toContain('shaken'); // idle activation over: Shaken cleared
    expect(next.units[0].models.find((m) => m.id === 'h1-m0')!.isDestroyed).toBe(true);
    expect(next.turnState.currentPlayerId).toBe(GUEST); // play passed on
  });

  it('a Shaken single model holding in the pool finishes at once', () => {
    const state = poolState(mkUnit('h1', HOST, { models: 1, tough: 3, status: ['shaken'] }));
    const specs = getDiceSpecs(state, hold('h1'))!;
    const out = applyAction(state, hold('h1'), diceFor(specs, { [specs[0].purpose]: [1, 5, 5], morale: 6 }));
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(out.state!.turnState.activeUnitId).toBeNull();
  });
});

describe('Counter, tabletop order (14C-2 PR 7B, Decisions 43-45)', () => {
  const counterBlade = (id = 'cblade') => ({ ...weapon('blade', ['counter']), id });
  const plainBlade = (id = 'pblade') => ({ ...weapon('blade'), id });
  const CHARGE = () =>
    createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
      path: [P(0, 0), P(0, 4)],
    } as any);
  const setup = (chargerOpts: UnitOpts = {}, targetOpts: UnitOpts = {}) =>
    mkState([
      mkUnit('h1', HOST, { tough: 5, ...chargerOpts }),
      mkUnit('g1', GUEST, { at: P(0, 5), tough: 5, weapons: [counterBlade()], ...targetOpts }),
      mkUnit('h2', HOST, { at: P(-20, -20) }),
    ]);
  const pickAction = (unitId: string, modelIds: string[]) =>
    createAction(HOST, 'pick-casualties', { type: 'pick-casualties', unitId, modelIds } as any);
  /** Five chargers ringed round a lone target at (0, 5), each in base contact. */
  const RING = [-120, -60, 0, 60, 120].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return P(Math.sin(rad), 5 - Math.cos(rad));
  });
  const squadCharge = (state: GameState, ends: Vector3[] = RING) => {
    const starts = state.units.find((u) => u.id === 'h1')!.models.map((m) => m.position!);
    return createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
      path: [P(0, 0), P(0, 4)],
      modelPositions: ends,
      modelPaths: starts.map((s, i) => [s, ends[i]]),
    } as any);
  };
  const unit = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
  const alive = (state: GameState, id: string) => unit(state, id).models.filter((m) => !m.isDestroyed).map((m) => m.id);

  it('a Shaken unit makes no Counter strike (no Counter dice) but is offered the strike back, hitting only on 6s', () => {
    const state = setup({}, { status: ['shaken'] });
    const specs = getDiceSpecs(state, CHARGE())!;
    expect(specs.some((s) => s.purpose.startsWith('counter'))).toBe(false);
    const out = applyAction(state, CHARGE(), diceFor(specs, { 'to-hit': 6, defense: 1 }));
    expect(out.ok).toBe(true);
    expect(out.logEntry!.dice!.outcome.counterStrikes).toBeUndefined();
    const pending = out.state!.turnState.pendingReaction!;
    expect(pending.type).toBe('melee-retaliation');
    expect(pending.data?.weaponId).toBe('cblade');
    // Shaken counts as Fatigued: a 5 misses, only a natural 6 hits
    const strike = (value: number) => {
      const respond = createAction(GUEST, 'respond-reaction', { type: 'respond-reaction', reactionId: pending.id, choiceId: 'strike-back' });
      const r = applyAction(out.state!, respond, diceFor(getDiceSpecs(out.state!, respond)!, { 'to-hit': value, defense: 1 }));
      expect(r.ok).toBe(true);
      return r.logEntry!.dice!.outcome.hitCount;
    };
    expect(strike(5)).toBe(0);
    expect(strike(6)).toBeGreaterThan(0);
  });

  it('every Counter weapon strikes first, one resolution each', () => {
    const state = setup({}, { weapons: [counterBlade('c1'), counterBlade('c2')] });
    const specs = getDiceSpecs(state, CHARGE())!;
    expect(specs.find((s) => s.purpose === 'counter0-to-hit')?.count).toBe(2);
    expect(specs.find((s) => s.purpose === 'counter1-to-hit')?.count).toBe(2);
    const out = applyAction(
      state,
      CHARGE(),
      diceFor(specs, { 'counter0-to-hit': 6, 'counter1-to-hit': [6, 1], 'counter0-defense': 1, 'counter1-defense': 1, 'to-hit': 1 })
    );
    const strikes = out.logEntry!.dice!.outcome.counterStrikes!;
    expect(strikes).toHaveLength(2);
    expect(strikes.map((c) => c.hitCount)).toEqual([2, 1]);
    expect(unit(out.state!, 'h1').wounds).toBe(2); // 5 - 2 - 1
  });

  it('a unit with a Counter weapon and a plain one strikes first, then is offered the plain weapon to strike back', () => {
    const state = setup({}, { weapons: [counterBlade(), plainBlade()] });
    const specs = getDiceSpecs(state, CHARGE())!;
    const out = applyAction(state, CHARGE(), diceFor(specs, { 'counter0-to-hit': 6, 'counter0-defense': 1, 'to-hit': 1 }));
    expect(out.logEntry!.dice!.outcome.counterStrikes).toHaveLength(1);
    const pending = out.state!.turnState.pendingReaction!;
    expect(pending.type).toBe('melee-retaliation');
    expect(pending.data?.weaponId).toBe('pblade');
    expect(out.logEntry!.dice!.context.retaliationWeaponId).toBe('pblade');
  });

  it('an Assault weapon counts as the plain strike-back weapon', () => {
    const assault = { ...weapon('rifle', ['assault']), id: 'arifle' };
    const state = setup({}, { weapons: [counterBlade(), assault] });
    const out = applyAction(state, CHARGE(), diceFor(getDiceSpecs(state, CHARGE())!, { 'to-hit': 1 }));
    expect(out.state!.turnState.pendingReaction?.data?.weaponId).toBe('arifle');
  });

  it('a unit whose only melee weapon has Counter gets no strike-back prompt', () => {
    const state = setup();
    const out = applyAction(state, CHARGE(), diceFor(getDiceSpecs(state, CHARGE())!, { 'to-hit': 1 }));
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(out.logEntry!.dice!.outcome.pushedBack).toBe(true);
  });

  describe('Counter casualties on a squad charger are picked before it strikes', () => {
    // 5 Tough-1 models in a row: after the charge the four nearest the target are in its reach, the fifth is not
    const squadSetup = () => setup({ models: 5, tough: 1, at: P(-2.4, 0) }, { tough: 10 });
    const hits = { 'counter0-to-hit': 6, 'counter0-defense': 1, 'to-hit': 6, defense: 1 };

    function atPick() {
      const state = squadSetup();
      const out = applyAction(state, squadCharge(state), diceFor(getDiceSpecs(state, squadCharge(state))!, hits));
      if (!out.ok) throw new Error(out.reason);
      return out;
    }

    it('pauses for the charger\'s owner with the charger still whole and untouched target', () => {
      const out = atPick();
      const pending = out.state!.turnState.pendingReaction!;
      expect(pending.type).toBe('pick-casualties');
      expect(pending.promptingPlayerId).toBe(HOST);
      expect(alive(out.state!, 'h1')).toHaveLength(5);
      expect(unit(out.state!, 'g1').wounds).toBe(10);
      expect(out.logEntry!.dice!.outcome.counterStrikes).toHaveLength(1);
      expect(out.logEntry!.dice!.outcome.attackCount).toBe(0);
      expect(unit(out.state!, 'h1').status).not.toContain('fatigued');
    });

    it('the charger then strikes with the models it has left (3 models x 2 attacks)', () => {
      const out = atPick();
      const pick = pickAction('h1', ['h1-m3', 'h1-m4']);
      expect(validateAction(out.state!, pick).valid).toBe(true);
      const resolved = applyAction(out.state!, pick);
      expect(resolved.ok).toBe(true);
      expect(resolved.logEntry!.dice!.outcome.attackCount).toBe(6);
      expect(unit(resolved.state!, 'g1').wounds).toBe(4);
      expect(unit(resolved.state!, 'h1').status).toContain('fatigued');
      expect(resolved.state!.turnState.pendingReaction ?? null).toBeNull();
    });

    it('only survivors still within 3" of the target strike', () => {
      const out = atPick();
      const state = JSON.parse(JSON.stringify(out.state!)) as GameState;
      unit(state, 'h1').models[2].position = P(0, -10); // a survivor out of reach
      const resolved = applyAction(state, pickAction('h1', ['h1-m3', 'h1-m4']));
      expect(resolved.logEntry!.dice!.outcome.attackCount).toBe(4); // m0 and m1 only
      expect(alive(resolved.state!, 'h1')).toEqual(['h1-m0', 'h1-m1', 'h1-m2']);
    });

    it('the timeout auto pick resolves the strike too', () => {
      const out = atPick();
      const pending = out.state!.turnState.pendingReaction!;
      const auto = createAction(HOST, 'respond-reaction', { type: 'respond-reaction', reactionId: pending.id, choiceId: 'auto-pick-casualties' });
      const resolved = applyAction(out.state!, auto);
      expect(resolved.ok).toBe(true);
      expect(alive(resolved.state!, 'h1')).toHaveLength(3);
      expect(resolved.logEntry!.dice!.outcome.attackCount).toBeGreaterThan(0);
      expect(resolved.state!.turnState.pendingReaction ?? null).toBeNull();
    });

    it('the exchange stays serializable while paused', () => {
      const out = atPick();
      expect(JSON.parse(JSON.stringify(out.state!.turnState.pendingReaction))).toEqual(out.state!.turnState.pendingReaction);
    });
  });

  it('Impact casualties on a squad that Counters are picked before the Counter strike', () => {
    // Impact(2) per striking model x 3 striking models = 6 dice; the Tough-1 squad of 3 loses 2 models
    const state = mkState([
      mkUnit('h1', HOST, { models: 3, tough: 5, rules: ['impact(2)'] }),
      mkUnit('g1', GUEST, { at: P(0, 5), models: 3, tough: 1, weapons: [counterBlade()] }),
      mkUnit('h2', HOST, { at: P(-20, -20) }),
    ]);
    const ends = [P(0, 4), P(1.2, 4), P(2.4, 4)];
    const specs = getDiceSpecs(state, squadCharge(state, ends))!;
    const dice = diceFor(specs, { impact: [6, 6, 1, 1, 1, 1], 'impact-defense': 1, 'counter0-to-hit': 6, 'counter0-defense': 1, 'to-hit': 1 });
    const out = applyAction(state, squadCharge(state, ends), dice);
    expect(out.ok).toBe(true);
    const pending = out.state!.turnState.pendingReaction!;
    expect(pending.type).toBe('pick-casualties');
    expect(pending.promptingPlayerId).toBe(GUEST);
    expect(unit(out.state!, 'h1').wounds).toBe(15); // the Counter has not struck yet
    const picked = applyAction(out.state!, createAction(GUEST, 'pick-casualties', { type: 'pick-casualties', unitId: 'g1', modelIds: ['g1-m0', 'g1-m1'] } as any));
    expect(picked.ok).toBe(true);
    // The survivors are counted for the Counter strike (the charger took wounds), the exchange went on
    expect(picked.logEntry!.dice!.outcome.counterStrikes).toHaveLength(1);
    expect(picked.logEntry!.dice!.outcome.counterStrikes![0].attackCount).toBe(2); // one surviving model x 2 attacks
    expect(unit(picked.state!, 'h1').wounds).toBeLessThan(15);
  });
});
