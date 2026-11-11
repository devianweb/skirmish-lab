import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs } from '../../src/engine/actions';
import { woundsToDestroy } from '../../src/engine/traversal';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function pool(x: number, z: number): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG['hazard-pool'];
  return {
    id: `pool-${x}-${z}`,
    terrainType: 'hazard-pool',
    position: P(x, 0, z),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
  };
}

/** `models` models, each with `tough` wounds, standing in a row from `at`. */
function makeUnit(id: string, at: Vector3, models: number, tough = 1, rules: string[] = [], owner = HOST): Unit {
  return {
    id,
    ownerId: owner,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 14,
    position: { ...at },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: models * tough,
    maxWounds: models * tough,
    isActivated: false,
    isDestroyed: false,
    models: Array.from({ length: models }, (_, i) => ({
      id: `${id}-m${i}`,
      wounds: tough,
      maxWounds: tough,
      isDestroyed: false,
      position: { ...at, x: at.x + i * 1.2 },
    })),
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: rules,
    hasMoved: false,
    remainingMovement: 14,
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  return state;
}

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

const activate = (unitId: string) => createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId });
const advance = (unitId: string, path: Vector3[]) =>
  createAction(HOST, 'advance', { type: 'advance', unitId, path, finalPosition: path[path.length - 1] });

const A = pool(0, 0); // x -2..2
const B = pool(8, 0); // x 6..10
const enemy = () => makeUnit('e', P(0, 0, 40), 1, 1, [], GUEST);

describe('dangerous terrain dice = wounds to destroy the unit', () => {
  it('a squad of 5 Tough 1 models crossing a piece rolls 5 dice', () => {
    const s = makeState([makeUnit('s', P(-6, 0, 0), 5), enemy()], [A]);
    s.turnState.activeUnitId = 's';
    expect(getDiceSpecs(s, advance('s', [P(-6, 0, 0), P(4, 0, 0)]))).toEqual([{ count: 5, sides: 6, purpose: 'hazard_pool-0-0' }]);
  });

  it('a Tough 3 hero with 1 wound taken rolls 2 dice', () => {
    const hero = makeUnit('h', P(-6, 0, 0), 1, 3);
    hero.models[0].wounds = 2;
    hero.wounds = 2;
    expect(woundsToDestroy(hero)).toBe(2);
    const s = makeState([hero, enemy()], [A]);
    s.turnState.activeUnitId = 'h';
    expect(getDiceSpecs(s, advance('h', [P(-6, 0, 0), P(4, 0, 0)]))).toEqual([{ count: 2, sides: 6, purpose: 'hazard_pool-0-0' }]);
  });

  it('counts every living model: a Tough 3 model plus two wounded Tough 3 models', () => {
    const squad = makeUnit('s', P(-6, 0, 0), 3, 3);
    squad.models[1].wounds = 1;
    squad.models[2].isDestroyed = true;
    squad.wounds = 4;
    expect(woundsToDestroy(squad)).toBe(4);
  });

  it('each 1 is a wound, and a squad loses models like any other wounds', () => {
    const s = makeState([makeUnit('s', P(0, 0, 0), 5), enemy()], [A]);
    const out = applyAction(s, activate('s'), [roll('hazard_pool-0-0', [1, 1, 6, 1, 3])]);
    expect(out.ok).toBe(true);
    expect(out.state!.turnState.pendingReaction?.type).toBe('pick-casualties');
    const done = applyAction(out.state!, createAction(HOST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: out.state!.turnState.pendingReaction!.id,
      choiceId: 'auto-pick-casualties',
    }));
    expect(done.ok).toBe(true);
    const u = done.state!.units[0];
    expect(u.wounds).toBe(2);
    expect(u.models.filter((m) => m.isDestroyed)).toHaveLength(3);
    const ev = out.state!.actionLog[out.state!.actionLog.length - 1].dice!.outcome.traversal!;
    expect(ev[0].wounds).toBe(3);
    expect(ev[0].text).toContain('5 dice');
  });

  it('the move casualty priority picks which squad models fall', () => {
    const s = makeState([makeUnit('s', P(-6, 0, 0), 3), enemy()], [A]);
    s.turnState.activeUnitId = 's';
    const act = createAction(HOST, 'advance', {
      type: 'advance',
      unitId: 's',
      path: [P(-6, 0, 0), P(4, 0, 0)],
      finalPosition: P(4, 0, 0),
      casualtyModelIds: ['s-m2'],
    });
    const out = applyAction(s, act, [roll('hazard_pool-0-0', [1, 5, 5])]);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    const models = out.state!.units[0].models;
    expect(models.find((m) => m.id === 's-m2')!.isDestroyed).toBe(true);
    expect(models.filter((m) => m.isDestroyed)).toHaveLength(1);
  });

  it('Flying units are immune, both crossing and activating in the piece', () => {
    const fly = makeUnit('f', P(0, 0, 0), 3, 1, ['flying']);
    const s = makeState([fly, enemy()], [A, B]);
    expect(getDiceSpecs(s, activate('f'))).toBeNull();
    s.turnState.activeUnitId = 'f';
    expect(getDiceSpecs(s, advance('f', [P(-6, 0, 0), P(12, 0, 0)]))).toBeNull();
  });
});

