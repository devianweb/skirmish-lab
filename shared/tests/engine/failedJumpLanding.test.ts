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
    wounds: 0,
    maxWounds: 3,
    isActivated: true,
    isDestroyed: false,
    models: Array.from({ length: models }, (_, i) => ({
      id: `u-m${i}`,
      wounds: models > 1 ? 1 : 0,
      maxWounds: 1,
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
const landing = P(2.6, 3, 0); // 2" gap (x 0..2); the fall point is its midpoint, x = 1.15

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
  createAction(HOST, 'move-unit', {
    type: 'move-unit',
    unitId: 'u',
    path: [takeoff, landing],
    finalPosition: landing,
    traversal: { kind: 'jump-gap', takeoff, landing },
  });

/** Declares the jump across the gap and fails it (gap die = 1) with the given falling save. */
function failJump(state: GameState, fallSave: number) {
  const out = applyAction(state, jumpAction(), [
    roll('gap_jump', [1]),
    roll('falling_defense', [fallSave]),
    roll('trauma', [1]),
  ]);
  if (!out.ok) throw new Error(out.reason);
  const events = out.state.actionLog[out.state.actionLog.length - 1].dice!.outcome.traversal!;
  return { state: out.state, unit: out.state.units[0], events };
}

describe('failed gap jump: landing', () => {
  it('requests falling dice for a jump off a 3" deck', () => {
    const state = makeState(makeUnit(takeoff));
    expect(getDiceSpecs(state, jumpAction())!.map((s) => s.purpose)).toEqual(['gap_jump', 'falling_defense', 'trauma']);
  });

  it('a 3" fall to the ground takes the AP(1) hit, lands near the fall point and ends the activation', () => {
    const { state, unit, events } = failJump(makeState(makeUnit(takeoff)), 5); // defense 5 + AP1 needs 6: a 5 fails
    expect(unit.position.y).toBe(0);
    expect(Math.hypot(unit.position.x - 1.15, unit.position.z)).toBeLessThanOrEqual(2);
    expect(unit.traumaTokens).toBe(1);
    const fall = events.find((e) => e.type === 'fall')!;
    expect(fall.wounds).toBe(1);
    expect(fall.text).toMatch(/3\.0"/);
    expect(state.turnState.activeUnitId).not.toBe('u');
    
  });

  it('a saved fall reports 0 wounds, still lands on the floor and ends the activation', () => {
    const { state, unit, events } = failJump(makeState(makeUnit(takeoff)), 6);
    expect(unit.traumaTokens ?? 0).toBe(0);
    expect(events.find((e) => e.type === 'fall')!.wounds).toBe(0);
    expect(unit.position.y).toBe(0);
    expect(state.turnState.activeUnitId).not.toBe('u');
  });

  it('a gap over a lower deck lands on that deck, and a 2" fall already takes damage', () => {
    const lower = piece('lower', 'platform-small', P(1.15, 0, 0), 1); // top at 1": the fall is 2"
    const { unit, events } = failJump(makeState(makeUnit(takeoff), [lower]), 1);
    expect(unit.position.y).toBeCloseTo(1);
    const fall = events.find((e) => e.type === 'fall')!;
    expect(fall.text).toMatch(/2\.0"/);
    expect(fall.wounds).toBe(1);
  });

  it('a fall under 2" takes no damage', () => {
    const lower = piece('lower', 'platform-small', P(1.15, 0, 0), 1.5); // top at 1.5": a 1.5" fall
    const { unit, events } = failJump(makeState(makeUnit(takeoff), [lower]), 1);
    expect(unit.position.y).toBeCloseTo(1.5);
    expect(unit.traumaTokens ?? 0).toBe(0);
    expect(events.find((e) => e.type === 'fall')!.wounds).toBe(0);
  });

  it('a crate under the gap: the model lands clear of it, within 2"', () => {
    const crate = piece("crate", "crate", P(1.15, 0, 0));
    const { state, unit } = failJump(makeState(makeUnit(takeoff), [crate]), 1);
    expect(unit.position.y).toBe(0);
    expect(findEndOverlap(state, 'u', unit.position)).toBeNull();
    expect(isBaseOverhanging(state, unit.position)).toBe(false);
    expect(Math.hypot(unit.position.x - 1.15, unit.position.z)).toBeLessThanOrEqual(2);
  });
});

describe('failed jump-down: lands on the floor below', () => {
  it('a failed 4" jump-down ends on the ground at its landing spot, clear of terrain, taking the hit', () => {
    const tall = piece('tall', 'platform-small', P(-2, 0, 0), 4);
    const from = P(-0.3, 4, 0);
    const to = P(1.0, 0, 0);
    const unit = makeUnit(from);
    const state = makeState(unit);
    state.terrain = [tall];
    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'u',
      path: [from, to],
      finalPosition: to,
      traversal: { kind: 'jump-drop', takeoff: from, landing: to },
    });
    const out = applyAction(state, action, [
      roll('drop_jump', [1, 1]),
      roll('falling_defense', [1]),
      roll('trauma', [1]),
    ]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.position).toMatchObject({ x: 1, y: 0, z: 0 });
    expect(findEndOverlap(out.state, 'u', u.position)).toBeNull();
    expect(u.traumaTokens).toBe(1);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });
});

describe('failed gap jump: squads', () => {
  it('only the jumping model falls and is lost; the others stay where they were', () => {
    // Squads cannot declare jumps through validation yet, so drive the traversal step directly.
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
      [roll('gap_jump', [1]), roll('falling_defense', [6]), roll('trauma', [1])],
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

  it('the last remaining model is not eliminated: it takes the normal falling hit', () => {
    const unit = makeUnit(takeoff, 2);
    unit.models[1].isDestroyed = true;
    const { unit: u } = failJump(makeState(unit), 1);
    expect(u.models[0].isDestroyed).toBe(false);
    expect(u.position.y).toBe(0);
    expect(u.traumaTokens).toBe(1);
  });
});
