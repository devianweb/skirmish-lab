import { createAction, createInitialGameState } from '../../src/gameState';
import { GameAction, GameState, Unit, Vector3 } from '../../src/gameTypes';
import { BUILTIN_MAPS } from '../../src/data/builtinMaps';
import { WEAPONS } from '../../src/data/weapons';
import { ValidationResult } from '../../src/engine/actions';
import { ClosestApproach, ClosestApproachOptions } from '../../src/engine/closestApproach';
import { findMoveBlocker, findNavPath, validateSquadCoherency } from '../../src/engine/spatial';
import { classifySegment, distance3D, isPathDifficult, pathMovementCost } from '../../src/engine/traversal';
import { livingModelPositions } from '../../src/engine/unitGeometry';

export const HOST = 'host-1';
export const GUEST = 'guest-1';

export type BuiltinMapId = 'standard-battlefield' | 'jump-range' | 'hazard-range';

export type NavCategory =
  | 'fast-path'
  | 'obstacle'
  | 'stairs'
  | 'ladder'
  | 'drop'
  | 'climb'
  | 'no-route'
  | 'clamped'
  | 'keep-away'
  | 'stop-before-difficult'
  | 'flying';

export interface ExtraUnitSpec {
  id: string;
  owner?: 'host' | 'guest';
  positions: Vector3[];
  specialRules?: string[];
}

export interface NavCase {
  id: string;
  map: BuiltinMapId;
  category: NavCategory;
  label: string;
  start: Vector3;
  destination: Vector3;
  maxDistance: number;
  specialRules?: string[];
  options?: {
    ignoreUnitId?: string;
    stopBeforeDifficult?: boolean;
    keepAway?: boolean;
  };
  extraUnits?: ExtraUnitSpec[];
  /** Optional directional hint for ladder checks ('up' | 'down'). */
  ladderDirection?: 'up' | 'down';
}

export interface ClosestApproachCase {
  id: string;
  map: BuiltinMapId;
  category: string;
  label: string;
  modelPositions: Vector3[];
  modelIndex: number;
  start: Vector3;
  budget: number;
  targetPositions: Vector3[];
  otherFinalPositions: Vector3[];
  extraUnits?: ExtraUnitSpec[];
  options?: ClosestApproachOptions;
  /** Category expectations checked on the returned result. */
  expectation: {
    nonNull: boolean;
    minCost?: number;
    maxGap?: number;
    minY?: number;
    maxY?: number;
    requireMultiSegment?: boolean;
    requireCoherentWithOthers?: boolean;
  };
}

export interface SquadChargeCase {
  id: string;
  map: BuiltinMapId;
  category: string;
  label: string;
  attackerSpots: Vector3[];
  targetSpots: Vector3[];
  ends: Vector3[];
  paths?: Vector3[][];
  speed?: number;
  extraUnits?: ExtraUnitSpec[];
  expectedValid: boolean;
  expectedReasonIncludes?: string;
}

export const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

export const r2 = (n: number): number => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

export const roundPoint = (p: Vector3): Vector3 => ({
  x: r2(p.x),
  y: r2(p.y ?? 0),
  z: r2(p.z),
});

export const roundPath = (path: Vector3[]): Vector3[] => path.map(roundPoint);

