import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { findNavPath, validateSquadCoherency, KEEP_AWAY_REASON } from '../../src/engine/spatial';
import { WEAPONS } from '../../src/data/weapons';

const HOST = 'host1';
const GUEST = 'guest1';

function weapon(id: keyof typeof WEAPONS): Weapon {
  return { ...WEAPONS[id], profile: { ...WEAPONS[id].profile } };
}

function makeUnit(id: string, ownerId: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    ownerId,
    armyId: 'army-x',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { x: 0, y: 0, z: 0 } as Vector3,
    rotation: { x: 0, y: 0, z: 0 } as Vector3,
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [weapon('rifle')],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
    ...overrides,
  };
}

/** A multi-model unit with its models at the given [x, z] spots (anchor = centroid, like the engine keeps it). */
function squad(id: string, ownerId: string, spots: Array<[number, number]>, overrides: Partial<Unit> = {}): Unit {
  const models = spots.map(([x, z], i) => ({
    id: `${id}-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
  }));
  const cx = spots.reduce((a, s) => a + s[0], 0) / spots.length;
  const cz = spots.reduce((a, s) => a + s[1], 0) / spots.length;
  return makeUnit(id, ownerId, { position: { x: cx, y: 0, z: cz }, models, wounds: spots.length, ...overrides });
}

function makeState(units: Unit[], activeId = 'h1'): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.activeUnitId = activeId;
  const active = units.find((u) => u.id === activeId);
  if (active) active.isActivated = true;
  return state;
}

const move = (unitId: string, path: Array<[number, number]>, type: 'advance' | 'rush' = 'advance') =>
  createAction(HOST, type, {
    type,
    unitId,
    path: path.map(([x, z]) => ({ x, y: 0, z })),
    finalPosition: { x: path[path.length - 1][0], y: 0, z: path[path.length - 1][1] },
  });

describe('1" keep-away rule (non-charge moves)', () => {
  // Enemy at z = 6: ending at z = 4 leaves exactly 1" between base edges.
  const build = (other: Unit) => makeState([makeUnit('h1', HOST), other]);

  it('rejects ending 0.9" (edge to edge) from an enemy model, accepts 1.0" and 1.1"', () => {
    const state = build(makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 6 } }));
    const bad = validateAction(state, move('h1', [[0, 0], [0, 4.1]]));
    expect(bad.valid).toBe(false);
    expect(bad.reason).toBe(KEEP_AWAY_REASON);
    expect(validateAction(state, move('h1', [[0, 0], [0, 4.0]])).valid).toBe(true);
    expect(validateAction(state, move('h1', [[0, 0], [0, 3.9]])).valid).toBe(true);
  });

  it('applies to rushes too', () => {
    const state = build(makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 9 } }));
    expect(validateAction(state, move('h1', [[0, 0], [0, 7.2]], 'rush')).valid).toBe(false);
    expect(validateAction(state, move('h1', [[0, 0], [0, 6.9]], 'rush')).valid).toBe(true);
  });

  it('counts friendly units from other squads as well', () => {
    const state = build(makeUnit('h2', HOST, { position: { x: 0, y: 0, z: 6 } }));
    const bad = validateAction(state, move('h1', [[0, 0], [0, 4.5]]));
    expect(bad.valid).toBe(false);
    expect(bad.reason).toBe(KEEP_AWAY_REASON);
    expect(validateAction(state, move('h1', [[0, 0], [0, 3.9]])).valid).toBe(true);
  });

  it('measures from the closest enemy model, not the squad anchor', () => {
    // Anchor (centroid) at z = 7, but the front model stands at z = 6
    const enemy = squad('g1', GUEST, [[0, 6], [0, 8]]);
    const state = build(enemy);
    expect(validateAction(state, move('h1', [[0, 0], [0, 4.5]])).valid).toBe(false);
    expect(validateAction(state, move('h1', [[0, 0], [0, 3.9]])).valid).toBe(true);
  });

  it('rejects a path that brushes past a unit even when it ends far away', () => {
    const state = build(makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 3 } }));
    state.units[0].position = { x: -2.5, y: 0, z: 1.5 };
    const res = validateAction(state, move('h1', [[-2.5, 1.5], [2.5, 1.5]]));
    expect(res.valid).toBe(false);
    expect(res.reason).toBe(KEEP_AWAY_REASON);
    // Swinging wide enough (>= 1" edge gap all the way) is fine
    expect(validateAction(state, move('h1', [[-2.5, 1.5], [-2.5, 0.5], [2.5, 0.5]])).valid).toBe(true);
  });

  it('lets a model that already starts closer than 1" move away, but not closer', () => {
    const state = build(makeUnit('h2', HOST, { position: { x: 0, y: 0, z: 1.5 } }));
    expect(validateAction(state, move('h1', [[0, 0], [0, -3]])).valid).toBe(true);
    expect(validateAction(state, move('h1', [[0, 0], [0.2, 0]])).valid).toBe(true);
    expect(validateAction(state, move('h1', [[0, 0], [0, 0.4]])).valid).toBe(false);
  });

  it('squad models each obey the rule against other units', () => {
    const units = [squad('h1', HOST, [[0, 0], [1.5, 0]], { speed: 6 }), makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 6 } })];
    const state = makeState(units);
    const action = (z: number) =>
      createAction(HOST, 'advance', {
        type: 'advance',
        unitId: 'h1',
        path: [{ x: 0.75, y: 0, z: 0 }, { x: 0.75, y: 0, z: z }],
        finalPosition: { x: 0.75, y: 0, z },
        modelPositions: [
          { x: 0, y: 0, z },
          { x: 1.5, y: 0, z },
        ],
        modelPaths: [
          [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z }],
          [{ x: 1.5, y: 0, z: 0 }, { x: 1.5, y: 0, z }],
        ],
      });
    expect(validateAction(state, action(4.5)).valid).toBe(false);
    expect(validateAction(state, action(3.9)).valid).toBe(true);
  });

  it('the navigator stops short at the keep-away distance when asked to', () => {
    const state = build(makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 6 } }));
    const unit = state.units[0];
    const path = findNavPath(state, unit, { x: 0, y: 0, z: 6 }, 12, { keepAway: true });
    const end = path[path.length - 1];
    expect(6 - end.z - 1).toBeGreaterThanOrEqual(0.98);
    expect(end.z).toBeGreaterThan(3);
  });

  it('the navigator routes around a unit instead of through its keep-away zone', () => {
    const state = build(makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 4 } }));
    const unit = state.units[0];
    const path = findNavPath(state, unit, { x: 0, y: 0, z: 8 }, 20, { keepAway: true });
    const end = path[path.length - 1];
    expect(end.z).toBeGreaterThan(7.5);
    for (let i = 1; i < path.length; i++) {
      const res = validateAction(state, move('h1', path.map((p) => [p.x, p.z] as [number, number])));
      expect(res.reason).not.toBe(KEEP_AWAY_REASON);
    }
  });

  it('is waived toward the declared charge target but not toward other units', () => {
    const base = () => [makeUnit('h1', HOST, { weapons: [weapon('blade')] }), makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 5 } })];
    const charge = (state: GameState) =>
      validateAction(
        state,
        createAction(HOST, 'charge', {
          type: 'charge',
          attackerId: 'h1',
          targetId: 'g1',
          path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }],
          weaponId: 'blade',
        })
      );
    expect(charge(makeState(base())).valid).toBe(true);

    const withEnemyBystander = makeState([...base(), makeUnit('g2', GUEST, { position: { x: 1.6, y: 0, z: 4 } })]);
    const enemyRes = charge(withEnemyBystander);
    expect(enemyRes.valid).toBe(false);
    expect(enemyRes.reason).toBe(KEEP_AWAY_REASON);

    const withFriend = makeState([...base(), makeUnit('h2', HOST, { position: { x: -1.6, y: 0, z: 4 } })]);
    expect(charge(withFriend).valid).toBe(false);
  });
});

describe('models never move through other models', () => {
  it('a move is blocked by a lone model of a squad whose anchor is far from the path', () => {
    const state = makeState([makeUnit('h1', HOST), squad('g1', GUEST, [[0, 3], [6, 3]])]);
    const res = validateAction(state, move('h1', [[0, 0], [0, 6]]));
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('blocked');
  });

  it('a charge may touch its target but not walk through one of its models to reach another', () => {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('blade')] }),
      squad('g1', GUEST, [[0, 3], [0, 6]]),
    ]);
    const res = validateAction(
      state,
      createAction(HOST, 'charge', {
        type: 'charge',
        attackerId: 'h1',
        targetId: 'g1',
        path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }],
        weaponId: 'blade',
      })
    );
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('blocked by another fighter');
  });
});

describe('charges measure to the closest target model', () => {
  const chargeTo = (state: GameState, z: number) =>
    validateAction(
      state,
      createAction(HOST, 'charge', {
        type: 'charge',
        attackerId: 'h1',
        targetId: 'g1',
        path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z }],
        weaponId: 'blade',
      })
    );

  it('reaches a squad whose front model is in contact even though its centroid is 1.4" further', () => {
    // models at z = 5 and z = 7.8: anchor at z = 6.4
    const state = makeState([makeUnit('h1', HOST, { weapons: [weapon('blade')] }), squad('g1', GUEST, [[0, 5], [0, 7.8]])]);
    expect(chargeTo(state, 4).valid).toBe(true);
  });

  it('still needs real contact: ending 1" short of the closest model is rejected', () => {
    const state = makeState([makeUnit('h1', HOST, { weapons: [weapon('blade')] }), squad('g1', GUEST, [[0, 5], [0, 7.8]])]);
    const res = chargeTo(state, 3);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('Charge must end in engagement range');
  });

  it('a fight is valid against a squad when any of its models is in range, whatever the anchor says', () => {
    const attacker = makeUnit('h1', HOST, { weapons: [weapon('blade')], status: ['engaged'] });
    const target = squad('g1', GUEST, [[0, 1.3], [0, 4.5], [0, 7.7]]);
    const state = makeState([attacker, target]);
    const res = validateAction(
      state,
      createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId: 'blade' })
    );
    expect(res.valid).toBe(true);
    target.models.forEach((m, i) => (m.position = { x: 0, y: 0, z: 4 + i * 2 }));
    const far = validateAction(
      state,
      createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId: 'blade' })
    );
    expect(far.valid).toBe(false);
  });
});

describe('who strikes in melee', () => {
  // Charger column: models 1" apart along z, charge distance 6" (each model closes up as far as it can walk)
  const chargerColumn = () =>
    squad('h1', HOST, [[0, 3.5], [0, 2.5], [0, 1.5], [0, 0.5]], { weapons: [weapon('blade')], speed: 3 });

  it('only models within 2" of a target model roll attacks on a charge (pooled)', () => {
    // Models end at z = 9, 8, 7, 6; the target is at z = 10.
    const state = makeState([chargerColumn(), makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 10 } })]);
    const charge = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 7.5 }],
      modelPositions: [9, 8, 7, 6].map((z) => ({ x: 0, y: 0, z })),
      weaponId: 'blade',
    });
    expect(validateAction(state, charge).valid).toBe(true);
    // gaps to the target: 0", 1", 2" (all strike), 3" (too far): 3 models x 2 attacks
    expect(getDiceSpecs(state, charge)?.find((s) => s.purpose === 'to-hit')?.count).toBe(6);

    const rolls: DiceResult[] = [
      { purpose: 'to-hit', rolls: [1, 1, 1, 1, 1, 1] } as DiceResult,
      { purpose: 'defense', rolls: [6, 6, 6, 6, 6, 6] } as DiceResult,
      { purpose: 'trauma', rolls: [1] } as DiceResult,
    ];
    const out = applyAction(state, charge, rolls);
    expect(out.ok).toBe(true);
    expect(out.logEntry?.dice?.outcome.attackCount).toBe(6);
  });

  it('the defenders strike back with the models within 2" of the charger', () => {
    const attacker = makeUnit('h1', HOST, { weapons: [weapon('blade')], position: { x: 0, y: 0, z: 0 } });
    // Defender column: z = 1, 2, 3 (gaps 0", 1", 2") plus z = 4.5 (gap 3.5") -> 3 strike
    const defender = squad('g1', GUEST, [[0, 1], [0, 2], [0, 3], [0, 4.5]], { weapons: [weapon('fists')] });
    const state = makeState([attacker, defender], 'h1');
    state.turnState.pendingReaction = {
      id: 'reaction-test',
      type: 'melee-retaliation',
      promptingPlayerId: GUEST,
      sourceUnitId: 'h1',
      targetUnitId: 'g1',
      title: 'Retaliation',
      description: 'Strike back',
      options: [],
      expiresAt: Date.now() + 10000,
      durationMs: 10000,
      data: { weaponId: 'fists' },
    };
    const ret = createAction(GUEST, 'respond-reaction', { reactionId: 'reaction-test', choiceId: 'strike-back' });
    expect(getDiceSpecs(state, ret)?.find((s) => s.purpose === 'to-hit')?.count).toBe(3);
  });

  it('a single-model charger still rolls its full attacks', () => {
    const state = makeState([
      makeUnit('h1', HOST, { weapons: [weapon('blade')] }),
      makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 5 } }),
    ]);
    const charge = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      path: [{ x: 0, y: 0, z: 4 }],
      weaponId: 'blade',
    });
    expect(getDiceSpecs(state, charge)?.find((s) => s.purpose === 'to-hit')?.count).toBe(2);
  });

  it('a fight uses the same rule', () => {
    const attacker = squad('h1', HOST, [[0, 0], [0, -1], [0, -2.1], [0, -3.2]], { weapons: [weapon('blade')], status: ['engaged'] });
    const target = makeUnit('g1', GUEST, { position: { x: 0, y: 0, z: 1 }, status: ['engaged'] });
    const state = makeState([attacker, target]);
    const fight = createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId: 'blade' });
    // gaps: 0, 1, 2.1, 3.2 -> two strike
    expect(getDiceSpecs(state, fight)?.find((s) => s.purpose === 'to-hit')?.count).toBe(4);
  });
});
