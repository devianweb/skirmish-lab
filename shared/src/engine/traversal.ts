import { GameState, TerrainPiece, Unit, Model } from '../gameTypes';
import { Vector3 } from '../types';
import { hasTrait } from '../rules/traits';
import { isClimbable } from '../data/mapSchema';
import {
  DROP_STANDOFF,
  computeSquadCentroid,
  findEndOverlap,
  findMoveBlocker,
  findTerrainAtPosition,
  collectWalkableSurfaces,
  findWalkableSurfaceAt,
  findWalkableSurfaceIn,
  getWalkableSurfaces,
  isBaseOverhanging,
  isFallColumnBlocked,
  isLadderStepSegment,
  isSegmentOnLadder,
  isSegmentOnRampOrStairs,
  worldToLocal,
} from './spatial';

/** 3D Euclidean distance between two points. */
export function distance3D(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = (a.y ?? 0) - (b.y ?? 0);
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

/** 2D horizontal distance on the XZ board plane. */
export function distanceHorizontal(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Total 3D length of a path (sum of 3D distances between consecutive waypoints). */
export function pathLength3D(path: Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distance3D(path[i - 1], path[i]);
  }
  return total;
}

/** Drops up to this height (inches) are regular movement: no test needed. */
export const FREE_DROP_MAX = 3.05;
/** Drops above FREE_DROP_MAX up to this height can be jumped (test); anything higher is a fall. */
export const JUMP_DROP_MAX = 6.05;

/** A model that falls (e.g. a failed jump) takes falling damage from this height (inches) up. */
export const FALL_DAMAGE_MIN = 2.0;
/** A fallen model is placed within this distance (inches) of where it fell. */
export const FALL_LANDING_RADIUS = 2.0;

/** Longest climb (inches of rise) a model can make without a ladder or stairs. */
export const CLIMB_MAX = 3.05;
/** How close (inches, horizontally) a model must stand to a floor edge to jump or fall from it. */
export const EDGE_SNAP_TOLERANCE = 0.5;
/** How far inside an edge a model standing fully on the floor can be and still count as "at the edge" (base radius + 0.1"). */
const FLOOR_EDGE_REACH = 0.55;

/** How a stretch of a path is traversed. Jumps and falls need a dice test and must be declared by the player. */
export type SegmentKind =
  | 'walk'
  | 'stairs'
  | 'ladder'
  | 'climb'
  | 'drop'
  | 'gap'
  | 'jump-drop'
  | 'jump-gap'
  | 'fall'
  | 'blocked';

/** Kinds that need a dice test (or a guaranteed fall) and therefore an explicit declaration. */
export type JumpKind = 'jump-drop' | 'jump-gap' | 'fall';
export const JUMP_KINDS: readonly SegmentKind[] = ['jump-drop', 'jump-gap', 'fall'];

export interface SegmentClass {
  kind: SegmentKind;
  /** Movement allowance the segment uses (a passed jump costs nothing). */
  cost: number;
  /** Horizontal length (board distance). */
  horizontal: number;
  /** Vertical change in inches (absolute). */
  height: number;
  /** Gap width (jump-gap) or drop height (drop kinds); the figure the dice depend on. 0 otherwise. */
  distance: number;
  /** Jump test dice (0 = no test). */
  dice: number;
  /** Target number each die needs (0 = no test). */
  target: number;
}

/**
 * True if the upward step `a` -> `b` is a legal climb: a rise of at most 3" that ends at the height of a
 * floor of a climbable piece, at the stand-off spot beside that floor's edge (a full base off the face) or
 * on the floor itself, with the climb column clear of terrain (a climb is a drop in reverse). Climbing onto
 * a piece that is not climbable, or past a wall that stands in the way, is not possible.
 */
export function canClimbBetween(state: GameState, a: Vector3, b: Vector3): boolean {
  const ay = a.y ?? 0;
  const by = b.y ?? 0;
  if (by - ay > CLIMB_MAX || by - ay <= 0.5) return false;
  for (const surface of collectWalkableSurfaces(state)) {
    if (!isClimbable(surface.piece) || Math.abs(surface.topY - by) > 0.1) continue;
    const l = worldToLocal(surface.piece, b);
    const dx = Math.max(surface.minX - l.x, 0, l.x - surface.maxX);
    const dz = Math.max(surface.minZ - l.z, 0, l.z - surface.maxZ);
    if (Math.hypot(dx, dz) > DROP_STANDOFF + 0.05) continue;
    if (distanceHorizontal(a, b) > 0.7) continue;
    if (isFallColumnBlocked(state, { x: b.x, y: by, z: b.z }, { x: b.x, y: ay, z: b.z })) continue;
    return true;
  }
  return false;
}

/**
 * Host-side check of every upward step in a path: each rise over half an inch must be a stairs/ladder
 * step or a legal climb. Returns a rejection reason, or null when fine.
 */
export function validatePathClimbs(state: GameState, unit: Unit, path: Vector3[]): string | null {
  for (let i = 1; i < path.length; i++) {
    const dy = (path[i].y ?? 0) - (path[i - 1].y ?? 0);
    if (dy <= 0.5) continue;
    if (classifySegment(state, path[i - 1], path[i], unit, path[i - 2]).kind === 'blocked') {
      return 'Cannot climb there: only climbable terrain up to 3" can be climbed without a ladder or stairs, from a clear spot beside it';
    }
  }
  return null;
}

/** Ordinary, test-free movement vs jump vs fall, from the height of a descent. */
export function classifyDropHeight(height: number): 'drop' | 'jump-drop' | 'fall' {
  if (height <= FREE_DROP_MAX) return 'drop';
  return height <= JUMP_DROP_MAX ? 'jump-drop' : 'fall';
}

/**
 * The single source of truth for how a straight stretch `a` -> `b` is traversed: walk, stairs, ladder,
 * climb (sheer face up to 3"), drop (up to 3"), gap (up to 1"), or the declared kinds jump-drop (3-6"),
 * jump-gap (1-6") and fall (over 6"). A rise over 3" or a gap over 6" is blocked. The movement cost, the
 * move preview and the host's jump check all read this.
 */
export function classifySegment(
  state: GameState,
  a: Vector3,
  b: Vector3,
  unit?: Unit,
  prev?: Vector3,
  next?: Vector3
): SegmentClass {
  const dy = (b.y ?? 0) - (a.y ?? 0);
  const horizontal = distanceHorizontal(a, b);
  const length = Math.hypot(horizontal, dy);
  const airborne = !!unit && hasTrait(unit.specialRules, 'airborne');
  const target = unit && hasTrait(unit.specialRules, 'pathfinder') ? 2 : 3;
  const make = (kind: SegmentKind, cost: number, extra: Partial<SegmentClass> = {}): SegmentClass => ({
    kind,
    cost,
    horizontal,
    height: Math.abs(dy),
    distance: 0,
    dice: 0,
    target: 0,
    ...extra,
  });

  if (isLadderStepSegment(state, a, b)) return make('ladder', 0); // the shuffle on or off a ladder is free

  if (Math.abs(dy) > 0.5) {
    const onSlope = isSegmentOnRampOrStairs(state, a, b);
    const onLadder = onSlope && isSegmentOnLadder(state, a, b);
    if (dy > 0) {
      if (onSlope) return make(onLadder ? 'ladder' : 'stairs', length);
      if (airborne) return make('walk', length);
      return canClimbBetween(state, a, b) ? make('climb', length) : make('blocked', length);
    }
    const height = -dy;
    if (onSlope) {
      // A short straight fall (3" or less, clear air) at a ladder's column is a plain drop, free like any other
      const arrivedByLadder = !!prev && isLadderStepSegment(state, prev, a);
      if (onLadder && !arrivedByLadder && height <= FREE_DROP_MAX && horizontal < 0.7 && !isFallColumnBlocked(state, a, b)) {
        return make('drop', horizontal, { distance: height });
      }
      return make(onLadder ? 'ladder' : 'stairs', length);
    }
    if (airborne) return make('drop', horizontal, { distance: height });
    const kind = classifyDropHeight(height);
    if (kind === 'drop') return make('drop', horizontal, { distance: height });
    if (kind === 'jump-drop') {
      return make('jump-drop', 0, { distance: height, dice: calculateJumpDice(height), target });
    }
    return make('fall', horizontal, { distance: height });
  }

  // Level movement: open air beneath an elevated stretch is a gap
  if (airborne) return make('walk', length);
  if (isSegmentOnRampOrStairs(state, a, b) && !isSegmentOnLadder(state, a, b)) return make('stairs', length);
  const gap = measureElevatedGap(state, [a, b]);
  if (gap <= 0) return make('walk', length);
  if (gap <= FREE_GAP_MAX) {
    // The short level step off a climb's top onto the floor, or off a floor's edge before a drop, is part of
    // that climb or drop (same cost as walking), not a gap
    const afterClimb = !!prev && (a.y ?? 0) - (prev.y ?? 0) > 0.5 && distanceHorizontal(prev, a) < 0.1;
    const beforeDrop = !!next && (a.y ?? 0) - (next.y ?? 0) > 0.5 && distanceHorizontal(b, next) < 0.1;
    if (afterClimb || beforeDrop) return make('walk', length);
    return make('gap', length, { distance: gap });
  }
  if (gap <= JUMP_GAP_MAX) {
    return make('jump-gap', 0, { distance: gap, dice: calculateJumpDice(gap), target });
  }
  return make('blocked', length, { distance: gap });
}

/**
 * Movement a path uses from a model's allowance. Tabletop movement is measured along the board, so
 * drops cost only their horizontal distance; climbs, stairs, ramps and ladders cost their full length.
 * A jump (a declared leap over a gap or down 3-6") that is passed does not count toward the move.
 */
export function pathMovementCost(state: GameState, path: Vector3[], unit?: Unit): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += classifySegment(state, path[i - 1], path[i], unit, path[i - 2], path[i + 1]).cost;
  }
  return total;
}

