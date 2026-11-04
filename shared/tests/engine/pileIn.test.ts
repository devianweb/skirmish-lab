import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { validateSquadCoherency } from '../../src/engine/spatial';
import { livingModelPositions, modelGap, strikingModelCount } from '../../src/engine/unitGeometry';
import { PILE_IN_AUTO_CHOICE, pileInModelIds } from '../../src/engine/pileIn';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

function mkUnit(id: string, ownerId: string, spots: Array<[number, number]>, extra: Partial<Unit> = {}): Unit {
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
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 4,
    ...extra,
  };
}

function mkState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = 'h1';
  return state;
}

function piece(id: string, type: string, x: number, z: number, extra: Partial<TerrainPiece> = {}): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type as keyof typeof TERRAIN_PALETTE_CATALOG];
  return {
    id,
    terrainType: type,
    position: P(x, z),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...extra,
  } as TerrainPiece;
}

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

/** Always-hit, never-saved melee dice, plenty of them. */
const meleeDice = (n = 40): DiceResult[] => [
  roll('to-hit', Array(n).fill(1)),
  roll('defense', Array(n).fill(6)),
  roll('trauma', [1]),
];

const startsOf = (state: GameState, id = 'h1') => livingModelPositions(state.units.find((u) => u.id === id)!);

function chargeAction(state: GameState, ends: Vector3[]) {
  return createAction(HOST, 'charge', {
    type: 'charge',
    attackerId: 'h1',
    targetId: 'g1',
    weaponId: 'blade',
    path: [P(0, 0), ends[0]],
    modelPositions: ends,
    modelPaths: startsOf(state).map((s, i) => [s, ends[i]]),
  } as any);
}

function pileInAction(positions: Vector3[], actor = GUEST, paths?: Vector3[][]) {
  return createAction(actor, 'pile-in-move', {
    type: 'pile-in-move',
    modelPositions: positions,
    ...(paths ? { modelPaths: paths } : {}),
  } as any);
}

// 4-model line abreast at z = 0 (charge reach 8"), a 3-model squad 9" away.
function lineAbreast(): GameState {
  return mkState([
    mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]]),
    mkUnit('g1', GUEST, [[0, 9], [1, 9], [0.5, 10]]),
  ]);
}
const LINE_ENDS = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];

/** The state right after the line-abreast charge: g1's third model must pile in. */
function afterCharge(): GameState {
  const state = lineAbreast();
  const out = applyAction(state, chargeAction(state, LINE_ENDS), undefined);
  expect(out.ok).toBe(true);
  return out.state!;
}

const g1Of = (state: GameState) => state.units.find((u) => u.id === 'g1')!;
const h1Of = (state: GameState) => state.units.find((u) => u.id === 'h1')!;
const g1Positions = (state: GameState) => livingModelPositions(g1Of(state));
/** The defender's positions with only model 2 changed. */
const withThird = (state: GameState, p: Vector3) => g1Positions(state).map((q, i) => (i === 2 ? p : q));