describe('one test per piece per activation', () => {
  it('activating in a piece and then moving out of it is one test', () => {
    const s = makeState([makeUnit('u', P(0, 0, 0), 2), enemy()], [A]);
    expect(getDiceSpecs(s, activate('u'))).toEqual([{ count: 2, sides: 6, purpose: 'hazard_pool-0-0' }]);
    const activated = applyAction(s, activate('u'), [roll('hazard_pool-0-0', [5, 5])]).state!;
    expect(activated.units[0].hazardTestedPieceIds).toEqual(['pool-0-0']);
    expect(getDiceSpecs(activated, advance('u', [P(0, 0, 0), P(4, 0, 0)]))).toBeNull();
  });

  it('activating in piece A and then crossing piece B is two tests, B only on the move', () => {
    const s = makeState([makeUnit('u', P(0, 0, 0), 2), enemy()], [A, B]);
    const activated = applyAction(s, activate('u'), [roll('hazard_pool-0-0', [5, 5])]).state!;
    // The path leaves A and crosses B: only B is new
    expect(getDiceSpecs(activated, advance('u', [P(0, 0, 0), P(12, 0, 0)]))).toEqual([
      { count: 2, sides: 6, purpose: 'hazard_pool-8-0' },
    ]);
  });

  it('crossing the same piece again on a later leg is not tested again', () => {
    const s = makeState([makeUnit('u', P(-6, 0, 0), 2), enemy()], [A]);
    const started = applyAction(s, activate('u')).state!;
    const first = advance('u', [P(-6, 0, 0), P(4, 0, 0)]);
    expect(getDiceSpecs(started, first)).toEqual([{ count: 2, sides: 6, purpose: 'hazard_pool-0-0' }]);
    const moved = applyAction(started, first, [roll('hazard_pool-0-0', [6, 6])]);
    expect(moved.ok).toBe(true);
    const state = moved.state!;
    expect(state.units[0].hazardTestedPieceIds).toEqual(['pool-0-0']);
    // Coming back across the same piece (a later leg, a Rush path or a charge) rolls nothing
    expect(getDiceSpecs(state, advance('u', [P(4, 0, 0), P(-6, 0, 0)]))).toBeNull();
    const back = createAction(HOST, 'charge-leg', {
      type: 'charge-leg',
      attackerId: 'u',
      path: [P(4, 0, 0), P(-6, 0, 0)],
      finalPosition: P(-6, 0, 0),
    });
    expect(getDiceSpecs(state, back)).toBeNull();
  });

  it('a path that crosses A, B and A again tests each piece once', () => {
    const s = makeState([makeUnit('u', P(-6, 0, 0), 1), enemy()], [A, B]);
    s.turnState.activeUnitId = 'u';
    const path = [P(-6, 0, 0), P(4, 0, 0), P(12, 0, 0), P(4, 0, 0), P(-6, 0, 0)];
    expect(getDiceSpecs(s, advance('u', path))).toEqual([
      { count: 1, sides: 6, purpose: 'hazard_pool-0-0' },
      { count: 1, sides: 6, purpose: 'hazard_pool-8-0' },
    ]);
  });

  it('a multi-leg move resolves one test per new piece and records them both', () => {
    const s = makeState([makeUnit('u', P(-3, 0, 0), 2), enemy()], [A, B]);
    const started = applyAction(s, activate('u')).state!;
    const move = advance('u', [P(-3, 0, 0), P(4, 0, 0), P(11, 0, 0)]);
    const out = applyAction(started, move, [roll('hazard_pool-0-0', [1, 4]), roll('hazard_pool-8-0', [1, 1])]);
    expect(out.ok).toBe(true);
    const u = out.state!.units[0];
    expect(u.hazardTestedPieceIds).toEqual(['pool-0-0', 'pool-8-0']);
    expect(u.isDestroyed).toBe(true); // 3 ones against 2 wounds
    const ev = out.state!.actionLog[out.state!.actionLog.length - 1].dice!.outcome.traversal!;
    expect(ev.filter((e) => e.type === 'hazard')).toHaveLength(2);
  });

  it('a later piece uses only as many dice as wounds still needed to destroy the unit', () => {
    const s = makeState([makeUnit('u', P(-3, 0, 0), 2), enemy()], [A, B]);
    const started = applyAction(s, activate('u')).state!;
    const move = advance('u', [P(-3, 0, 0), P(4, 0, 0), P(11, 0, 0)]);
    const out = applyAction(started, move, [roll('hazard_pool-0-0', [1, 6]), roll('hazard_pool-8-0', [6, 1])]);
    expect(out.ok).toBe(true);
    const u = out.state!.units[0];
    expect(u.isDestroyed).toBe(false);
    expect(u.wounds).toBe(1);
    const ev = out.state!.actionLog[out.state!.actionLog.length - 1].dice!.outcome.traversal!.filter((e) => e.type === 'hazard');
    expect(ev[1].rolls).toEqual([6]);
    expect(ev[1].wounds).toBe(0);
  });

  it('the activation tests are not repeated on the next activation (the list resets)', () => {
    const u = makeUnit('u', P(0, 0, 0), 1);
    u.hazardTestedPieceIds = ['pool-0-0'];
    const s = makeState([u, enemy()], [A]);
    expect(getDiceSpecs(s, activate('u'))).toEqual([{ count: 1, sides: 6, purpose: 'hazard_pool-0-0' }]);
    const out = applyAction(s, activate('u'), [roll('hazard_pool-0-0', [3])]).state!;
    expect(out.units[0].hazardTestedPieceIds).toEqual(['pool-0-0']);
  });
});
