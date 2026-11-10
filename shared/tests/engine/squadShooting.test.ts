import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, Model, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import {
  closestModelPair,
  livingModelPositions,
  unitDistance,
} from '../../src/engine/unitGeometry';
import { firingModels, targetCoverByMajority } from '../../src/engine/squadTargeting';

const HOST = 'host1';
const GUEST = 'guest1';
const pt = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

function rifle() {
  return { ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } };
}

/** Squad unit: models at the given spots, anchor = first spot unless given (the "centroid"). */
function squad(id: string, owner: string, spots: Vector3[], anchor?: Vector3, destroyed: number[] = []): Unit {
  const models: Model[] = spots.map((p, i) => ({
    id: `${id}-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: destroyed.includes(i),
    position: { ...p },
    rotation: pt(0, 0),
  }));
  return {
    id, ownerId: owner, armyId: 'a', unitType: 'trooper', name: id,
    quality: 4, defense: 5, speed: 6,
    position: { ...(anchor ?? spots[0]) }, rotation: pt(0, 0), status: [],
    wounds: spots.length, maxWounds: spots.length, isActivated: false, isDestroyed: false,
    models, weapons: [rifle()], specialRules: [], hasMoved: false, remainingMovement: 6,
  };
}

function piece(type: string, x: number, z: number, rotY = 0): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id: `${type}-${x}-${z}`, terrainType: type, position: pt(x, z),
    rotation: { x: 0, y: rotY, z: 0 }, scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight, providesCover: meta.providesCover, isObstacle: meta.isObstacle,
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.activeUnitId = units[0].id;
  state.turnState.currentPlayerId = HOST;
  units[0].isActivated = true;
  return state;
}

const shootAction = (attacker = 'a', target = 't') =>
  createAction(HOST, 'shoot', { type: 'shoot', attackerId: attacker, targetId: target, weaponId: 'rifle' });

const wall = (x: number, z: number) => piece('wall', x, z); // 4" wide, 2.5" tall, blocks sight
const toHitCount = (state: GameState, action = shootAction()) =>
  getDiceSpecs(state, action)!.find((s) => s.purpose === 'to-hit')!.count;

describe('unitGeometry: per-model helpers', () => {
  it('livingModelPositions skips casualties and falls back to the anchor for model-less units', () => {
    const s = squad('s', HOST, [pt(0, 0), pt(2, 0), pt(4, 0)], undefined, [1]);
    expect(livingModelPositions(s)).toEqual([pt(0, 0), pt(4, 0)]);
    expect(livingModelPositions({ position: pt(3, 3), models: [] })).toEqual([pt(3, 3)]);
  });

  it('closestModelPair / unitDistance measure the closest models by base edge, not the centroids', () => {
    const a = squad('a', HOST, [pt(0, 0), pt(10, 0)], pt(5, 0));
    const b = squad('b', GUEST, [pt(10, 10), pt(20, 10)], pt(15, 10));
    const pair = closestModelPair(a, b)!;
    expect(pair.from).toEqual(pt(10, 0));
    expect(pair.to).toEqual(pt(10, 10));
    expect(pair.gap).toBeCloseTo(9);
    expect(unitDistance(a, b)).toBeCloseTo(9);
  });
});

describe('squad shooting: who can fire', () => {
  it('a target is valid when one model is visible, and only seeing shooters count', () => {
    // Shooter model at x=0 is walled off from the whole target; the one at x=10 sees it.
    const shooters = squad('a', HOST, [pt(0, 0), pt(10, 0)], pt(5, 0));
    const target = squad('t', GUEST, [pt(0, 10), pt(4, 10)], pt(2, 10));
    shooters.hasMoved = true; // spread-out squad that has moved (an incoherent squad may not shoot in place)
    const state = makeState([shooters, target], [wall(-2, 4), wall(2, 4)]); // x -4..4 at z=4
    const fm = firingModels(state, shooters, target, shooters.weapons[0]);
    expect(fm.map((f) => f.position)).toEqual([pt(10, 0)]);
    expect(validateAction(state, shootAction()).valid).toBe(true);
    expect(toHitCount(state)).toBe(1); // rifle 1 attack x 1 firing model
  });

  it('all models firing multiplies the attacks', () => {
    const shooters = squad('a', HOST, [pt(0, 0), pt(2, 0), pt(4, 0)]);
    const target = squad('t', GUEST, [pt(0, 10), pt(2, 10)]);
    expect(toHitCount(makeState([shooters, target]))).toBe(3);
  });

  it('centre hidden behind a wall but an end model visible -> valid', () => {
    const shooter = squad('a', HOST, [pt(0, 0)]);
    // Anchor (0,10) is hidden by the wall at z=5; the model at x=8 is visible.
    const target = squad('t', GUEST, [pt(0, 10), pt(8, 10)], pt(0, 10));
    const state = makeState([shooter, target], [wall(0, 5)]);
    expect(validateAction(state, shootAction()).valid).toBe(true);
  });

  it('centre visible but every model hidden -> invalid', () => {
    const shooter = squad('a', HOST, [pt(0, 0)]);
    // The anchor (0,10) is in the open gap between two walls; both models stand behind a wall.
    const target = squad('t', GUEST, [pt(-3, 10), pt(3, 10)], pt(0, 10));
    const state = makeState([shooter, target], [wall(-3, 5), wall(3, 5)]);
    expect(validateAction(state, shootAction())).toMatchObject({ valid: false, reason: 'No line of sight to target' });
  });

  it('only shooters within range fire (base-edge range per model)', () => {
    // Rifle range 24. Model A: edge gap 21 (in range). Model B is 30" behind it (out of range).
    const shooters = squad('a', HOST, [pt(0, 0), pt(0, -8)], pt(0, -4));
    const target = squad('t', GUEST, [pt(0, 22)], pt(0, 22));
    const state = makeState([shooters, target]);
    const fm = firingModels(state, shooters, target, shooters.weapons[0]);
    expect(fm.map((f) => f.position)).toEqual([pt(0, 0)]);
    expect(toHitCount(state)).toBe(1);
  });

  it('is out of range when no model reaches any target model', () => {
    const shooters = squad('a', HOST, [pt(0, 0), pt(2, 0)]);
    const target = squad('t', GUEST, [pt(0, 40)]);
    expect(validateAction(makeState([shooters, target]), shootAction())).toMatchObject({
      valid: false,
      reason: 'Target out of range',
    });
  });

  it('own squad-mates never block line of sight; another unit does', () => {
    const shooters = squad('a', HOST, [pt(0, 0), pt(0, 3)]); // mate directly in front of model 0
    const target = squad('t', GUEST, [pt(0, 12)]);
    expect(firingModels(makeState([shooters, target]), shooters, target, shooters.weapons[0])).toHaveLength(2);

    const blocker = squad('b', HOST, [pt(0, 6)]);
    const state = makeState([shooters, target, blocker]);
    expect(firingModels(state, shooters, target, shooters.weapons[0])).toHaveLength(0);
    expect(validateAction(state, shootAction()).valid).toBe(false);
  });

  it('a indirect weapon needs range only, no sight', () => {
    const shooter = squad('a', HOST, [pt(0, 0)]);
    const lob = { ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile, specialRules: ['indirect'] } };
    const target = squad('t', GUEST, [pt(0, 10)]);
    const state = makeState([shooter, target], [wall(0, 5)]);
    expect(firingModels(state, shooter, target, lob)).toHaveLength(1);
    expect(firingModels(state, shooter, target, shooter.weapons[0])).toHaveLength(0);
  });
});

describe('squad shooting: cover by majority', () => {
  // Shooter at origin; barricade (3" wide) at z=9.2 covers target models standing in x -1.5..1.5 at z=10.
  const barricade = piece('barricade', 0, 9.2);
  const shooter = squad('a', HOST, [pt(0, 0)]);
  const coverOf = (target: Unit) => {
    const state = makeState([shooter, target], [barricade]);
    return targetCoverByMajority(state, firingModels(state, shooter, target, shooter.weapons[0]), shooter, target);
  };

  it('3 of 4 models behind a barricade -> cover', () => {
    expect(coverOf(squad('t', GUEST, [pt(-1, 10), pt(0, 10), pt(1, 10), pt(6, 10)]))).toBe(true);
  });

  it('1 of 4 behind a barricade -> no cover; exactly half is not a majority', () => {
    expect(coverOf(squad('t', GUEST, [pt(0, 10), pt(4, 10), pt(6, 10), pt(8, 10)]))).toBe(false);
    expect(coverOf(squad('t', GUEST, [pt(-1, 10), pt(1, 10), pt(6, 10), pt(8, 10)]))).toBe(false);
  });

  it('single-model targets are judged on their own', () => {
    expect(coverOf(squad('t', GUEST, [pt(0, 10)]))).toBe(true);
    expect(coverOf(squad('t', GUEST, [pt(6, 10)]))).toBe(false);
  });

  it('resolution applies the majority result (cover turns a 4 into a block on D5)', () => {
    const rolls = [
      { rolls: [5], total: 5, finalTotal: 0, purpose: 'to-hit' },
      { rolls: [4], total: 4, finalTotal: 0, purpose: 'defense' },
    ];
    const run = (target: Unit) => {
      const res = applyAction(makeState([shooter, target], [barricade]), shootAction(), rolls);
      expect(res.ok).toBe(true);
      // the target's owner picks the casualties (here the host does, as on timeout)
      const pending = res.state!.turnState.pendingReaction;
      const settled = pending
        ? applyAction(
            res.state!,
            createAction(GUEST, 'respond-reaction', { type: 'respond-reaction', reactionId: pending.id, choiceId: 'auto-pick-casualties' })
          ).state!
        : res.state!;
      return settled.units[1].models.filter((m) => m.isDestroyed).length;
    };
    expect(run(squad('t', GUEST, [pt(-1, 10), pt(0, 10), pt(1, 10), pt(6, 10)]))).toBe(0);
    expect(run(squad('t', GUEST, [pt(0, 10), pt(4, 10), pt(6, 10), pt(8, 10)]))).toBe(1);
  });
});

describe('single-model regression', () => {
  it('single model vs single model: same range, sight and attack count as before', () => {
    const a = squad('a', HOST, [pt(0, 0)]);
    // centre 24.9 = edge gap 23.9 <= 24 ; centre 25.1 = 24.1 > 24
    expect(validateAction(makeState([a, squad('t', GUEST, [pt(0, 24.9)])]), shootAction()).valid).toBe(true);
    expect(validateAction(makeState([a, squad('t', GUEST, [pt(0, 25.1)])]), shootAction()).valid).toBe(false);
    expect(validateAction(makeState([a, squad('t', GUEST, [pt(0, 10)])], [wall(0, 5)]), shootAction()).valid).toBe(false);
    expect(toHitCount(makeState([a, squad('t', GUEST, [pt(0, 10)])]))).toBe(1);
  });

  it('model-less units still work (anchor only)', () => {
    const a = { ...squad('a', HOST, [pt(0, 0)]), models: [] as Model[] };
    const t = { ...squad('t', GUEST, [pt(0, 10)]), models: [] as Model[] };
    const state = makeState([a, t]);
    expect(validateAction(state, shootAction()).valid).toBe(true);
    expect(toHitCount(state)).toBe(1);
  });

  it('split fire across two targets still validates and counts per weapon group', () => {
    const a = squad('a', HOST, [pt(0, 0), pt(2, 0)]);
    a.weapons = [rifle(), { ...WEAPONS.rifle, id: 'rifle2', name: 'Rifle B', profile: { ...WEAPONS.rifle.profile } }];
    const state = makeState([a, squad('t1', GUEST, [pt(0, 10)]), squad('t2', GUEST, [pt(5, 12)])]);
    const action = createAction(HOST, 'shoot', {
      type: 'shoot', attackerId: 'a', targetId: 't1', weaponId: 'rifle',
      allocations: [{ weaponId: 'rifle', targetId: 't1' }, { weaponId: 'rifle2', targetId: 't2' }],
    });
    expect(validateAction(state, action).valid).toBe(true);
    const specs = getDiceSpecs(state, action)!;
    expect(specs.filter((s) => s.purpose.endsWith('to-hit')).map((s) => s.count)).toEqual([2, 2]);
  });
});