describe('pile-in: the charge waits for the defender', () => {
  it('sets a 60 s pile-in prompt for the defender and rolls no strike dice yet', () => {
    const state = lineAbreast();
    const action = chargeAction(state, LINE_ENDS);
    // Nothing to roll yet: no jumps or hazards, and the strike waits for the pile-in
    expect(getDiceSpecs(state, action)).toBeNull();

    const out = applyAction(state, action, undefined);
    expect(out.ok).toBe(true);
    const next = out.state!;
    const reaction = next.turnState.pendingReaction!;
    expect(reaction.type).toBe('pile-in');
    expect(reaction.promptingPlayerId).toBe(GUEST);
    expect(reaction.sourceUnitId).toBe('h1');
    expect(reaction.targetUnitId).toBe('g1');
    expect(reaction.durationMs).toBe(60000);
    expect(reaction.data?.modelIds).toEqual(['g1-m2']);
    expect(reaction.data?.maxDistance).toBe(3);
    expect(reaction.options.find((o) => o.isDefault)?.id).toBe(PILE_IN_AUTO_CHOICE);

    // No attack yet: nobody is hurt, no attack dice are in the log, the defender has not moved
    expect(out.logEntry?.dice).toBeUndefined();
    expect(g1Of(next).models.filter((m) => !m.isDestroyed)).toHaveLength(3);
    expect(g1Positions(next)[2]).toEqual(P(0.5, 10));
    expect(h1Of(next).hasAttacked).toBe(true);
    expect(h1Of(next).models.map((m) => m.position)).toEqual(LINE_ENDS);
  });

  it('the attacker cannot act while the pile-in is pending, and neither can the defender do anything else', () => {
    const next = afterCharge();
    expect(validateAction(next, createAction(HOST, 'end-activation', { type: 'end-activation' } as any)).valid).toBe(false);
    expect(validateAction(next, createAction(HOST, 'pile-in-move', { type: 'pile-in-move', modelPositions: startsOf(next, 'g1') } as any)).valid).toBe(false);
    expect(validateAction(next, createAction(GUEST, 'end-activation', { type: 'end-activation' } as any)).valid).toBe(false);
  });

  it('accepts a valid placement, then rolls the strike counted from the new positions', () => {
    const next = afterCharge();
    const placement = withThird(next, P(2, 9));
    const action = pileInAction(placement, GUEST, [[P(0, 9)], [P(1, 9)], [P(0.5, 10), P(2, 9)]]);
    expect(validateAction(next, action)).toEqual({ valid: true });

    const specs = getDiceSpecs(next, action)!;
    const movedTarget = { position: g1Of(next).position, models: g1Of(next).models.map((m, i) => ({ ...m, position: placement[i] })) };
    const expectedStrikers = Math.max(1, strikingModelCount(h1Of(next), movedTarget));
    expect(specs.find((s) => s.purpose === 'to-hit')?.count).toBe(expectedStrikers * 2);

    const out = applyAction(next, action, meleeDice());
    expect(out.ok).toBe(true);
    expect(g1Positions(out.state!)[2]).toEqual(P(2, 9));
    expect(out.logEntry?.dice?.outcome.attackCount).toBe(expectedStrikers * 2);
    // The usual aftermath: a strike-back prompt for the defender
    const after = out.state!.turnState.pendingReaction;
    expect(after?.type).toBe('melee-retaliation');
    expect(after?.promptingPlayerId).toBe(GUEST);
  });

  it('counts strikers after the pile-in, not before (more chargers reach once a defender steps up)', () => {
    // A column charging a two-model squad: the second defender steps up beside the column and brings
    // the fourth charger within reach
    const state = mkState([
      mkUnit('h1', HOST, [[0, 3.5], [0, 2.5], [0, 1.5], [0, 0.5]], { speed: 3 }),
      mkUnit('g1', GUEST, [[0, 10], [1, 10.8]]),
    ]);
    const ends = [P(0, 9), P(0, 8), P(0, 7), P(0, 6)];
    const charge = chargeAction(state, ends);
    expect(validateAction(state, charge)).toEqual({ valid: true });
    const next = applyAction(state, charge, undefined).state!;
    expect(next.turnState.pendingReaction?.type).toBe('pile-in');
    const before = Math.max(1, strikingModelCount(h1Of(next), g1Of(next)));

    const stepUp = [P(0, 10), P(1, 8.4)];
    const action = pileInAction(stepUp);
    expect(validateAction(next, action)).toEqual({ valid: true });
    const attacks = getDiceSpecs(next, action)!.find((s) => s.purpose === 'to-hit')!.count;
    expect(before * 2).toBeLessThan(attacks);
  });
});

