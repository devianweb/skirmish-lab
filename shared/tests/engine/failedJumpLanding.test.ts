import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { findEndOverlap, isBaseOverhanging } from '../../src/engine/spatial';
import { applyAction, applyTraversalHazardsAndFalls, getDiceSpecs } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(id: string, terrainType: string, pos: Vector3, scaleY?: number): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[terrainType];
  return {
    id,
    terrainType,
    position: pos,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale, ...(scaleY !== undefined ? { y: scaleY } : {}) },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

function makeUnit(position: Vector3, models = 1, budget = 6): Unit {
  return {
    id: 'u',
    ownerId: HOST,
    armyId: 'army-1',
    unitType: 'trooper',
    name: 'u',
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: models > 1 ? models : 3,
    maxWounds: models > 1 ? models : 3,
    isActivated: true,
    isDestroyed: false,
    models: Array.from({ length: models }, (_, i) => ({
      id: `u-m${i}`,
      wounds: models > 1 ? 1 : 3,
      maxWounds: models > 1 ? 1 : 3,
      isDestroyed: false,
      position: { x: position.x, y: position.y, z: position.z + i * 0.2 },
    })) as any,
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: budget,
  };
}

const deckA = piece('deck-a', 'platform-small', P(-2, 0, 0)); // x -4..0, top 3
const deckB = piece('deck-b', 'platform-small', P(4, 0, 0)); // x 2..6, top 3
const takeoff = P(-0.3, 3, 0);
const landing = P(2.6, 3, 0); // 2" gap (x 0..2); a failed jump falls from the take-off spot

function makeState(unit: Unit, extra: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = [deckA, deckB, ...extra];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  return state;
}

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

const jumpAction = () =>
  createAction(HOST, 'advance', {
    type: 'advance',
    unitId: 'u',
    path: [takeoff, landing],
    finalPosition: landing,
    traversal: { kind: 'jump-gap', takeoff, landing },
  });

/** Declares the jump across the gap and fails it (all jump dice 1) with the given fall dice. */
function failJump(state: GameState, fallDice: number[]) {
  const out = applyAction(state, jumpAction(), [roll('jump', Array(3).fill(1)), roll('fall', fallDice)]);
  if (!out.ok) throw new Error(out.reason);
  const events = out.state.actionLog[out.state.actionLog.length - 1].dice!.outcome.traversal!;
  return { state: out.state, unit: out.state.units[0], events };
}

