import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { applyAction, validateAction } from '../../src/engine/actions';
import { FollowInput, autoPlaceSquadFollowers } from '../../src/engine/squadFollow';
import { validateSquadCoherency } from '../../src/engine/spatial';
import { pathMovementCost } from '../../src/engine/traversal';
import { keepAwayGap3D } from '../../src/engine/unitGeometry';

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
    id, ownerId, armyId: 'a', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: P(cx, cz), rotation: { x: 0, y: 0, z: 0 }, status: [],
    wounds: spots.length, maxWounds: spots.length, isActivated: ownerId === HOST, isDestroyed: false,
    models, weapons: [], specialRules: [], hasMoved: false, remainingMovement: 6, ...extra,
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
    id, terrainType: type, position: P(x, z), rotation: { x: 0, y: 0, z: 0 }, scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight, providesCover: meta.providesCover, isObstacle: meta.isObstacle,
    ...extra,
  } as TerrainPiece;
}

const BLOCK: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];

function inputFor(unit: Unit, placedIdx: number[], placedAt: Vector3[], budget = 6, extra: Partial<FollowInput> = {}): FollowInput {
  const models = unit.models.map((m, index) => ({ index, start: m.position!, budget }));
  return { kind: 'move', models, placed: placedIdx.map((index, k) => ({ index, position: placedAt[k] })), ...extra };
}

type Ok = Extract<ReturnType<typeof autoPlaceSquadFollowers>, { ok: true }>;

/** The host's verdict on the squad's whole move built from hand placements plus the auto placements. */
function hostVerdict(state: GameState, unit: Unit, input: FollowInput, res: Ok, type: 'advance' | 'rush' = 'advance') {
  const positions = unit.models.map((_, i) => input.placed.find((p) => p.index === i)?.position ?? res.placements.get(i)!.position);
  const paths = unit.models.map((m, i) => {
    const hand = input.placed.find((p) => p.index === i);
    return hand ? [m.position!, hand.position] : res.placements.get(i)!.path;
  });
  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length;
  return validateAction(
    state,
    createAction(HOST, type, { type, unitId: unit.id, path: [unit.position, P(cx, cz)], finalPosition: P(cx, cz), modelPositions: positions, modelPaths: paths })
  );
}