describe('pile-in: the host rejects bad placements', () => {
  const reason = (state: GameState, positions: Vector3[], actor = GUEST) => {
    const res = validateAction(state, pileInAction(positions, actor));
    expect(res.valid).toBe(false);
    return res.valid === false ? res.reason : '';
  };

  it('a model moved more than 3"', () => {
    const next = afterCharge();
    expect(reason(next, withThird(next, P(4.2, 9)))).toMatch(/too far/);
  });

  it('a model that is already in contact may not move', () => {
    const next = afterCharge();
    const positions = g1Positions(next).map((q, i) => (i === 0 ? P(q.x - 0.3, q.z) : i === 2 ? P(2, 9) : q));
    expect(reason(next, positions)).toMatch(/already in contact/);
  });

  it('a model left short of a contact spot it can reach', () => {
    const next = afterCharge();
    // Staying at (0.5, 10) leaves a 1" gap: a contact spot at (2, 9) is a short step away
    expect(reason(next, g1Positions(next))).toMatch(/could get closer/);
    // ... 0.3" short of the best spot is fine
    expect(validateAction(next, pileInAction(withThird(next, P(2, 9.3))))).toEqual({ valid: true });
  });

  it('a placement that breaks the chain is refused', () => {
    const next = afterCharge();
    const far = withThird(next, P(3.2, 8.9));
    expect(validateSquadCoherency(far).coherent).toBe(false);
    expect(validateAction(next, pileInAction(far)).valid).toBe(false);
  });

  it('a pile-in sent by the attacker (the wrong player)', () => {
    const next = afterCharge();
    expect(reason(next, withThird(next, P(2, 9)), HOST)).toMatch(/pending|Not your/);
  });

  it('a wrong number of positions', () => {
    const next = afterCharge();
    expect(reason(next, g1Positions(next).slice(0, 2))).toMatch(/count mismatch/);
  });

  it('a jump or long drop: no pile-in off a high deck', () => {
    const state = lineAbreast();
    // The third defender stands on a 3.5" deck, so the step down to the chargers is a long drop
    const deck = piece('deck', 'platform-small', 0.5, 10, {
      scale: { ...TERRAIN_PALETTE_CATALOG['platform-small'].defaultScale, x: 1.5, z: 1.5, y: 3.5 },
      isWalkable: true,
    });
    state.terrain = [deck];
    g1Of(state).models[2].position = P(0.5, 10, 3.5);
    const out = applyAction(state, chargeAction(state, LINE_ENDS), undefined);
    expect(out.reason).toBeUndefined();
    const next = out.state!;
    expect(next.turnState.pendingReaction?.type).toBe('pile-in');
    const res = validateAction(next, pileInAction(withThird(next, P(2, 9, 0))));
    expect(res.valid).toBe(false);
    expect(res.valid === false && res.reason).toMatch(/drop|jump/);
  });
});

describe('pile-in: timeout fallback (auto place)', () => {
  it('places the models with closestApproach and then resolves the strike', () => {
    const next = afterCharge();
    const auto = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: next.turnState.pendingReaction!.id,
      choiceId: PILE_IN_AUTO_CHOICE,
    });
    expect(validateAction(next, auto)).toEqual({ valid: true });
    const specs = getDiceSpecs(next, auto);
    expect(specs?.find((s) => s.purpose === 'to-hit')?.count).toBeGreaterThan(0);
    const out = applyAction(next, auto, meleeDice());
    expect(out.ok).toBe(true);
    const third = g1Positions(out.state!)[2];
    const gap = Math.min(...livingModelPositions(h1Of(out.state!)).map((c) => modelGap(third, c)));
    expect(gap).toBeLessThan(0.3);
    expect(Math.hypot(third.x - 0.5, third.z - 10)).toBeLessThanOrEqual(3.05);
    expect(validateSquadCoherency(g1Positions(out.state!)).coherent).toBe(true);
    expect(out.logEntry?.dice).toBeDefined();
    expect(out.state!.turnState.pendingReaction?.type).toBe('melee-retaliation');
  });

  it('never walks through a wall: a walled-off model stops on its own side, and the strike still resolves', () => {
    // A short wall between the third defender and the chargers (a detour round it costs more than 3")
    const state = mkState(
      [
        mkUnit('h1', HOST, [[-1, 0], [0, 0]]),
        mkUnit('g1', GUEST, [[-1, 7], [0, 7], [1, 7.2]]),
      ],
      [piece('w', 'wall-short', 1.5, 6.5, { scale: { ...TERRAIN_PALETTE_CATALOG['wall-short'].defaultScale, x: 2 } })]
    );
    const ends = [P(-1, 6), P(0, 6)];
    const charge = chargeAction(state, ends);
    const validity = validateAction(state, charge);
    expect(validity).toEqual({ valid: true });
    const next = applyAction(state, charge, undefined).state!;
    const reaction = next.turnState.pendingReaction;
    expect(reaction?.type).toBe('pile-in');
    const auto = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: reaction!.id,
      choiceId: PILE_IN_AUTO_CHOICE,
    });
    const out = applyAction(next, auto, meleeDice());
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).toBe('melee-retaliation');
    const third = g1Positions(out.state!)[2];
    const gap = Math.min(...livingModelPositions(h1Of(out.state!)).map((c) => modelGap(third, c)));
    expect(third.z).toBeGreaterThan(6.7); // still north of the wall
    expect(gap).toBeGreaterThan(0.25); // not in contact: the wall is in the way
  });
});

