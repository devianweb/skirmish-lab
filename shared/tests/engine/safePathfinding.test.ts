import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import {
  findJumpOption,
  classifySegment,
  pathMovementCost,
  SegmentKind,
} from '../../src/engine/traversal';
import {
  findNavPath,
  findWalkableSurfaceAt,
  getDeckPoints,
  getWalkableSurfaces,
  isOnLadderClimbLine,
  isLadderPiece,
  isSuspendedInMidAir,
} from '../../src/engine/spatial';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';

function makeUnit(id: string, position: Vector3, budget = 12, rules: string[] = []): Unit {
  return {
    id,
    ownerId: HOST,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
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
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: rules,
    hasMoved: false,
    remainingMovement: budget,
  };
}

const map = JSON.parse(readFileSync(join(__dirname, '../fixtures/testy-mctestface.json'), 'utf8'))[0];
const terrain: TerrainPiece[] = map.terrain;

function makeState(unit: Unit, pieces: TerrainPiece[] = terrain): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = pieces;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  return state;
}

const ORDINARY: SegmentKind[] = ['walk', 'stairs', 'ladder', 'climb', 'drop', 'gap'];
const kindsOf = (state: GameState, unit: Unit, path: Vector3[]) =>
  path.slice(1).map((b, i) => classifySegment(state, path[i], b, unit).kind);
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

describe('classifySegment', () => {
  const unit = makeUnit('u', P(0, 0, 0));
  const state = makeState(unit, []);

  it('level ground is a walk costing its length', () => {
    expect(classifySegment(state, P(0, 0, 0), P(3, 0, 4), unit)).toMatchObject({ kind: 'walk', cost: 5 });
  });

  it('a drop of exactly 3" is ordinary and costs only its horizontal distance', () => {
    const c = classifySegment(state, P(2, 3, 0), P(2.5, 0, 0), unit);
    expect(c).toMatchObject({ kind: 'drop', height: 3, dice: 0 });
    expect(c.cost).toBeCloseTo(0.5);
  });

  it('a drop just over 3" is a jump (2 dice, 3+) and its cost is zero', () => {
    const c = classifySegment(state, P(2, 3.5, 0), P(2.5, 0, 0), unit);
    expect(c).toMatchObject({ kind: 'jump-drop', dice: 2, target: 3, cost: 0 });
    expect(classifySegment(state, P(2, 3.5, 0), P(2.5, 0, 0), makeUnit('p', P(0, 0, 0), 6, ['strider'])).target).toBe(2);
  });

  it('a drop of exactly 6" is still a jump; over 6" is a fall with no dice', () => {
    expect(classifySegment(state, P(0, 6, 0), P(0.5, 0, 0), unit).kind).toBe('jump-drop');
    const fall = classifySegment(state, P(0, 7, 0), P(0.5, 0, 0), unit);
    expect(fall).toMatchObject({ kind: 'fall', dice: 0, height: 7 });
  });

  it('flying never needs a jump', () => {
    const flyer = makeUnit('f', P(0, 0, 0), 6, ['flying']);
    expect(classifySegment(state, P(0, 5, 0), P(0.5, 0, 0), flyer).kind).toBe('drop');
  });

  it('a climb is only a climb up a climbable floor (rise at most 3"); elsewhere it is blocked', () => {
    const container: TerrainPiece = {
      id: 'c',
      terrainType: 'shipping-container',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 5, y: 2.25, z: 2.25 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    };
    const withBox = makeState(unit, [container]);
    expect(classifySegment(withBox, P(0, 0, -1.675), P(0, 2.25, -1.675), unit)).toMatchObject({ kind: 'climb', cost: 2.25 });
    expect(classifySegment(state, P(0, 0, 0), P(0, 2.25, 0), unit).kind).toBe('blocked'); // nothing to climb onto
    expect(classifySegment(state, P(0, 0, 0), P(0, 4.5, 0), unit).kind).toBe('blocked');
  });

  describe('gaps between decks', () => {
    const deckAt = (id: string, x: number): TerrainPiece => ({
      id,
      terrainType: 'platform',
      position: { x, y: 3, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.3, z: 4 },
      elevation: 3,
      isWalkable: true,
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
    });
    const at = (gap: number) => makeState(unit, [deckAt('a', 0), deckAt('b', 4 + gap)]); // a: -2..2
    it('a 1" gap is ordinary; 1.5" is a jump needing 1 die; the hop (take-off to landing) is limited to 6"', () => {
      expect(classifySegment(at(1), P(0, 3, 0), P(4, 3, 0), unit).kind).toBe('gap');
      const j = classifySegment(at(1.5), P(1.6, 3, 0), P(3.9, 3, 0), unit);
      expect(j).toMatchObject({ kind: 'jump-gap', dice: 1, cost: 0 });
      expect(j.distance).toBeCloseTo(2.3, 1);
      expect(classifySegment(at(5), P(1.6, 3, 0), P(7.4, 3, 0), unit)).toMatchObject({ kind: 'jump-gap', dice: 2 }); // 5.8"
      expect(classifySegment(at(5), P(0, 3, 0), P(9, 3, 0), unit).kind).toBe('blocked'); // a 9" hop, though only a 5" gap
      expect(classifySegment(at(7), P(1.6, 3, 0), P(9.4, 3, 0), unit).kind).toBe('blocked');
    });
    it('touching decks are a plain walk', () => {
      expect(classifySegment(at(0), P(0, 3, 0), P(3, 3, 0), unit).kind).toBe('walk');
    });
  });

  it('stairs and ladders on the fixture', () => {
    const fx = makeState(unit);
    // up the slope of the stairs at (7,0,3): foot z=5.2, head z=0.8
    expect(classifySegment(fx, P(7, 1.5, 3), P(7, 2.25, 2.25), unit).kind).toBe('stairs');
    // ladder at x=5: foot (4.45, 0, -1); climb line straight up
    expect(classifySegment(fx, P(4.45, 0, -1), P(4.45, 3, -1), unit)).toMatchObject({ kind: 'ladder', cost: 3 });
    // the free step on/off the ladder head
    expect(classifySegment(fx, P(4.45, 3, -1), P(5.55, 3, -1), unit)).toMatchObject({ kind: 'ladder', cost: 0 });
  });
});

