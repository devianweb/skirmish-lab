import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import {
  LADDER_STANDOFF,
  findMoveBlocker,
  findNavPath,
  getStairWaypoints,
  isSuspendedInMidAir,
} from '../../src/engine/spatial';
import { pathMovementCost } from '../../src/engine/traversal';
import { createAction } from '../../src/gameState';
import { validateAction } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';

function makeUnit(id: string, position: Vector3): Unit {
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

function piece(type: string, x: number, z: number, rotY = 0, id = `${type}-${x}-${z}`): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id,
    terrainType: type,
    position: { x, y: 0, z },
    rotation: { x: 0, y: rotY, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...(meta.isWalkable ? { isWalkable: true } : {}),
    ...(meta.climbType ? { climbType: meta.climbType } : {}),
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  return state;
}

/** Ladders snapped to each face of a 4x4 deck at the origin: local +Z points into the deck. */
const FACES = [
  { name: 'west', x: -2, z: 0, yaw: Math.PI / 2, out: { x: -1, z: 0 } },
  { name: 'east', x: 2, z: 0, yaw: -Math.PI / 2, out: { x: 1, z: 0 } },
  { name: 'south', x: 0, z: -2, yaw: 0, out: { x: 0, z: -1 } },
  { name: 'north', x: 0, z: 2, yaw: Math.PI, out: { x: 0, z: 1 } },
];

/** Horizontal distance from a point to the 4x4 deck footprint. */
function distToDeck(p: Vector3): number {
  const dx = Math.max(Math.abs(p.x) - 2, 0);
  const dz = Math.max(Math.abs(p.z) - 2, 0);
  return Math.hypot(dx, dz);
}

describe('ladder standing spots', () => {
  for (const f of FACES) {
    describe(`ladder on the ${f.name} face`, () => {
      const deck = piece('platform-small', 0, 0);
      const ladder = piece('ladder', f.x, f.z, f.yaw, 'ladder');
      const state = makeState([], [deck, ladder]);
      const { foot, head } = getStairWaypoints(state, ladder);

      it('foot is LADDER_STANDOFF outside the face at ground, head is the same inside at deck height', () => {
        expect(foot.y).toBe(0);
        expect(foot.x).toBeCloseTo(f.x + f.out.x * LADDER_STANDOFF, 2);
        expect(foot.z).toBeCloseTo(f.z + f.out.z * LADDER_STANDOFF, 2);
        expect(head.y).toBeCloseTo(3.0);
        expect(head.x).toBeCloseTo(f.x - f.out.x * LADDER_STANDOFF, 2);
        expect(head.z).toBeCloseTo(f.z - f.out.z * LADDER_STANDOFF, 2);
      });

      it('a base at the foot clears the deck; a base at the head is fully over the deck', () => {
        expect(distToDeck(foot)).toBeGreaterThanOrEqual(0.5);
        const mover = makeUnit('m', { x: 0, y: 0, z: 0 });
        const s = makeState([mover], [deck, ladder]);
        const approach = { x: foot.x + f.out.x * 2, y: 0, z: foot.z + f.out.z * 2 };
        expect(findMoveBlocker(s, mover, [approach, foot]).blocked).toBe(false);
        expect(distToDeck(head)).toBe(0);
        expect(Math.abs(head.x) + 0.5).toBeLessThanOrEqual(2 + 1e-6);
        expect(Math.abs(head.z) + 0.5).toBeLessThanOrEqual(2 + 1e-6);
      });

      it('ground to deck: foot, vertical climb at the foot, level step onto the head', () => {
        const mover = makeUnit('m', { x: foot.x + f.out.x * 3, y: 0, z: foot.z + f.out.z * 3 });
        const s = makeState([mover], [deck, ladder]);
        const path = findNavPath(s, mover, { x: 0, y: 3, z: 0 }, 20);
        const fi = path.findIndex((p) => Math.abs(p.x - foot.x) < 0.02 && Math.abs(p.z - foot.z) < 0.02 && p.y === 0);
        expect(fi).toBeGreaterThanOrEqual(0);
        const top = path[fi + 1];
        expect(top.x).toBeCloseTo(foot.x, 1);
        expect(top.z).toBeCloseTo(foot.z, 1);
        expect(top.y).toBeCloseTo(3.0);
        const hd = path[fi + 2];
        expect(hd.x).toBeCloseTo(head.x, 1);
        expect(hd.z).toBeCloseTo(head.z, 1);
        expect(hd.y).toBeCloseTo(3.0);
        for (let i = 1; i < path.length; i++) {
          const dy = Math.abs(path[i].y - path[i - 1].y);
          const dh = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
          if (dy > 0.5) expect(dh).toBeLessThan(0.05);
        }
      });

      it('going down mirrors it: head, level step to above the foot, vertical descent, foot', () => {
        const mover = makeUnit('m', { x: head.x, y: 3, z: head.z });
        const s = makeState([mover], [deck, ladder]);
        const path = findNavPath(s, mover, { x: foot.x + f.out.x * 3, y: 0, z: foot.z + f.out.z * 3 }, 20);
        const di = path.findIndex((p, i) => i > 0 && p.y < path[i - 1].y - 1);
        expect(di).toBeGreaterThan(1);
        expect(path[di - 1].x).toBeCloseTo(foot.x, 1);
        expect(path[di - 1].z).toBeCloseTo(foot.z, 1);
        expect(path[di - 1].y).toBeCloseTo(3.0);
        expect(path[di].x).toBeCloseTo(foot.x, 1);
        expect(path[di].z).toBeCloseTo(foot.z, 1);
        expect(path[di].y).toBe(0);
      });

      it('with too little budget to finish the climb the path ends at the foot, on the ground', () => {
        const mover = makeUnit('m', { x: foot.x + f.out.x * 3, y: 0, z: foot.z + f.out.z * 3 });
        const s = makeState([mover], [deck, ladder]);
        const path = findNavPath(s, mover, { x: 0, y: 3, z: 0 }, 3 + 2.9);
        const end = path[path.length - 1];
        expect(end.y).toBe(0);
        expect(end.x).toBeCloseTo(foot.x, 1);
        expect(end.z).toBeCloseTo(foot.z, 1);
      });

      it('costs only the climb height: the step onto/off the head is free', () => {
        const s = makeState([], [deck, ladder]);
        const up = [foot, { x: foot.x, y: 3, z: foot.z }, head];
        expect(pathMovementCost(s, up)).toBeCloseTo(3.0, 2);
        expect(pathMovementCost(s, [...up].reverse())).toBeCloseTo(3.0, 2);
        const mover = makeUnit('m', { x: foot.x + f.out.x * 3, y: 0, z: foot.z + f.out.z * 3 });
        const s2 = makeState([mover], [deck, ladder]);
        const path = findNavPath(s2, mover, { x: head.x, y: 3, z: head.z }, 6.0);
        const end = path[path.length - 1];
        expect(end.y).toBeCloseTo(3.0);
        expect(end.x).toBeCloseTo(head.x, 1);
        expect(end.z).toBeCloseTo(head.z, 1);
      });
    });
  }
});

describe('ladder onto a shipping container', () => {
  for (const f of [
    { name: 'east face', x: -6.5, z: -3, yaw: -Math.PI / 2, out: { x: 1, z: 0 } },
    { name: 'west face', x: -11.5, z: -3, yaw: Math.PI / 2, out: { x: -1, z: 0 } },
    { name: 'south face', x: -9, z: -4.125, yaw: 0, out: { x: 0, z: -1 } },
    { name: 'north face', x: -9, z: -1.875, yaw: Math.PI, out: { x: 0, z: 1 } },
  ]) {
    it(`ground to roof via a ladder on the ${f.name}`, () => {
      const container = piece('shipping-container', -9, -3, 0, 'container');
      const ladder = piece('ladder', f.x, f.z, f.yaw, 'ladder');
      ladder.scale.y = 2.25;
      const { foot } = getStairWaypoints(makeState([], [container, ladder]), ladder);
      const mover = makeUnit('m', { x: foot.x + f.out.x * 3, y: 0, z: foot.z + f.out.z * 3 });
      const state = makeState([mover], [container, ladder]);
      const target = { x: -9, y: 2.25, z: -3 };
      const path = findNavPath(state, mover, target, 20);
      const end = path[path.length - 1];
      expect(end.y).toBeCloseTo(2.25);
      expect(Math.hypot(end.x - target.x, end.z - target.z)).toBeLessThan(0.1);
      expect(findMoveBlocker(state, mover, path).blocked).toBe(false);
    });
  }
});

describe('mid-air guard on a map that contains a ladder (bug C)', () => {
  const deck = piece('platform-small', 0, 0);
  const ladder = piece('ladder', -2, 0, Math.PI / 2, 'ladder');
  const state = makeState([], [deck, ladder]);
  const { foot } = getStairWaypoints(state, ladder);

  it('points hanging in open air are still suspended even though a ladder exists elsewhere', () => {
    expect(isSuspendedInMidAir(state, { x: 10, y: 2, z: 10 })).toBe(true);
    expect(isSuspendedInMidAir(state, { x: foot.x - 2, y: 2, z: foot.z })).toBe(true);
  });

  it('points on the ladder climb line are not flagged by the mid-air guard', () => {
    expect(isSuspendedInMidAir(state, { x: foot.x, y: 1.5, z: foot.z })).toBe(false);
  });
});

describe('host rejects ending part-way up a ladder', () => {
  function setup() {
    const deck = piece('platform-small', 0, 4); // spans z 2..6; the ladder is on its south face
    const ladder = piece('ladder', 0, 2, 0, 'test-ladder');
    const unit = makeUnit('h1', { x: 0, y: 0, z: 0 });
    unit.speed = 12;
    const state = makeState([unit], [deck, ladder]);
    state.turnState.activeUnitId = 'h1';
    const { foot, head } = getStairWaypoints(state, ladder);
    return { state, foot, head };
  }
  const move = (state: GameState, path: Vector3[]) =>
    validateAction(
      state,
      createAction(HOST, 'advance', {
        type: 'advance',
        unitId: 'h1',
        path: [{ x: 0, y: 0, z: 0 }, ...path],
        finalPosition: path[path.length - 1],
      })
    );

  it('rejects an end on the climb line between foot and top', () => {
    const { state, foot } = setup();
    const res = move(state, [foot, { x: foot.x, y: 1.5, z: foot.z }]);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/ladder rungs/i);
  });

  it('accepts ending at the foot and at the head', () => {
    const { state, foot, head } = setup();
    expect(move(state, [foot]).valid).toBe(true);
    expect(move(state, [foot, { x: foot.x, y: 3, z: foot.z }, head]).valid).toBe(true);
  });

  it('with a ladder elsewhere, a move ending in open air is rejected', () => {
    const { state } = setup();
    const res = move(state, [{ x: 5, y: 0, z: 0 }, { x: 5, y: 2, z: 0 }]);
    expect(res.valid).toBe(false);
  });
});