/** Jump test dice for a drop (or gap) of `distance` inches: one die per full 3", plus one. */
export function calculateJumpDice(distance: number): number {
  return Math.floor((distance + 0.05) / 3.0) + 1;
}

interface JumpResult {
  requiresTest: boolean;
  canJump: boolean;
  dice: number;
  target: number;
  passed: boolean;
}

/**
 * The jump test: roll one die per full 3" plus one, each needing 3+ (2+ with Pathfinder; Airborne
 * auto-passes). All dice must succeed. Distances up to `freeMax` are regular movement (no test);
 * distances above `jumpMax` cannot be jumped.
 */
function resolveJump(
  unit: Unit,
  distance: number,
  freeMax: number,
  jumpMax: number,
  rolls?: number[]
): JumpResult {
  if (distance <= freeMax) {
    return { requiresTest: false, canJump: true, dice: 0, target: 0, passed: true };
  }
  if (hasTrait(unit.specialRules, 'airborne')) {
    return { requiresTest: false, canJump: true, dice: 0, target: 0, passed: true };
  }
  const target = hasTrait(unit.specialRules, 'pathfinder') ? 2 : 3;
  if (distance > jumpMax) {
    return { requiresTest: false, canJump: false, dice: 0, target, passed: false };
  }
  const dice = calculateJumpDice(distance);
  const passed = !!rolls && rolls.length >= dice && rolls.slice(0, dice).every((r) => r >= target);
  return { requiresTest: true, canJump: true, dice, target, passed };
}

