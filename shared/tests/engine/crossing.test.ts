import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { DeclaredTraversal, findJumpOption } from '../../src/engine/traversal';
import { CROSSING_REACH_REASON, autoPlaceCrossers, crossingPlacementProblem } from '../../src/engine/crossing';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(id: string, terrainType: string, pos: Vector3, scaleY?: number, scaleZ?: number): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[terrainType];
  return {
    id,
    terrainType,
    position: pos,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale, ...(scaleY ? { y: scaleY } : {}), ...(scaleZ ? { z: scaleZ } : {}) },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

// Deck A spans x -4..0, deck B x 1.5..5.5 (both 3" high, 8" deep): a 1.5" gap, 2.6" hop between the edge spots.
const deckA = piece('deck-a', 'platform-small', P(-2, 0, 0), undefined, 8);
const deckB = piece('deck-b', 'platform-small', P(3.5, 0, 0), undefined, 8);
const takeoff = P(-0.55, 3, 0);
const landing = P(2.05, 3, 0);
const leaderJump: DeclaredTraversal = { kind: 'jump-gap', takeoff, landing };

// A tight cluster several inches behind the edge except the leader, who stands on it
const cluster = [takeoff, P(-1.55, 3, 0.9), P(-1.55, 3, -0.9), P(-3.0, 3, 0)];
// A line along the edge
const line = [takeoff, P(-0.55, 3, 1.0), P(-0.55, 3, 2.0), P(-0.55, 3, -1.0)];

function makeSquad(points: Vector3[], rules: string[] = []): Unit {
  return {
    id: 'u',
    ownerId: HOST,
    armyId: 'army-1',
    unitType: 'trooper',
    name: 'u',
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...points[0] },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: points.length,
    maxWounds: points.length,
    isActivated: true,
    isDestroyed: false,
    models: points.map((p, i) => ({ id: `u-m${i}`, wounds: 1, maxWounds: 1, isDestroyed: false, position: { ...p } })) as any,
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: rules,
    hasMoved: false,
    remainingMovement: 6,
  };
}