describe('fixture: safe pathfinding (testy-mctestface)', () => {
  const run = (from: Vector3, to: Vector3, budget: number) => {
    const unit = makeUnit('m', from, budget);
    const state = makeState(unit);
    const path = findNavPath(state, unit, to, budget);
    return { unit, state, path, kinds: kindsOf(state, unit, path), cost: pathMovementCost(state, path) };
  };
  const end = (p: Vector3[]) => p[p.length - 1];

  it('ruin ledge to the ground in the gap steps off the open east end: a 3" drop, no jump, cost about 3.5', () => {
    const { path, kinds, cost } = run(P(-1, 3, 0), P(2.5, 0, 0), 12);
    expect(end(path)).toMatchObject({ x: 2.5, y: 0, z: 0 });
    expect(kinds).toContain('drop');
    expect(kinds.every((k) => ORDINARY.includes(k))).toBe(true);
    expect(kinds).not.toContain('ladder');
    expect(cost).toBeGreaterThan(3.2);
    expect(cost).toBeLessThan(4.2);
    // it left the ledge by the east end (x just past 0), never over the gap at deck height
    const drop = path.findIndex((p, i) => i > 0 && (path[i - 1].y ?? 0) - (p.y ?? 0) > 2.9);
    expect(path[drop].x).toBeLessThan(1);
  });

  it('platform A to the ground beside it takes the free edge drop, not the ladder', () => {
    const { path, kinds, cost } = run(P(7, 3, -1), P(2.5, 0, -1), 12);
    expect(end(path)).toMatchObject({ x: 2.5, y: 0, z: -1 });
    expect(kinds).toContain('drop');
    expect(kinds).not.toContain('ladder');
    expect(cost).toBeLessThan(5.2);
  });

  it('ledge to platform A never crosses the gap; with budget it goes round by the ground and the ladder', () => {
    const { path, kinds, state, unit } = run(P(-1, 3, 0), P(7, 3, -1), 14);
    expect(kinds.every((k) => ORDINARY.includes(k))).toBe(true);
    expect(end(path)).toMatchObject({ x: 7, y: 3, z: -1 });
    expect(isSuspendedInMidAir(state, end(path))).toBe(false);
    expect(findJumpOption(state, unit, path[0], end(path))).toBeNull(); // mid-ledge: not at an edge
  });

  it('ledge to platform A with a small budget ends on firm ground, never over the gap', () => {
    for (const budget of [1, 2, 3, 4, 5, 6]) {
      const { path, state } = run(P(-1, 3, 0), P(7, 3, -1), budget);
      expect(isSuspendedInMidAir(state, end(path))).toBe(false);
    }
  });

  it('from the ledge east edge the 5" gap jump to platform A is offered (2 dice, 3+); from mid-ledge it is not', () => {
    const unit = makeUnit('m', P(-0.2, 3, 0));
    const state = makeState(unit);
    const opt = findJumpOption(state, unit, P(-0.2, 3, 0), P(5.6, 3, -1))!;
    expect(opt).not.toBeNull();
    expect(opt.kind).toBe('jump-gap');
    expect(opt.distance).toBeGreaterThan(5.6); // take-off to landing, 3D
    expect(opt.distance).toBeLessThan(6.05);
    expect(opt.dice).toBe(2);
    expect(opt.target).toBe(3);
    expect(opt.takeoff).toMatchObject(P(-0.2, 3, 0));
    expect(opt.landing).toMatchObject(P(5.6, 3, -1));

    expect(findJumpOption(state, unit, P(-1.5, 3, 0), P(5.6, 3, -1))).toBeNull();
  });

  it('pathfinder jumps on 2+, flying needs no dice', () => {
    const pf = makeUnit('p', P(-0.2, 3, 0), 12, ['strider']);
    expect(findJumpOption(makeState(pf), pf, pf.position, P(5.6, 3, -1))!.target).toBe(2);
  });

  it('a drop of 3-6" from an edge is a jump down; over 6" is a fall with a warning flag; at most 3" is no option', () => {
    const tall = (h: number): TerrainPiece => ({
      id: 'tall',
      terrainType: 'platform',
      position: { x: 0, y: h, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.3, z: 4 },
      elevation: h,
      isWalkable: true,
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
    });
    const at = (h: number) => {
      const u = makeUnit('u', P(1.8, h, 0));
      return { u, s: makeState(u, [tall(h)]) };
    };
    const a4 = at(4);
    expect(findJumpOption(a4.s, a4.u, a4.u.position, P(3, 0, 0))).toMatchObject({
      kind: 'jump-drop',
      dice: 2,
      distance: 4.2, // 4" down plus the 0.7" step-off, measured as a tape
    });
    const a3 = at(3);
    expect(findJumpOption(a3.s, a3.u, a3.u.position, P(3, 0, 0))).toBeNull();
    const a7 = at(7);
    expect(findJumpOption(a7.s, a7.u, a7.u.position, P(3, 0, 0))).toMatchObject({ kind: 'fall', dice: 0 });
    // not at an edge: no option
    const mid = makeUnit('m', P(0, 4, 0));
    expect(findJumpOption(makeState(mid, [tall(4)]), mid, mid.position, P(3, 0, 0))).toBeNull();
  });

  it('ground beside the stairs reaches platform A by walking round the corner and up the stairs (about 10")', () => {
    const { path, kinds, cost } = run(P(10, 0, 4), P(7, 3, -1), 14);
    expect(end(path)).toMatchObject({ x: 7, y: 3, z: -1 });
    expect(kinds).toContain('stairs');
    expect(kinds).not.toContain('ladder');
    expect(cost).toBeGreaterThan(9);
    expect(cost).toBeLessThan(11.5);
  });

  it('no planned path ends in mid-air, mid-climb or uses a jump, whatever the target or budget', () => {
    const starts = [P(10, 0, 4), P(-1, 3, 0), P(7, 3, -1), P(12, 3, 0), P(0.55, 0, 0), P(4.45, 0, -1)];
    const targets: Vector3[] = [];
    for (let x = -8; x <= 22; x += 3) {
      for (let z = -6; z <= 6; z += 6) {
        targets.push(P(x, 0, z));
        const unit0 = makeUnit('t', P(x, 0, z));
        const surf = findWalkableSurfaceAt(makeState(unit0), { x, z }, 0);
        if (surf) targets.push(P(x, surf.topY, z));
      }
    }
    const state0 = makeState(makeUnit('z', P(0, 0, 0)));
    const ladders = state0.terrain.filter(isLadderPiece);
    let checked = 0;
    for (const start of starts) {
      for (const budget of [3, 8, 14]) {
        for (const t of targets) {
          const unit = makeUnit('m', start, budget);
          const state = makeState(unit);
          const path = findNavPath(state, unit, t, budget);
          const e = end(path);
          expect(isSuspendedInMidAir(state, e), `end ${JSON.stringify(e)} from ${JSON.stringify(start)} to ${JSON.stringify(t)}`).toBe(false);
          for (const l of ladders) expect(isOnLadderClimbLine(state, l, e)).toBe(false);
          for (const k of kindsOf(state, unit, path)) {
            expect(ORDINARY, `kind ${k} from ${JSON.stringify(start)} to ${JSON.stringify(t)}`).toContain(k);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);
});

describe('one source of truth for traversal', () => {
  const deckAt = (id: string, x: number): TerrainPiece => ({
    id,
    terrainType: 'platform',
    position: { x, y: 3, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 4, y: 0.3, z: 4 },
    elevation: 3,
    isWalkable: true,
    blocksLineOfSight: false,
    providesCover: false,
    isObstacle: false,
  });

  it('short hops never add up to a jump: a 2" gap is not crossed by chaining 1" steps', () => {
    const unit = makeUnit('u', P(0, 3, 0), 12); // deck a spans -2..2, deck b 4..8 (a 2" gap)
    const state = makeState(unit, [deckAt('a', 0), deckAt('b', 6)]);
    const path = findNavPath(state, unit, P(6, 3, 0), 12);
    expect(path[path.length - 1].x).toBeLessThan(2.2);
    expect(isSuspendedInMidAir(state, path[path.length - 1])).toBe(false);
  });

  it('a passed jump is free: the leap costs nothing, only the walking around it does', () => {
    const unit = makeUnit('u', P(0, 3, 0), 12);
    const state = makeState(unit, [deckAt('a', 0), deckAt('b', 6)]);
    expect(pathMovementCost(state, [P(1.8, 3, 0), P(4.2, 3, 0)])).toBe(0);
    expect(pathMovementCost(state, [P(0, 3, 0), P(1.8, 3, 0), P(4.2, 3, 0), P(6, 3, 0)])).toBeCloseTo(1.8 + 1.8);
    // a jump down is free too (the old rule charged its horizontal part)
    const tall = makeUnit('t', P(1.8, 4, 0));
    const tallState = makeState(tall, [{ ...deckAt('a', 0), position: { x: 0, y: 4, z: 0 }, elevation: 4 }]);
    expect(pathMovementCost(tallState, [P(1.8, 4, 0), P(3.8, 0, 0)])).toBe(0);
    // while an ordinary 3" drop still costs its horizontal distance
    expect(pathMovementCost(state, [P(2.5, 3, 0), P(3.5, 0, 0)])).toBeCloseTo(1);
  });

  it('a passed jump leaves the budget untouched when the jump path is just the leap', () => {
    const unit = makeUnit('u', P(1.8, 3, 0), 2);
    const state = makeState(unit, [deckAt('a', 0), deckAt('b', 6)]);
    const opt = findJumpOption(state, unit, P(1.8, 3, 0), P(4.6, 3, 0))!;
    expect(opt.kind).toBe('jump-gap');
    expect(pathMovementCost(state, opt.path, unit)).toBe(0);
  });
});

describe('deck points follow the piece rotation', () => {
  it.each([0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2])('every nav point on a ruin ledge lies on the ledge at yaw %f', (yaw) => {
    const meta = TERRAIN_PALETTE_CATALOG['ruin-l'];
    const piece: TerrainPiece = {
      id: 'r',
      terrainType: 'ruin-l',
      position: { x: 3, y: 0, z: -2 },
      rotation: { x: 0, y: yaw, z: 0 },
      scale: { ...meta.defaultScale },
      blocksLineOfSight: meta.blocksLineOfSight,
      providesCover: meta.providesCover,
      isObstacle: meta.isObstacle,
    };
    const unit = makeUnit('u', P(0, 0, 0));
    const state = makeState(unit, [piece]);
    for (const surface of getWalkableSurfaces(piece)) {
      for (const pt of getDeckPoints(piece, surface)) {
        const found = findWalkableSurfaceAt(state, pt, 0.02);
        expect(found, `${JSON.stringify(pt)} at yaw ${yaw}`).not.toBeNull();
        expect(found!.topY).toBeCloseTo(3);
      }
    }
  });
});

describe('host: jumps must be declared', () => {
  // unit on the ledge's east edge; platform A's west edge is 5" away
  const takeoff = P(-0.2, 3, 0);
  const landing = P(5.6, 3, -1);
  const roll = (purpose: string, rolls: number[]): DiceResult => ({
    rolls,
    total: rolls.reduce((a, b) => a + b, 0),
    finalTotal: rolls.reduce((a, b) => a + b, 0),
    purpose,
  });
  const moveAction = (path: Vector3[], traversal?: unknown) =>
    createAction(HOST, 'advance', {
      type: 'advance',
      unitId: 'u',
      path,
      finalPosition: path[path.length - 1],
      ...(traversal ? { traversal } : {}),
    });
  const declared = { kind: 'jump-gap', takeoff, landing };

  it('rejects a move that crosses the gap without declaring the jump', () => {
    const unit = makeUnit('u', takeoff, 6);
    const v = validateAction(makeState(unit), moveAction([takeoff, landing]));
    expect(v.valid).toBe(false);
    expect((v as { reason: string }).reason).toMatch(/needs a jump/i);
  });

  it('accepts the declared jump, requests 2 jump dice, and a passed jump does not count toward the move', () => {
    const unit = makeUnit('u', takeoff, 1); // only 1" of movement left
    const state = makeState(unit);
    const action = moveAction([takeoff, landing], declared);
    expect(validateAction(state, action).valid).toBe(true);
    const specs = getDiceSpecs(state, action)!;
    expect(specs.find((s) => s.purpose === 'gap_jump')?.count).toBe(2);
    const out = applyAction(state, action, [roll('gap_jump', [4, 6]), roll('falling_defense', [6]), roll('trauma', [6])]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const u = out.state.units[0];
    expect(u.position).toMatchObject({ x: 5.6, y: 3, z: -1 });
    expect(u.remainingMovement).toBeCloseTo(1);
    expect(out.state.actionLog[out.state.actionLog.length - 1].dice!.outcome.traversal![0]).toMatchObject({
      type: 'gap-jump',
      passed: true,
    });
  });

  it('a failed declared jump falls into the gap and ends the activation', () => {
    const unit = makeUnit('u', takeoff, 6);
    const state = makeState(unit);
    const out = applyAction(state, moveAction([takeoff, landing], declared), [
      roll('gap_jump', [2, 6]),
      roll('falling_defense', [1]),
      roll('trauma', [1]),
    ]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.units[0].position.y).toBe(0);
    expect(out.state.turnState.activeUnitId).not.toBe('u');
  });

  it('rejects a declaration whose takeoff is mid-deck, whose kind or landing does not match, or that declares no jump', () => {
    const mid = P(-1.5, 3, 0);
    const unit = makeUnit('u', mid, 6);
    const state = makeState(unit);
    const a = validateAction(state, moveAction([mid, landing], { kind: 'jump-gap', takeoff: mid, landing }));
    expect(a.valid).toBe(false); // from mid-deck the hop is over 6" long: it cannot be a jump at all
    expect(findJumpOption(state, unit, mid, landing)).toBeNull();

    const edgeUnit = makeUnit('u', takeoff, 6);
    const edgeState = makeState(edgeUnit);
    expect(validateAction(edgeState, moveAction([takeoff, landing], { ...declared, kind: 'jump-drop' })).valid).toBe(false);
    expect(validateAction(edgeState, moveAction([takeoff, landing], { ...declared, landing: P(5.9, 3, -1) })).valid).toBe(false);
    // declaring a jump on an ordinary walk
    const walk = [takeoff, P(-1, 3, 0)];
    expect(validateAction(edgeState, moveAction(walk, { kind: 'jump-gap', takeoff, landing: P(-1, 3, 0) })).valid).toBe(false);
  });

  it('a fall (over 6") must also be declared; a 4" jump down must be declared too', () => {
    const tallDeck = (h: number): TerrainPiece => ({
      id: 'tall',
      terrainType: 'platform',
      position: { x: 0, y: h, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.3, z: 4 },
      elevation: h,
      isWalkable: true,
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
    });
    for (const [h, kind] of [[4, 'jump-drop'], [7, 'fall']] as const) {
      const from = P(1.8, h, 0);
      const to = P(3, 0, 0);
      const unit = makeUnit('u', from, 6);
      const state = makeState(unit, [tallDeck(h)]);
      const bare = validateAction(state, moveAction([from, to]));
      expect(bare.valid).toBe(false);
      expect((bare as { reason: string }).reason).toMatch(/needs a jump/i);
      const ok = validateAction(state, moveAction([from, to], { kind, takeoff: from, landing: to }));
      expect(ok.valid, JSON.stringify(ok)).toBe(true);
    }
  });

  it('ordinary moves with a 3" drop or a 1" gap need no declaration', () => {
    const from = P(7, 3, -1);
    const via = [from, P(4.45, 3, -2.4), P(4.45, 0, -2.4), P(3, 0, -2.4)];
    const unit = makeUnit('u', from, 12);
    const v = validateAction(makeState(unit), moveAction(via));
    expect(v.valid, JSON.stringify(v)).toBe(true);
  });
});
