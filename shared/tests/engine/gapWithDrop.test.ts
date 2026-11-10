import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { collectWalkableSurfaces, findWalkableSurfaceAt } from '../../src/engine/spatial';
import { classifySegment, detectPathGapJump, findJumpOption } from '../../src/engine/traversal';

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

function makeUnit(position: Vector3): Unit {
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
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  } as Unit;
}

function makeState(unit: Unit, terrain: TerrainPiece[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
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

// a: ground container; b: stacked on a (top 4.5"); c: open air beyond b's +z edge (top 2.25")
const a = piece('a', 'shipping-container', P(0, 0, 0));
const b = piece('b', 'shipping-container', P(0, 2.25, 0));
const c = piece('c', 'shipping-container', P(0, 0, 6.05));
const repro = [a, b, c];
// an edge snap puts the model 0.5" inside b's +z edge
const takeoff = P(0, 4.5, 0.6);
const landing = P(0, 2.25, 5.5); // 0.575" inside c's near edge (z 4.925)

const moveAction = (path: Vector3[], traversal?: object, type: 'advance' | 'rush' = 'advance') =>
  createAction(HOST, type, {
    type,
    unitId: 'u',
    path,
    finalPosition: path[path.length - 1],
    ...(traversal ? { traversal } : {}),
  } as any);

describe('gap jump that also drops (4.5" stack to a 2.25" container)', () => {
  const unit = makeUnit(takeoff);
  const state = makeState(unit, repro);

  it('the hop is classified as a jump-gap by the gap distance, not as a safe drop', () => {
    const cls = classifySegment(state, takeoff, landing, unit);
    expect(cls.kind).toBe('jump-gap');
    expect(cls.cost).toBe(0);
    expect(cls.dice).toBe(2);
    // measured like a tape, take-off to landing: 4.9" across and 2.25" down
    expect(cls.distance).toBeCloseTo(Math.hypot(4.9, 2.25), 2);
  });

  it('at the edges the container hop (3.8" gap, 2.25" drop) is a 4.42" tape: 2 dice', () => {
    const edge = P(0, 4.5, 1.125);
    const far = P(0, 2.25, 4.925);
    const cls = classifySegment(state, edge, far, unit);
    expect(cls).toMatchObject({ kind: 'jump-gap', dice: 2 });
    expect(cls.distance).toBeCloseTo(4.42, 2);
    expect(detectPathGapJump(state, [edge, far], unit)).toMatchObject({ isGapJump: true, dice: 2 });
  });

  it('findJumpOption offers it from the edge spot and the path detector agrees', () => {
    const opt = findJumpOption(state, unit, takeoff, landing);
    expect(opt?.kind).toBe('jump-gap');
    expect(opt?.dice).toBe(2);
    expect(detectPathGapJump(state, [takeoff, landing], unit).isGapJump).toBe(true);
  });

  for (const type of ['advance', 'rush'] as const) {
    it(`the host accepts the declared ${type}`, () => {
      const opt = findJumpOption(state, unit, takeoff, landing)!;
      const act = moveAction(opt.path, { kind: opt.kind, takeoff: opt.takeoff, landing: opt.landing }, type);
      expect(validateAction(state, act)).toEqual({ valid: true });
      expect(getDiceSpecs(state, act)![0]).toMatchObject({ count: 2, purpose: 'gap_jump' });
    });

    it(`the host still rejects the ${type} when it is not declared`, () => {
      const v = validateAction(state, moveAction([takeoff, landing], undefined, type));
      expect(v.valid).toBe(false);
    });
  }

  it('a failed jump falls into the gap and lands on the ground, ending the activation', () => {
    const act = moveAction([takeoff, landing], { kind: 'jump-gap', takeoff, landing });
    const out = applyAction(state, act, [roll('gap_jump', [1, 1]), roll('falling_defense', [6]), roll('trauma', [1])]);
    if (!out.ok) throw new Error(out.reason);
    const u = out.state.units[0];
    expect(u.position.y).toBe(0);
    expect(u.position.z).toBeGreaterThan(1);
    expect(u.position.z).toBeLessThan(4.925);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('a passed jump lands on the lower roof', () => {
    const act = moveAction([takeoff, landing], { kind: 'jump-gap', takeoff, landing });
    const out = applyAction(state, act, [roll('gap_jump', [3, 3])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].position).toMatchObject({ x: 0, y: 2.25, z: 5.5 });
  });

  it('a gap of 1" or less with a small drop is still a free drop', () => {
    const near = piece('c2', 'shipping-container', P(0, 0, 3.05)); // near edge at z = 1.925: 0.925" gap
    const s = makeState(unit, [a, b, near]);
    const to = P(0, 2.25, 2.5);
    const cls = classifySegment(s, takeoff, to, unit);
    expect(cls.kind).toBe('drop');
    expect(detectPathGapJump(s, [takeoff, to], unit).isGapJump).toBe(false);
    expect(validateAction(s, moveAction([takeoff, to])).valid).toBe(true);
  });
});

describe('jump distance is the straight-line hop, with a 6" limit', () => {
  const deck = (id: string, x: number, topY: number): TerrainPiece =>
    ({
      id,
      terrainType: 'platform',
      position: { x, y: topY, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.3, z: 4 },
      elevation: topY,
      isWalkable: true,
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
    }) as TerrainPiece;
  const upper = deck('up', 0, 6); // x -2..2, top 6

  it('a 2.9" gap with a 2.9" drop is a 4.1" hop: 2 dice (a drop that also crosses air is one gap jump)', () => {
    const lower = deck('lo', 6.9, 3.1); // x 4.9..8.9
    const u = makeUnit(P(2, 6, 0));
    const s = makeState(u, [upper, lower]);
    const cls = classifySegment(s, P(2, 6, 0), P(4.9, 3.1, 0), u);
    expect(cls.kind).toBe('jump-gap');
    expect(cls.distance).toBeCloseTo(4.1, 1);
    expect(cls.dice).toBe(2);
    expect(detectPathGapJump(s, [P(2, 6, 0), P(4.9, 3.1, 0)], u).dice).toBe(2);
  });

  it('a gap hop that drops over 3" rolls one set of gap dice, not a second drop test', () => {
    const tall = deck('tall', 0, 8);
    const lower = deck('lo', 5, 3.5); // x 3..7: a 1.0"+ gap and a 4.5" drop
    const u = makeUnit(P(1.6, 8, 0));
    const s = makeState(u, [tall, lower]);
    const hop = [P(1.6, 8, 0), P(3.9, 3.5, 0)];
    expect(classifySegment(s, hop[0], hop[1], u).kind).toBe('jump-gap');
    const act = moveAction(hop, { kind: 'jump-gap', takeoff: hop[0], landing: hop[1] });
    const purposes = getDiceSpecs(s, act)!.map((d) => d.purpose);
    expect(purposes.filter((p) => p === 'gap_jump')).toHaveLength(1);
    expect(purposes).not.toContain('drop_jump');
  });

  it('a 5" gap with a 5" drop is a 7.07" hop: blocked, never offered, and rejected by the host', () => {
    const lower = deck('lo', 9, 1); // x 7..11, top 1
    const u = makeUnit(P(1.6, 6, 0));
    const s = makeState(u, [upper, lower]);
    expect(classifySegment(s, P(2, 6, 0), P(7, 1, 0), u).kind).toBe('blocked');
    expect(findJumpOption(s, u, P(1.6, 6, 0), P(7.5, 1, 0))).toBeNull();
    const act = moveAction([P(1.6, 6, 0), P(7.5, 1, 0)], { kind: 'jump-gap', takeoff: P(1.6, 6, 0), landing: P(7.5, 1, 0) });
    expect(validateAction(s, act).valid).toBe(false);
  });

  it('a level hop is measured the same way: a 5.8" tape is 2 dice, 6.2" is blocked', () => {
    const b = deck('b', 9, 6); // x 7..11 level with the upper deck: a 5" gap
    const u = makeUnit(P(1.6, 6, 0));
    const s = makeState(u, [upper, b]);
    expect(classifySegment(s, P(1.6, 6, 0), P(7.4, 6, 0), u)).toMatchObject({ kind: 'jump-gap', dice: 2 });
    expect(classifySegment(s, P(1.6, 6, 0), P(7.8, 6, 0), u).kind).toBe('blocked');
  });
});

describe('every offered jump is accepted by the host (fixtures + repro)', () => {
  const loadTerrain = (name: string): TerrainPiece[] => {
    const raw = JSON.parse(readFileSync(join(__dirname, '../fixtures', name), 'utf8'));
    return (Array.isArray(raw) ? raw[0] : raw).terrain;
  };
  const cases: Array<[string, TerrainPiece[]]> = [
    ['testy-mctestface.json', loadTerrain('testy-mctestface.json')],
    ['testy-mctestface-2.json', loadTerrain('testy-mctestface-2.json')],
    ['repro', repro],
  ];

  for (const [name, terrain] of cases) {
    it(`${name}: findJumpOption results validate as advance and rush`, () => {
      const probe = makeState(makeUnit(P(0, 0, 0)), terrain);
      const tops = [...new Set(collectWalkableSurfaces(probe).map((s) => Math.round(s.topY * 100) / 100))];
      const xs = terrain.map((p) => p.position.x);
      const zs = terrain.map((p) => p.position.z);
      const [x0, x1] = [Math.min(...xs) - 6, Math.max(...xs) + 6];
      const [z0, z1] = [Math.min(...zs) - 6, Math.max(...zs) + 6];
      const spots: Vector3[] = [];
      for (let x = x0; x <= x1; x += 0.5) {
        for (let z = z0; z <= z1; z += 0.5) {
          for (const y of [0, ...tops]) {
            if (y === 0 || findWalkableSurfaceAt(probe, { x, y, z }, 0)) spots.push(P(x, y, z));
          }
        }
      }
      const froms = spots.filter((s) => (s.y ?? 0) >= 1);
      let offered = 0;
      let gapWithDrop = 0;
      for (const from of froms) {
        const unit = makeUnit(from);
        const state = makeState(unit, terrain);
        for (const to of spots) {
          if (Math.hypot(to.x - from.x, to.z - from.z) > 6.1 || to === from) continue;
          const opt = findJumpOption(state, unit, from, to);
          if (!opt) continue;
          offered++;
          if (opt.kind === 'jump-gap' && Math.abs((from.y ?? 0) - (to.y ?? 0)) > 0.5) gapWithDrop++;
          const traversal = { kind: opt.kind, takeoff: opt.takeoff, landing: opt.landing };
          for (const type of ['advance', 'rush'] as const) {
            const v = validateAction(state, moveAction(opt.path, traversal, type));
            // other legit rejections (move allowance, etc.) are not what this guards: only the jump check is
            if (!v.valid && /jump|edge|Declared/i.test(v.reason ?? '')) {
              throw new Error(`${name}: ${type} ${JSON.stringify(from)} -> ${JSON.stringify(to)} (${opt.kind}): ${v.reason}`);
            }
          }
        }
      }
      expect(offered).toBeGreaterThan(0);
      if (name === 'repro') expect(gapWithDrop).toBeGreaterThan(0);
    }, 120000);
  }
});
