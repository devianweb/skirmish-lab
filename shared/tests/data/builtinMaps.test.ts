import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { BUILTIN_MAPS, createStandardBattlefieldMap } from '../../src/data/builtinMaps';
import { applyDefaultScenario } from '../../src/data/scenario';
import { TERRAIN_PALETTE_CATALOG, CustomMapDefinition } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { getDeploymentZoneBounds } from '../../src/engine/activation';
import { findNavPath, getWalkableSurfaces, hasLineOfSight } from '../../src/engine/spatial';
import { localToWorldXZ, worldToLocal } from '../../src/engine/terrainStructure';
import { validateDeclaredTraversal } from '../../src/engine/traversal';

const HOST = 'host-1';
const GUEST = 'guest-1';
const TABLE_AREA = 48 * 48;
const TWO_PI = Math.PI * 2;

// ---- helpers ---------------------------------------------------------------------------------------------

const map = createStandardBattlefieldMap();
const isFitting = (p: TerrainPiece) => p.terrainType === 'ladder' || p.terrainType === 'stairs';
const counted = map.terrain.filter((p) => !isFitting(p));
const obstacles = map.terrain.filter((p) => p.isObstacle);

type Pt = { x: number; z: number };

function corners(p: TerrainPiece): Pt[] {
  const hx = p.scale.x / 2;
  const hz = p.scale.z / 2;
  return [
    localToWorldXZ(p, -hx, -hz),
    localToWorldXZ(p, hx, -hz),
    localToWorldXZ(p, hx, hz),
    localToWorldXZ(p, -hx, hz),
  ];
}

function pointInPiece(p: TerrainPiece, pt: Pt, margin = 0): boolean {
  const l = worldToLocal(p, { x: pt.x, y: 0, z: pt.z });
  return Math.abs(l.x) <= p.scale.x / 2 + margin && Math.abs(l.z) <= p.scale.z / 2 + margin;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function pointToPieceDistance(pt: Pt, p: TerrainPiece): number {
  if (pointInPiece(p, pt)) return 0;
  const c = corners(p);
  return Math.min(...c.map((a, i) => segDist(pt, a, c[(i + 1) % 4])));
}

/** Distance between two convex footprints (0 when they touch or overlap). */
function pieceGap(a: TerrainPiece, b: TerrainPiece): number {
  const ca = corners(a);
  const cb = corners(b);
  if (ca.some((c) => pointInPiece(b, c)) || cb.some((c) => pointInPiece(a, c))) return 0;
  // Crossing edges without a corner inside (a plus shape).
  const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const a1 = ca[i], a2 = ca[(i + 1) % 4], b1 = cb[j], b2 = cb[(j + 1) % 4];
      if (cross(a1, a2, b1) * cross(a1, a2, b2) < 0 && cross(b1, b2, a1) * cross(b1, b2, a2) < 0) return 0;
    }
  }
  const d = (pts: Pt[], other: Pt[]) =>
    Math.min(...pts.flatMap((pt) => other.map((o, i) => segDist(pt, o, other[(i + 1) % 4]))));
  return Math.min(d(ca, cb), d(cb, ca));
}

const isPlatformJoin = (a: TerrainPiece, b: TerrainPiece) => {
  const deck = (t: string) => t === 'platform-small' || t === 'platform-large';
  return (
    (deck(a.terrainType) && b.terrainType === 'catwalk') || (a.terrainType === 'catwalk' && deck(b.terrainType))
  );
};

function makeUnit(id: string, at: Vector3, ownerId = HOST): Unit {
  return {
    id, ownerId, armyId: 'army-1', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: { ...at }, rotation: { x: 0, y: 0, z: 0 }, status: [], wounds: 1, maxWounds: 1,
    isActivated: false, isDestroyed: false, models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [], hasMoved: false, remainingMovement: 200,
  };
}

function stateWithMap(): GameState {
  const state = createInitialGameState(HOST, GUEST);
  applyDefaultScenario(state, { customMap: createStandardBattlefieldMap() });
  state.units = [];
  return state;
}

