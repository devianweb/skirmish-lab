import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { pushBackChargerModels, validateSquadCoherency } from '../../src/engine/spatial';
import { findJumpOption } from '../../src/engine/traversal';
import { livingModelPositions, modelGap } from '../../src/engine/unitGeometry';
import { closestApproach } from '../../src/engine/closestApproach';

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

function chargeAction(
  positions: Vector3[],
  paths?: Vector3[][],
  extra: Record<string, unknown> = {},
  type: 'charge' | 'charge-leg' = 'charge'
) {
  return createAction(HOST, type, {
    type,
    attackerId: 'h1',
    ...(type === 'charge' ? { targetId: 'g1', weaponId: 'blade' } : {}),
    path: [P(0, 0), positions[0]],
    modelPositions: positions,
    ...(paths ? { modelPaths: paths } : {}),
    ...extra,
  } as any);
}

/** Each model walks straight from where it stands. */
const straight = (state: GameState, ends: Vector3[]) => startsOf(state).map((s, i) => [s, ends[i]]);

// 4-model line abreast at z = 0 (charge reach 8"), a 3-model squad 9" away.
function lineAbreast(): GameState {
  return mkState([
    mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]]),
    mkUnit('g1', GUEST, [[0, 9], [1, 9], [0.5, 10]]),
  ]);
}

describe('squad charge: each model moves', () => {
  it('accepts models in contact plus models that can only get as close as their allowance lets them', () => {
    const state = lineAbreast();
    // Models 0 and 1 stop in base contact (8"); models 2 and 3 are as close as 8" gets them
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const action = chargeAction(ends, straight(state, ends));
    expect(validateAction(state, action)).toEqual({ valid: true });

    const out = applyAction(state, action, meleeDice());
    expect(out.ok).toBe(true);
    const h1 = out.state!.units[0];
    expect(h1.models.map((m) => m.position)).toEqual(ends);
    expect(h1.position).toEqual({ x: 1.5, y: 0, z: 8 });
    expect(h1.hasAttacked).toBe(true);
    expect(h1.status).toContain('engaged');
  });

  it('rejects a charge where no model reaches base contact', () => {
    const state = lineAbreast();
    const ends = [P(0, 6), P(1, 6), P(2, 6), P(3, 6)];
    const res = validateAction(state, chargeAction(ends, straight(state, ends)));
    expect(res).toEqual({ valid: false, reason: 'Charge must end in engagement range' });
  });

  it('rejects a model whose own path is longer than the charge distance', () => {
    const state = lineAbreast();
    // Model 3 detours: 3" sideways then 8" forward = 11" > 8"
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(6, 8)];
    const paths = straight(state, ends);
    paths[3] = [P(3, 0), P(6, 0), P(6, 8)];
    const res = validateAction(state, chargeAction(ends, paths));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/model 4/i);
  });

  it('accepts a longer winding path when it stays inside the charge distance', () => {
    const state = lineAbreast();
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const paths = straight(state, ends);
    paths[3] = [P(3, 0), P(3, 4), P(3, 8)];
    expect(validateAction(state, chargeAction(ends, paths)).valid).toBe(true);
  });

  it('rejects a model that ends farther from the target than it started', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0], [1, 0]]), mkUnit('g1', GUEST, [[0, 2]])]);
    const ok = [P(0, 1), P(1, 1)];
    expect(validateAction(state, chargeAction(ok, straight(state, ok))).valid).toBe(true);
    const away = [P(0, 1), P(1, -0.5)];
    const res = validateAction(state, chargeAction(away, straight(state, away)));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/model 2 .*closer/i);
  });

  it('rejects ending out of coherency', () => {
    const state = lineAbreast();
    const ends = [P(0, 8), P(1, 8), P(2, 3), P(3, -3)];
    const res = validateAction(state, chargeAction(ends, straight(state, ends)));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/coherency|nearest squad member|spread/i);
  });

  it('uses the split-level coherency link (3" across levels) that the charge end relies on', () => {
    expect(validateSquadCoherency([P(0, 0, 0), P(0, 3, 3)]).coherent).toBe(true);
    expect(validateSquadCoherency([P(0, 0, 0), P(0, 3, 0)]).coherent).toBe(false);
  });

  it('requires one position per living model', () => {
    const state = lineAbreast();
    const res = validateAction(state, chargeAction([P(0, 8), P(1, 8), P(2, 8)]));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/count mismatch/i);
  });

  it('rejects a model path that does not start where the model stands', () => {
    const state = lineAbreast();
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const paths = straight(state, ends);
    paths[1] = [P(1, 1), P(1, 8)];
    expect(validateAction(state, chargeAction(ends, paths)).reason).toMatch(/model 2 .*start/i);
  });

  it('never moves a model through a target model', () => {
    const state = lineAbreast();
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const paths = straight(state, ends);
    paths[1] = [P(1, 0), P(1, 9), P(1, 8)];
    expect(validateAction(state, chargeAction(ends, paths)).valid).toBe(false);
  });

  it('keeps the 1" rule against a third unit, ignoring it only toward the target', () => {
    const state = lineAbreast();
    state.units.push(mkUnit('g2', GUEST, [[6, 5]]));
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    expect(validateAction(state, chargeAction(ends, straight(state, ends))).valid).toBe(true);
    const paths = straight(state, ends);
    paths[3] = [P(3, 0), P(5.2, 5), P(3, 8)];
    expect(validateAction(state, chargeAction(ends, paths)).valid).toBe(false);
  });

  it('rejects ending on top of a target model', () => {
    const state = lineAbreast();
    const ends = [P(0, 9), P(1, 8), P(2, 8), P(3, 8)];
    expect(validateAction(state, chargeAction(ends, straight(state, ends))).valid).toBe(false);
  });

  it('rejects a charge payload aimed at a different target than the declared one', () => {
    const state = lineAbreast();
    state.units.push(mkUnit('g2', GUEST, [[20, 20]]));
    const declared = applyAction(state, createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' })).state!;
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const wrong = chargeAction(ends, straight(declared, ends), { targetId: 'g2' });
    expect(validateAction(declared, wrong).valid).toBe(false);
  });
});

