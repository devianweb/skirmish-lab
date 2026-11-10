import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameAction, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { KEEP_AWAY_REASON } from '../../src/engine/spatial';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(id: string, terrainType: string, pos: Vector3): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[terrainType];
  return {
    id,
    terrainType,
    position: pos,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

// Deck A spans x -4..0 and deck B x 1.5..5.5, both 3" high: a 1.5" gap between them.
const deckA = piece('deck-a', 'platform-small', P(-2, 0, 0));
const deckB = piece('deck-b', 'platform-small', P(3.5, 0, 0));
const takeoff = P(-0.5, 3, 0);
const landing = P(2.6, 3, 0);
const jump = { kind: 'jump-gap' as const, takeoff, landing };

function makeUnit(id: string, ownerId: string, position: Vector3, extra: Partial<Unit> = {}): Unit {
  return {
    id,
    ownerId,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: 3,
    maxWounds: 3,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models: [{ id: `${id}-m0`, wounds: 3, maxWounds: 3, isDestroyed: false, position: { ...position } }] as any,
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
    ...extra,
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
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

const begin = (targetId = 'g1') => createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId });
const leg = (path: Vector3[], traversal?: unknown) =>
  createAction(HOST, 'charge-leg', { type: 'charge-leg', attackerId: 'h1', path, ...(traversal ? { traversal } : {}) } as any);
const finalCharge = (path: Vector3[], targetId = 'g1') =>
  createAction(HOST, 'charge', { type: 'charge', attackerId: 'h1', targetId, path, weaponId: 'blade' });
const endActivation = () => createAction(HOST, 'end-activation', { type: 'end-activation' });

function ok(state: GameState, action: GameAction, dice?: DiceResult[]): GameState {
  const out = applyAction(state, action, dice);
  if (!out.ok) throw new Error(out.reason);
  return out.state!;
}

const meleeDice = (): DiceResult[] => [
  roll('to-hit', [1, 1]),
  roll('defense', [6, 6]),
];

/** Charger on deck A, enemy across the gap on deck B. */
function deckScenario(): GameState {
  return makeState(
    [makeUnit('h1', HOST, P(-3, 3, 0)), makeUnit('g1', GUEST, P(4.5, 3, 0))],
    [deckA, deckB]
  );
}

describe('split charge: declaring', () => {
  it('locks the target and gives the unit the full charge budget', () => {
    const state = deckScenario();
    expect(validateAction(state, begin())).toEqual({ valid: true });
    const next = ok(state, begin());
    expect(next.turnState.charge).toEqual({ unitId: 'h1', targetId: 'g1', legs: 0 });
    expect(next.units[0].remainingMovement).toBe(12);
    expect(next.units[0].hasMoved).toBe(false);
  });

  it('rejects a target beyond charge reach at the start', () => {
    const state = makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 20))]);
    expect(validateAction(state, begin())).toMatchObject({ valid: false, reason: 'Target out of charge range' });
  });

  it('accepts a target at exactly the charge reach and rejects one just beyond', () => {
    // the contact spot is 1" short of the target centre: a 12" reach means a target centre at 13"
    expect(validateAction(makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 13))]), begin()).valid).toBe(true);
    expect(validateAction(makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 13.2))]), begin()).valid).toBe(false);
  });

  it('cannot be declared after moving, or twice', () => {
    const moved = makeState([makeUnit('h1', HOST, P(0, 0, 0), { hasMoved: true }), makeUnit('g1', GUEST, P(0, 0, 8))]);
    expect(validateAction(moved, begin()).valid).toBe(false);
    const declared = ok(makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 8))]), begin());
    expect(validateAction(declared, begin())).toMatchObject({ valid: false });
  });

  it('a declared charge cannot become another action', () => {
    const state = ok(makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 8))]), begin());
    for (const type of ['advance', 'rush', 'shoot', 'fight', 'hold'] as const) {
      const a = createAction(HOST, type, {
        type,
        unitId: 'h1',
        attackerId: 'h1',
        targetId: 'g1',
        weaponId: 'blade',
        path: [P(0, 0, 0), P(0, 0, 2)],
        finalPosition: P(0, 0, 2),
      } as any);
      const res = validateAction(state, a);
      expect(res.valid, type).toBe(false);
      expect(res.reason, type).toMatch(/charge is declared/);
    }
  });

  it('the final charge is locked to the declared target', () => {
    const state = ok(
      makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 8)), makeUnit('g2', GUEST, P(6, 0, 0))]),
      begin()
    );
    const res = validateAction(state, finalCharge([P(0, 0, 0), P(5, 0, 0)], 'g2'));
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/locked/);
  });
});