/** Plan a route with a huge budget; returns whether it arrives with no jump or fall. */
function walkable(state: GameState, from: Vector3, to: Vector3): { arrived: boolean; noJump: boolean; end: Vector3 } {
  const unit = makeUnit('walker', from);
  state.units = [unit];
  const path = findNavPath(state, unit, to, 200);
  const end = path[path.length - 1];
  const arrived = Math.hypot(end.x - to.x, end.z - to.z) < 0.3 && Math.abs((end.y ?? 0) - (to.y ?? 0)) < 0.3;
  return { arrived, noJump: validateDeclaredTraversal(state, unit, path, null) === null, end };
}

// ---- tests -----------------------------------------------------------------------------------------------

describe('Standard Battlefield: data integrity', () => {
  it('is registered as a built-in map', () => {
    expect(BUILTIN_MAPS['standard-battlefield']().id).toBe('standard-battlefield');
    expect(map.name).toBe('Standard Battlefield');
    expect(map.board).toEqual({ width: 48, height: 48 });
  });

  it('builds a fresh copy on each call (no shared references)', () => {
    const a = createStandardBattlefieldMap();
    const b = createStandardBattlefieldMap();
    a.terrain[0].position.x += 10;
    expect(b.terrain[0].position.x).not.toBe(a.terrain[0].position.x);
  });

  it('uses only catalog types at their default scale and flags, with unique stable ids', () => {
    const ids = new Set<string>();
    const problems: string[] = [];
    for (const p of map.terrain) {
      const meta = TERRAIN_PALETTE_CATALOG[p.terrainType];
      if (!meta) {
        problems.push(`${p.id}: type ${p.terrainType} not in catalog`);
        continue;
      }
      if (!/^std-[a-z-]+-\d+$/.test(p.id) || !p.id.startsWith(`std-${p.terrainType}-`)) problems.push(`${p.id}: bad id`);
      if (ids.has(p.id)) problems.push(`${p.id}: duplicate id`);
      ids.add(p.id);
      const s = meta.defaultScale;
      if (p.scale.x !== s.x || p.scale.y !== s.y || p.scale.z !== s.z) problems.push(`${p.id}: scale ${JSON.stringify(p.scale)}`);
      if (p.blocksLineOfSight !== meta.blocksLineOfSight) problems.push(`${p.id}: blocksLineOfSight`);
      if (p.providesCover !== meta.providesCover) problems.push(`${p.id}: providesCover`);
      if (p.isObstacle !== meta.isObstacle) problems.push(`${p.id}: isObstacle`);
      if (!!p.isWalkable !== !!meta.isWalkable) problems.push(`${p.id}: isWalkable`);
      if (p.climbType !== meta.climbType) problems.push(`${p.id}: climbType`);
      if (p.isDifficult !== meta.isDifficult) problems.push(`${p.id}: isDifficult`);
      if (p.isDangerous !== meta.isDangerous) problems.push(`${p.id}: isDangerous`);
      if (p.elevation !== undefined) problems.push(`${p.id}: carries a legacy elevation`);
      if (p.position.y !== 0 && !isFitting(p)) problems.push(`${p.id}: not on the ground`);
    }
    expect(problems).toEqual([]);
  });

  it('keeps positions on the 0.25" grid and yaws on quarter turns', () => {
    const problems: string[] = [];
    for (const p of map.terrain) {
      for (const v of [p.position.x, p.position.z]) {
        if (Math.abs(v * 4 - Math.round(v * 4)) > 1e-9) problems.push(`${p.id}: ${v}`);
      }
      const turns = (p.rotation.y || 0) / (Math.PI / 2);
      if (Math.abs(turns - Math.round(turns)) > 1e-9) problems.push(`${p.id}: yaw ${p.rotation.y}`);
    }
    expect(problems).toEqual([]);
  });

  it('is point-symmetric: every piece has a twin at (-x, -z) turned by pi', () => {
    const problems: string[] = [];
    for (const p of map.terrain) {
      // A piece centred on the board (the catwalk) is its own twin: a half turn leaves it unchanged.
      if (p.position.x === 0 && p.position.z === 0 && p.terrainType === 'catwalk') continue;
      const twin = map.terrain.find(
        (q) =>
          q.terrainType === p.terrainType &&
          Math.abs(q.position.x + p.position.x) < 1e-6 &&
          Math.abs(q.position.z + p.position.z) < 1e-6 &&
          Math.abs(q.position.y - p.position.y) < 1e-6 &&
          Math.abs((((q.rotation.y - p.rotation.y - Math.PI) % TWO_PI) + TWO_PI) % TWO_PI) < 1e-6
      );
      if (!twin) problems.push(`${p.id} has no twin`);
    }
    expect(problems).toEqual([]);
  });

  it('defines no objectives (the players place them after the roll-offs)', () => {
    expect(map.objectives ?? []).toEqual([]);
  });

  it('applyDefaultScenario copies the board and terrain (no shared references)', () => {
    const source: CustomMapDefinition = createStandardBattlefieldMap();
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { customMap: source });
    expect(state.board.width).toBe(48);
    expect(state.board.height).toBe(48);
    expect(state.terrain).toHaveLength(source.terrain.length);
    expect(state.terrain).toEqual(source.terrain);
    state.terrain[0].position.x += 5;
    expect(source.terrain[0].position.x).not.toBe(state.terrain[0].position.x);
  });
});

