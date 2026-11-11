import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, DiceSpec, GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { BLAST_SPLIT_AUTO_CHOICE, type BlastSplitData } from '../../src/engine/blastSplit';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });

function weapon(id: string, attacks?: number): Weapon {
  const base = WEAPONS[id];
  return { ...base, profile: { ...base.profile, ...(attacks ? { attacks } : {}) } };
}

/** A unit of `count` models in a row starting at (x, z), 1" apart. */
function mkUnit(id: string, owner: string, x: number, z: number, opts: { count?: number; weapons?: Weapon[] } = {}): Unit {
  const count = opts.count ?? 1;
  return {
    id,
    ownerId: owner,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: P(x + (count - 1) / 2, z),
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: count,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      wounds: 1,
      maxWounds: 1,
      isDestroyed: false,
      position: P(x + i, z),
      rotation: { x: 0, y: 0, z: 0 },
    })),
    weapons: opts.weapons ?? [weapon('rifle')],
    specialRules: [],
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
  state.turnState.activeUnitId = units[0].id;
  units[0].isActivated = true;
  return state;
}

const unitOf = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

const shootAt = (allocations: Array<{ weaponId: string; targetId: string }>) =>
  createAction(HOST, 'shoot', {
    type: 'shoot',
    attackerId: 'h1',
    targetId: allocations[0].targetId,
    weaponId: allocations[0].weaponId,
    allocations,
  });

/** Answer every requested die: to-hit dice show `toHit`, every other batch shows `fill` (1 fails any Defense). */
function fire(state: GameState, action: ReturnType<typeof shootAt>, toHit: number[], fill = 1) {
  const specs: DiceSpec[] = getDiceSpecs(state, action) ?? [];
  const dice = specs.map((s) => roll(s.purpose, s.purpose.endsWith('to-hit') ? toHit : Array(s.count).fill(fill)));
  return applyAction(state, action, dice);
}

const split = (state: GameState, splits: number[][], actorId = GUEST) =>
  createAction(actorId, 'blast-split', { type: 'blast-split', splits });

const autoAnswer = (state: GameState) => {
  const r = state.turnState.pendingReaction!;
  return createAction(r.promptingPlayerId, 'respond-reaction', {
    type: 'respond-reaction',
    reactionId: r.id,
    choiceId: BLAST_SPLIT_AUTO_CHOICE,
  });
};

/** h1 (1 model, frag launcher, 1 attack: one hit = 3 Blast hits) shoots g1; g2 stands 2" behind it. */
const twoUnits = (g1Models = 5, g2Models = 5) =>
  mkState([
    mkUnit('h1', HOST, 0, 0, { weapons: [weapon('frag-launcher')] }),
    mkUnit('g1', GUEST, 0, 10, { count: g1Models }),
    mkUnit('g2', GUEST, 0, 13, { count: g2Models }),
  ]);

const FRAG = [{ weaponId: 'frag-launcher', targetId: 'g1' }];

describe('Blast split prompt: when it appears', () => {
  it('a lone eligible unit resolves at once, no prompt', () => {
    const state = mkState([mkUnit('h1', HOST, 0, 0, { weapons: [weapon('frag-launcher')] }), mkUnit('g1', GUEST, 0, 10, { count: 5 })]);
    const out = fire(state, shootAt(FRAG), [5]);
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).not.toBe('blast-split');
    expect(out.logEntry!.dice!.outcome.blastSplits![0].shares).toHaveLength(1);
  });

  it('a unit within 3" of the target pauses the shot for the target owner, with nothing resolved yet', () => {
    const state = twoUnits();
    const out = fire(state, shootAt(FRAG), [5]);
    expect(out.ok).toBe(true);
    const s = out.state!;
    const pending = s.turnState.pendingReaction!;
    expect(pending.type).toBe('blast-split');
    expect(pending.promptingPlayerId).toBe(GUEST);
    expect(pending.options.map((o) => o.id)).toEqual([BLAST_SPLIT_AUTO_CHOICE]);
    const data = pending.data as unknown as BlastSplitData;
    expect(data.blasts).toHaveLength(1);
    expect(data.blasts[0]).toMatchObject({ totalHits: 3, auto: [2, 1] });
    expect(data.blasts[0].participants.map((p) => p.unitId)).toEqual(['g1', 'g2']);
    // The shot has not been resolved: no wounds, the shooter has not attacked, the pause is logged without dice
    expect(unitOf(s, 'g1').wounds).toBe(5);
    expect(unitOf(s, 'g2').wounds).toBe(5);
    expect(unitOf(s, 'h1').hasAttacked).toBeFalsy();
    expect(out.logEntry!.dice).toBeUndefined();
    // The reaction is plain data
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending);
  });

  it('no prompt when no hit lands (nothing to split)', () => {
    const out = fire(twoUnits(), shootAt(FRAG), [1]);
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).not.toBe('blast-split');
    expect(unitOf(out.state!, 'h1').hasAttacked).toBe(true);
  });

  it('only the defender may answer, and the shooter cannot act meanwhile', () => {
    const paused = fire(twoUnits(), shootAt(FRAG), [5]).state!;
    expect(validateAction(paused, split(paused, [[2, 1]], HOST)).valid).toBe(false);
    expect(validateAction(paused, createAction(HOST, 'end-activation', { type: 'end-activation' })).valid).toBe(false);
    expect(validateAction(paused, split(paused, [[2, 1]])).valid).toBe(true);
  });
});

