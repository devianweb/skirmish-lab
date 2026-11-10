import { describe, it, expect } from 'vitest';
import { createInitialGameState, createAction } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { validateAction } from '../../src/engine/actions';
import {
  findEndOverlap,
  findNavPath,
  settleMoveEnd,
} from '../../src/engine/spatial';

const HOST = 'host-1';
const GUEST = 'guest-1';

function makeUnit(id: string, position: Vector3, ownerId = HOST): Unit {
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
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function piece(type: string, x: number, z: number, rotY = 0, y = 0): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id: `${type}-${x}-${z}`,
    terrainType: type,
    position: { x, y, z },
    rotation: { x: 0, y: rotY, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...(meta.isWalkable ? { isWalkable: true } : {}),
    ...(meta.climbType ? { climbType: meta.climbType } : {}),
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

describe('findEndOverlap: terrain', () => {
  const crate = piece('crate', 5, 0); // 1x1, 0.75 tall: x 4.5..5.5

  it('reports a base inside a crate', () => {
    const state = makeState([makeUnit('u', { x: 0, y: 0, z: 0 })], [crate]);
    expect(findEndOverlap(state, 'u', { x: 5, y: 0, z: 0 })).toMatchObject({ kind: 'terrain', pieceId: crate.id });
  });

  it('reports a base clipping the crate edge and clears it at exactly the movement clearance', () => {
    const state = makeState([makeUnit('u', { x: 0, y: 0, z: 0 })], [crate]);
    expect(findEndOverlap(state, 'u', { x: 4.2, y: 0, z: 0 })).not.toBeNull(); // 0.3" from the face
    expect(findEndOverlap(state, 'u', { x: 4.05, y: 0, z: 0 })).toBeNull(); // 0.45" from the face
  });

  it('reports a base clipping a standalone pillar', () => {
    const pillar = piece('support-pillar', 0, 5);
    const state = makeState([makeUnit('u', { x: 0, y: 0, z: 0 })], [pillar]);
    const half = pillar.scale.z / 2;
    expect(findEndOverlap(state, 'u', { x: 0, y: 0, z: 5 - half - 0.3 })).toMatchObject({ kind: 'terrain' });
    expect(findEndOverlap(state, 'u', { x: 0, y: 0, z: 5 - half - 0.5 })).toBeNull();
  });

  it('standing on top of a crate is not an overlap (the floor stood on does not count)', () => {
    const state = makeState([makeUnit('u', { x: 0, y: 0, z: 0 })], [crate]);
    expect(findEndOverlap(state, 'u', { x: 5, y: 0.75, z: 0 })).toBeNull();
  });

  it('standing on a deck is not an overlap, but its legs below are (at ground level inside a leg)', () => {
    const deck = piece('platform-small', 0, 10); // 4x4 deck on corner legs
    const state = makeState([makeUnit('u', { x: 0, y: 0, z: 0 })], [deck]);
    expect(findEndOverlap(state, 'u', { x: 0, y: 3, z: 10 })).toBeNull();
    expect(findEndOverlap(state, 'u', { x: 1.25, y: 3, z: 11.25 })).toBeNull(); // right above a leg
    expect(findEndOverlap(state, 'u', { x: 1.5, y: 0, z: 11.5 })).toMatchObject({ kind: 'terrain' }); // inside a leg
    expect(findEndOverlap(state, 'u', { x: 0, y: 0, z: 10 })).toBeNull(); // open space under the deck
  });

  it('standing under a lintel is not an overlap', () => {
    const door = piece('wall-doorway', 0, 5); // lintel from 2.25"
    const state = makeState([makeUnit('u', { x: 0, y: 0, z: 0 })], [door]);
    expect(findEndOverlap(state, 'u', { x: 0, y: 0, z: 5 })).toBeNull();
    expect(findEndOverlap(state, 'u', { x: door.scale.x / 2 - 0.1, y: 0, z: 5 })).toMatchObject({ kind: 'terrain' }); // in the jamb
  });

  it('a model right next to a wall (base touching) is fine', () => {
    const wall = piece('wall', 0, 5);
    const state = makeState([makeUnit('u', { x: 0, y: 0, z: 0 })], [wall]);
    const face = 5 - wall.scale.z / 2;
    expect(findEndOverlap(state, 'u', { x: 0, y: 0, z: face - 0.45 })).toBeNull();
    expect(findEndOverlap(state, 'u', { x: 0, y: 0, z: face - 0.2 })).not.toBeNull();
  });
});

describe('findEndOverlap: models', () => {
  const state = makeState(
    [makeUnit('u', { x: 0, y: 0, z: 0 }), makeUnit('e', { x: 10, y: 0, z: 0 }, GUEST)],
    []
  );

  it('reports another unit within 0.9 and clears at 0.91', () => {
    expect(findEndOverlap(state, 'u', { x: 9.12, y: 0, z: 0 })).toEqual({ kind: 'model', unitId: 'e' });
    expect(findEndOverlap(state, 'u', { x: 9.09, y: 0, z: 0 })).toBeNull();
    expect(findEndOverlap(state, 'u', { x: 9.0, y: 0, z: 0 })).toBeNull(); // base contact at 1.0
  });

  it('ignores models on another level, destroyed units and the mover itself', () => {
    expect(findEndOverlap(state, 'u', { x: 10, y: 3, z: 0 })).toBeNull();
    expect(findEndOverlap(state, 'e', { x: 10, y: 0, z: 0 })).toBeNull();
    const dead = makeState([makeUnit('u', { x: 0, y: 0, z: 0 }), makeUnit('e', { x: 10, y: 0, z: 0 }, GUEST)]);
    dead.units[1].isDestroyed = true;
    expect(findEndOverlap(dead, 'u', { x: 10, y: 0, z: 0 })).toBeNull();
  });

  it('checks every living model of a squad', () => {
    const squad = makeState([makeUnit('u', { x: 0, y: 0, z: 0 }), makeUnit('e', { x: 10, y: 0, z: 0 }, GUEST)]);
    squad.units[1].models = [
      { id: 'a', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 10, y: 0, z: 0 } },
      { id: 'b', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 10, y: 0, z: 3 } },
      { id: 'c', wounds: 1, maxWounds: 1, isDestroyed: true, position: { x: 10, y: 0, z: 6 } },
    ];
    expect(findEndOverlap(squad, 'u', { x: 10, y: 0, z: 3.3 })).toMatchObject({ kind: 'model' });
    expect(findEndOverlap(squad, 'u', { x: 10, y: 0, z: 6 })).toBeNull(); // the dead model is gone
  });
});