describe('Standard Battlefield: terrain mix', () => {
  const n = counted.length;

  it('at least half of the pieces block sight', () => {
    const k = counted.filter((p) => p.blocksLineOfSight).length;
    expect(k, `${k} of ${n} block sight (${((k / n) * 100).toFixed(0)}%)`).toBeGreaterThanOrEqual(n / 2);
  });

  it('at least a third of the pieces give cover', () => {
    const k = counted.filter((p) => p.providesCover).length;
    expect(k, `${k} of ${n} give cover`).toBeGreaterThanOrEqual(n / 3);
  });

  it('at least a third of the pieces are difficult', () => {
    const k = counted.filter((p) => p.isDifficult === true).length;
    expect(k, `${k} of ${n} are difficult`).toBeGreaterThanOrEqual(n / 3);
  });

  it('has at least two dangerous pieces', () => {
    const k = counted.filter((p) => p.isDangerous === true).length;
    expect(k, `${k} dangerous`).toBeGreaterThanOrEqual(2);
  });

  it('covers at least 18% of the table', () => {
    const area = counted.reduce((sum, p) => sum + p.scale.x * p.scale.z, 0);
    expect(area / TABLE_AREA, `footprint ${area}" sq of ${TABLE_AREA}" sq`).toBeGreaterThanOrEqual(0.18);
  });
});