export function makeUnit(
  id: string,
  ownerId: string,
  positions: Vector3[],
  opts: { speed?: number; specialRules?: string[] } = {}
): Unit {
  const models = positions.map((pos, i) => ({
    id: `${id}-m${i + 1}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: { ...pos },
    rotation: { x: 0, y: 0, z: 0 },
  }));
  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cy = positions.reduce((s, p) => s + (p.y ?? 0), 0) / positions.length;
  const cz = positions.reduce((s, p) => s + p.z, 0) / positions.length;
  return {
    id,
    ownerId,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: opts.speed ?? 6,
    position: { x: cx, y: cy, z: cz },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: positions.length,
    maxWounds: positions.length,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models,
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: opts.specialRules ? [...opts.specialRules] : [],
    hasMoved: false,
    remainingMovement: (opts.speed ?? 6) * 2,
    isDeployed: true,
  };
}

export function buildMapState(mapId: BuiltinMapId, units: Unit[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  const map = BUILTIN_MAPS[mapId]();
  state.board.width = map.board?.width ?? 48;
  state.board.height = map.board?.height ?? 48;
  state.terrain = map.terrain;
  state.units = units;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.roundNumber = 1;
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = units[0]?.id ?? null;
  return state;
}

export function buildNavCaseState(c: NavCase): { state: GameState; unit: Unit } {
  const mover = makeUnit('mover', HOST, [c.start], { specialRules: c.specialRules });
  const extras = (c.extraUnits ?? []).map((e) =>
    makeUnit(e.id, e.owner === 'host' ? HOST : GUEST, e.positions, { specialRules: e.specialRules })
  );
  const state = buildMapState(c.map, [mover, ...extras]);
  return { state, unit: mover };
}

export function buildClosestApproachCaseState(c: ClosestApproachCase): {
  state: GameState;
  unit: Unit;
  target: Unit;
} {
  const unit = makeUnit('mover', HOST, c.modelPositions, { speed: 6 });
  const target = makeUnit('target', GUEST, c.targetPositions, { speed: 6 });
  const extras = (c.extraUnits ?? []).map((e) =>
    makeUnit(e.id, e.owner === 'host' ? HOST : GUEST, e.positions, { specialRules: e.specialRules })
  );
  const state = buildMapState(c.map, [unit, target, ...extras]);
  return { state, unit, target };
}

export function buildSquadChargeAction(c: SquadChargeCase): {
  state: GameState;
  action: GameAction;
} {
  const attacker = makeUnit('h1', HOST, c.attackerSpots, { speed: c.speed ?? 6 });
  const target = makeUnit('g1', GUEST, c.targetSpots, { speed: 6 });
  const extras = (c.extraUnits ?? []).map((e) =>
    makeUnit(e.id, e.owner === 'host' ? HOST : GUEST, e.positions, { specialRules: e.specialRules })
  );
  const state = buildMapState(c.map, [attacker, target, ...extras]);
  const paths = c.paths ?? c.attackerSpots.map((s, i) => [s, c.ends[i]]);
  const action = createAction(HOST, 'charge', {
    type: 'charge',
    attackerId: 'h1',
    targetId: 'g1',
    path: [c.attackerSpots[0], c.ends[0]],
    modelPositions: c.ends,
    modelPaths: paths,
    weaponId: 'blade',
  } as any);
  return { state, action };
}

/**
 * Verifies that `path` genuinely exercises what `c.category` and `c.label` say.
 * Throws an informative Error if a case does not match its category.
 */
export function verifyNavCaseCategory(c: NavCase, state: GameState, unit: Unit, path: Vector3[]): void {
  const fail = (msg: string): never => {
    throw new Error(`[${c.map}/${c.id}] (${c.category}) "${c.label}": ${msg}. path=${JSON.stringify(roundPath(path))}`);
  };
  if (path.length === 0) fail('returned empty path');
  const end = path[path.length - 1];
  const segKinds = path.slice(1).map((b, i) => classifySegment(state, path[i], b, unit, path[i - 1], path[i + 1]).kind);
  const opts = c.options ?? {};

  switch (c.category) {
    case 'fast-path': {
      if (path.length !== 2) fail(`expected 2 points, got ${path.length}`);
      if (distance3D(end, c.destination) > 0.05) fail(`did not arrive at destination (${distance3D(end, c.destination).toFixed(2)}")`);
      if (findMoveBlocker(state, unit, path, opts).blocked) fail('straight path is blocked');
      break;
    }
    case 'obstacle': {
      if (path.length < 3) fail(`expected detour (>= 3 points), got ${path.length}`);
      const direct = findMoveBlocker(state, unit, [c.start, c.destination], { ...opts, keepAway: false });
      if (!direct.blocked) fail('straight line was not blocked by terrain');
      if (distance3D(end, c.destination) > 0.25) fail(`did not arrive at destination (${distance3D(end, c.destination).toFixed(2)}")`);
      if (findMoveBlocker(state, unit, path, opts).blocked) fail('returned path is blocked');
      break;
    }
    case 'stairs': {
      const hasStairs = segKinds.some((k) => k === 'stairs');
      if (!hasStairs) fail(`expected a 'stairs' segment, got [${segKinds.join(', ')}]`);
      const maxDy = Math.max(...path.slice(1).map((b, i) => Math.abs((b.y ?? 0) - (path[i].y ?? 0))));
      if (maxDy < 0.5) fail('path had no significant vertical change on stairs');
      if (distance3D(end, c.destination) > 0.25) fail(`did not reach destination (${distance3D(end, c.destination).toFixed(2)}")`);
      break;
    }
    case 'ladder': {
      const ladderSegs = path.slice(1).filter((b, i) => {
        const a = path[i];
        const kind = segKinds[i];
        const dy = Math.abs((b.y ?? 0) - (a.y ?? 0));
        const dh = Math.hypot(b.x - a.x, b.z - a.z);
        return kind === 'ladder' && dy > 1.0 && dh < 0.1;
      });
      if (ladderSegs.length === 0) fail(`expected vertical 'ladder' segment, got [${segKinds.join(', ')}]`);
      if (c.ladderDirection === 'up') {
        const wentUp = path.slice(1).some((b, i) => segKinds[i] === 'ladder' && (b.y ?? 0) - (path[i].y ?? 0) > 1.0);
        if (!wentUp) fail('expected upward ladder climb');
      } else if (c.ladderDirection === 'down') {
        const wentDown = path.slice(1).some((b, i) => segKinds[i] === 'ladder' && (path[i].y ?? 0) - (b.y ?? 0) > 1.0);
        if (!wentDown) fail('expected downward ladder descent');
      }
      if (distance3D(end, c.destination) > 0.25) fail(`did not reach destination (${distance3D(end, c.destination).toFixed(2)}")`);
      break;
    }
    case 'drop': {
      const hasDrop = path.slice(1).some((b, i) => segKinds[i] === 'drop' && (path[i].y ?? 0) - (b.y ?? 0) > 0.5);
      if (!hasDrop) fail(`expected 'drop' descent > 0.5", got [${segKinds.join(', ')}]`);
      if (distance3D(end, c.destination) > 0.25) fail(`did not reach destination (${distance3D(end, c.destination).toFixed(2)}")`);
      break;
    }
    case 'climb': {
      const hasClimb = path.slice(1).some((b, i) => segKinds[i] === 'climb' && (b.y ?? 0) - (path[i].y ?? 0) > 0.5);
      if (!hasClimb) fail(`expected 'climb' ascent > 0.5", got [${segKinds.join(', ')}]`);
      if (distance3D(end, c.destination) > 0.25) fail(`did not reach destination (${distance3D(end, c.destination).toFixed(2)}")`);
      break;
    }
    case 'no-route': {
      if (distance3D(end, c.destination) <= 0.5) fail('expected no-route fallback, but reached destination');
      if (path.length > 2) fail(`expected 1-2 point fallback path, got ${path.length} points`);
      const cost = pathMovementCost(state, path, unit);
      if (cost >= c.maxDistance - 0.1) fail(`stopped at maxDistance (${cost.toFixed(2)} vs ${c.maxDistance}), looks clamped rather than no-route`);
      break;
    }
    case 'clamped': {
      if (distance3D(end, c.destination) <= 0.5) fail('expected clamping short of destination, but reached destination');
      const cost = pathMovementCost(state, path, unit);
      if (Math.abs(cost - c.maxDistance) > 0.015) {
        fail(`expected path cost ${c.maxDistance} (±0.015), got ${cost.toFixed(4)}`);
      }
      break;
    }
    case 'keep-away': {
      if (!opts.keepAway) fail('keepAway option must be true');
      if (!c.extraUnits || c.extraUnits.length === 0) fail('expected nearby extraUnits');
      if (findMoveBlocker(state, unit, path, opts).blocked) fail('returned path violates keepAway/blocker');
      const without = findNavPath(state, unit, c.destination, c.maxDistance, { ...opts, keepAway: false });
      const sameLen = path.length === without.length;
      const maxDiff = sameLen
        ? Math.max(...path.map((p, i) => distance3D(p, without[i])))
        : Infinity;
      if (maxDiff < 0.1) fail('keepAway: true produced the same path as keepAway: false');
      break;
    }
    case 'stop-before-difficult': {
      if (!opts.stopBeforeDifficult) fail('stopBeforeDifficult option must be true');
      if (c.maxDistance <= 6.0) fail('stopBeforeDifficult only triggers when maxDistance > 6.0');
      if (isPathDifficult(state, path, unit)) fail('path entered difficult terrain instead of stopping before it');
      const without = findNavPath(state, unit, c.destination, c.maxDistance, { ...opts, stopBeforeDifficult: false });
      const withoutEnd = without[without.length - 1];
      if (!isPathDifficult(state, without, unit) && distance3D(end, withoutEnd) < 0.5) {
        fail('stopBeforeDifficult: false did not cross difficult terrain or go further');
      }
      break;
    }
    case 'flying': {
      if (!unit.specialRules.includes('flying')) fail('unit must have flying special rule');
      if (path.length !== 2) fail(`expected 2-point straight flying path, got ${path.length}`);
      const groundUnit: Unit = { ...unit, specialRules: unit.specialRules.filter((r) => r !== 'flying') };
      const groundDirectBlocked = findMoveBlocker(state, groundUnit, [c.start, c.destination], opts).blocked;
      const groundPath = findNavPath(state, groundUnit, c.destination, c.maxDistance, opts);
      const groundEnd = groundPath[groundPath.length - 1];
      if (!groundDirectBlocked && groundPath.length === 2 && distance3D(end, groundEnd) < 0.2) {
        fail('flying unit took the exact same 2-point path as a ground unit');
      }
      break;
    }
  }
}

export function verifyClosestApproachCase(
  c: ClosestApproachCase,
  state: GameState,
  unit: Unit,
  res: ClosestApproach | null
): void {
  const fail = (msg: string): never => {
    throw new Error(`[closestApproach/${c.id}] "${c.label}": ${msg}`);
  };
  if (c.expectation.nonNull && !res) fail('expected non-null ClosestApproach, got null');
  if (!c.expectation.nonNull && res) fail(`expected null, got ${JSON.stringify(res)}`);
  if (!res) return;
  if (res.cost > c.budget + 0.05) fail(`cost ${res.cost} exceeded budget ${c.budget}`);
  if (c.expectation.minCost !== undefined && res.cost < c.expectation.minCost) {
    fail(`cost ${res.cost} < minCost ${c.expectation.minCost}`);
  }
  if (c.expectation.maxGap !== undefined && res.gap > c.expectation.maxGap) {
    fail(`gap ${res.gap} > maxGap ${c.expectation.maxGap}`);
  }
  if (c.expectation.minY !== undefined && (res.position.y ?? 0) < c.expectation.minY) {
    fail(`y ${res.position.y} < minY ${c.expectation.minY}`);
  }
  if (c.expectation.maxY !== undefined && (res.position.y ?? 0) > c.expectation.maxY) {
    fail(`y ${res.position.y} > maxY ${c.expectation.maxY}`);
  }
  if (c.expectation.requireMultiSegment && res.path.length < 3) {
    fail(`expected multi-segment detour path (>= 3 pts), got ${res.path.length}`);
  }
  if (c.expectation.requireCoherentWithOthers && !validateSquadCoherency([res.position, ...c.otherFinalPositions]).coherent) {
    fail('result broke squad coherency with otherFinalPositions');
  }
  // Sanity: verify target exists
  if (livingModelPositions(state.units.find((u) => u.id === 'target')!).length === 0) fail('target has no models');
  void unit;
}

export function verifySquadChargeCase(c: SquadChargeCase, res: ValidationResult): void {
  if (res.valid !== c.expectedValid) {
    throw new Error(
      `[squadCharge/${c.id}] "${c.label}": expected valid=${c.expectedValid}, got ${JSON.stringify(res)}`
    );
  }
  if (c.expectedReasonIncludes && !(res.reason ?? '').includes(c.expectedReasonIncludes)) {
    throw new Error(
      `[squadCharge/${c.id}] "${c.label}": expected reason containing "${c.expectedReasonIncludes}", got "${res.reason}"`
    );
  }
}

// ============================================================================
// 1. Standard Battlefield cases (44 findNavPath cases: 4 per category)
// ============================================================================
const STANDARD_CASES: NavCase[] = [
  // fast-path (4)
  {
    id: 'std-fast-1',
    map: 'standard-battlefield',
    category: 'fast-path',
    label: 'fast-path: open ground across host deployment zone',
    start: P(-4, 0, -20),
    destination: P(4, 0, -20),
    maxDistance: 12,
  },
  {
    id: 'std-fast-2',
    map: 'standard-battlefield',
    category: 'fast-path',
    label: 'fast-path: straight diagonal across clear mid-field',
    start: P(10, 0, -6),
    destination: P(14, 0, 2),
    maxDistance: 12,
  },
  {
    id: 'std-fast-3',
    map: 'standard-battlefield',
    category: 'fast-path',
    label: 'fast-path: straight along elevated catwalk top',
    start: P(-2, 3, 0),
    destination: P(2, 3, 0),
    maxDistance: 6,
  },
  {
    id: 'std-fast-4',
    map: 'standard-battlefield',
    category: 'fast-path',
    label: 'fast-path: step straight over low barricade',
    start: P(-12, 0, 4),
    destination: P(-12, 0, 8),
    maxDistance: 6,
  },

  // obstacle (4)
  {
    id: 'std-obs-1',
    map: 'standard-battlefield',
    category: 'obstacle',
    label: 'obstacle: route round 4" wall (-10, -12)',
    start: P(-10, 0, -15),
    destination: P(-10, 0, -9),
    maxDistance: 12,
  },
  {
    id: 'std-obs-2',
    map: 'standard-battlefield',
    category: 'obstacle',
    label: 'obstacle: route round 6" wall-long (8, -16)',
    start: P(8, 0, -19),
    destination: P(8, 0, -13),
    maxDistance: 14,
  },
  {
    id: 'std-obs-3',
    map: 'standard-battlefield',
    category: 'obstacle',
    label: 'obstacle: route round rotated wall-window (-20, -2)',
    start: P(-22, 0, -2),
    destination: P(-18, 0, -2),
    maxDistance: 12,
  },
  {
    id: 'std-obs-4',
    map: 'standard-battlefield',
    category: 'obstacle',
    label: 'obstacle: route round structural column (-3, -12)',
    start: P(-3, 0, -15),
    destination: P(-3, 0, -9),
    maxDistance: 12,
  },

  // stairs (4)
  {
    id: 'std-stairs-1',
    map: 'standard-battlefield',
    category: 'stairs',
    label: 'stairs: up host stairs (-5, -4) onto platform-small (-5, 0)',
    start: P(-5, 0, -9),
    destination: P(-5, 3, 0),
    maxDistance: 12,
  },
  {
    id: 'std-stairs-2',
    map: 'standard-battlefield',
    category: 'stairs',
    label: 'stairs: up guest stairs (5, 4) onto platform-small (5, 0)',
    start: P(5, 0, 9),
    destination: P(5, 3, 0),
    maxDistance: 12,
  },
  {
    id: 'std-stairs-3',
    map: 'standard-battlefield',
    category: 'stairs',
    label: 'stairs: from east side of stair wedge (-2.5, -4) round to foot and up onto deck',
    start: P(-2.5, 0, -4),
    destination: P(-5, 3, 0),
    maxDistance: 14,
  },
  {
    id: 'std-stairs-4',
    map: 'standard-battlefield',
    category: 'stairs',
    label: 'stairs: down host stairs from platform (-5, 0) to ground (-5, -9)',
    start: P(-5, 3, 0),
    destination: P(-5, 0, -9),
    maxDistance: 12,
  },

  // ladder (4)
  {
    id: 'std-ladder-1',
    map: 'standard-battlefield',
    category: 'ladder',
    label: 'ladder: up host ladder (-7, 0) onto platform-small (-5, 0)',
    start: P(-10, 0, 0),
    destination: P(-5, 3, 0),
    maxDistance: 12,
    ladderDirection: 'up',
  },
  {
    id: 'std-ladder-2',
    map: 'standard-battlefield',
    category: 'ladder',
    label: 'ladder: up guest ladder (7, 0) onto platform-small (5, 0)',
    start: P(10, 0, 0),
    destination: P(5, 3, 0),
    maxDistance: 12,
    ladderDirection: 'up',
  },
  {
    id: 'std-ladder-3',
    map: 'standard-battlefield',
    category: 'ladder',
    label: 'ladder: up host ladder and across catwalk to guest platform',
    start: P(-10, 0, 0),
    destination: P(5, 3, 0),
    maxDistance: 24,
    ladderDirection: 'up',
  },
  {
    id: 'std-ladder-4',
    map: 'standard-battlefield',
    category: 'ladder',
    label: 'ladder: approach host ladder from south-west (-10, -3) and climb onto platform',
    start: P(-10, 0, -3),
    destination: P(-5, 3, 0),
    maxDistance: 14,
    ladderDirection: 'up',
  },

  // drop (4)
  {
    id: 'std-drop-1',
    map: 'standard-battlefield',
    category: 'drop',
    label: 'drop: off north edge of host platform (-5, 0) down 3" to ground',
    start: P(-5, 3, 0),
    destination: P(-5, 0, 4),
    maxDistance: 12,
  },
  {
    id: 'std-drop-2',
    map: 'standard-battlefield',
    category: 'drop',
    label: 'drop: off north edge of central catwalk (0, 0) down 3" to ground',
    start: P(0, 3, 0),
    destination: P(0, 0, 3),
    maxDistance: 12,
  },
  {
    id: 'std-drop-3',
    map: 'standard-battlefield',
    category: 'drop',
    label: 'drop: off shipping-container (-16, -7) roof (2.25") to ground east',
    start: P(-16, 2.25, -7),
    destination: P(-13, 0, -7),
    maxDistance: 12,
  },
  {
    id: 'std-drop-4',
    map: 'standard-battlefield',
    category: 'drop',
    label: 'drop: off south edge of guest platform (5, 0) down 3" to ground',
    start: P(5, 3, 0),
    destination: P(5, 0, -4),
    maxDistance: 12,
  },

  // climb (4)
  {
    id: 'std-climb-1',
    map: 'standard-battlefield',
    category: 'climb',
    label: 'climb: up east face of host shipping-container (-16, -7) onto 2.25" roof',
    start: P(-13, 0, -7),
    destination: P(-16, 2.25, -7),
    maxDistance: 12,
  },
  {
    id: 'std-climb-2',
    map: 'standard-battlefield',
    category: 'climb',
    label: 'climb: up west face of guest shipping-container (16, 7) onto 2.25" roof',
    start: P(13, 0, 7),
    destination: P(16, 2.25, 7),
    maxDistance: 12,
  },
  {
    id: 'std-climb-3',
    map: 'standard-battlefield',
    category: 'climb',
    label: 'climb: up onto host ruin-l (-14, 2) upper 3" ledge from courtyard',
    start: P(-13, 0, 1),
    destination: P(-13, 3, 3.1),
    maxDistance: 12,
  },
  {
    id: 'std-climb-4',
    map: 'standard-battlefield',
    category: 'climb',
    label: 'climb: up onto guest ruin-l (14, -2) upper 3" ledge from courtyard',
    start: P(13, 0, -1),
    destination: P(13, 3, -3.1),
    maxDistance: 12,
  },

  // no-route (4)
  {
    id: 'std-noroute-1',
    map: 'standard-battlefield',
    category: 'no-route',
    label: 'no-route: ground to non-climbable platform when all stairs and ladders are blocked',
    start: P(-5, 0, -11),
    destination: P(-5, 3, 0),
    maxDistance: 30,
    options: { keepAway: true },
    extraUnits: [
      { id: 'blk-s1', positions: [P(-5, 0, -6.5)] },
      { id: 'blk-l1', positions: [P(-7.55, 0, 0)] },
      { id: 'blk-s2', positions: [P(5, 0, 6.5)] },
      { id: 'blk-l2', positions: [P(7.55, 0, 0)] },
    ],
  },
  {
    id: 'std-noroute-2',
    map: 'standard-battlefield',
    category: 'no-route',
    label: 'no-route: destination inside solid shipping-container body',
    start: P(-12, 0, -7),
    destination: P(-16, 0, -7),
    maxDistance: 20,
  },
  {
    id: 'std-noroute-3',
    map: 'standard-battlefield',
    category: 'no-route',
    label: 'no-route: destination inside solid column (-3, -12)',
    start: P(-3, 0, -16),
    destination: P(-3, 0, -12),
    maxDistance: 20,
  },
  {
    id: 'std-noroute-4',
    map: 'standard-battlefield',
    category: 'no-route',
    label: 'no-route: destination inside solid 6" wall-long (8, -16)',
    start: P(8, 0, -20),
    destination: P(8, 0, -16),
    maxDistance: 20,
  },

  // clamped (4)
  {
    id: 'std-clamp-1',
    map: 'standard-battlefield',
    category: 'clamped',
    label: 'clamped: straight ground advance capped at 6.0"',
    start: P(-12, 0, -20),
    destination: P(-12, 0, -6),
    maxDistance: 6,
  },
  {
    id: 'std-clamp-2',
    map: 'standard-battlefield',
    category: 'clamped',
    label: 'clamped: detour round wall (-10, -12) capped at 6.0"',
    start: P(-10, 0, -15),
    destination: P(-10, 0, -9),
    maxDistance: 6,
  },
  {
    id: 'std-clamp-3',
    map: 'standard-battlefield',
    category: 'clamped',
    label: 'clamped: route up stairs (-5, -4) onto platform capped at 8.0"',
    start: P(-5, 0, -9),
    destination: P(-5, 3, 1.5),
    maxDistance: 8,
  },
  {
    id: 'std-clamp-4',
    map: 'standard-battlefield',
    category: 'clamped',
    label: 'clamped: diagonal ground rush capped at 12.0"',
    start: P(10, 0, -20),
    destination: P(18, 0, 4),
    maxDistance: 12,
  },

  // keep-away (4)
  {
    id: 'std-keep-1',
    map: 'standard-battlefield',
    category: 'keep-away',
    label: 'keep-away: single enemy model in open ground forces 1" octagon detour',
    start: P(10, 0, -6),
    destination: P(10, 0, 4),
    maxDistance: 14,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-1', positions: [P(10, 0, -1)] }],
  },
  {
    id: 'std-keep-2',
    map: 'standard-battlefield',
    category: 'keep-away',
    label: 'keep-away: pair of enemy models blocks narrow 1.8" gap and forces wide detour',
    start: P(12, 0, -6),
    destination: P(12, 0, 4),
    maxDistance: 18,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-pair', positions: [P(11.1, 0, -1), P(12.9, 0, -1)] }],
  },
  {
    id: 'std-keep-3',
    map: 'standard-battlefield',
    category: 'keep-away',
    label: 'keep-away: friendly unit 1.4" east of wall (-10, -12) blocks east gap only under keepAway',
    start: P(-9, 0, -15),
    destination: P(-9, 0, -9),
    maxDistance: 16,
    options: { keepAway: true },
    extraUnits: [{ id: 'ally-1', owner: 'host', positions: [P(-6.0, 0, -12)] }],
  },
  {
    id: 'std-keep-4',
    map: 'standard-battlefield',
    category: 'keep-away',
    label: 'keep-away: enemy unit near destination pulls end back outside 1" keep-away',
    start: P(10, 0, -20),
    destination: P(15, 0, -20),
    maxDistance: 12,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-dest', positions: [P(15, 0, -20)] }],
  },

  // stop-before-difficult (4)
  {
    id: 'std-diff-1',
    map: 'standard-battlefield',
    category: 'stop-before-difficult',
    label: 'stop-before-difficult: rush toward rubble-field (4, -10) stops at entry edge',
    start: P(4, 0, -16),
    destination: P(4, 0, -5),
    maxDistance: 12,
    options: { stopBeforeDifficult: true },
  },
  {
    id: 'std-diff-2',
    map: 'standard-battlefield',
    category: 'stop-before-difficult',
    label: 'stop-before-difficult: rush toward rubble-field (-10, -4) stops at entry edge',
    start: P(-10, 0, -9),
    destination: P(-10, 0, 1),
    maxDistance: 12,
    options: { stopBeforeDifficult: true },
  },
  {
    id: 'std-diff-3',
    map: 'standard-battlefield',
    category: 'stop-before-difficult',
    label: 'stop-before-difficult: detour round wall (-10, -12) into rubble-field (-10, -4) stops at rubble',
    start: P(-10, 0, -15),
    destination: P(-10, 0, -2),
    maxDistance: 16,
    options: { stopBeforeDifficult: true },
  },
  {
    id: 'std-diff-4',
    map: 'standard-battlefield',
    category: 'stop-before-difficult',
    label: 'stop-before-difficult: diagonal rush toward rubble-field (-2, -17) stops at entry edge',
    start: P(-7, 0, -22),
    destination: P(2, 0, -14),
    maxDistance: 14,
    options: { stopBeforeDifficult: true },
  },

  // flying (4)
  {
    id: 'std-fly-1',
    map: 'standard-battlefield',
    category: 'flying',
    label: 'flying: straight over 6" wall-long (8, -16)',
    start: P(8, 0, -19),
    destination: P(8, 0, -13),
    maxDistance: 12,
    specialRules: ['flying'],
  },
  {
    id: 'std-fly-2',
    map: 'standard-battlefield',
    category: 'flying',
    label: 'flying: straight from ground onto platform-small (-5, 0) without stairs or ladder',
    start: P(-5, 0, -10),
    destination: P(-5, 3, 0),
    maxDistance: 12,
    specialRules: ['flying'],
  },
  {
    id: 'std-fly-3',
    map: 'standard-battlefield',
    category: 'flying',
    label: 'flying: straight over shipping-container (-16, -7) to far ground',
    start: P(-19, 0, -7),
    destination: P(-13, 0, -7),
    maxDistance: 12,
    specialRules: ['flying'],
  },
  {
    id: 'std-fly-4',
    map: 'standard-battlefield',
    category: 'flying',
    label: 'flying: straight over enemy unit and wall (-10, -12) with keepAway',
    start: P(-10, 0, -15),
    destination: P(-10, 0, -9),
    maxDistance: 12,
    specialRules: ['flying'],
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-under', positions: [P(-10, 0, -13.5)] }],
  },
];

// ============================================================================
// 2. Jump Range cases (18 findNavPath cases)
// ============================================================================
const JUMP_RANGE_CASES: NavCase[] = [
  // fast-path (2)
  {
    id: 'jr-fast-1',
    map: 'jump-range',
    category: 'fast-path',
    label: 'fast-path: open ground in host deployment zone',
    start: P(-6, 0, -18),
    destination: P(4, 0, -18),
    maxDistance: 12,
  },
  {
    id: 'jr-fast-2',
    map: 'jump-range',
    category: 'fast-path',
    label: 'fast-path: straight along 8"-deep deck A top',
    start: P(-9, 3, -9),
    destination: P(-9, 3, -3),
    maxDistance: 8,
  },

  // obstacle (2)
  {
    id: 'jr-obs-1',
    map: 'jump-range',
    category: 'obstacle',
    label: 'obstacle: ground route round stairs A wedge (-9, -12)',
    start: P(-12, 0, -11),
    destination: P(-6, 0, -11),
    maxDistance: 14,
  },
  {
    id: 'jr-obs-2',
    map: 'jump-range',
    category: 'obstacle',
    label: 'obstacle: ground route round deck C north pillars (-2.5)',
    start: P(1, 0, -2.5),
    destination: P(9, 0, -2.5),
    maxDistance: 14,
  },

  // stairs (3)
  {
    id: 'jr-stairs-1',
    map: 'jump-range',
    category: 'stairs',
    label: 'stairs: up stairs A (-9, -12) onto 3" deck A',
    start: P(-9, 0, -16),
    destination: P(-9, 3, -7),
    maxDistance: 14,
  },
  {
    id: 'jr-stairs-2',
    map: 'jump-range',
    category: 'stairs',
    label: 'stairs: up stairs B (-3, -12) onto 3" deck B',
    start: P(-3, 0, -16),
    destination: P(-3, 3, -7),
    maxDistance: 14,
  },
  {
    id: 'jr-stairs-3',
    map: 'jump-range',
    category: 'stairs',
    label: 'stairs: up guest stairs C (-5, 12) onto guest deck C',
    start: P(-5, 0, 16),
    destination: P(-5, 3, 7),
    maxDistance: 14,
  },

  // ladder (3 - including up AND down on 4.5" tall deck!)
  {
    id: 'jr-ladder-1',
    map: 'jump-range',
    category: 'ladder',
    label: 'ladder: up 4.5" ladder (-20, -6) onto tall deck D',
    start: P(-22, 0, -6),
    destination: P(-18, 4.5, -6),
    maxDistance: 12,
    ladderDirection: 'up',
  },
  {
    id: 'jr-ladder-2',
    map: 'jump-range',
    category: 'ladder',
    label: 'ladder: down 4.5" ladder (-20, -6) from tall deck D to ground',
    start: P(-18, 4.5, -6),
    destination: P(-22, 0, -6),
    maxDistance: 12,
    ladderDirection: 'down',
  },
  {
    id: 'jr-ladder-3',
    map: 'jump-range',
    category: 'ladder',
    label: 'ladder: up guest 4.5" ladder (20, 6) onto guest tall deck D',
    start: P(22, 0, 6),
    destination: P(18, 4.5, 6),
    maxDistance: 12,
    ladderDirection: 'up',
  },

  // drop (2)
  {
    id: 'jr-drop-1',
    map: 'jump-range',
    category: 'drop',
    label: 'drop: off east edge of 3" deck A to ground gap',
    start: P(-9, 3, -6),
    destination: P(-6, 0, -6),
    maxDistance: 12,
  },
  {
    id: 'jr-drop-2',
    map: 'jump-range',
    category: 'drop',
    label: 'drop: off west edge of 3" deck C to ground',
    start: P(5, 3, -6),
    destination: P(2, 0, -6),
    maxDistance: 12,
  },

  // no-route (2)
  {
    id: 'jr-noroute-1',
    map: 'jump-range',
    category: 'no-route',
    label: 'no-route: ground to 4.5" tall deck D when its ladder foot is blocked',
    start: P(-14, 0, -6),
    destination: P(-18, 4.5, -6),
    maxDistance: 24,
    options: { keepAway: true },
    extraUnits: [{ id: 'blk-lad', positions: [P(-20.55, 0, -6)] }],
  },
  {
    id: 'jr-noroute-2',
    map: 'jump-range',
    category: 'no-route',
    label: 'no-route: destination inside solid stairs A wedge body (-9, 0, -11)',
    start: P(-12, 0, -11),
    destination: P(-9, 0, -11),
    maxDistance: 20,
  },

  // clamped (2)
  {
    id: 'jr-clamp-1',
    map: 'jump-range',
    category: 'clamped',
    label: 'clamped: open ground advance capped at 6.0"',
    start: P(0, 0, -18),
    destination: P(0, 0, 0),
    maxDistance: 6,
  },
  {
    id: 'jr-clamp-2',
    map: 'jump-range',
    category: 'clamped',
    label: 'clamped: long ground advance across host half capped at 12.0"',
    start: P(-14, 0, -18),
    destination: P(14, 0, -18),
    maxDistance: 12,
  },

  // keep-away (1)
  {
    id: 'jr-keep-1',
    map: 'jump-range',
    category: 'keep-away',
    label: 'keep-away: enemy model near stairs A foot forces detour round 1" keep-away',
    start: P(-9, 0, -19),
    destination: P(-9, 3, -7),
    maxDistance: 18,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-stairs', positions: [P(-9, 0, -16)] }],
  },

  // flying (2)
  {
    id: 'jr-fly-1',
    map: 'jump-range',
    category: 'flying',
    label: 'flying: straight across 4" gap between deck B (-3, -6) and deck C (5, -6)',
    start: P(-2, 3, -6),
    destination: P(4, 3, -6),
    maxDistance: 12,
    specialRules: ['flying'],
  },
  {
    id: 'jr-fly-2',
    map: 'jump-range',
    category: 'flying',
    label: 'flying: straight from ground up to 4.5" tall deck D bypassing ladder',
    start: P(-14, 0, -6),
    destination: P(-18, 4.5, -6),
    maxDistance: 12,
    specialRules: ['flying'],
  },
];

// ============================================================================
// 3. Hazard Range cases (16 findNavPath cases)
// ============================================================================
const HAZARD_RANGE_CASES: NavCase[] = [
  // fast-path (4)
  {
    id: 'hr-fast-1',
    map: 'hazard-range',
    category: 'fast-path',
    label: 'fast-path: straight through hazard pool A (-9, -8)',
    start: P(-13, 0, -8),
    destination: P(-5, 0, -8),
    maxDistance: 12,
  },
  {
    id: 'hr-fast-2',
    map: 'hazard-range',
    category: 'fast-path',
    label: 'fast-path: straight across pools A and B (-9 to -1)',
    start: P(-13, 0, -8),
    destination: P(1, 0, -8),
    maxDistance: 16,
  },
  {
    id: 'hr-fast-3',
    map: 'hazard-range',
    category: 'fast-path',
    label: 'fast-path: diagonal across lone pool C (9, -8)',
    start: P(6, 0, -12),
    destination: P(12, 0, -4),
    maxDistance: 12,
  },
  {
    id: 'hr-fast-4',
    map: 'hazard-range',
    category: 'fast-path',
    label: 'fast-path: straight through guest twin pool (-9, 8)',
    start: P(-13, 0, 8),
    destination: P(-5, 0, 8),
    maxDistance: 12,
  },

  // clamped (4)
  {
    id: 'hr-clamp-1',
    map: 'hazard-range',
    category: 'clamped',
    label: 'clamped: advance across pool A capped at 6.0"',
    start: P(-13, 0, -8),
    destination: P(1, 0, -8),
    maxDistance: 6,
  },
  {
    id: 'hr-clamp-2',
    map: 'hazard-range',
    category: 'clamped',
    label: 'clamped: rush across pools A and B capped at 12.0"',
    start: P(-13, 0, -8),
    destination: P(5, 0, -8),
    maxDistance: 12,
  },
  {
    id: 'hr-clamp-3',
    map: 'hazard-range',
    category: 'clamped',
    label: 'clamped: short move toward pool C capped at 4.0"',
    start: P(9, 0, -16),
    destination: P(9, 0, -4),
    maxDistance: 4,
  },
  {
    id: 'hr-clamp-4',
    map: 'hazard-range',
    category: 'clamped',
    label: 'clamped: diagonal rush across mid-field capped at 10.0"',
    start: P(-12, 0, -16),
    destination: P(12, 0, 16),
    maxDistance: 10,
  },

  // keep-away (5)
  {
    id: 'hr-keep-1',
    map: 'hazard-range',
    category: 'keep-away',
    label: 'keep-away: enemy unit on strip between pools A and B forces detour',
    start: P(-6, 0, -13),
    destination: P(-6, 0, -3),
    maxDistance: 14,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-strip', positions: [P(-6, 0, -8)] }],
  },
  {
    id: 'hr-keep-2',
    map: 'hazard-range',
    category: 'keep-away',
    label: 'keep-away: two enemy models in pool A form wall requiring wide detour',
    start: P(-9, 0, -13),
    destination: P(-9, 0, -3),
    maxDistance: 18,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-wall', positions: [P(-10, 0, -8), P(-8, 0, -8)] }],
  },
  {
    id: 'hr-keep-3',
    map: 'hazard-range',
    category: 'keep-away',
    label: 'keep-away: friendly unit near pool C forces detour',
    start: P(5, 0, -8),
    destination: P(13, 0, -8),
    maxDistance: 14,
    options: { keepAway: true },
    extraUnits: [{ id: 'ally-c', owner: 'host', positions: [P(9, 0, -8)] }],
  },
  {
    id: 'hr-keep-4',
    map: 'hazard-range',
    category: 'keep-away',
    label: 'keep-away: enemy unit at destination pulls stop back outside 1" keep-away',
    start: P(0, 0, -14),
    destination: P(0, 0, -6),
    maxDistance: 12,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-end', positions: [P(0, 0, -6)] }],
  },
  {
    id: 'hr-keep-5',
    map: 'hazard-range',
    category: 'keep-away',
    label: 'keep-away: 3-model enemy squad in L-formation forces multi-leg detour',
    start: P(0, 0, -14),
    destination: P(0, 0, 2),
    maxDistance: 22,
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-l', positions: [P(-1.5, 0, -6), P(0, 0, -6), P(1.5, 0, -6)] }],
  },

  // flying (2)
  {
    id: 'hr-fly-1',
    map: 'hazard-range',
    category: 'flying',
    label: 'flying: straight over enemy unit in pool A with keepAway',
    start: P(-9, 0, -13),
    destination: P(-9, 0, -3),
    maxDistance: 12,
    specialRules: ['flying'],
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-a', positions: [P(-9, 0, -8)] }],
  },
  {
    id: 'hr-fly-2',
    map: 'hazard-range',
    category: 'flying',
    label: 'flying: straight over two enemy units between pools A and B',
    start: P(-6, 0, -13),
    destination: P(-6, 0, -3),
    maxDistance: 12,
    specialRules: ['flying'],
    options: { keepAway: true },
    extraUnits: [{ id: 'foe-ab', positions: [P(-7, 0, -8), P(-5, 0, -8)] }],
  },

  // no-route (1)
  {
    id: 'hr-noroute-1',
    map: 'hazard-range',
    category: 'no-route',
    label: 'no-route: destination surrounded by a ring of enemy models with keepAway',
    start: P(0, 0, -18),
    destination: P(0, 0, 0),
    maxDistance: 24,
    options: { keepAway: true },
    extraUnits: [
      {
        id: 'ring',
        positions: [
          P(0, 0, -2),
          P(1.5, 0, -1.5),
          P(2, 0, 0),
          P(1.5, 0, 1.5),
          P(0, 0, 2),
          P(-1.5, 0, 1.5),
          P(-2, 0, 0),
          P(-1.5, 0, -1.5),
        ],
      },
    ],
  },
];

export const ALL_NAV_CASES: NavCase[] = [
  ...STANDARD_CASES,
  ...JUMP_RANGE_CASES,
  ...HAZARD_RANGE_CASES,
];

// ============================================================================
// 4. closestApproach cases (12 cases across maps, single & squads, walls & decks)
// ============================================================================
export const CLOSEST_APPROACH_CASES: ClosestApproachCase[] = [
  {
    id: 'ca-single-open-contact',
    map: 'standard-battlefield',
    category: 'single-open',
    label: 'single model reaches contact in open ground',
    modelPositions: [P(10, 0, -6)],
    modelIndex: 0,
    start: P(10, 0, -6),
    budget: 12,
    targetPositions: [P(10, 0, 0)],
    otherFinalPositions: [],
    expectation: { nonNull: true, maxGap: 0.05 },
  },
  {
    id: 'ca-single-clamped',
    map: 'standard-battlefield',
    category: 'single-clamped',
    label: 'single model clamped by budget on open ground',
    modelPositions: [P(10, 0, -20)],
    modelIndex: 0,
    start: P(10, 0, -20),
    budget: 8,
    targetPositions: [P(10, 0, 0)],
    otherFinalPositions: [],
    expectation: { nonNull: true, minCost: 7.5 },
  },
  {
    id: 'ca-single-round-wall',
    map: 'standard-battlefield',
    category: 'single-wall',
    label: 'single model routes round wall (-10, -12) to reach target',
    modelPositions: [P(-10, 0, -15)],
    modelIndex: 0,
    start: P(-10, 0, -15),
    budget: 14,
    targetPositions: [P(-10, 0, -9)],
    otherFinalPositions: [],
    expectation: { nonNull: true, maxGap: 0.25, requireMultiSegment: true },
  },
  {
    id: 'ca-single-round-wall-long',
    map: 'standard-battlefield',
    category: 'single-wall-long',
    label: 'single model routes round wall-long (8, -16) toward target',
    modelPositions: [P(8, 0, -19)],
    modelIndex: 0,
    start: P(8, 0, -19),
    budget: 14,
    targetPositions: [P(8, 0, -13)],
    otherFinalPositions: [],
    expectation: { nonNull: true, maxGap: 0.5, requireMultiSegment: true },
  },
  {
    id: 'ca-single-up-stairs-deck',
    map: 'standard-battlefield',
    category: 'single-stairs-deck',
    label: 'single model climbs stairs (-5, -4) onto platform (-5, 0) to target on deck',
    modelPositions: [P(-5, 0, -9)],
    modelIndex: 0,
    start: P(-5, 0, -9),
    budget: 14,
    targetPositions: [P(-5, 3, 0)],
    otherFinalPositions: [],
    expectation: { nonNull: true, maxGap: 0.25, minY: 2.8 },
  },
  {
    id: 'ca-single-up-ladder-deck',
    map: 'standard-battlefield',
    category: 'single-ladder-deck',
    label: 'single model climbs ladder (-7, 0) onto platform (-5, 0) to target on deck',
    modelPositions: [P(-10, 0, 0)],
    modelIndex: 0,
    start: P(-10, 0, 0),
    budget: 12,
    targetPositions: [P(-5, 3, 0)],
    otherFinalPositions: [],
    extraUnits: [{ id: 'under-deck', positions: [P(-5, 0, 0)] }],
    expectation: { nonNull: true, maxGap: 0.25, minY: 2.8 },
  },
  {
    id: 'ca-single-tall-deck-stays',
    map: 'jump-range',
    category: 'single-high-deck',
    label: 'model on 4.5" tall deck D stays on deck (no jump) when target is on ground east',
    modelPositions: [P(-17, 4.5, -6)],
    modelIndex: 0,
    start: P(-17, 4.5, -6),
    budget: 12,
    targetPositions: [P(-12, 0, -6)],
    otherFinalPositions: [],
    expectation: { nonNull: true, minY: 4.3 },
  },
  {
    id: 'ca-squad-coherency-held',
    map: 'standard-battlefield',
    category: 'squad-coherency',
    label: 'squad model moves forward up to 2" coherency limit with stationary squad-mate',
    modelPositions: [P(10, 0, -18), P(11, 0, -18)],
    modelIndex: 0,
    start: P(10, 0, -18),
    budget: 12,
    targetPositions: [P(10, 0, -14)],
    otherFinalPositions: [P(11, 0, -18)],
    expectation: { nonNull: true, minCost: 1.0, requireCoherentWithOthers: true },
  },
  {
    id: 'ca-squad-round-wall',
    map: 'standard-battlefield',
    category: 'squad-wall',
    label: '4-model squad trailing model routes round wall (-10, -12) behind front models',
    modelPositions: [P(-10, 0, -15), P(-9, 0, -15), P(-10, 0, -16), P(-9, 0, -16)],
    modelIndex: 2,
    start: P(-10, 0, -16),
    budget: 14,
    targetPositions: [P(-10, 0, -9), P(-9, 0, -9)],
    otherFinalPositions: [P(-10, 0, -10), P(-9, 0, -10), P(-8, 0, -10.5)],
    expectation: { nonNull: true, requireMultiSegment: true },
  },
  {
    id: 'ca-squad-up-stairs',
    map: 'jump-range',
    category: 'squad-stairs-deck',
    label: 'squad model walks up stairs A onto 3" deck A to join lead model',
    modelPositions: [P(-9, 0, -15), P(-10, 0, -15)],
    modelIndex: 1,
    start: P(-10, 0, -15),
    budget: 14,
    targetPositions: [P(-9, 3, -6), P(-8, 3, -6)],
    otherFinalPositions: [P(-9, 3, -7)],
    expectation: { nonNull: true, minY: 2.8 },
  },
  {
    id: 'ca-squad-avoids-hazard',
    map: 'hazard-range',
    category: 'squad-hazard',
    label: 'model refuses dangerous path straight through hazard pool C (9, -8) and stays put',
    modelPositions: [P(9, 0, -14)],
    modelIndex: 0,
    start: P(9, 0, -14),
    budget: 12,
    targetPositions: [P(9, 0, -4)],
    otherFinalPositions: [],
    expectation: { nonNull: true },
  },
  {
    id: 'ca-squad-6-target-difficult',
    map: 'standard-battlefield',
    category: 'squad-6-target',
    label: 'squad model picks nearest of 6 target models with difficultBudget in rubble',
    modelPositions: [P(4, 0, -16), P(5, 0, -16), P(4, 0, -17)],
    modelIndex: 0,
    start: P(4, 0, -16),
    budget: 12,
    targetPositions: [
      P(3, 0, -9.5),
      P(4, 0, -9.5),
      P(5, 0, -9.5),
      P(3, 0, -8.5),
      P(4, 0, -8.5),
      P(5, 0, -8.5),
    ],
    otherFinalPositions: [P(5, 0, -11.5), P(4, 0, -12.5)],
    options: { difficultBudget: 6 },
    expectation: { nonNull: true },
  },
];

// ============================================================================
// 5. Squad charge validation cases (4 cases through validateAction)
// ============================================================================
export const SQUAD_CHARGE_CASES: SquadChargeCase[] = [
  {
    id: 'charge-valid-4v3',
    map: 'standard-battlefield',
    category: 'valid',
    label: 'valid 4-model squad charge on Standard Battlefield (2 in contact, 2 behind)',
    attackerSpots: [P(10, 0, -6), P(11, 0, -6), P(10, 0, -7), P(11, 0, -7)],
    targetSpots: [P(10, 0, 2.5), P(11, 0, 2.5), P(10.5, 0, 3.5)],
    ends: [P(10, 0, 1.5), P(11, 0, 1.5), P(10, 0, 0.5), P(11, 0, 0.5)],
    speed: 4,
    expectedValid: true,
  },
  {
    id: 'charge-rejected-could-get-closer',
    map: 'standard-battlefield',
    category: 'rejected-closer',
    label: 'rejected 4-model squad charge: back model stopped too far ("could get closer")',
    attackerSpots: [P(10, 0, -6), P(11, 0, -6), P(10, 0, -7), P(11, 0, -7)],
    targetSpots: [P(10, 0, 2), P(11, 0, 2), P(10.5, 0, 3)],
    // Model 4 stopped at z = -1.5 (coherent with Model 2 at z = 0) even though it had 12" reach
    ends: [P(10, 0, 1), P(11, 0, 1), P(10, 0, 0), P(11, 0, -1.5)],
    speed: 6,
    expectedValid: false,
    expectedReasonIncludes: 'could get closer',
  },
  {
    id: 'charge-6v6-round-terrain',
    map: 'standard-battlefield',
    category: '6v6-terrain',
    label: '6-model squad charging 6-model target round wall-long (8, -16)',
    attackerSpots: [
      P(9, 0, -18.5),
      P(8, 0, -18.5),
      P(7, 0, -18.5),
      P(9, 0, -19.5),
      P(8, 0, -19.5),
      P(7, 0, -19.5),
    ],
    targetSpots: [
      P(9, 0, -13),
      P(8, 0, -13),
      P(7, 0, -13),
      P(9, 0, -12),
      P(8, 0, -12),
      P(7, 0, -12),
    ],
    ends: [
      P(8.5, 0, -13.87),
      P(6.66, 0, -13.94),
      P(6, 0, -13),
      P(9.5, 0, -13.87),
      P(10.43, 0, -13.58),
      P(5.62, 0, -14.05),
    ],
    paths: [
      [P(9, 0, -18.5), P(11.57, 0, -16.69), P(11.57, 0, -15.3), P(8.5, 0, -13.87)],
      [P(8, 0, -18.5), P(4.43, 0, -16.69), P(4.43, 0, -15.3), P(6.66, 0, -13.94)],
      [P(7, 0, -18.5), P(4.43, 0, -16.69), P(4.43, 0, -15.3), P(6, 0, -13)],
      [P(9, 0, -19.5), P(11.57, 0, -16.69), P(11.57, 0, -15.3), P(9.5, 0, -13.87)],
      [P(8, 0, -19.5), P(11.57, 0, -16.69), P(11.57, 0, -15.3), P(10.43, 0, -13.58)],
      [P(7, 0, -19.5), P(4.43, 0, -16.69), P(4.43, 0, -15.3), P(5.62, 0, -14.05)],
    ],
    speed: 4,
    expectedValid: true,
  },
  {
    id: 'charge-10v5-stress',
    map: 'standard-battlefield',
    category: '10-model-stress',
    label: '10-model extreme squad charge on Standard Battlefield beside wall-long (8, -16)',
    attackerSpots: [
      P(11.5, 0, -19), P(12.5, 0, -19), P(13.5, 0, -19), P(14.5, 0, -19), P(15.5, 0, -19),
      P(11.5, 0, -20), P(12.5, 0, -20), P(13.5, 0, -20), P(14.5, 0, -20), P(15.5, 0, -20),
    ],
    targetSpots: [
      P(11.5, 0, -11), P(12.5, 0, -11), P(13.5, 0, -11), P(14.5, 0, -11), P(15.5, 0, -11),
    ],
    ends: [
      P(11.5, 0, -12), P(12.5, 0, -12), P(13.5, 0, -12), P(14.5, 0, -12), P(15.5, 0, -12),
      P(11.5, 0, -13), P(12.5, 0, -13), P(13.5, 0, -13), P(14.5, 0, -13), P(15.5, 0, -13),
    ],
    speed: 4,
    expectedValid: true,
  },
];