describe('squad charge: who strikes, pile-in', () => {
  it('only models within 2" (base edge) of a target model roll attacks, pooled', () => {
    const state = mkState([
      mkUnit('h1', HOST, [[0, 3.5], [0, 2.5], [0, 1.5], [0, 0.5]], { speed: 3 }),
      mkUnit('g1', GUEST, [[0, 10]]),
    ]);
    // Charge distance 6": the column closes up as far as each model's own walk allows
    const ends = [P(0, 9), P(0, 8), P(0, 7), P(0, 6)]; // gaps to the target: 0", 1", 2", 3"
    const action = chargeAction(ends, straight(state, ends));
    expect(validateAction(state, action).valid).toBe(true);
    // 3 models within 2" x 2 blade attacks
    expect(getDiceSpecs(state, action)?.find((s) => s.purpose === 'to-hit')?.count).toBe(6);
    const out = applyAction(state, action, meleeDice());
    expect(out.ok).toBe(true);
    expect(out.logEntry?.dice?.outcome.attackCount).toBe(6);
  });

  it('defenders not in contact pile in up to 3" toward the charger', () => {
    const state = lineAbreast();
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const out = applyAction(state, chargeAction(ends, straight(state, ends)), meleeDice());
    expect(out.ok).toBe(true);
    const g1 = out.state!.units.find((u) => u.id === 'g1')!;
    const rear = g1.models[2].position!;
    expect(rear.z).toBeLessThan(10);
    expect(Math.hypot(rear.x - 0.5, rear.z - 10)).toBeLessThanOrEqual(3.001);
  });
});