describe('failed gap jump: landing', () => {
  it('requests the jump roll (one die per started inch of the 2.9" hop) and the fall dice for a jump off a 3" deck', () => {
    const state = makeState(makeUnit(takeoff));
    const specs = getDiceSpecs(state, jumpAction())!;
    expect(specs.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    expect(specs[0].count).toBe(3);
    expect(specs[1].count).toBe(3);
  });

  it('a 3" fall to the ground rolls 3 dice, each 1-3 wounds, lands near the take-off and ends the activation', () => {
    const { state, unit, events } = failJump(makeState(makeUnit(takeoff)), [1, 3, 4]);
    expect(unit.position.y).toBe(0);
    expect(Math.hypot(unit.position.x - takeoff.x, unit.position.z - takeoff.z)).toBeLessThanOrEqual(2);
    expect(unit.wounds).toBe(1);
    const fall = events.find((e) => e.type === 'fall')!;
    expect(fall).toMatchObject({ wounds: 2, rolls: [1, 3, 4] });
    expect(fall.text).toMatch(/3\.0"/);
    expect(state.turnState.activeUnitId).not.toBe('u');
  });

  it('a fall whose dice all show 4+ reports 0 wounds, still lands on the floor and ends the activation', () => {
    const { state, unit, events } = failJump(makeState(makeUnit(takeoff)), [4, 5, 6]);
    expect(unit.wounds).toBe(3);
    expect(events.find((e) => e.type === 'fall')!.wounds).toBe(0);
    expect(unit.position.y).toBe(0);
    expect(state.turnState.activeUnitId).not.toBe('u');
  });

  it('a lower deck under the take-off is the landing floor, and a 2" fall rolls 2 dice', () => {
    const lower = piece('lower', 'platform-small', P(-0.3, 0, 0), 1); // top at 1": the fall is 2"
    const { unit, events } = failJump(makeState(makeUnit(takeoff), [lower]), [1, 1]);
    expect(unit.position.y).toBeCloseTo(1);
    const fall = events.find((e) => e.type === 'fall')!;
    expect(fall.text).toMatch(/2\.0" \(2 dice/);
    expect(fall.wounds).toBe(2);
  });

  it('a fall under 2" rolls no dice and takes no damage', () => {
    const lower = piece('lower', 'platform-small', P(-0.3, 0, 0), 1.5); // top at 1.5": a 1.5" fall
    const state = makeState(makeUnit(takeoff), [lower]);
    expect(getDiceSpecs(state, jumpAction())!.map((s) => s.purpose)).toEqual(['jump', 'morale']);
    const out = applyAction(state, jumpAction(), [roll('jump', [1, 1, 1])]);
    if (!out.ok) throw new Error(out.reason);
    const unit = out.state.units[0];
    expect(unit.position.y).toBeCloseTo(1.5);
    expect(unit.wounds).toBe(3);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a crate under the take-off: the model lands clear of it, within 2"', () => {
    const crate = piece("crate", "crate", P(-0.3, 0, 0));
    const { state, unit } = failJump(makeState(makeUnit(takeoff), [crate]), [4, 4, 4]);
    expect(unit.position.y).toBe(0);
    expect(findEndOverlap(state, 'u', unit.position)).toBeNull();
    expect(isBaseOverhanging(state, unit.position)).toBe(false);
    expect(Math.hypot(unit.position.x - takeoff.x, unit.position.z - takeoff.z)).toBeLessThanOrEqual(2);
  });
});

describe('failed jump-down: lands on the floor below', () => {
  it('a failed 4" jump-down falls 4" from the take-off to the ground, clear of terrain, rolling 4 fall dice', () => {
    const tall = piece('tall', 'platform-small', P(-2, 0, 0), 4);
    const from = P(-0.3, 4, 0);
    const to = P(1.0, 0, 0);
    const unit = makeUnit(from);
    const state = makeState(unit);
    state.terrain = [tall];
    const action = createAction(HOST, 'advance', {
      type: 'advance',
      unitId: 'u',
      path: [from, to],
      finalPosition: to,
      traversal: { kind: 'jump-drop', takeoff: from, landing: to },
    });
    const specs = getDiceSpecs(state, action)!;
    expect(specs.find((d) => d.purpose === 'jump')!.count).toBe(5); // a 4.2" hop
    expect(specs.find((d) => d.purpose === 'fall')!.count).toBe(4);
    const out = applyAction(state, action, [roll('jump', [1, 1, 1, 1, 1]), roll('fall', [1, 6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.position.y).toBe(0);
    expect(findEndOverlap(out.state, 'u', u.position)).toBeNull();
    expect(u.wounds).toBe(2);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });
});

describe('failed gap jump: squads', () => {
  it('the faller takes the wound as its casualty; the others stay where they were', () => {
    // Drives the traversal step directly (the declared-jump path is covered in squadDeclaredJumps.test.ts).
    const unit = makeUnit(takeoff, 3);
    unit.models[0].position = P(-1.5, 3, 0.5);
    unit.models[2].position = P(-1.5, 3, -0.5);
    unit.models[1].position = { ...takeoff }; // the jumper is the middle model
    const before = [unit.models[0].position!, unit.models[2].position!].map((p) => ({ ...p }));
    const state = makeState(unit);
    const u = state.units[0];
    const res = applyTraversalHazardsAndFalls(
      state,
      u,
      [takeoff, landing],
      jumpAction(),
      [roll('jump', [1, 1, 1]), roll('fall', [1, 6, 6])],
      u.models[1]
    );
    expect(res).toMatchObject({ terminated: true, wounds: 1 });
    expect(u.models[1].isDestroyed).toBe(true);
    expect(u.models[1].position).toMatchObject({ y: 0 });
    expect(u.models[0].isDestroyed).toBe(false);
    expect(u.models[2].isDestroyed).toBe(false);
    expect([u.models[0].position, u.models[2].position]).toEqual(before);
    expect(state.turnState.activeUnitId).not.toBe('u');
  });

  it('a fall whose dice all show 4+ leaves the faller alive on the floor below', () => {
    const unit = makeUnit(takeoff, 3);
    unit.models[1].position = { ...takeoff };
    const state = makeState(unit);
    const u = state.units[0];
    applyTraversalHazardsAndFalls(state, u, [takeoff, landing], jumpAction(), [roll('jump', [1, 1, 1]), roll('fall', [4, 5, 6])], u.models[1]);
    expect(u.models[1].isDestroyed).toBe(false);
    expect(u.models[1].position).toMatchObject({ y: 0 });
    expect(u.models.filter((m) => m.isDestroyed)).toHaveLength(0);
  });

  it('a Tough model survives a fall wound: it is wounded, not removed', () => {
    const unit = makeUnit(takeoff, 2);
    unit.models[1].isDestroyed = true;
    unit.models[0].wounds = 2; // a Tough(2) model: one fall wound does not kill it
    unit.models[0].maxWounds = 2;
    const { unit: u } = failJump(makeState(unit), [1, 6, 6]);
    expect(u.models[0].isDestroyed).toBe(false);
    expect(u.position.y).toBe(0);
    expect(u.models[0].wounds).toBe(1);
  });
});