describe('pile-in: the host-placed result stays tidy', () => {
  it('moves only models that are not touching, up to 3" each, and keeps a coherent squad coherent', () => {
    const layouts: Array<Array<[number, number]>> = [
      [[0, 1], [1, 2.7], [1, 4.6], [1, 6.5]],
      [[0, 1], [-1.9, 1.2], [-3.8, 1.2], [-3.8, 3]],
      [[0, 1], [0, 2.9], [0, 4.8], [0, 6.7], [1.9, 6.7]],
    ];
    for (const spots of layouts) {
      const state = mkState([mkUnit('h1', HOST, [[0, -6]], { speed: 6 }), mkUnit('g1', GUEST, spots)]);
      expect(validateSquadCoherency(livingModelPositions(state.units[1])).coherent).toBe(true);
      const charged = applyAction(state, chargeAction(state, [P(0, 0)]), undefined);
      expect(charged.reason).toBeUndefined();
      const next = charged.state!;
      const before = g1Positions(next);
      const auto = createAction(GUEST, 'respond-reaction', {
        type: 'respond-reaction',
        reactionId: next.turnState.pendingReaction!.id,
        choiceId: PILE_IN_AUTO_CHOICE,
      });
      const out = applyAction(next, auto, meleeDice());
      expect(out.reason).toBeUndefined();
      const after = g1Positions(out.state!);
      expect(after[0]).toEqual(before[0]); // already touching: stays
      after.forEach((p, i) => expect(Math.hypot(p.x - before[i].x, p.z - before[i].z)).toBeLessThanOrEqual(3.05));
      expect(validateSquadCoherency(after).coherent).toBe(true);
    }
  });
});

describe('pile-in: nothing to place', () => {
  it('a single-model target resolves the strike at once, as before', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0]]),
      mkUnit('g1', GUEST, [[0.5, 9]]),
    ]);
    const ends = [P(0, 8), P(1, 8)];
    const action = chargeAction(state, ends);
    const specs = getDiceSpecs(state, action)!;
    expect(specs.find((s) => s.purpose === 'to-hit')?.count).toBe(4);
    const out = applyAction(state, action, meleeDice());
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).toBe('melee-retaliation');
    expect(out.logEntry?.dice?.outcome.attackCount).toBe(4);
  });

  it('a target already in contact all round resolves the strike at once, as before', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 0], [1, 0]]),
      mkUnit('g1', GUEST, [[0, 9], [1, 9]]),
    ]);
    const ends = [P(0, 8), P(1, 8)];
    expect(pileInModelIds(state.units[1], { ...state.units[0], models: state.units[0].models.map((m, i) => ({ ...m, position: ends[i] })) })).toEqual([]);
    const action = chargeAction(state, ends);
    const specs = getDiceSpecs(state, action)!;
    expect(specs.find((s) => s.purpose === 'to-hit')?.count).toBe(4);
    const out = applyAction(state, action, meleeDice());
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).toBe('melee-retaliation');
    expect(out.logEntry?.dice?.outcome.attackCount).toBe(4);
    expect(g1Positions(out.state!)).toEqual([P(0, 9), P(1, 9)]);
  });
});

describe('pile-in: state', () => {
  it('a pending pile-in survives a JSON round trip (reconnect) and can still be answered', () => {
    const next = afterCharge();
    const revived = JSON.parse(JSON.stringify(next)) as GameState;
    expect(revived.turnState.pendingReaction).toEqual(next.turnState.pendingReaction);
    const action = pileInAction(withThird(revived, P(2, 9)));
    expect(validateAction(revived, action)).toEqual({ valid: true });
    const out = applyAction(revived, action, meleeDice());
    expect(out.ok).toBe(true);
    expect(JSON.parse(JSON.stringify(out.state))).toEqual(out.state);
  });
});