function makeState(unit: Unit, terrain: TerrainPiece[] = [deckA, deckB], extra: Unit[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  const bystander = makeSquad([P(-20, 0, 20), P(-18.5, 0, 20)]);
  bystander.id = 'bystander';
  bystander.ownerId = GUEST;
  bystander.isActivated = false;
  bystander.models.forEach((m, i) => (m.id = `by-m${i}`));
  state.units = [unit, bystander, ...extra];
  state.terrain = terrain;
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

/** The payload the HUD builds after Auto placement: model 0 jumps, the others are carried to `spots`. */
function crossingPayload(starts: Vector3[], spots: Vector3[], extra: Record<string, unknown> = {}) {
  const positions = [landing, ...spots];
  return {
    unitId: 'u',
    path: [starts[0], landing],
    finalPosition: landing,
    modelPositions: positions,
    modelPaths: positions.map((p, i) => [starts[i], p]),
    modelTraversals: positions.map((_, i) => (i === 0 ? leaderJump : null)),
    jumpLeader: 0,
    crossers: spots.map((_, i) => i + 1),
    ...extra,
  };
}

const advance = (payload: Record<string, unknown>) => createAction(HOST, 'advance', { type: 'advance', ...payload });

/** Auto spots for the carried models of a squad that starts at `starts`. */
function autoSpots(state: GameState, unit: Unit, starts: Vector3[]) {
  const spots = autoPlaceCrossers(state, unit, {
    declared: leaderJump,
    leaderStart: starts[0],
    leaderEnd: landing,
    models: starts.slice(1).map((position, i) => ({ index: i + 1, position })),
    across: [landing],
    occupied: [],
  });
  return starts.slice(1).map((_, i) => spots.get(i + 1)!);
}

describe('group crossing, option C (14C-2 PR 4C)', () => {
  it('carries a cluster standing several inches back across with no move left: nobody walks to the edge', () => {
    const unit = makeSquad(cluster);
    const state = makeState(unit);
    // the carried models have already spent their whole move; the leader has not
    state.units[0].modelMovementSpent = { 'u-m0': 0, 'u-m1': 6, 'u-m2': 6, 'u-m3': 6 };
    const spots = autoSpots(state, unit, cluster);
    expect(spots.every(Boolean)).toBe(true);
    const action = advance(crossingPayload(cluster, spots));
    expect(validateAction(state, action)).toEqual({ valid: true });
    const specs = getDiceSpecs(state, action)!;
    expect(specs.map((s) => s.purpose)).toEqual(['jump', 'fall', 'morale']);
    expect(specs[0].count).toBe(3); // sized by the leader's 2.6" hop only
    const out = applyAction(state, action, [roll('jump', [6, 6, 3]), roll('fall', [6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    u.models.forEach((m, i) => expect(m.position).toMatchObject(i === 0 ? landing : spots[i - 1]));
    expect(u.models.every((m) => m.position!.x > 1.5)).toBe(true);
    // crossing costs nothing: the carried models' tallies did not grow
    expect(u.modelMovementSpent).toMatchObject({ 'u-m1': 6, 'u-m2': 6, 'u-m3': 6 });
    expect(out.state.turnState.activeUnitId).toBe('u');
  });

  it('Auto placement keeps a coherent line in formation when the shifted spots are all legal', () => {
    const unit = makeSquad(line);
    const state = makeState(unit);
    const spots = autoSpots(state, unit, line);
    // the leader moves (+2.6, 0): every other model keeps its place in the line
    expect(spots).toEqual([P(2.05, 3, 1.0), P(2.05, 3, 2.0), P(2.05, 3, -1.0)]);
    expect(validateAction(state, advance(crossingPayload(line, spots)))).toEqual({ valid: true });
  });

  it('Auto placement falls back to a spot within 1" when the shifted spot would be in the gap or on the take-off side', () => {
    const unit = makeSquad(cluster);
    const state = makeState(unit);
    const spots = autoSpots(state, unit, cluster);
    // (-1.55, +/-0.9) shifts to x = 1.05: over the gap. (-3.0, 0) shifts to x = -0.4: the near side.
    for (const s of spots) {
      expect(s.x).toBeGreaterThan(1.5);
      expect(s.y).toBe(3);
      expect(crossingPlacementProblem(state, unit, s, { declared: leaderJump, across: [landing], occupied: [] })).toBeNull();
    }
    // every carried model is within 1" (edge to edge: 2" between centres) of a model across, chain included
    const across = [landing];
    for (const s of spots) {
      expect(across.some((a) => Math.hypot(a.x - s.x, a.z - s.z) <= 2 + 1e-6)).toBe(true);
      across.push(s);
    }
    const all = [landing, ...spots];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z)).toBeGreaterThanOrEqual(0.9 - 1e-6);
    expect(validateAction(state, advance(crossingPayload(cluster, spots)))).toEqual({ valid: true });
  });

  it('a model whose shifted spot is legal but whose neighbour is not keeps its own shifted spot', () => {
    const unit = makeSquad([takeoff, P(-0.55, 3, 1.0), P(-2.0, 3, 0)]);
    const state = makeState(unit);
    const spots = autoSpots(state, unit, [takeoff, P(-0.55, 3, 1.0), P(-2.0, 3, 0)]);
    expect(spots[0]).toEqual(P(2.05, 3, 1.0)); // shifted
    expect(spots[1].x).toBeGreaterThan(1.5); // the back model's shifted spot (0.6, 0) is over the gap: fallback
  });

  describe('the host refuses illegal placements, with the reason', () => {
    const starts = cluster;
    const base = (spots: Vector3[], state: GameState) => validateAction(state, advance(crossingPayload(starts, spots))) as { valid: boolean; reason?: string };

    it('more than 1" from every model that has crossed', () => {
      const state = makeState(makeSquad(starts));
      const r = base([P(2.05, 3, 1.0), P(4.5, 3, 3.0), P(2.05, 3, -1.0)], state);
      expect(r.valid).toBe(false);
      expect(r.reason).toContain(CROSSING_REACH_REASON);
    });

    it('exactly 1" (edge to edge) from a crossed model is fine, just over 1" is not', () => {
      const state = makeState(makeSquad(starts));
      expect(base([P(2.05, 3, 2.0), P(2.05, 3, -2.0), P(3.5, 3, 0)], state).valid).toBe(true);
      const over = base([P(2.05, 3, 2.1), P(2.05, 3, -2.0), P(3.5, 3, 0)], state);
      expect(over.valid).toBe(false);
      expect(over.reason).toContain(CROSSING_REACH_REASON);
    });

    it('a chain is fine in any order: the first carried model may hang off the second', () => {
      const state = makeState(makeSquad(starts));
      expect(base([P(4.0, 3, 1.0), P(2.05, 3, 1.0), P(2.05, 3, -1.0)], state).valid).toBe(true);
    });

    it('on the take-off side, in the gap, or on top of terrain', () => {
      const state = makeState(makeSquad(starts));
      expect(base([P(-0.55, 3, 1.0), P(2.05, 3, 1.0), P(2.05, 3, -1.0)], state).valid).toBe(false);
      expect(base([P(0.75, 3, 0), P(2.05, 3, 1.0), P(2.05, 3, -1.0)], state).reason).toMatch(/mid-air|overhang/);
      const wall = piece('wall', 'wall-short', P(3.2, 3, 0));
      const walled = makeState(makeSquad(starts), [deckA, deckB, wall]);
      const r = base([P(3.2, 3, 0), P(2.05, 3, 1.0), P(2.05, 3, -1.0)], walled);
      expect(r.valid).toBe(false);
    });

    it('within 1" of another unit, friendly or not', () => {
      const mate = makeSquad([P(3.0, 3, 1.9)]);
      mate.id = 'mate';
      mate.models[0].id = 'mate-m0';
      const state = makeState(makeSquad(starts), [deckA, deckB], [mate]);
      const r = base([P(2.05, 3, 1.0), P(2.05, 3, -1.0), P(2.05, 3, -2.0)], state);
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/within 1" of another unit/);
    });

    it('off the board', () => {
      const state = makeState(makeSquad(starts));
      state.board.width = 3;
      state.board.height = 3;
      const r = base([P(2.05, 3, 1.0), P(2.05, 3, -1.0), P(2.05, 3, -2.0)], state);
      expect(r.valid).toBe(false);
    });

    it('overlapping a squad-mate', () => {
      const state = makeState(makeSquad(starts));
      const r = base([P(2.05, 3, 0.5), P(2.05, 3, -1.0), P(2.05, 3, -2.0)], state);
      expect(r.valid).toBe(false);
    });

    it('a carried model that also declares its own jump, a missing leader, or a Flying unit', () => {
      const state = makeState(makeSquad(starts));
      const spots = [P(2.05, 3, 1.0), P(2.05, 3, -1.0), P(2.05, 3, -2.0)];
      const both = crossingPayload(starts, spots, {});
      both.modelTraversals[1] = leaderJump;
      expect(validateAction(state, advance(both)).valid).toBe(false);
      const noLeader = crossingPayload(starts, spots, {});
      noLeader.modelTraversals = [null, null, null, null];
      expect((validateAction(state, advance(noLeader)) as any).reason).toMatch(/declares a jump/);
      const flyer = makeState(makeSquad(starts, ['flying']));
      expect((validateAction(flyer, advance(crossingPayload(starts, spots))) as any).reason).toMatch(/Flying/);
    });

    it('a model that is not placed stays put, and the usual coherency still applies', () => {
      const state = makeState(makeSquad(starts));
      // only model 2 is carried; models 3 and 4 stay on deck A, far from the models across
      const payload = crossingPayload(starts, [P(2.05, 3, 1.0)]);
      payload.modelPositions.push(starts[2], starts[3]);
      payload.modelPaths.push([starts[2], starts[2]], [starts[3], starts[3]]);
      payload.modelTraversals.push(null, null);
      const r = validateAction(state, advance(payload)) as { valid: boolean; reason?: string };
      expect(r.valid).toBe(false);
      expect(r.reason).toMatch(/coherency|did not cross/i);
    });
  });

  describe('a failed roll', () => {
    it('brings the whole unit down to the fallen leader and rolls fall dice for the leader only', () => {
      const unit = makeSquad(cluster);
      const state = makeState(unit);
      const spots = autoSpots(state, unit, cluster);
      const action = advance(crossingPayload(cluster, spots));
      const specs = getDiceSpecs(state, action)!;
      expect(specs.filter((s) => s.purpose === 'fall')).toHaveLength(1);
      const out = applyAction(state, action, [roll('jump', [1, 6, 6]), roll('fall', [4, 5, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      const anchor = u.models[0].position!;
      expect(anchor.y).toBe(0);
      u.models.slice(1).forEach((m) => {
        expect(m.position!.y).toBe(0);
        expect(Math.hypot(m.position!.x - anchor.x, m.position!.z - anchor.z)).toBeLessThanOrEqual(2 + 1e-6);
      });
      expect(out.state.turnState.activeUnitId).not.toBe('u');
    });

    it('fall wounds hit the faller only', () => {
      const unit = makeSquad(cluster);
      const state = makeState(unit);
      const spots = autoSpots(state, unit, cluster);
      const out = applyAction(state, advance(crossingPayload(cluster, spots)), [roll('jump', [1, 6, 6]), roll('fall', [1, 2, 3])]);
      if (!out.ok) throw new Error(out.reason);
      expect(out.state.units[0].models.map((m) => m.isDestroyed)).toEqual([true, false, false, false]);
    });

    it('a short fall (under 2") leaves carried models where they stood', () => {
      const lowA = piece('low-a', 'platform-small', P(-2, 0, 0), 1.5, 8);
      const lowB = piece('low-b', 'platform-small', P(3.5, 0, 0), 1.5, 8);
      const lowStarts = cluster.map((p) => P(p.x, 1.5, p.z));
      const opt = findJumpOption(makeState(makeSquad(lowStarts), [lowA, lowB]), makeSquad(lowStarts), P(-0.55, 1.5, 0), P(2.05, 1.5, 0));
      expect(opt).not.toBeNull();
      const lowLeader: DeclaredTraversal = { kind: opt!.kind, takeoff: opt!.takeoff, landing: opt!.landing };
      const unit = makeSquad(lowStarts);
      const state = makeState(unit, [lowA, lowB]);
      const lowLanding = P(2.05, 1.5, 0);
      const spots = [P(2.05, 1.5, 1.0), P(2.05, 1.5, -1.0), P(3.1, 1.5, 0)];
      const positions = [lowLanding, ...spots];
      const action = advance({
        unitId: 'u',
        path: [lowStarts[0], lowLanding],
        finalPosition: lowLanding,
        modelPositions: positions,
        modelPaths: positions.map((p, i) => [lowStarts[i], p]),
        modelTraversals: [lowLeader, null, null, null],
        jumpLeader: 0,
        crossers: [1, 2, 3],
      });
      expect(validateAction(state, action)).toEqual({ valid: true });
      const out = applyAction(state, action, [roll('jump', Array(opt!.dice).fill(1)), roll('fall', [6, 6, 6])]);
      if (!out.ok) throw new Error(out.reason);
      const u = out.state.units[0];
      expect(u.models[1].position).toMatchObject(lowStarts[1]);
      expect(u.models[2].position).toMatchObject(lowStarts[2]);
      expect(u.models[3].position).toMatchObject(lowStarts[3]);
    });
  });

  it('rush legs carry models across the same way', () => {
    const unit = makeSquad(cluster);
    const state = makeState(unit);
    const spots = autoSpots(state, unit, cluster);
    const action = createAction(HOST, 'rush', { type: 'rush', ...crossingPayload(cluster, spots) });
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = applyAction(state, action, [roll('jump', [6, 6, 6]), roll('fall', [6, 6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].models.every((m) => m.position!.x > 1.5)).toBe(true);
  });

  describe('charge legs', () => {
    function chargeState() {
      const unit = makeSquad(cluster);
      const foe = makeSquad([P(6.0, 3, 0), P(6.0, 3, 1.0)]);
      foe.id = 'foe';
      foe.ownerId = GUEST;
      foe.isActivated = false;
      foe.models.forEach((m, i) => (m.id = `foe-m${i}`));
      const state = makeState(unit, [deckA, deckB], [foe]);
      state.turnState.charge = { unitId: 'u', targetId: 'foe', legs: 0 };
      state.units[0].remainingMovement = 12;
      return { unit, state };
    }

    it('carries the squad across on one roll, with nothing taken off their charge move', () => {
      const { unit, state } = chargeState();
      state.units[0].modelMovementSpent = { 'u-m0': 0, 'u-m1': 12, 'u-m2': 12, 'u-m3': 12 };
      const spots = autoSpots(state, unit, cluster);
      const leg = createAction(HOST, 'charge-leg', { type: 'charge-leg', attackerId: 'u', ...crossingPayload(cluster, spots) });
      const check = validateAction(state, leg);
      if (!check.valid) throw new Error(check.reason);
      expect(getDiceSpecs(state, leg)!.map((s) => s.purpose).slice(0, 2)).toEqual(['jump', 'fall']);
      const pass = applyAction(state, leg, [roll('jump', [6, 6, 6]), roll('fall', [6, 6, 6])]);
      if (!pass.ok) throw new Error(pass.reason);
      expect(pass.state.units[0].models.every((m) => m.position!.x > 1.5)).toBe(true);
      const fail = applyAction(state, leg, [roll('jump', [1, 1, 1]), roll('fall', [6, 6, 6])]);
      if (!fail.ok) throw new Error(fail.reason);
      expect(fail.state.turnState.activeUnitId).not.toBe('u');
    });

    it('carried models may land in contact with the charge target but not on top of it', () => {
      const { unit, state } = chargeState();
      const spots = autoSpots(state, unit, cluster);
      expect(spots.every((s) => Math.hypot(s.x - 6, s.z) > 0.9)).toBe(true);
      const onTop = [spots[0], spots[1], P(6.0, 3, 0)];
      const leg = createAction(HOST, 'charge-leg', { type: 'charge-leg', attackerId: 'u', ...crossingPayload(cluster, onTop) });
      expect(validateAction(state, leg).valid).toBe(false);
    });
  });

  it('Strider rolls half the dice for the group crossing', () => {
    const unit = makeSquad(cluster, ['strider']);
    const state = makeState(unit);
    const spots = autoSpots(state, unit, cluster);
    const action = advance(crossingPayload(cluster, spots));
    expect(validateAction(state, action)).toEqual({ valid: true });
    expect(getDiceSpecs(state, action)![0]).toMatchObject({ purpose: 'jump', count: 2 });
  });

  it('Flying squads move as usual and never roll', () => {
    const unit = makeSquad(line, ['flying']);
    const state = makeState(unit);
    const ends = [P(2.05, 3, 0), P(2.05, 3, 1.0), P(2.05, 3, 2.0), P(2.05, 3, -1.0)];
    const action = advance({
      unitId: 'u',
      path: [line[0], ends[0]],
      finalPosition: ends[0],
      modelPositions: ends,
      modelPaths: ends.map((p, i) => [line[i], p]),
    });
    expect(validateAction(state, action)).toEqual({ valid: true });
    expect((getDiceSpecs(state, action) ?? []).some((s) => s.purpose === 'jump')).toBe(false);
  });
});