/** Jump test for dropping off an elevation: up to 3" is regular movement, 3-6" is jumped, more falls. */
export function resolveDropJump(unit: Unit, drop: number, rolls?: number[]): JumpResult {
  return resolveJump(unit, drop, FREE_DROP_MAX, JUMP_DROP_MAX, rolls);
}

/** Human-readable warning for the highest drop on a path (empty when it is regular movement). */
export function describeDrop(drop: number, unit: Unit): string {
  const kind = classifyDropHeight(drop);
  if (kind === 'drop' || hasTrait(unit.specialRules, 'airborne')) return '';
  if (kind === 'fall') {
    return `⚠️ HIGH DROP (${drop.toFixed(1)}"): too far to jump — falls, Falling damage and ends activation!`;
  }
  const res = resolveDropJump(unit, drop);
  return `⚠️ JUMP DOWN (${drop.toFixed(1)}"): roll ${res.dice} dice, all must be ${res.target}+ or fall (Falling damage, ends activation)`;
}

/**
 * Maximum vertical height difference for melee engagement.
 * Core rules: Models must strike enemies within 2" horizontally and 4" vertically.
 */
export const MELEE_MAX_VERTICAL_REACH = 4.05;

/** Validates whether two models can engage in Close Quarters Combat vertically. */
export function validateMeleeVerticalReach(a: Vector3, b: Vector3): boolean {
  const dy = Math.abs((a.y ?? 0) - (b.y ?? 0));
  return dy <= MELEE_MAX_VERTICAL_REACH;
}