describe('settleMoveEnd', () => {
  const crate = piece('crate', 5, 0);
  const unit = makeUnit('u', { x: 0, y: 0, z: 0 });
  const state = makeState([unit], [crate]);

  it('pulls an overlapping end back along the path to the first clear point', () => {
    const settled = settleMoveEnd(state, unit, [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }]);
    const end = settled[settled.length - 1];
    expect(findEndOverlap(state, 'u', end)).toBeNull();
    expect(end.x).toBeGreaterThan(3.9);
    expect(end.x).toBeLessThan(4.1); // touching the crate, not far short of it
    expect(end.z).toBe(0);
  });

  it('never returns a point further along the path than the original end', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, { x: 4.6, y: 0, z: 0 }];
    const settled = settleMoveEnd(state, unit, path);
    expect(settled.length).toBeLessThanOrEqual(path.length);
    const end = settled[settled.length - 1];
    expect(end.x).toBeLessThanOrEqual(4.6 + 1e-9);
    expect(findEndOverlap(state, 'u', end)).toBeNull();
  });

  it('leaves a clear path unchanged', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }];
    expect(settleMoveEnd(state, unit, path)).toEqual(path);
  });

  it('walks back across segments when the whole last segment overlaps', () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5.2, y: 0, z: 0 }];
    const settled = settleMoveEnd(state, unit, path);
    const end = settled[settled.length - 1];
    expect(end.x).toBeLessThan(4.1);
    expect(findEndOverlap(state, 'u', end)).toBeNull();
  });

  it('returns just the start when nothing along the path is clear', () => {
    const inside = makeUnit('i', { x: 5, y: 0, z: 0 });
    const s = makeState([inside], [crate]);
    expect(settleMoveEnd(s, inside, [{ x: 5, y: 0, z: 0 }, { x: 5.1, y: 0, z: 0 }])).toEqual([{ x: 5, y: 0, z: 0 }]);
  });

  it('a settled path ends clear next to another unit', () => {
    const mover = makeUnit('m', { x: 0, y: 0, z: 0 });
    const s = makeState([mover, makeUnit('e', { x: 4, y: 0, z: 0 }, GUEST)]);
    const end = settleMoveEnd(s, mover, [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]).pop()!;
    expect(findEndOverlap(s, 'm', end)).toBeNull();
    expect(end.x).toBeLessThan(3.2);
  });
});

describe('pathfinding never plans an overlapping end', () => {
  it('a target inside a crate or under another model yields a clear end', () => {
    const crate = piece('crate', 5, 0);
    const mover = makeUnit('m', { x: 0, y: 0, z: 0 });
    const enemy = makeUnit('e', { x: 0, y: 0, z: 6 }, GUEST);
    const state = makeState([mover, enemy], [crate]);
    for (const target of [{ x: 5, y: 0, z: 0 }, { x: 4.4, y: 0, z: 0.3 }, { x: 0, y: 0, z: 6 }, { x: 0.2, y: 0, z: 5.5 }]) {
      const path = findNavPath(state, mover, target, 12);
      expect(findEndOverlap(state, 'm', path[path.length - 1]), JSON.stringify(target)).toBeNull();
    }
  });
});