describe('Standard Battlefield: spacing', () => {
  it('keeps every piece inside the board', () => {
    const problems: string[] = [];
    for (const p of map.terrain) {
      for (const c of corners(p)) {
        if (Math.abs(c.x) > 24 + 1e-6 || Math.abs(c.z) > 24 + 1e-6) problems.push(`${p.id} corner (${c.x}, ${c.z})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps obstacles at least 1.5" apart, except platforms joined to catwalks', () => {
    const problems: string[] = [];
    for (let i = 0; i < obstacles.length; i++) {
      for (let j = i + 1; j < obstacles.length; j++) {
        if (isPlatformJoin(obstacles[i], obstacles[j])) continue;
        const gap = pieceGap(obstacles[i], obstacles[j]);
        if (gap < 1.5) problems.push(`${obstacles[i].id} / ${obstacles[j].id}: gap ${gap.toFixed(2)}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('joins each platform flush to the catwalk', () => {
    const catwalk = map.terrain.find((p) => p.terrainType === 'catwalk')!;
    const decks = map.terrain.filter((p) => p.terrainType === 'platform-small');
    expect(decks).toHaveLength(2);
    for (const d of decks) expect(pieceGap(d, catwalk), d.id).toBeLessThan(1e-6);
  });
});

describe('Standard Battlefield: access fittings', () => {
  const platform = map.terrain.find((p) => p.terrainType === 'platform-small' && p.position.x < 0)!;

  it('puts the ladder on the platform west face, climbing into the deck', () => {
    const ladder = map.terrain.find((p) => p.terrainType === 'ladder' && p.position.x < 0)!;
    const l = worldToLocal(platform, ladder.position);
    expect(l.x).toBeCloseTo(-2, 5); // on the west face
    expect(Math.abs(l.z)).toBeLessThanOrEqual(2);
    expect(ladder.rotation.y).toBeCloseTo(Math.PI / 2, 5); // local +Z points into the floor
    expect(ladder.scale.y).toBeCloseTo(3, 5); // reaches the deck top
  });

  it('puts the stair head at the platform south face', () => {
    const stairs = map.terrain.find((p) => p.terrainType === 'stairs' && p.position.x < 0)!;
    const head = localToWorldXZ(stairs, 0, stairs.scale.z / 2);
    expect(head.x).toBeCloseTo(platform.position.x, 5);
    expect(head.z).toBeCloseTo(platform.position.z - platform.scale.z / 2, 5);
    expect(stairs.scale.y).toBeCloseTo(3, 5);
  });

  it('lets a model climb the ladder onto each platform deck without a jump', () => {
    const state = stateWithMap();
    for (const sx of [-1, 1]) {
      const r = walkable(state, { x: sx * 9.5, y: 0, z: 0 }, { x: sx * 5, y: 3, z: 0 });
      expect(r.arrived, `reached ${JSON.stringify(r.end)}`).toBe(true);
      expect(r.noJump).toBe(true);
    }
  });

  it('lets a model walk the stairs onto each platform deck without a jump', () => {
    const state = stateWithMap();
    for (const sx of [-1, 1]) {
      const r = walkable(state, { x: sx * 5, y: 0, z: -sx * 9 }, { x: sx * 5, y: 3, z: 0.5 * sx });
      expect(r.arrived, `reached ${JSON.stringify(r.end)}`).toBe(true);
      expect(r.noJump).toBe(true);
    }
  });
});

describe('Standard Battlefield: traversal sweep', () => {
  // Open ground in each quadrant, just outside the zones (where players are likely to put objectives)
  const quadrantSpots: Vector3[] = [
    { x: -12, y: 0, z: 9 },
    { x: 12, y: 0, z: -9 },
    { x: -12, y: 0, z: -9 },
    { x: 12, y: 0, z: 9 },
  ];
  const zones: Array<[string, Vector3]> = [
    ['host zone', { x: 0, y: 0, z: -20 }],
    ['guest zone', { x: 0, y: 0, z: 20 }],
  ];

  for (const [label, from] of zones) {
    it(`reaches open ground in every quadrant from the ${label} without jumps`, () => {
      const state = stateWithMap();
      const problems: string[] = [];
      for (const spot of quadrantSpots) {
        const r = walkable(state, from, spot);
        const id = `(${spot.x}, ${spot.z})`;
        if (!r.arrived) problems.push(`${id}: stopped at (${r.end.x}, ${r.end.z})`);
        else if (!r.noJump) problems.push(`${id}: needs a jump`);
      }
      expect(problems).toEqual([]);
    });
  }

  it('reaches the ruin ledge', () => {
    const state = stateWithMap();
    const ruin = state.terrain.find((p) => p.terrainType === 'ruin-l')!;
    const surface = getWalkableSurfaces(ruin).find((s) => s.topY > 0)!;
    const c = localToWorldXZ(ruin, (surface.minX + surface.maxX) / 2, (surface.minZ + surface.maxZ) / 2);
    const r = walkable(state, { x: 0, y: 0, z: -20 }, { x: c.x, y: surface.topY, z: c.z });
    expect(r.arrived, `stopped at ${JSON.stringify(r.end)}`).toBe(true);
    expect(r.noJump).toBe(true);
  });
});

describe('Standard Battlefield: line-of-sight symmetry sweep', () => {
  it('A sees B exactly when B sees A, for ground pairs within 24" on a 4" grid', () => {
    const state = stateWithMap();
    // The grid is offset by a few hundredths so no ray runs exactly along a piece corner (an exact graze is a
    // floating-point tie that can flip with direction); the spacing is still 4".
    const pts: Pt[] = [];
    for (let x = -21.83; x <= 22; x += 4) {
      for (let z = -21.57; z <= 22; z += 4) {
        if (!obstacles.some((p) => pointToPieceDistance({ x, z }, p) < 0.5)) pts.push({ x, z });
      }
    }
    const problems: string[] = [];
    let pairs = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) > 24) continue;
        pairs++;
        const a = makeUnit('a', { x: pts[i].x, y: 0, z: pts[i].z });
        const b = makeUnit('b', { x: pts[j].x, y: 0, z: pts[j].z }, GUEST);
        const ab = hasLineOfSight(state, a, b);
        const ba = hasLineOfSight(state, b, a);
        if (ab !== ba) problems.push(`(${pts[i].x}, ${pts[i].z}) -> (${pts[j].x}, ${pts[j].z}): ${ab} vs ${ba}`);
      }
    }
    expect(pairs).toBeGreaterThan(1000);
    expect(problems).toEqual([]);
  });
});
