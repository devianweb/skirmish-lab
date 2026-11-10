import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, DiceSpec, GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { validateSquadCoherency } from '../../src/engine/spatial';
import { livingModelPositions, strikingModelCount } from '../../src/engine/unitGeometry';
import {
  PICK_CASUALTIES_AUTO_CHOICE,
  PickCasualtiesData,
  autoPickCasualties,
} from '../../src/engine/casualties';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

const weapon = (id: string): Weapon => ({ ...WEAPONS[id], profile: { ...WEAPONS[id].profile } });

function mkUnit(id: string, ownerId: string, spots: Array<[number, number]>, weapons: string[] = ['rifle', 'blade']): Unit {
  const models = spots.map(([x, z], i) => ({
    id: `${id}-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: P(x, z),
    rotation: { x: 0, y: 0, z: 0 },
  }));
  const cx = spots.reduce((a, s) => a + s[0], 0) / spots.length;
  const cz = spots.reduce((a, s) => a + s[1], 0) / spots.length;
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 4,
    position: P(cx, cz),
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: spots.length,
    maxWounds: spots.length,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models,
    weapons: weapons.map(weapon),
    specialRules: [],
    hasMoved: false,
    remainingMovement: 4,
  };
}

function mkState(units: Unit[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = [];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = 'h1';
  return state;
}

/**
 * Dice for a spec list: in each attack (alloc_N_ prefix, or none) the first `wounds[N]` attacks hit and every
 * defense roll fails, so that many wounds land.
 */
function diceFor(specs: DiceSpec[], wounds: number[]): DiceResult[] {
  return specs.map((spec) => {
    const m = /^alloc_(\d+)_(.*)$/.exec(spec.purpose);
    const index = m ? Number(m[1]) : 0;
    const base = m ? m[2] : spec.purpose;
    let rolls: number[];
    if (base === 'to-hit') rolls = Array.from({ length: spec.count }, (_, i) => (i < (wounds[index] ?? 0) ? 6 : 1));
    else if (base === 'defense') rolls = Array(spec.count).fill(1);
    else rolls = Array(spec.count).fill(1);
    return { rolls, total: rolls.reduce((a, b) => a + b, 0), finalTotal: rolls.reduce((a, b) => a + b, 0), purpose: spec.purpose };
  });
}

const shootAction = (targets: string[]) =>
  targets.length === 1
    ? createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: targets[0], weaponId: 'rifle' } as any)
    : createAction(HOST, 'shoot', {
        type: 'shoot',
        attackerId: 'h1',
        allocations: targets.map((t, i) => ({ weaponId: i === 0 ? 'rifle' : 'carbine', targetId: t })),
      } as any);

/** Resolve an action with `wounds` wounds per attack. */
function resolve(state: GameState, action: ReturnType<typeof createAction>, wounds: number[]) {
  const specs = getDiceSpecs(state, action)!;
  return applyAction(state, action, diceFor(specs, wounds));
}

const pickAction = (actor: string, unitId: string, modelIds: string[]) =>
  createAction(actor, 'pick-casualties', { type: 'pick-casualties', unitId, modelIds } as any);

const autoAction = (state: GameState, actor: string) =>
  createAction(actor, 'respond-reaction', {
    type: 'respond-reaction',
    reactionId: state.turnState.pendingReaction!.id,
    choiceId: PICK_CASUALTIES_AUTO_CHOICE,
  });

const unitOf = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
const aliveIds = (state: GameState, id: string) => unitOf(state, id).models.filter((m) => !m.isDestroyed).map((m) => m.id);
const dataOf = (state: GameState) => state.turnState.pendingReaction!.data as unknown as PickCasualtiesData;

/** A 4-model shooter squad and a 4-model target line 10" away. */
function shootingState(): GameState {
  return mkState([
    mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle', 'carbine']),
    mkUnit('g1', GUEST, [[0, 10], [1, 10], [2, 10], [3, 10]]),
  ]);
}

describe('casualties: the owner picks (shooting)', () => {
  it('2 wounds into a 4-model squad stop at a prompt for its owner; nothing is removed yet', () => {
    const out = resolve(shootingState(), shootAction(['g1']), [2]);
    expect(out.ok).toBe(true);
    const next = out.state!;
    const reaction = next.turnState.pendingReaction!;
    expect(reaction.type).toBe('pick-casualties');
    expect(reaction.promptingPlayerId).toBe(GUEST);
    expect(reaction.targetUnitId).toBe('g1');
    expect(reaction.sourceUnitId).toBe('h1');
    expect(reaction.durationMs).toBe(30000);
    expect(reaction.options.find((o) => o.isDefault)?.id).toBe(PICK_CASUALTIES_AUTO_CHOICE);
    expect(dataOf(next).entry.count).toBe(2);
    expect(aliveIds(next, 'g1')).toHaveLength(4);
    expect(unitOf(next, 'g1').wounds).toBe(4);
    // The shot itself is logged as before
    expect(out.logEntry?.dice?.outcome.wounds).toBe(2);
    expect(out.logEntry?.dice?.outcome.targetDestroyed).toBe(false);
    expect(unitOf(next, 'h1').hasAttacked).toBe(true);
  });

  it('while the pick is pending only the owner may answer; the attacker cannot act', () => {
    const next = resolve(shootingState(), shootAction(['g1']), [2]).state!;
    expect(validateAction(next, createAction(HOST, 'end-activation', { type: 'end-activation' } as any)).valid).toBe(false);
    expect(validateAction(next, pickAction(HOST, 'g1', ['g1-m0', 'g1-m1'])).valid).toBe(false);
    expect(validateAction(next, createAction(GUEST, 'end-activation', { type: 'end-activation' } as any)).valid).toBe(false);
  });

  it('removes exactly the picked models and recomputes the squad position', () => {
    const next = resolve(shootingState(), shootAction(['g1']), [2]).state!;
    const pick = pickAction(GUEST, 'g1', ['g1-m3', 'g1-m2']);
    expect(validateAction(next, pick)).toEqual({ valid: true });
    expect(getDiceSpecs(next, pick)).toBeNull();
    const out = applyAction(next, pick);
    expect(out.ok).toBe(true);
    const done = out.state!;
    expect(aliveIds(done, 'g1')).toEqual(['g1-m0', 'g1-m1']);
    expect(unitOf(done, 'g1').wounds).toBe(2);
    expect(unitOf(done, 'g1').position.x).toBeCloseTo(0.5);
    expect(done.turnState.pendingReaction).toBeNull();
  });

  it('rejects a wrong count, a duplicate, a dead model, another unit\'s model and the wrong player', () => {
    const next = resolve(shootingState(), shootAction(['g1']), [2]).state!;
    const reasonOf = (a: ReturnType<typeof pickAction>, s = next) => {
      const res = validateAction(s, a);
      expect(res.valid).toBe(false);
      return res.valid === false ? res.reason : '';
    };
    expect(reasonOf(pickAction(GUEST, 'g1', ['g1-m0']))).toMatch(/exactly 2/);
    expect(reasonOf(pickAction(GUEST, 'g1', ['g1-m0', 'g1-m1', 'g1-m2']))).toMatch(/exactly 2/);
    expect(reasonOf(pickAction(GUEST, 'g1', ['g1-m0', 'g1-m0']))).toMatch(/distinct/);
    expect(reasonOf(pickAction(GUEST, 'g1', ['g1-m0', 'h1-m0']))).toMatch(/not a living model/);
    expect(reasonOf(pickAction(GUEST, 'g1', ['g1-m0', 'nobody']))).toMatch(/not a living model/);
    expect(reasonOf(pickAction(HOST, 'g1', ['g1-m0', 'g1-m1']))).toMatch(/Not your|pending/);

    // A model already dead after an earlier pick can't be named again
    const dead = unitOf(next, 'g1');
    dead.models[0].isDestroyed = true;
    dead.wounds = 3;
    next.turnState.pendingReaction!.data!.entry.count = 2;
    expect(reasonOf(pickAction(GUEST, 'g1', ['g1-m0', 'g1-m1']))).toMatch(/not a living model/);
  });

  it('there is no pick when nothing is pending', () => {
    const state = shootingState();
    expect(validateAction(state, pickAction(GUEST, 'g1', ['g1-m0'])).valid).toBe(false);
  });

  it('any living models may be picked (no sight or coherency limit); a chain-breaking pick is accepted', () => {
    // Targets spaced 2" apart (a chain at the link limit): taking the two middle models splits it
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle']),
      mkUnit('g1', GUEST, [[0, 10], [2, 10], [4, 10], [6, 10]]),
    ]);
    const next = resolve(state, shootAction(['g1']), [2]).state!;
    const pick = pickAction(GUEST, 'g1', ['g1-m1', 'g1-m2']);
    expect(validateAction(next, pick)).toEqual({ valid: true });
    const done = applyAction(next, pick).state!;
    expect(aliveIds(done, 'g1')).toEqual(['g1-m0', 'g1-m3']);
    expect(validateSquadCoherency(livingModelPositions(unitOf(done, 'g1'))).coherent).toBe(false);
  });

  it('wounds that destroy the whole squad need no pick', () => {
    // 3 models, 3 wounds: two models go, the last takes a wound and a high wound-effect roll knocks it out
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle']),
      mkUnit('g1', GUEST, [[0, 10], [1, 10], [2, 10]]),
    ]);
    const out = resolve(state, shootAction(['g1']), [3], 6);
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(unitOf(out.state!, 'g1').isDestroyed).toBe(true);
    expect(out.logEntry?.dice?.outcome.targetDestroyed).toBe(true);
  });

  it('a single-model unit takes its wounds at once, no prompt', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle']),
      mkUnit('g1', GUEST, [[0, 10]]),
    ]);
    unitOf(state, 'g1').models[0].maxWounds = 3;
    unitOf(state, 'g1').models[0].wounds = 3;
    unitOf(state, 'g1').wounds = 3;
    unitOf(state, 'g1').maxWounds = 3;
    const out = resolve(state, shootAction(['g1']), [2]);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(unitOf(out.state!, 'g1').wounds).toBe(1);
  });

  it('a squad reduced to one model: no prompt for the lone survivor, only for the squad that still has a choice', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle']),
      mkUnit('g1', GUEST, [[0, 10], [1, 10]]),
    ]);
    // 1 wound into a 2-model squad: one model must go, the owner picks which
    const next = resolve(state, shootAction(['g1']), [1]).state!;
    expect(dataOf(next).entry.count).toBe(1);
    const done = applyAction(next, pickAction(GUEST, 'g1', ['g1-m1'])).state!;
    expect(aliveIds(done, 'g1')).toEqual(['g1-m0']);
    // Now it is a lone model: more wounds land immediately (no prompt) and a Tough 1 model dies to one
    done.turnState.activeUnitId = 'h1';
    done.units.find((u) => u.id === 'h1')!.hasAttacked = false;
    const again = resolve(done, shootAction(['g1']), [1]);
    expect(again.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(unitOf(again.state!, 'g1').isDestroyed).toBe(true);
  });

  it('Tough 2 models: wounds fill one model before the next, and the owner picks the model that dies', () => {
    const state = shootingState();
    for (const m of unitOf(state, 'g1').models) {
      m.wounds = 2;
      m.maxWounds = 2;
    }
    unitOf(state, 'g1').wounds = 8;
    // 3 wounds: one model takes 2 and dies, the next takes 1 and survives wounded; only one model must go
    const next = resolve(state, shootAction(['g1']), [3]);
    const pending = next.state!;
    expect(dataOf(pending).entry.count).toBe(1);
    expect(unitOf(pending, 'g1').models.every((m) => !m.isDestroyed)).toBe(true); // not applied until the pick

    const done = applyAction(pending, pickAction(GUEST, 'g1', ['g1-m3'])).state!;
    const g1 = unitOf(done, 'g1');
    expect(aliveIds(done, 'g1')).toEqual(['g1-m0', 'g1-m1', 'g1-m2']);
    expect(g1.models.map((m) => m.wounds)).toEqual([1, 2, 2, 0]);
    expect(g1.wounds).toBe(5);
  });

  it('wounds that remove every model of a squad destroy it with no prompt', () => {
    const out = resolve(shootingState(), shootAction(['g1']), [4]);
    expect(out.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(unitOf(out.state!, 'g1').isDestroyed).toBe(true);
  });

  it('split fire at two units gives one prompt per unit, in order', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle', 'carbine']),
      mkUnit('g1', GUEST, [[0, 10], [1, 10], [2, 10], [3, 10]]),
      mkUnit('g2', GUEST, [[8, 10], [9, 10], [10, 10]]),
    ]);
    const action = shootAction(['g1', 'g2']);
    const out = resolve(state, action, [2, 1]);
    expect(out.ok).toBe(true);
    const first = out.state!;
    expect(first.turnState.pendingReaction?.targetUnitId).toBe('g1');
    expect(dataOf(first).entry.count).toBe(2);
    expect(dataOf(first).rest.map((e) => e.unitId)).toEqual(['g2']);
    expect(aliveIds(first, 'g2')).toHaveLength(3);

    const second = applyAction(first, pickAction(GUEST, 'g1', ['g1-m0', 'g1-m1'])).state!;
    expect(aliveIds(second, 'g1')).toEqual(['g1-m2', 'g1-m3']);
    expect(second.turnState.pendingReaction?.targetUnitId).toBe('g2');
    expect(second.turnState.pendingReaction?.id).not.toBe(first.turnState.pendingReaction?.id);
    expect(aliveIds(second, 'g2')).toHaveLength(3);
    // g1's pick is not valid for g2's prompt
    expect(validateAction(second, pickAction(GUEST, 'g1', ['g1-m2'])).valid).toBe(false);

    const third = applyAction(second, pickAction(GUEST, 'g2', ['g2-m2'])).state!;
    expect(aliveIds(third, 'g2')).toEqual(['g2-m0', 'g2-m1']);
    expect(third.turnState.pendingReaction ?? null).toBeNull();
  });

  it('two weapons into the same squad add up to one prompt', () => {
    const state = shootingState();
    const split = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: [
        { weaponId: 'rifle', targetId: 'g1' },
        { weaponId: 'carbine', targetId: 'g1' },
      ],
    } as any);
    const out = resolve(state, split, [1, 1]);
    expect(out.ok).toBe(true);
    expect(dataOf(out.state!).entry.count).toBe(2);
    expect(dataOf(out.state!).rest).toEqual([]);
    expect(dataOf(out.state!).entry.applications).toHaveLength(2);
    const done = applyAction(out.state!, pickAction(GUEST, 'g1', ['g1-m1', 'g1-m3'])).state!;
    expect(aliveIds(done, 'g1')).toEqual(['g1-m0', 'g1-m2']);
  });

  it('a pending pick survives a JSON round trip and still resolves the same', () => {
    const next = resolve(shootingState(), shootAction(['g1']), [2]).state!;
    const revived = JSON.parse(JSON.stringify(next)) as GameState;
    expect(revived.turnState.pendingReaction).toEqual(next.turnState.pendingReaction);
    const pick = pickAction(GUEST, 'g1', ['g1-m1', 'g1-m2']);
    const a = applyAction(next, pick).state!;
    const b = applyAction(revived, pick).state!;
    expect(aliveIds(b, 'g1')).toEqual(aliveIds(a, 'g1'));
    expect(JSON.parse(JSON.stringify(b.units))).toEqual(JSON.parse(JSON.stringify(a.units)));
  });
});

describe('casualties: the timeout pick', () => {
  // A chain at the link limit (2" centre to centre): the second model in list order holds it together
  const chain = () =>
    mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle']),
      mkUnit('g1', GUEST, [[2, 10], [0, 10], [4, 10], [6, 10]]),
    ]);

  it('prefers models whose removal keeps the squad connected, then list order', () => {
    const next = resolve(chain(), shootAction(['g1']), [1]).state!;
    // list order would take g1-m0 (the middle of the chain); the host takes g1-m1 (an end) instead
    expect(autoPickCasualties(unitOf(next, 'g1'), 1)).toEqual(['g1-m1']);
    const auto = autoAction(next, GUEST);
    expect(validateAction(next, auto)).toEqual({ valid: true });
    expect(getDiceSpecs(next, auto)).toBeNull();
    const done = applyAction(next, auto).state!;
    expect(aliveIds(done, 'g1')).toEqual(['g1-m0', 'g1-m2', 'g1-m3']);
    expect(validateSquadCoherency(livingModelPositions(unitOf(done, 'g1'))).coherent).toBe(true);
    expect(done.turnState.pendingReaction ?? null).toBeNull();
  });

  it('falls back to list order when every removal leaves the squad equally broken', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle']),
      mkUnit('g1', GUEST, [[0, 10], [5, 10], [10, 10]]),
    ]);
    const unit = unitOf(state, 'g1');
    // Taking an end model leaves a 5" gap, the middle one a 10" gap: the best is the first end in list order
    expect(autoPickCasualties(unit, 1)).toEqual(['g1-m0']);
    expect(autoPickCasualties(unit, 2)).toEqual(['g1-m0', 'g1-m1']);
  });

  it('keeps going through a whole queue of prompts', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]], ['rifle', 'carbine']),
      mkUnit('g1', GUEST, [[0, 10], [1, 10], [2, 10]]),
      mkUnit('g2', GUEST, [[8, 10], [9, 10], [10, 10]]),
    ]);
    let s = resolve(state, shootAction(['g1', 'g2']), [1, 1]).state!;
    s = applyAction(s, autoAction(s, GUEST)).state!;
    expect(s.turnState.pendingReaction?.targetUnitId).toBe('g2');
    s = applyAction(s, autoAction(s, GUEST)).state!;
    expect(s.turnState.pendingReaction ?? null).toBeNull();
    expect(aliveIds(s, 'g1')).toHaveLength(2);
    expect(aliveIds(s, 'g2')).toHaveLength(2);
  });
});

describe('casualties: melee', () => {
  // h1: 4 chargers 9" away in a line; g1: two defenders touching the line and two that must pile in
  const meleeSetup = () =>
    mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]]),
      mkUnit('g1', GUEST, [[0, 9], [1, 9], [0, 20], [1, 20]]),
    ]);
  const ENDS = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];

  const chargeAction = (state: GameState) =>
    createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
      path: [P(0, 0), ENDS[0]],
      modelPositions: ENDS,
      modelPaths: livingModelPositions(unitOf(state, 'h1')).map((s, i) => [s, ENDS[i]]),
    } as any);

  /** Charge, let the host pile in, strike for `wounds` wounds: the state at the defender's pick. */
  function atDefenderPick(wounds: number) {
    const state = meleeSetup();
    const charged = applyAction(state, chargeAction(state), undefined).state!;
    expect(charged.turnState.pendingReaction?.type).toBe('pile-in');
    const auto = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: charged.turnState.pendingReaction!.id,
      choiceId: 'auto-pile-in',
    });
    return applyAction(charged, auto, diceFor(getDiceSpecs(charged, auto)!, [wounds]));
  }

  it('the charge strike stops at the defender\'s pick; the strike-back waits for it', () => {
    const out = atDefenderPick(2);
    expect(out.ok).toBe(true);
    const next = out.state!;
    const reaction = next.turnState.pendingReaction!;
    expect(reaction.type).toBe('pick-casualties');
    expect(reaction.promptingPlayerId).toBe(GUEST);
    expect(dataOf(next).after.kind).toBe('charge-strike');
    expect(aliveIds(next, 'g1')).toHaveLength(4);
    expect(out.logEntry?.dice?.outcome.wounds).toBe(2);
    expect(unitOf(next, 'h1').status).toContain('fatigued');
  });

  it('the strike-back counts only the models that survive the defender\'s pick and are within reach', () => {
    const next = atDefenderPick(2).state!;
    // after the host's pile-in the two back models stand beside the line; check both choices against the engine
    const keepFront = applyAction(next, pickAction(GUEST, 'g1', ['g1-m2', 'g1-m3'])).state!;
    const keepBack = applyAction(next, pickAction(GUEST, 'g1', ['g1-m0', 'g1-m1'])).state!;
    const counts: number[] = [];
    for (const done of [keepFront, keepBack]) {
      expect(done.turnState.pendingReaction?.type).toBe('melee-retaliation');
      const strike = createAction(GUEST, 'respond-reaction', {
        type: 'respond-reaction',
        reactionId: done.turnState.pendingReaction!.id,
        choiceId: 'strike-back',
      });
      const expected = Math.max(1, strikingModelCount(unitOf(done, 'g1'), unitOf(done, 'h1'))) * 2;
      const count = getDiceSpecs(done, strike)!.find((s) => s.purpose === 'to-hit')!.count;
      expect(count).toBe(expected);
      counts.push(count);
    }
    // the two front defenders touch the chargers (2 strikers); the two back ones are still out of reach (1)
    expect(counts).toEqual([4, 2]);
    expect(aliveIds(keepFront, 'g1')).toEqual(['g1-m0', 'g1-m1']);
    expect(aliveIds(keepBack, 'g1')).toEqual(['g1-m2', 'g1-m3']);
  });

  it('then the charger\'s owner picks after the strike-back, and the step back follows the pick', () => {
    const afterStrike = atDefenderPick(2).state!;
    const retaliation = applyAction(afterStrike, pickAction(GUEST, 'g1', ['g1-m2', 'g1-m3'])).state!;
    const strike = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: retaliation.turnState.pendingReaction!.id,
      choiceId: 'strike-back',
    });
    const out = applyAction(retaliation, strike, diceFor(getDiceSpecs(retaliation, strike)!, [2]));
    expect(out.ok).toBe(true);
    const pending = out.state!.turnState.pendingReaction!;
    expect(pending.type).toBe('pick-casualties');
    expect(pending.promptingPlayerId).toBe(HOST);
    expect(dataOf(out.state!).after.kind).toBe('strike-back');
    expect(aliveIds(out.state!, 'h1')).toHaveLength(4);
    expect(out.logEntry?.dice?.outcome.pushedBack).toBe(false);
    expect(unitOf(out.state!, 'g1').status).toContain('fatigued');

    // The defender cannot pick the charger's casualties
    expect(validateAction(out.state!, pickAction(GUEST, 'h1', ['h1-m0', 'h1-m1'])).valid).toBe(false);
    const done = applyAction(out.state!, pickAction(HOST, 'h1', ['h1-m0', 'h1-m3']));
    expect(done.ok).toBe(true);
    expect(aliveIds(done.state!, 'h1')).toEqual(['h1-m1', 'h1-m2']);
    expect(done.state!.turnState.pendingReaction ?? null).toBeNull();
    // Both units survived, so they stepped apart
    expect(done.logEntry?.dice?.outcome.pushedBack).toBe(true);
    expect(unitOf(done.state!, 'h1').status).not.toContain('engaged');
  });

  it('a charge strike that leaves the defender unable to strike back steps back right after the pick', () => {
    const state = meleeSetup();
    unitOf(state, 'g1').weapons = [weapon('rifle')];
    const charged = applyAction(state, chargeAction(state), undefined).state!;
    const auto = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: charged.turnState.pendingReaction!.id,
      choiceId: 'auto-pile-in',
    });
    const struck = applyAction(charged, auto, diceFor(getDiceSpecs(charged, auto)!, [1])).state!;
    expect(struck.turnState.pendingReaction?.type).toBe('pick-casualties');
    const done = applyAction(struck, autoAction(struck, GUEST));
    expect(done.ok).toBe(true);
    expect(done.state!.turnState.pendingReaction ?? null).toBeNull();
    expect(done.logEntry?.dice?.outcome.pushedBack).toBe(true);
  });

  it('a fight (no charge) also stops at the defender\'s pick', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]]),
      mkUnit('g1', GUEST, [[0, 1], [1, 1], [2, 1], [3, 1]]),
    ]);
    for (const u of state.units) u.status.push('engaged');
    const fight = createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId: 'blade' } as any);
    expect(validateAction(state, fight)).toEqual({ valid: true });
    const out = resolve(state, fight, [2]);
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).toBe('pick-casualties');
    expect(dataOf(out.state!).after.kind).toBe('fight');
    const done = applyAction(out.state!, pickAction(GUEST, 'g1', ['g1-m0', 'g1-m1'])).state!;
    expect(aliveIds(done, 'g1')).toEqual(['g1-m2', 'g1-m3']);
    expect(done.turnState.pendingReaction ?? null).toBeNull();
  });
});