describe('split charge: legs on the ground', () => {
  const flat = () =>
    ok(makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 10))]), begin());

  it('a leg spends the charge budget and keeps the declaration', () => {
    const state = ok(flat(), leg([P(0, 0, 0), P(0, 0, 5)]));
    expect(state.units[0].position).toMatchObject({ x: 0, z: 5 });
    expect(state.units[0].remainingMovement).toBe(7);
    expect(state.turnState.charge?.legs).toBe(1);
    expect(state.turnState.activeUnitId).toBe('h1');
  });

  it('legs plus the final move may not exceed the single charge budget', () => {
    let state = ok(flat(), leg([P(0, 0, 0), P(5, 0, 0)]));
    state = ok(state, leg([P(5, 0, 0), P(8, 0, 0)]));
    expect(state.units[0].remainingMovement).toBe(4);
    // 5 + 3 + 4 = 12 is fine
    expect(validateAction(state, leg([P(8, 0, 0), P(12, 0, 0)])).valid).toBe(true);
    // 4.5" would overspend by 0.5"
    expect(validateAction(state, leg([P(8, 0, 0), P(12.5, 0, 0)])).valid).toBe(false);
    // the final charge move is held to the same remainder: this one would need 7" more
    state.units[1] = makeUnit('g1', GUEST, P(8, 0, 8));
    expect(validateAction(state, finalCharge([P(8, 0, 0), P(8, 0, 7)])).valid).toBe(false);
    state.units[1] = makeUnit('g1', GUEST, P(8, 0, 5));
    expect(validateAction(state, finalCharge([P(8, 0, 0), P(8, 0, 4)])).valid).toBe(true);
  });

  it('a leg must start where the unit stands', () => {
    expect(validateAction(flat(), leg([P(1, 0, 1), P(1, 0, 3)])).valid).toBe(false);
  });

  it('a leg may not come within 1" of another enemy unit, but may approach the target', () => {
    const state = ok(
      makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 10)), makeUnit('g2', GUEST, P(3, 0, 5))]),
      begin()
    );
    const res = validateAction(state, leg([P(0, 0, 0), P(1.4, 0, 5)]));
    expect(res.valid).toBe(false);
    expect(res.reason).toBe(KEEP_AWAY_REASON);
    // a leg right up to the target is fine (the target is exempt)
    expect(validateAction(state, leg([P(0, 0, 0), P(0, 0, 9)])).valid).toBe(true);
  });

  it('a leg may not end on top of the target', () => {
    expect(validateAction(flat(), leg([P(0, 0, 0), P(0, 0, 10)])).valid).toBe(false);
  });

  it('legs need a declared charge', () => {
    const noCharge = makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 10))]);
    expect(validateAction(noCharge, leg([P(0, 0, 0), P(0, 0, 2)]))).toMatchObject({
      valid: false,
      reason: 'No charge is declared',
    });
  });

  it('legs then the final charge resolves melee and clears the declaration', () => {
    let state = ok(flat(), leg([P(0, 0, 0), P(0, 0, 6)]));
    const fin = finalCharge([P(0, 0, 6), P(0, 0, 9)]);
    expect(validateAction(state, fin)).toEqual({ valid: true });
    state = ok(state, fin, meleeDice());
    expect(state.turnState.charge).toBeNull();
    expect(state.units[0].position).toMatchObject({ z: 9 });
    expect(state.units[0].status).toContain('engaged');
    const entry = state.actionLog[state.actionLog.length - 1];
    expect(entry.dice?.outcome.attackCount).toBeGreaterThan(0);
  });

  it('a zero-length final move works when a leg already ended in contact range', () => {
    const state = ok(flat(), leg([P(0, 0, 0), P(0, 0, 9)]));
    expect(validateAction(state, finalCharge([P(0, 0, 9)])).valid).toBe(true);
  });

  it('the final move must still end in engagement range of the target', () => {
    const state = ok(flat(), leg([P(0, 0, 0), P(0, 0, 5)]));
    expect(validateAction(state, finalCharge([P(0, 0, 5), P(0, 0, 7)]))).toMatchObject({
      valid: false,
      reason: 'Charge must end in engagement range',
    });
  });

  it('abandoning ends the activation with no melee', () => {
    let state = ok(flat(), leg([P(0, 0, 0), P(0, 0, 5)]));
    expect(validateAction(state, endActivation()).valid).toBe(true);
    state = ok(state, endActivation());
    expect(state.turnState.charge).toBeNull();
    expect(state.turnState.activeUnitId).toBeNull();
    expect(state.units[0].status).not.toContain('engaged');
    expect(state.units[1].wounds).toBe(3);
    expect(state.units[0].position).toMatchObject({ z: 5 });
  });

  it('declaring and abandoning without a leg also ends cleanly', () => {
    const state = ok(flat(), endActivation());
    expect(state.turnState.charge).toBeNull();
    expect(state.turnState.activeUnitId).toBeNull();
  });
});

