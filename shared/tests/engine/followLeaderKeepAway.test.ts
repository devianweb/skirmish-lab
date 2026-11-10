import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { validateAction } from '../../src/engine/actions';
import { DeclaredTraversal } from '../../src/engine/traversal';
import { planFollowerCrossing } from '../../src/engine/followLeader';
import { KEEP_AWAY_REASON } from '../../src/engine/spatial';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function deck(id: string, x: number): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG['platform-small'];
  return {
    id,
    terrainType: 'platform-small',
    position: P(x, 0, 0),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale, z: 8 },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

function squad(id: string, owner: string, points: Vector3[]): Unit {
  return {
    id,
    ownerId: owner,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...points[0] },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: points.length,
    maxWounds: points.length,
    isActivated: false,
    isDestroyed: false,
    models: points.map((p, i) => ({ id: `${id}-m${i}`, wounds: 1, maxWounds: 1, isDestroyed: false, position: { ...p } })) as any,
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

// Deck A x -4..0, deck B x 4.1..8.1 (3" high): a 4.1" gap. The jumpers start in a cluster at the near edge.
const starts = [P(-0.55, 3, 0), P(-1.55, 3, 0.9), P(-1.55, 3, -0.9), P(-2.55, 3, 0)];
const leader: DeclaredTraversal = { kind: 'jump-gap', takeoff: starts[0], landing: P(4.65, 3, 0) };

function setup(friend: Vector3): { state: GameState; unit: Unit } {
  const state = createInitialGameState(HOST, GUEST);
  const unit = squad('u', HOST, starts);
  unit.isActivated = true;
  const mate = squad('mate', HOST, [friend]);
  const foe = squad('foe', GUEST, [P(-20, 0, 20)]);
  state.units = [unit, mate, foe];
  state.terrain = [deck('a', -2), deck('b', 6.1)];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  return { state, unit };
}

/** Route every follower the way the HUD does and build the advance action it would send. */
function route(state: GameState, unit: Unit) {
  const alive = unit.models;
  const taken: Vector3[] = [leader.takeoff, leader.landing];
  const positions: Vector3[] = [leader.landing];
  const paths: Vector3[][] = [[leader.takeoff, leader.landing]];
  const traversals: (DeclaredTraversal | null)[] = [leader];
  const plans = [];
  for (let i = 1; i < alive.length; i++) {
    const plan = planFollowerCrossing(state, unit, alive[i].position!, leader, { budget: 6, taken, navOptions: { keepAway: true } });
    plans.push(plan);
    if (plan.status !== 'route') {
      positions.push({ ...alive[i].position! });
      paths.push([alive[i].position!, alive[i].position!]);
      traversals.push(null);
      continue;
    }
    taken.push(plan.route.option.takeoff, plan.route.option.landing);
    positions.push(plan.route.option.landing);
    paths.push(plan.route.path);
    traversals.push({ kind: plan.route.option.kind, takeoff: plan.route.option.takeoff, landing: plan.route.option.landing });
  }
  const action = createAction(HOST, 'advance', {
    type: 'advance',
    unitId: 'u',
    path: [starts[0], positions[0]],
    finalPosition: positions[0],
    modelPositions: positions,
    modelPaths: paths,
    modelTraversals: traversals,
  });
  return { positions, plans, action };
}

describe('follow the leader keeps 1" from other units', () => {
  it('host: a group jump whose leader lands within 1" of another unit is rejected with the keep-away reason', () => {
    const { state, unit } = setup(P(6.2, 3, 0)); // 1.55" from the landing: 0.55" between base edges
    const r = route(state, unit);
    const result = validateAction(state, r.action);
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toContain(KEEP_AWAY_REASON);
  });

  it('followers do not land within 1" of a friendly unit, and the whole leg is accepted', () => {
    // clear of the leader's landing, but on a spot a follower would otherwise take one step along the edge
    const friend = P(4.65, 3, 2.9);
    const { state, unit } = setup(friend);
    const r = route(state, unit);
    expect(r.plans.every((p) => p.status === 'route')).toBe(true);
    for (const p of r.positions) expect(Math.hypot(p.x - friend.x, p.z - friend.z)).toBeGreaterThanOrEqual(2 - 0.02);
    expect(validateAction(state, r.action)).toEqual({ valid: true });
  });

  it('a follower with no landing that keeps 1" clear is reported unreachable and not routed into a rejection', () => {
    // friendly models line the whole landing strip except the leader's own spot
    const wall = [-3, -2, 2, 3].map((z) => P(4.65, 3, z));
    const { state, unit } = setup(wall[0]);
    state.units[1] = squad('mate', HOST, wall);
    const plan = planFollowerCrossing(state, unit, starts[1], leader, {
      budget: 6,
      taken: [leader.takeoff, leader.landing],
      navOptions: { keepAway: true },
    });
    expect(plan.status).toBe('unreachable');
  });
});