describe('squad charge: step back after melee', () => {
  const decline = (state: GameState) =>
    createAction(GUEST, 'respond-reaction', {
      reactionId: state.turnState.pendingReaction!.id,
      choiceId: 'decline',
    });

  it('moves each charging model back to at least 1" from every enemy model, staying coherent', () => {
    const state = lineAbreast();
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const charged = applyAction(state, chargeAction(ends, straight(state, ends)), meleeDice());
    expect(charged.ok).toBe(true);
    const next = charged.state!;
    const done = applyAction(next, decline(next));
    expect(done.reason).toBeUndefined();
    const h1 = done.state!.units.find((u) => u.id === 'h1')!;
    const g1 = done.state!.units.find((u) => u.id === 'g1')!;
    for (const a of livingModelPositions(h1)) {
      for (const b of livingModelPositions(g1)) {
        expect(modelGap(a, b)).toBeGreaterThanOrEqual(0.99);
      }
    }
    expect(validateSquadCoherency(livingModelPositions(h1)).coherent).toBe(true);
    expect(h1.status).not.toContain('engaged');
  });

  it('moves the models that are too close and leaves clear ones alone', () => {
    const charger = mkUnit('h1', HOST, [[0, 0], [1, 0], [2, -1.5]]);
    const foe = mkUnit('g1', GUEST, [[0, 1], [1, 1]]);
    const state = mkState([charger, foe]);
    const before = livingModelPositions(charger);
    pushBackChargerModels(state, charger, foe);
    const after = livingModelPositions(charger);
    for (const a of after) for (const b of livingModelPositions(foe)) expect(modelGap(a, b)).toBeGreaterThanOrEqual(0.99);
    expect(after[0].z).toBeLessThan(before[0].z);
    expect(after[1].z).toBeLessThan(before[1].z);
    expect(validateSquadCoherency(after).coherent).toBe(true);
  });

  it('a model already 1" or more away stays where it is', () => {
    const charger = mkUnit('h1', HOST, [[0, 0], [1.2, -0.6]]);
    const foe = mkUnit('g1', GUEST, [[0, 1]]);
    const state = mkState([charger, foe]);
    const clear = { ...charger.models[1].position! };
    pushBackChargerModels(state, charger, foe);
    expect(charger.models[0].position!.z).toBeCloseTo(-1, 1);
    expect(charger.models[1].position).toEqual(clear);
  });

  it('single models still step straight back to a 1" gap', () => {
    const charger = mkUnit('h1', HOST, [[0, 0]]);
    const foe = mkUnit('g1', GUEST, [[0, 1]]);
    const state = mkState([charger, foe]);
    const anchor = pushBackChargerModels(state, charger, foe);
    expect(charger.models[0].position!.x).toBeCloseTo(0, 2);
    expect(charger.models[0].position!.z).toBeCloseTo(-1, 2);
    expect(anchor.z).toBeCloseTo(-1, 2);
    expect(charger.position.z).toBeCloseTo(-1, 2);
  });
});