describe('split charge: jumping mid-charge', () => {
  const declared = () => ok(deckScenario(), begin());

  it('walk to the edge, jump (free), then make contact; melee resolves', () => {
    let state = declared();
    state = ok(state, leg([P(-3, 3, 0), takeoff])); // 2.5" walk
    expect(state.units[0].remainingMovement).toBeCloseTo(9.5, 5);

    const jumpLeg = leg([takeoff, landing], jump);
    expect(validateAction(state, jumpLeg)).toEqual({ valid: true });
    expect(getDiceSpecs(state, jumpLeg)?.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    expect(getDiceSpecs(state, jumpLeg)?.[0].count).toBe(4);
    state = ok(state, jumpLeg, [roll('jump', [3, 4, 2, 6])]);
    // a passed jump costs no movement
    expect(state.units[0].remainingMovement).toBeCloseTo(9.5, 5);
    expect(state.units[0].position).toMatchObject(landing);
    expect(state.turnState.activeUnitId).toBe('h1');
    const legEntry = state.actionLog[state.actionLog.length - 1];
    expect(legEntry.dice?.outcome.traversal?.[0]).toMatchObject({ type: 'gap-jump', passed: true });

    const fin = finalCharge([landing, P(3.5, 3, 0)]);
    expect(validateAction(state, fin)).toEqual({ valid: true });
    state = ok(state, fin, meleeDice());
    expect(state.units[0].status).toContain('engaged');
    expect(state.turnState.charge).toBeNull();
  });

  it('a failed jump falls, ends the activation and the charge, with no melee', () => {
    let state = declared();
    state = ok(state, leg([P(-3, 3, 0), takeoff]));
    state = ok(state, leg([takeoff, landing], jump), [roll('jump', [1, 1, 1, 1, 1]), roll('fall', [4, 4, 4])]);
    expect(state.units[0].position.y).toBe(0); // fell to the floor below
    expect(state.turnState.activeUnitId).toBeNull();
    expect(state.turnState.charge).toBeNull();
    expect(state.units[0].status).not.toContain('engaged');
    expect(state.units[1].wounds).toBe(3);
  });

  it('a jump leg without a declaration is rejected, and so is a declaration with no jump', () => {
    const state = ok(declared(), leg([P(-3, 3, 0), takeoff]));
    expect(validateAction(state, leg([takeoff, landing]))).toMatchObject({ valid: false });
    expect(validateAction(state, leg([takeoff, P(-1, 3, 0)], jump))).toMatchObject({ valid: false });
  });

  it('a jump not taken from the edge is rejected', () => {
    const state = declared(); // still at (-3, 3, 0), far from the edge
    const from = P(-3, 3, 0);
    expect(validateAction(state, leg([from, landing], { kind: 'jump-gap', takeoff: from, landing })).valid).toBe(false);
  });

  it('a single-click charge on open ground still works exactly as before', () => {
    const state = makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 8))]);
    const direct = finalCharge([P(0, 0, 0), P(0, 0, 7)]);
    expect(validateAction(state, direct)).toEqual({ valid: true });
    const next = ok(state, direct, meleeDice());
    expect(next.units[0].position).toMatchObject({ z: 7 });
    expect(next.units[0].status).toContain('engaged');
    expect(next.turnState.charge ?? null).toBeNull();
    // and it still cannot go beyond 12" in one move
    const farState = makeState([makeUnit('h1', HOST, P(0, 0, 0)), makeUnit('g1', GUEST, P(0, 0, 14))]);
    expect(validateAction(farState, finalCharge([P(0, 0, 0), P(0, 0, 13)]))).toMatchObject({ valid: false });
  });

  it('a declared jump inside a one-click charge rolls the same jump dice as a leg', () => {
    const state = deckScenario();
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [P(-3, 3, 0), takeoff, landing, P(3.5, 3, 0)],
      weaponId: 'blade',
      traversal: jump,
    } as any);
    expect(validateAction(state, action)).toEqual({ valid: true });
    expect(getDiceSpecs(state, action)?.map((s) => s.purpose).slice(0, 1)).toEqual(["jump"]);
  });
});