describe('host rejects overlapping ends', () => {
  const crate = piece('crate', 5, 0);

  it('a move that ends inside terrain (nothing to path through) is rejected with a clear reason', () => {
    // The unit starts inside the crate and shuffles a hair: the sweep sees no segment to hit
    const unit = makeUnit('u', { x: 5, y: 0, z: 0 });
    const state = makeState([unit], [crate]);
    const res = validateAction(
      state,
      createAction(HOST, 'advance', {
        type: 'advance',
        unitId: 'u',
        path: [{ x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }],
        finalPosition: { x: 5, y: 0, z: 0 },
      })
    );
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/overlapping terrain/i);
  });

  it('a move or rush ending in a crate or on another model is rejected', () => {
    const unit = makeUnit('u', { x: 2, y: 0, z: 0 });
    const state = makeState([unit, makeUnit('e', { x: 0, y: 0, z: 8 }, GUEST)], [crate]);
    for (const [type, end] of [
      ['advance', { x: 5, y: 0, z: 0 }],
      ['rush', { x: 5, y: 0, z: 0 }],
      ['advance', { x: 0, y: 0, z: 8 }],
    ] as const) {
      const res = validateAction(
        state,
        createAction(HOST, type, { type, unitId: 'u', path: [{ x: 2, y: 0, z: 0 }, end], finalPosition: end })
      );
      expect(res.valid, `${type} ${JSON.stringify(end)}`).toBe(false);
    }
  });

  it('a squad model ending inside terrain is rejected (move and rush)', () => {
    const unit = makeUnit('u', { x: 5, y: 0, z: 0 });
    unit.models = [
      { id: 'a', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5, y: 0, z: 0 } },
      { id: 'b', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 6, y: 0, z: 0 } },
    ];
    const state = makeState([unit], [crate]);
    const positions = [
      { x: 5, y: 0, z: 0 },
      { x: 6.2, y: 0, z: 0 },
    ];
    for (const type of ['advance', 'rush'] as const) {
      const res = validateAction(
        state,
        createAction(HOST, type, {
          type,
          unitId: 'u',
          path: [{ x: 5.6, y: 0, z: 0 }, { x: 5.6, y: 0, z: 0 }],
          finalPosition: { x: 5.6, y: 0, z: 0 },
          modelPositions: positions,
          modelPaths: [
            [{ x: 5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }],
            [{ x: 6, y: 0, z: 0 }, { x: 6.2, y: 0, z: 0 }],
          ],
        })
      );
      expect(res.valid, type).toBe(false);
      expect(res.reason, type).toMatch(/Squad model 1.*overlapping terrain/i);
    }
  });

  it('a charge ending inside terrain is rejected, a normal base-contact charge is accepted', () => {
    const attacker = makeUnit('u', { x: 0, y: 0, z: 0 });
    const target = makeUnit('t', { x: 8, y: 0, z: 0 }, GUEST);
    const state = makeState([attacker, target], [piece('crate', 7.5, 0)]);
    const into = validateAction(
      state,
      createAction(HOST, 'charge', {
        type: 'charge',
        attackerId: 'u',
        targetId: 't',
        path: [{ x: 0, y: 0, z: 0 }, { x: 7.2, y: 0, z: 0 }],
      })
    );
    expect(into.valid).toBe(false);

    const clear = makeState([makeUnit('u', { x: 0, y: 0, z: 0 }), makeUnit('t', { x: 8, y: 0, z: 0 }, GUEST)]);
    const ok = validateAction(
      clear,
      createAction(HOST, 'charge', {
        type: 'charge',
        attackerId: 'u',
        targetId: 't',
        path: [{ x: 0, y: 0, z: 0 }, { x: 7, y: 0, z: 0 }],
      })
    );
    expect(ok.reason ?? '').not.toMatch(/overlapping/i);
  });

  it('moves that end next to a wall, a crate, or through a doorway are unaffected', () => {
    const wall = piece('wall', 0, 5);
    const unit = makeUnit('u', { x: 0, y: 0, z: 0 });
    const state = makeState([unit], [wall, piece('crate', 8, 0), piece('wall-doorway', 12, 0, Math.PI / 2)]);
    const face = 5 - wall.scale.z / 2;
    for (const end of [{ x: 0, y: 0, z: face - 0.46 }, { x: 7, y: 0, z: 0 }]) {
      const res = validateAction(
        state,
        createAction(HOST, 'advance', {
          type: 'advance',
          unitId: 'u',
          path: [{ x: 0, y: 0, z: 0 }, end],
          finalPosition: end,
        })
      );
      expect(res.reason ?? '', JSON.stringify(end)).not.toMatch(/overlapping/i);
    }
  });
});