describe('squad charge in legs', () => {
  const begin = () => createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' });

  it('walks every model in a leg, spends the shared budget, then closes into contact', () => {
    const state = lineAbreast();
    const declared = applyAction(state, begin());
    expect(declared.ok).toBe(true);
    expect(declared.state!.units[0].remainingMovement).toBe(8);

    const legEnds = [P(0, 4), P(1, 4), P(2, 4), P(3, 4)];
    const leg = chargeAction(legEnds, straight(state, legEnds), {}, 'charge-leg');
    expect(validateAction(declared.state!, leg)).toEqual({ valid: true });
    const afterLeg = applyAction(declared.state!, leg);
    expect(afterLeg.ok).toBe(true);
    const h1 = afterLeg.state!.units[0];
    expect(h1.models.map((m) => m.position)).toEqual(legEnds);
    expect(h1.remainingMovement).toBe(4);
    expect(afterLeg.state!.turnState.charge?.legs).toBe(1);

    // Final move: 4" left, contact at z = 8
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    const final = chargeAction(ends, legEnds.map((s, i) => [s, ends[i]]));
    expect(validateAction(afterLeg.state!, final)).toEqual({ valid: true });
    const done = applyAction(afterLeg.state!, final, meleeDice());
    expect(done.ok).toBe(true);
    expect(done.state!.turnState.charge).toBeNull();
    expect(done.state!.units[0].hasAttacked).toBe(true);
  });

  it('the final move cannot use more than the legs left', () => {
    const state = lineAbreast();
    const declared = applyAction(state, begin()).state!;
    const legEnds = [P(0, 5), P(1, 5), P(2, 5), P(3, 5)];
    const afterLeg = applyAction(declared, chargeAction(legEnds, straight(state, legEnds), {}, 'charge-leg')).state!;
    const ends = [P(0, 9), P(1, 8), P(2, 8), P(3, 8)];
    expect(validateAction(afterLeg, chargeAction(ends, legEnds.map((s, i) => [s, ends[i]]))).valid).toBe(false);
  });

  it('a leg must keep the squad coherent and stay inside the remaining charge', () => {
    const declared = applyAction(lineAbreast(), begin()).state!;
    const split = [P(0, 4), P(1, 4), P(2, -3), P(3, -3)];
    expect(validateAction(declared, chargeAction(split, straight(declared, split), {}, 'charge-leg')).valid).toBe(false);
    const far = [P(0, 9), P(1, 9), P(2, 9), P(3, 9)];
    expect(validateAction(declared, chargeAction(far, straight(declared, far), {}, 'charge-leg')).valid).toBe(false);
  });

  it('a squad declares per-model jumps in a leg and rolls jump dice for the jumper only', () => {
    // Deck A: x -4..0, 4.5" up. The front model hops off its edge to the ground; the rear model walks up behind it
    const meta = TERRAIN_PALETTE_CATALOG['platform-small'];
    const deck = {
      id: 'deck-a',
      terrainType: 'platform-small',
      position: P(-2, 0),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { ...meta.defaultScale, y: 4.5 },
      blocksLineOfSight: meta.blocksLineOfSight,
      providesCover: meta.providesCover,
      isObstacle: meta.isObstacle,
      isWalkable: true,
    } as TerrainPiece;
    const state = mkState(
      [mkUnit('h1', HOST, [[-0.5, 0], [-1.5, 0]], { speed: 6 }), mkUnit('g1', GUEST, [[6, 0]])],
      [deck]
    );
    const h1 = state.units[0];
    for (const m of h1.models) m.position = { ...m.position!, y: 4.5 };
    h1.position = { ...h1.position, y: 4.5 };
    const option = findJumpOption(state, h1, P(-0.5, 0, 4.5), P(1.5, 0, 0));
    expect(option?.kind).toBe('jump-drop');
    const declared = applyAction(state, begin()).state!;
    const front = option!;
    const ends = [front.landing, P(-0.5, 0, 4.5)];
    const jumpLeg = chargeAction(
      ends,
      [front.path, [P(-1.5, 0, 4.5), P(-0.5, 0, 4.5)]],
      { modelTraversals: [{ kind: front.kind, takeoff: front.takeoff, landing: front.landing }, null] },
      'charge-leg'
    );
    expect(validateAction(declared, jumpLeg)).toEqual({ valid: true });
    const specs = getDiceSpecs(declared, jumpLeg) ?? [];
    expect(specs.some((s) => s.purpose === 'm0_drop_jump')).toBe(true);
    expect(specs.some((s) => s.purpose.startsWith('m1_'))).toBe(false);
    // An undeclared jump is still rejected
    const undeclared = chargeAction(ends, [front.path, [P(-1.5, 0, 4.5), P(-0.5, 0, 4.5)]], {}, 'charge-leg');
    expect(validateAction(declared, undeclared).valid).toBe(false);
  });
});

describe('squad charges must place every model (no block charges)', () => {
  const blockCharge = (type: 'charge' | 'charge-leg') =>
    createAction(HOST, type, {
      type,
      attackerId: 'h1',
      ...(type === 'charge' ? { targetId: 'g1', weaponId: 'blade' } : {}),
      path: [P(0, 0), P(0, 7)],
    } as any);

  it('rejects a charge from a 2+ model unit without modelPositions', () => {
    const res = validateAction(lineAbreast(), blockCharge('charge'));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/every model/);
  });

  it('rejects a charge-leg from a 2+ model unit without modelPositions', () => {
    const declared = applyAction(
      lineAbreast(),
      createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' })
    ).state!;
    const res = validateAction(declared, blockCharge('charge-leg'));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/every model/);
  });

  it('still accepts the same charge when every model is placed', () => {
    const state = lineAbreast();
    const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
    expect(validateAction(state, chargeAction(ends, straight(state, ends))).valid).toBe(true);
  });

  it('a unit down to one living model may still send a plain path', () => {
    const state = lineAbreast();
    state.units[0].models.slice(1).forEach((m) => (m.isDestroyed = true));
    state.units[0].speed = 6;
    state.units[0].remainingMovement = 6;
    const action = createAction(HOST, 'charge', {
      type: 'charge', attackerId: 'h1', targetId: 'g1', path: [P(0, 0), P(0, 7.5)], weaponId: 'blade',
    });
    expect(validateAction(state, action).reason ?? '').not.toMatch(/every model/);
  });
});