describe('Blast split prompt: the defender answers', () => {
  it('Auto split resolves the shot exactly as the old automatic split did', () => {
    const paused = fire(twoUnits(), shootAt(FRAG), [5]).state!;
    const out = applyAction(paused, autoAnswer(paused));
    expect(out.ok).toBe(true);
    const s = out.state!;
    expect(s.turnState.pendingReaction?.type).not.toBe('blast-split');
    const record = out.logEntry!.dice!.outcome.blastSplits![0];
    expect(record.shares.map((x) => x.hits)).toEqual([2, 1]);
    expect(out.logEntry!.dice!.outcome.blastSplash![0]).toMatchObject({ targetId: 'g2', hitCount: 1 });
    expect(unitOf(s, 'h1').hasAttacked).toBe(true);
  });

  it('a custom split goes where the defender put it (not even), and each unit rolls its own Defense', () => {
    const paused = fire(twoUnits(), shootAt(FRAG), [5], 1).state!;
    // All 3 hits on the neighbour: g1 takes none
    const out = applyAction(paused, split(paused, [[0, 3]]));
    expect(out.ok).toBe(true);
    const outcome = out.logEntry!.dice!.outcome;
    expect(outcome.blastSplits![0].shares.map((x) => x.hits)).toEqual([0, 3]);
    expect(outcome.hitCount).toBe(0);
    expect(outcome.blastSplash![0]).toMatchObject({ targetId: 'g2', hitCount: 3, wounds: 3 });
    expect(outcome.blastSplash![0].defenseRolls).toHaveLength(3);
    expect(unitOf(out.state!, 'g1').wounds).toBe(5);
    // 3 failed saves on a squad that survives: its owner picks the casualties before the shot finishes
    const pick = out.state!.turnState.pendingReaction!;
    expect(pick.type).toBe('pick-casualties');
    expect(pick.targetUnitId).toBe('g2');
  });

  it('the answer carries the shot dice, so the log entry shows the roll (the pause itself shows none)', () => {
    const paused = fire(twoUnits(), shootAt(FRAG), [5]).state!;
    const out = applyAction(paused, split(paused, [[3, 0]]));
    const dice = out.logEntry!.dice!;
    expect(dice.context.attackerId).toBe('h1');
    expect(dice.results.some((r) => r.purpose === 'to-hit')).toBe(true);
    expect(dice.outcome.blastSplits![0].shares.map((x) => x.hits)).toEqual([3, 0]);
  });

  it('the timeout fallback (respond-reaction with the auto choice) is accepted from the prompted player', () => {
    const paused = fire(twoUnits(), shootAt(FRAG), [5]).state!;
    expect(validateAction(paused, autoAnswer(paused)).valid).toBe(true);
  });

  it('the shot then carries on to the usual casualty pick and ends cleanly', () => {
    const paused = fire(twoUnits(), shootAt(FRAG), [5]).state!;
    let s = applyAction(paused, autoAnswer(paused)).state!;
    while (s.turnState.pendingReaction) {
      const r = s.turnState.pendingReaction;
      expect(r.type).toBe('pick-casualties');
      s = applyAction(
        s,
        createAction(r.promptingPlayerId, 'respond-reaction', { type: 'respond-reaction', reactionId: r.id, choiceId: 'auto-pick-casualties' })
      ).state!;
    }
    expect(unitOf(s, 'g1').models.filter((m) => !m.isDestroyed)).toHaveLength(3);
    expect(unitOf(s, 'g2').models.filter((m) => !m.isDestroyed)).toHaveLength(4);
  });
});