/**
 * Checks whether a movement path encounters Difficult Terrain (climbing is ordinary movement, never difficult).
 */
export function isPathDifficult(
  state: GameState,
  path: Vector3[],
  unit?: Unit
): boolean {
  if (unit && hasTrait(unit.specialRules, 'pathfinder')) {
    return false; // Pathfinder ignores difficult terrain
  }
  if (unit && hasTrait(unit.specialRules, 'airborne')) {
    return false; // Airborne ignores all terrain effects
  }

  // Check difficult terrain pieces along the path
  for (const point of path) {
    const piece = findTerrainAtPosition(state, point);
    if (
      piece &&
      (piece.isDifficult ||
        piece.terrainType === 'trench' ||
        piece.terrainType === 'forest' ||
        piece.terrainType === 'mud')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether a movement path passes through Dangerous Terrain (toxic waste, fire, spikes).
 */
export function isPathDangerous(
  state: GameState,
  path: Vector3[],
  unit?: Unit
): boolean {
  if (unit && hasTrait(unit.specialRules, 'airborne')) {
    return false; // Airborne models fly over dangerous ground terrain
  }

  for (const point of path) {
    const piece = findTerrainAtPosition(state, point);
    if (
      piece &&
      (piece.isDangerous ||
        piece.terrainType === 'toxic' ||
        piece.terrainType === 'hazard' ||
        piece.terrainType === 'fire')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Scans a path for vertical downward drops.
 * Returns the maximum downward drop across any segment.
 */
export function detectPathFall(
  path: Vector3[],
  state?: GameState | null
): {
  maxDrop: number;
  dropStartIndex: number;
} {
  let maxDrop = 0;
  let dropStartIndex = -1;

  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const prevY = prev.y ?? 0;
    const currY = curr.y ?? 0;
    const drop = prevY - currY;
    if (drop > maxDrop) {
      if (state) {
        const kind = classifySegment(state, prev, curr).kind;
        if (kind === 'stairs' || kind === 'ladder') {
          continue;
        }
      }
      maxDrop = drop;
      dropStartIndex = i - 1;
    }
  }

  return { maxDrop, dropStartIndex };
}

/**
 * Returns the effective maximum movement allowed for an action, considering speed, action type,
 * special rules (Pathfinder, Airborne), and Difficult Terrain capping.
 */
export function getEffectiveMaxMovement(
  unit: Unit,
  actionType: 'move' | 'rush' | 'charge',
  isDifficult: boolean
): number {
  if (
    isDifficult &&
    !hasTrait(unit.specialRules, 'pathfinder') &&
    !hasTrait(unit.specialRules, 'airborne')
  ) {
    // Difficult Terrain caps total activation movement at 6.0" maximum.
    // Negates speed bonuses for Rush and Charge.
    return actionType === 'move' ? Math.min(unit.speed, 6.0) : 6.0;
  }

  switch (actionType) {
    case 'move':
      return unit.speed;
    case 'rush':
    case 'charge':
      return unit.speed * 2;
  }
}

/**
 * Drops <= 3.0" are safe. Drops > 3.0" inflict Falling Damage: 1 hit with AP(1) per full 3.0" fallen.
 */
export function calculateFallingDamage(
  verticalDrop: number,
  forcedFall: boolean = false
): {
  isDangerous: boolean;
  damageHits: number;
  armorPiercing: number;
} {
  // A voluntary drop of up to 3" is safe movement; a model that actually falls (failed jump) is hurt from 2" up.
  const threshold = forcedFall ? FALL_DAMAGE_MIN - 0.05 : FREE_DROP_MAX;
  if (forcedFall ? verticalDrop < threshold : verticalDrop <= threshold) {
    return { isDangerous: false, damageHits: 0, armorPiercing: 0 };
  }
  const full3Inches = Math.floor((verticalDrop + 0.05) / 3.0);
  const ap = full3Inches; // AP(1) per FULL 3" fallen: a 2-2.99" fall is an AP(0) hit
  return {
    isDangerous: true,
    damageHits: 1,
    armorPiercing: ap,
  };
}

/**
 * Resolves falling damage defense roll and trauma for a unit that plummeted.
 */
export function resolveFallingDamage(
  unit: Unit,
  verticalDrop: number,
  defenseRoll?: number,
  forcedFall: boolean = false
): {
  isDangerous: boolean;
  damageHits: number;
  armorPiercing: number;
  saved: boolean;
  wounds: number;
} {
  const calc = calculateFallingDamage(verticalDrop, forcedFall);
  if (!calc.isDangerous) {
    return {
      isDangerous: false,
      damageHits: 0,
      armorPiercing: 0,
      saved: true,
      wounds: 0,
    };
  }

  if (defenseRoll === undefined) {
    // Unchecked or guaranteed hit if no roll supplied
    return {
      isDangerous: true,
      damageHits: calc.damageHits,
      armorPiercing: calc.armorPiercing,
      saved: false,
      wounds: 1,
    };
  }

  // Natural 1 always fails; natural 6 always saves.
  // Defense test: roll - AP >= unit.defense
  if (defenseRoll === 6) {
    return {
      isDangerous: true,
      damageHits: calc.damageHits,
      armorPiercing: calc.armorPiercing,
      saved: true,
      wounds: 0,
    };
  }
  if (defenseRoll === 1) {
    return {
      isDangerous: true,
      damageHits: calc.damageHits,
      armorPiercing: calc.armorPiercing,
      saved: false,
      wounds: 1,
    };
  }

  const effectiveDefense = Math.max(2, Math.min(6, unit.defense + calc.armorPiercing));
  const saved = defenseRoll >= effectiveDefense;
  return {
    isDangerous: true,
    damageHits: calc.damageHits,
    armorPiercing: calc.armorPiercing,
    saved,
    wounds: saved ? 0 : 1,
  };
}

/** Gaps up to this width (inches) are regular movement: no test. */
export const FREE_GAP_MAX = 1.05;
/** Gaps above FREE_GAP_MAX up to this width can be jumped (test); wider gaps cannot be crossed. */
export const JUMP_GAP_MAX = 6.05;

/**
 * Widest stretch of open air a path crosses while elevated (y >= 1.0"): the longest run along the
 * path (measured on the board) with no walkable floor beneath it. Walking onto an adjacent deck,
 * catwalk, stairs or ladder is not a gap; only space with nothing to stand on is.
 */
export function measureElevatedGap(state: GameState, path: Vector3[]): number {
  let widest = 0;
  let run = 0;
  const step = 0.1;
  let surfaces: ReturnType<typeof collectWalkableSurfaces> | undefined; // resolved lazily, once
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const aY = a.y ?? 0;
    const bY = b.y ?? 0;
    const len = distanceHorizontal(a, b);
    if (Math.min(aY, bY) < 1.0 || len < 1e-6 || isSegmentOnRampOrStairs(state, a, b)) {
      run = 0;
      continue;
    }
    const n = Math.max(1, Math.ceil(len / step));
    surfaces ??= collectWalkableSurfaces(state);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const pt = { x: a.x + (b.x - a.x) * t, y: aY + (bY - aY) * t, z: a.z + (b.z - a.z) * t };
      const surface = findWalkableSurfaceIn(surfaces, pt, 0.05);
      const supported = surface !== null && Math.abs(surface.topY - pt.y) <= 0.5;
      if (supported) {
        run = 0;
      } else {
        run += len / n;
        widest = Math.max(widest, run);
      }
    }
  }
  return Math.round(widest * 10) / 10;
}

/**
 * Scans a path for a horizontal gap between elevated surfaces. A gap of 1" or less is regular
 * movement; 1-6" must be jumped; wider cannot be crossed.
 */
export function detectPathGapJump(
  state: GameState,
  path: Vector3[],
  unit: Unit
): {
  isGapJump: boolean;
  gapDistance: number;
  tooWide: boolean;
  dice: number;
  target: number;
} {
  const none = { isGapJump: false, gapDistance: 0, tooWide: false, dice: 0, target: 0 };
  if (path.length < 2 || hasTrait(unit.specialRules, 'airborne')) return none;
  const gap = measureElevatedGap(state, path);
  if (gap <= FREE_GAP_MAX) return none;
  const res = resolveGapJump(gap, unit);
  return {
    isGapJump: res.canJump,
    gapDistance: gap,
    tooWide: !res.canJump,
    dice: res.dice,
    target: res.target,
  };
}

/** Jump test for crossing a horizontal gap (same dice as a drop: X+1 dice, all 3+). */
export function resolveGapJump(gapDistance: number, unit: Unit, rolls?: number[]): JumpResult {
  return resolveJump(unit, gapDistance, FREE_GAP_MAX, JUMP_GAP_MAX, rolls);
}

/** A jump or fall the player has chosen to make, sent with the move that contains it. */
export interface DeclaredTraversal {
  kind: JumpKind;
  /** Where the leap starts (the model's spot at the edge). */
  takeoff: Vector3;
  /** Where the model lands (or, for a fall, ends up). */
  landing: Vector3;
}

export interface JumpOption extends DeclaredTraversal {
  /** Gap width (jump-gap) or drop height (jump-drop, fall) in inches. */
  distance: number;
  /** Jump dice (0 for a fall: it is guaranteed). */
  dice: number;
  /** Target number each die needs (0 for a fall). */
  target: number;
  /** The path to send: just the leap from takeoff to landing. */
  path: Vector3[];
}

/**
 * True if `point` stands on a floor within `EDGE_SNAP_TOLERANCE` of an edge that the line toward `toward`
 * leaves through (the leap must head out over that edge, not across the deck).
 */
export function isAtFloorEdgeToward(state: GameState, point: Vector3, toward: Vector3): boolean {
  const y = point.y ?? 0;
  for (const piece of state.terrain) {
    for (const surface of getWalkableSurfaces(piece)) {
      if (Math.abs(surface.topY - y) > 0.3) continue;
      const l = worldToLocal(piece, point);
      const eps = 0.1;
      if (
        l.x < surface.minX - eps ||
        l.x > surface.maxX + eps ||
        l.z < surface.minZ - eps ||
        l.z > surface.maxZ + eps
      ) {
        continue;
      }
      const t = worldToLocal(piece, toward);
      const dx = t.x - l.x;
      const dz = t.z - l.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const edges: Array<{ dist: number; nx: number; nz: number }> = [
        { dist: l.x - surface.minX, nx: -1, nz: 0 },
        { dist: surface.maxX - l.x, nx: 1, nz: 0 },
        { dist: l.z - surface.minZ, nx: 0, nz: -1 },
        { dist: surface.maxZ - l.z, nx: 0, nz: 1 },
      ];
      for (const e of edges) {
        if (e.dist <= FLOOR_EDGE_REACH + 1e-6 && (dx * e.nx + dz * e.nz) / len > 0.2) return true;
      }
    }
  }
  return false;
}

/**
 * The jump (or fall) a model standing at `from` could declare to reach `target`, or null.
 *
 * Offered only when the model is already at a floor edge (within `EDGE_SNAP_TOLERANCE`, heading out over it)
 * and the target is across a 1-6" gap at the same height (jump-gap), 3-6" below (jump-drop) or more than 6"
 * below (fall: no dice, a guaranteed fall). Everything else is ordinary movement the pathfinder handles, or
 * impossible. There is no path search: a jump is one hop from where the model stands.
 */
export function findJumpOption(
  state: GameState,
  unit: Unit,
  from: Vector3,
  target: Vector3
): JumpOption | null {
  if (hasTrait(unit.specialRules, 'airborne')) return null;
  const fromY = from.y ?? 0;
  const targetY = target.y ?? 0;
  if (fromY < 1.0 || targetY - fromY > 0.5) return null;
  if (distanceHorizontal(from, target) > JUMP_GAP_MAX) return null;
  if (!isAtFloorEdgeToward(state, from, target)) return null;
  if (targetY > 0.3) {
    const floor = findWalkableSurfaceAt(state, { x: target.x, y: targetY, z: target.z }, 0);
    if (!floor || Math.abs(floor.topY - targetY) > 0.3) return null;
    // The landing must hold the whole base: a hop that would end half over the far edge is not offered
    if (isBaseOverhanging(state, { x: target.x, y: targetY, z: target.z })) return null;
  }
  const cls = classifySegment(state, from, target, unit);
  if (!(JUMP_KINDS as readonly string[]).includes(cls.kind)) return null;
  if (findMoveBlocker(state, unit, [from, target]).blocked) return null;
  if (findEndOverlap(state, unit.id, { x: target.x, y: targetY, z: target.z })) return null;
  const takeoff = { x: from.x, y: fromY, z: from.z };
  const landing = { x: target.x, y: targetY, z: target.z };
  return {
    kind: cls.kind as JumpKind,
    takeoff,
    landing,
    distance: Math.round(cls.distance * 10) / 10,
    dice: cls.dice,
    target: cls.target,
    path: [takeoff, landing],
  };
}

/**
 * Host-side check of the jump a move needs. Recomputes everything from the path (never trusts the client):
 * a path containing a jump or fall must carry a matching `traversal` declaration, made from a floor edge;
 * a declaration with nothing to declare is rejected. Returns a rejection reason, or null when fine.
 */
export function validateDeclaredTraversal(
  state: GameState,
  unit: Unit,
  path: Vector3[],
  traversal?: DeclaredTraversal | null
): string | null {
  const climbProblem = validatePathClimbs(state, unit, path);
  if (climbProblem) return climbProblem;
  const jumps: Array<{ a: Vector3; b: Vector3; kind: SegmentKind }> = [];
  for (let i = 1; i < path.length; i++) {
    const cls = classifySegment(state, path[i - 1], path[i], unit);
    if ((JUMP_KINDS as readonly string[]).includes(cls.kind)) {
      jumps.push({ a: path[i - 1], b: path[i], kind: cls.kind });
    }
  }
  const pathGap = detectPathGapJump(state, path, unit);
  const needsGapJump = pathGap.isGapJump && !jumps.some((j) => j.kind === 'jump-gap');
  if (!traversal) {
    if (jumps.length > 0 || needsGapJump) {
      return 'This move needs a jump: choose it explicitly (move to the edge, then declare the jump)';
    }
    return null;
  }
  if (needsGapJump) return 'This move needs a jump: choose it explicitly (move to the edge, then declare the jump)';
  if (jumps.length === 0) return 'Declared jump does not match the path: there is no jump to declare';
  if (jumps.length > 1) return 'Only one jump or fall can be made in a single move';
  const jump = jumps[0];
  if (traversal.kind !== jump.kind) return 'Declared jump does not match the path (wrong kind)';
  if (distance3D(jump.a, traversal.takeoff) > 0.1 || distance3D(jump.b, traversal.landing) > 0.1) {
    return 'Declared jump does not match the path (takeoff or landing differs)';
  }
  const option = findJumpOption(state, unit, jump.a, jump.b);
  if (!option || option.kind !== traversal.kind) {
    return 'Models can only jump or fall from the edge of a floor: move to the edge first';
  }
  return null;
}

/**
 * Evaluates Dangerous Terrain hazard tests for a unit (1d6 per living model entering).
 * Every roll of 1 inflicts 1 unsaved wound.
 */
export function resolveDangerousTerrain(
  unit: Unit,
  diceRolls: number[]
): {
  woundsInflicted: number;
  failedCount: number;
} {
  if (hasTrait(unit.specialRules, 'airborne')) {
    return { woundsInflicted: 0, failedCount: 0 };
  }

  let wounds = 0;
  for (const roll of diceRolls) {
    if (roll === 1) {
      wounds++;
    }
  }

  return { woundsInflicted: wounds, failedCount: wounds };
}

/**
 * Calculates knockback displacement when a unit is shoved near a high ledge.
 * If pushed over an edge where elevation drops > 3.0", the model plummets to the ground.
 */
export function calculateLedgeKnockback(
  currentPos: Vector3,
  pushOffset: { x: number; z: number },
  groundElevation: number = 0
): {
  destination: Vector3;
  didPlummet: boolean;
  fallHeight: number;
} {
  const currentY = currentPos.y ?? 0;
  const targetX = currentPos.x + pushOffset.x;
  const targetZ = currentPos.z + pushOffset.z;

  if (currentY > 3.0) {
    // If elevated > 3" and pushed over edge, model plummets to ground level
    return {
      destination: { x: targetX, y: groundElevation, z: targetZ },
      didPlummet: true,
      fallHeight: currentY - groundElevation,
    };
  }

  return {
    destination: { x: targetX, y: currentY, z: targetZ },
    didPlummet: false,
    fallHeight: 0,
  };
}

/**
 * Allocates hazard or fall casualties to models in a squad.
 * If specific model IDs are selected by the player, those are prioritized (verifying they are alive).
 * Otherwise, allocates to living models in default order.
 */
export function allocateSquadCasualties(
  unit: Unit,
  wounds: number,
  preferredModelIds?: string[]
): {
  modelsDestroyed: Model[];
  remainingWounds: number;
} {
  const modelsDestroyed: Model[] = [];
  if (wounds <= 0 || !unit.models || unit.models.length === 0) {
    return { modelsDestroyed, remainingWounds: wounds };
  }

  let unallocated = wounds;

  // If preferred models were designated (e.g. via player selection modal)
  if (preferredModelIds && preferredModelIds.length > 0) {
    for (const modelId of preferredModelIds) {
      if (unallocated <= 0) break;
      const model = unit.models.find((m) => m.id === modelId && !m.isDestroyed);
      if (model) {
        model.isDestroyed = true;
        model.wounds = 0;
        modelsDestroyed.push(model);
        unit.wounds = Math.max(1, unit.wounds - 1);
        unallocated--;
      }
    }
  }

  // Fallback / automatic allocation for remaining wounds
  while (unallocated > 0) {
    const alive = unit.models.filter((m) => !m.isDestroyed);
    if (alive.length <= 1) {
      // Last surviving model is not auto-destroyed by multi-model loop;
      // it takes damage via normal unit trauma/tough logic
      break;
    }
    const victim = alive[0];
    victim.isDestroyed = true;
    victim.wounds = 0;
    modelsDestroyed.push(victim);
    unit.wounds = Math.max(1, unit.wounds - 1);
    unallocated--;
  }

  if (modelsDestroyed.length > 0) {
    const surviving = unit.models.filter((m) => !m.isDestroyed);
    if (surviving.length > 0 && surviving.some((m) => m.position)) {
      unit.position = computeSquadCentroid(surviving.map((m) => m.position ?? unit.position));
    }
  }

  return { modelsDestroyed, remainingWounds: unallocated };
}


/**
 * Where a model that fell from `startY` at (`from.x`, `from.z`) comes to rest: the highest floor below the start
 * floor (a lower deck, or the ground) at a spot with the whole base supported and clear of terrain and other
 * models, as near the fall point as possible and within `FALL_LANDING_RADIUS`. If nothing is clear, the fall
 * point itself on its floor. `height` is the real fall (start floor minus landing floor).
 */
export function findFallLanding(
  state: GameState,
  unit: Unit,
  from: { x: number; z: number },
  startY: number
): { position: Vector3; height: number } {
  const surfaces = collectWalkableSurfaces(state);
  const floorAt = (x: number, z: number): number => {
    let best = 0;
    for (const s of surfaces) {
      if (s.topY > startY - 0.5 || s.topY <= best) continue;
      const l = worldToLocal(s.piece, { x, y: 0, z });
      if (l.x >= s.minX && l.x <= s.maxX && l.z >= s.minZ && l.z <= s.maxZ) best = s.topY;
    }
    return best;
  };
  const candidates: Array<{ x: number; z: number }> = [{ x: from.x, z: from.z }];
  for (let r = 0.25; r <= FALL_LANDING_RADIUS + 1e-6; r += 0.25) {
    const n = Math.max(8, Math.round(r * 16));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      candidates.push({ x: from.x + Math.cos(a) * r, z: from.z + Math.sin(a) * r });
    }
  }
  for (const c of candidates) {
    const y = floorAt(c.x, c.z);
    const pt: Vector3 = { x: Math.round(c.x * 100) / 100, y, z: Math.round(c.z * 100) / 100 };
    if (findEndOverlap(state, unit.id, pt) === null && !isBaseOverhanging(state, pt, surfaces)) {
      return { position: pt, height: startY - y };
    }
  }
  const y = floorAt(from.x, from.z);
  return { position: { x: from.x, y, z: from.z }, height: startY - y };
}