describe('autoPlaceSquadFollowers', () => {
  it('keeps the formation on open ground and the host accepts the whole move', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const input = inputFor(squad, [0], [P(0, 5)], 6);
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.placements.get(1)!.position).toEqual(P(1, 5));
    expect(res.placements.get(2)!.position).toEqual(P(0, 6));
    expect(res.placements.get(3)!.position).toEqual(P(1, 6));
    expect(res.stayed).toEqual([]);
    { const v = hostVerdict(state, squad, input, res); expect(v.reason).toBeUndefined(); expect(v.valid).toBe(true); }
  });

  it('never moves a hand-placed model', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const res = autoPlaceSquadFollowers(state, squad, inputFor(squad, [0, 3], [P(0, 4), P(1, 5)]));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.placements.has(0)).toBe(false);
    expect(res.placements.has(3)).toBe(false);
    expect([...res.placements.keys()].sort()).toEqual([1, 2]);
  });

  it('a follower blocked on the way takes a legal point short of its spot and the squad stays coherent', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[2.5, 6.5]])]);
    const input = inputFor(squad, [0], [P(0, 5)], 6);
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const [, pl] of res.placements) {
      expect(keepAwayGap3D(pl.position, P(2.5, 6.5))).toBeGreaterThanOrEqual(0.99);
    }
    // Model 4's formation spot (1,6) is the enemy's own spot: it must have taken another one
    expect(res.placements.get(3)!.position).not.toEqual(P(2.5, 6.5));
    const ends = squad.models.map((_, i) => (i === 0 ? P(0, 5) : res.placements.get(i)!.position));
    expect(validateSquadCoherency(ends).coherent).toBe(true);
    { const v = hostVerdict(state, squad, input, res); expect(v.reason).toBeUndefined(); expect(v.valid).toBe(true); }
  });

  it('a follower with no move left stays where it is when the squad remains coherent', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const input = inputFor(squad, [0], [P(0, -0.9)], 6);
    input.models[3] = { ...input.models[3], budget: 0 };
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.stayed).toEqual([3]);
    expect(res.placements.get(3)!.position).toEqual(P(1, 1));
    expect(res.placements.get(3)!.path).toHaveLength(1);
    { const v = hostVerdict(state, squad, input, res); expect(v.reason).toBeUndefined(); expect(v.valid).toBe(true); }
  });

  it('refuses naming the model when a follower that cannot move would break coherency', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const input = inputFor(squad, [0], [P(0, 5)], 6);
    input.models[3] = { ...input.models[3], budget: 0 }; // model 4 already spent its move
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.modelIndex).toBe(3);
    expect(res.reason).toMatch(/^Model 4 /);
  });

  it('respects the Rush allowance: nobody walks past 12"', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 45]])]);
    const input = inputFor(squad, [0], [P(0, 12)], 12, { kind: 'rush' });
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const [, pl] of res.placements) expect(pathMovementCost(state, pl.path, squad)).toBeLessThanOrEqual(12.05);
    expect(res.placements.get(3)!.position).toEqual(P(1, 13));
    expect(hostVerdict(state, squad, input, res, 'rush').valid).toBe(true);
  });

  it("does not walk a follower farther than its own remaining allowance", () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const input = inputFor(squad, [0], [P(0, 5)], 6);
    input.models[1] = { ...input.models[1], budget: 4 }; // model 2 already spent 2"
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const pl = res.placements.get(1)!;
    expect(pathMovementCost(state, pl.path, squad)).toBeLessThanOrEqual(4.05);
    expect(pl.position.z).toBeLessThanOrEqual(4.05);
  });

  it('keeps every follower inside the difficult-terrain cap', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const woods = piece('w1', 'rubble-field', 0.5, 12);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 45]])], [woods]);
    const input = inputFor(squad, [0], [P(0, 6)], 12, { kind: 'rush', stopBeforeDifficult: true });
    input.models.forEach((m) => (m.difficultBudget = 6));
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(hostVerdict(state, squad, input, res, 'rush').valid).toBe(true);
  });

  it('never ends a follower on an enemy model or inside its keep-away', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[2.5, 6.5]])]);
    const input = inputFor(squad, [0], [P(0, 5)], 6);
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const [, pl] of res.placements) expect(keepAwayGap3D(pl.position, P(2.5, 6.5))).toBeGreaterThanOrEqual(0.99);
    { const v = hostVerdict(state, squad, input, res); expect(v.reason).toBeUndefined(); expect(v.valid).toBe(true); }
  });

  it('never stacks two models on one spot', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const res = autoPlaceSquadFollowers(state, squad, inputFor(squad, [0], [P(0.5, 0.5)], 6));
    if (!res.ok) return;
    const ends = squad.models.map((_, i) => (i === 0 ? P(0.5, 0.5) : res.placements.get(i)!.position));
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        expect(Math.hypot(ends[i].x - ends[j].x, ends[i].z - ends[j].z)).toBeGreaterThanOrEqual(0.89);
      }
    }
  });

  it('a squad that began out of coherency may regroup', () => {
    const squad = mkUnit('h1', HOST, [[0, 0], [1, 0], [0, 1], [5, 1]]);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const input = inputFor(squad, [3], [P(3, 1)], 6);
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
  });

  it('on a charge leg, followers shift with the placed model and none ends in contact by accident', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const foe = mkUnit('g1', GUEST, [[0.5, 20]]);
    const state = mkState([squad, foe]);
    const input = inputFor(squad, [0], [P(0, 6)], 12, { kind: 'charge', target: foe });
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.closedIn).toEqual([]);
    expect(res.placements.get(3)!.position).toEqual(P(1, 7));
  });

  it('on a final charge (a placed model touches the target) the rest close in as far as they can', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const foe = mkUnit('g1', GUEST, [[0.5, 9]]);
    const state = mkState([squad, foe]);
    const input = inputFor(squad, [2], [P(0.5, 8)], 12, { kind: 'charge', target: foe });
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.closedIn.length).toBeGreaterThan(0);
    for (const i of res.closedIn) {
      const pl = res.placements.get(i)!;
      expect(Math.hypot(pl.position.x - 0.5, pl.position.z - 9)).toBeLessThan(2.5);
    }
  });
});

describe('autoPlaceSquadFollowers: applied end to end', () => {
  it('the host applies the combined move', () => {
    const squad = mkUnit('h1', HOST, BLOCK);
    const state = mkState([squad, mkUnit('g1', GUEST, [[0, 40]])]);
    const input = inputFor(squad, [1], [P(1, 5)], 6);
    const res = autoPlaceSquadFollowers(state, squad, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const positions = squad.models.map((_, i) => (i === 1 ? P(1, 5) : res.placements.get(i)!.position));
    const paths = squad.models.map((m, i) => (i === 1 ? [m.position!, P(1, 5)] : res.placements.get(i)!.path));
    const action = createAction(HOST, 'advance', { type: 'advance', unitId: 'h1', path: [squad.position, P(0.5, 5.5)], finalPosition: P(0.5, 5.5), modelPositions: positions, modelPaths: paths });
    expect(applyAction(state, action).ok).toBe(true);
  });
});