describe('Blast split prompt: host validation of a custom split', () => {
  // 5 + 5 models, 3 hits: all 3 must be assigned, at most 5 per unit
  const paused = () => fire(twoUnits(), shootAt(FRAG), [5]).state!;

  it.each([
    ['too few hits assigned', [[1, 1]]],
    ['too many hits assigned', [[2, 2]]],
    ['a negative count', [[4, -1]]],
    ['a fractional count', [[1.5, 1.5]]],
    ['the wrong number of units', [[3]]],
    ['the wrong number of weapons', [[2, 1], [2, 1]]],
  ])('rejects %s', (_name, splits) => {
    const state = paused();
    expect(validateAction(state, split(state, splits as number[][])).valid).toBe(false);
    expect(applyAction(state, split(state, splits as number[][])).ok).toBe(false);
  });

  it('accepts any split that assigns every hit within the caps, even a lopsided one', () => {
    const state = paused();
    for (const row of [[3, 0], [0, 3], [1, 2], [2, 1]]) {
      expect(validateAction(state, split(state, [row])).valid).toBe(true);
    }
  });

  it('rejects a unit over its cap (one hit per living model)', () => {
    // g2 has one living model: it can take 1 hit at most
    const state = fire(twoUnits(5, 1), shootAt(FRAG), [5]).state!;
    expect(validateAction(state, split(state, [[1, 2]])).valid).toBe(false);
    expect(validateAction(state, split(state, [[2, 1]])).valid).toBe(true);
  });

  it('when the caps cannot take every hit, only the assignable hits are required', () => {
    // 6 Blast hits (2 hits x 3) but 2 + 2 models: 4 can land
    const state = mkState([
      mkUnit('h1', HOST, 0, 0, { count: 2, weapons: [weapon('frag-launcher')] }),
      mkUnit('g1', GUEST, 0, 10, { count: 2 }),
      mkUnit('g2', GUEST, 0, 13, { count: 2 }),
    ]);
    const paused2 = fire(state, shootAt(FRAG), [5, 5]).state!;
    const data = paused2.turnState.pendingReaction!.data as unknown as BlastSplitData;
    expect(data.blasts[0].totalHits).toBe(6);
    expect(validateAction(paused2, split(paused2, [[2, 2]])).valid).toBe(true);
    expect(validateAction(paused2, split(paused2, [[1, 2]])).valid).toBe(false);
    const out = applyAction(paused2, split(paused2, [[2, 2]]));
    expect(out.logEntry!.dice!.outcome.blastSplits![0]).toMatchObject({ totalHits: 6, lostHits: 2 });
  });

  it('rejects a split with no pending prompt', () => {
    const state = twoUnits();
    expect(validateAction(state, split(state, [[2, 1]])).valid).toBe(false);
  });
});

describe('Blast split prompt: several Blast weapons in one salvo', () => {
  it('asks for one combined prompt with a split per weapon, and resolves them together', () => {
    const state = mkState([
      mkUnit('h1', HOST, 0, 0, { weapons: [weapon('frag-launcher'), weapon('trench-mortar')] }),
      mkUnit('g1', GUEST, 0, 10, { count: 5 }),
      mkUnit('g2', GUEST, 0, 13, { count: 5 }),
    ]);
    const action = shootAt([
      { weaponId: 'frag-launcher', targetId: 'g1' },
      { weaponId: 'trench-mortar', targetId: 'g1' },
    ]);
    const paused = fire(state, action, [5]).state!;
    const data = paused.turnState.pendingReaction!.data as unknown as BlastSplitData;
    expect(data.blasts.map((b) => b.allocIndex)).toEqual([0, 1]);
    // One row per weapon is required
    expect(validateAction(paused, split(paused, [[2, 1]])).valid).toBe(false);
    const out = applyAction(paused, split(paused, [[3, 0], [0, 3]]));
    expect(out.ok).toBe(true);
    const records = out.logEntry!.dice!.outcome.blastSplits!;
    expect(records.map((r) => r.shares.map((x) => x.hits))).toEqual([[3, 0], [0, 3]]);
  });
});