describe('single-model charges are unchanged', () => {
  it('a lone model charges with a plain path', () => {
    const state = mkState([mkUnit('h1', HOST, [[0, 0]], { speed: 6 }), mkUnit('g1', GUEST, [[0, 8]])]);
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [P(0, 0), P(0, 7)],
      weaponId: 'blade',
    });
    expect(validateAction(state, action).valid).toBe(true);
    const out = applyAction(state, action, meleeDice());
    expect(out.ok).toBe(true);
    expect(out.state!.units[0].models[0].position).toEqual(P(0, 7));
    const short = createAction(HOST, 'charge', {
      type: 'charge', attackerId: 'h1', targetId: 'g1', path: [P(0, 0), P(0, 5)], weaponId: 'blade',
    });
    expect(validateAction(state, short).reason).toBe('Charge must end in engagement range');
  });
});

describe('squad charge: as close as possible', () => {
  // Two chargers (charge distance 8") facing one defender: model 0 makes contact at z = 7.5
  const pair = () => mkState([mkUnit('h1', HOST, [[0, 0], [1, 0]]), mkUnit('g1', GUEST, [[0, 8.5]])]);

  it('rejects a model that holds back when it could walk up to the target', () => {
    const state = pair();
    const ends = [P(0, 7.5), P(1, 6.5)]; // model 2 is 1.2" short with open ground ahead
    const res = validateAction(state, chargeAction(ends, straight(state, ends)));
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('Model 2 could get closer to the target');
  });

  it('accepts a model within 0.5" of its best spot (0.4" short is fine)', () => {
    const state = pair();
    const ends = [P(0, 7.5), P(1, 7.5)];
    const best = closestApproach(state, state.units[0], 1, P(1, 0), 8, state.units[1], [ends[0]])!;
    const mine = modelGap(ends[1], P(0, 8.5));
    expect(mine - best.gap).toBeGreaterThan(0.2);
    expect(mine - best.gap).toBeLessThanOrEqual(0.5);
    expect(validateAction(state, chargeAction(ends, straight(state, ends)))).toEqual({ valid: true });
  });

  it('accepts a model standing exactly on its best spot', () => {
    const state = pair();
    const first = P(0, 7.5);
    const best = closestApproach(state, state.units[0], 1, P(1, 0), 8, state.units[1], [first])!;
    const ends = [first, best.position];
    expect(validateAction(state, chargeAction(ends, [straight(state, ends)[0], best.path]))).toEqual({ valid: true });
  });

  it('never requires a jump: a model on a high deck may stay up there', () => {
    const meta = TERRAIN_PALETTE_CATALOG['platform-small'];
    const deck = {
      id: 'deck-a',
      terrainType: 'platform-small',
      position: P(-2, 0),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { ...meta.defaultScale, y: 4.5 },
      blocksLineOfSight: meta.blocksLineOfSight,
      providesCover: meta.providesCover,
      isObstacle: meta.isObstacle,
      isWalkable: true,
    } as TerrainPiece;
    const state = mkState(
      [mkUnit('h1', HOST, [[1.5, 0], [-0.5, 0]], { speed: 6 }), mkUnit('g1', GUEST, [[3.5, 0]])],
      [deck]
    );
    const h1 = state.units[0];
    h1.models[1].position = P(-0.5, 0, 4.5);
    // Model 2 could only get nearer by leaping off the deck edge: it stays, model 1 makes contact
    const ends = [P(2.5, 0), P(-0.5, 0, 4.5)];
    expect(validateAction(state, chargeAction(ends, straight(state, ends)))).toEqual({ valid: true });
  });

  it('strike dice follow the resolved positions', () => {
    const state = pair();
    const ends = [P(0, 7.5), P(1, 7.5)]; // both within 2" of the target
    const action = chargeAction(ends, straight(state, ends));
    expect(getDiceSpecs(state, action)?.find((s) => s.purpose === 'to-hit')?.count).toBe(4);
    const out = applyAction(state, action, meleeDice());
    expect(out.ok).toBe(true);
    expect(out.logEntry?.dice?.outcome.attackCount).toBe(4);
  });

  it('charge legs have no closeness rule (only the final move does)', () => {
    const state = pair();
    const declared = applyAction(state, createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g1' })).state!;
    const leg = [P(0, 3), P(1, 3)];
    expect(validateAction(declared, chargeAction(leg, straight(declared, leg), {}, 'charge-leg'))).toEqual({ valid: true });
  });
});
