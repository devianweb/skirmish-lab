import { GameState, TerrainPiece, Unit, Model } from '../gameTypes';
import { Vector3 } from '../types';
import { hasTrait } from '../rules/traits';
import { getEffectiveSpeed } from './specialRules';
import { isClimbable, isDangerousPiece, isDifficultPiece } from '../data/mapSchema';
import {
  DROP_STANDOFF,
  computeSquadCentroid,
  findEndOverlap,
  findMoveBlocker,
  collectWalkableSurfaces,
  findWalkableSurfaceAt,
  findWalkableSurfaceIn,
  getWalkableSurfaces,
  isBaseOverhanging,
  isFallColumnBlocked,
  isLadderStepSegment,
  isSegmentOnLadder,
  isSegmentOnRampOrStairs,
  pointInsideFootprintAtLevel,
  segmentCrossesFootprintAtLevel,
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
  const flying = !!unit && hasTrait(unit.specialRules, 'flying');
  const target = JUMP_TARGET;
  const strider = !!unit && hasTrait(unit.specialRules, 'strider');
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
      if (flying) return make('walk', length);
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
    if (flying) return make('drop', horizontal, { distance: height });
    const kind = classifyDropHeight(height);
    // A hop that also crosses more than 1" of open air is a gap jump, whatever its height change. A jump is
    // measured like a tape: the straight line from take-off to landing (`length`), and a hop longer than 6"
    // cannot be jumped (it is not a fall either)
    if (measureElevatedGap(state, [a, b]) > FREE_GAP_MAX) {
      if (length > JUMP_GAP_MAX) return make('blocked', length, { distance: length });
      return make('jump-gap', 0, { distance: length, dice: calculateJumpDice(length, strider), target });
    }
    if (kind === 'drop') return make('drop', horizontal, { distance: height });
    if (kind === 'jump-drop') {
      return make('jump-drop', 0, { distance: length, dice: calculateJumpDice(length, strider), target });
    }
    return make('fall', horizontal, { distance: height });
  }

  // Level movement: open air beneath an elevated stretch is a gap
  if (flying) return make('walk', length);
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
  if (length <= JUMP_GAP_MAX) {
    return make('jump-gap', 0, { distance: length, dice: calculateJumpDice(length, strider), target });
  }
  return make('blocked', length, { distance: length });
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

/** Every jump die needs this or better. */
export const JUMP_TARGET = 2;

/**
 * Jump test dice for a drop (or gap) of `distance` inches: one per started inch (a hair of tolerance so a
 * measured 5.0" is 5 dice, not 6). A Strider rolls half as many, rounding up.
 */
export function calculateJumpDice(distance: number, strider: boolean = false): number {
  const dice = Math.max(1, Math.ceil(distance - 0.05));
  return strider ? Math.ceil(dice / 2) : dice;
}

interface JumpResult {
  requiresTest: boolean;
  canJump: boolean;
  dice: number;
  target: number;
  passed: boolean;
}

/**
 * The jump test: one die per started inch (half as many for a Strider), each needing 2+; Flying
 * auto-passes. All dice must succeed. Distances up to `freeMax` are regular movement (no test);
 * distances above `jumpMax` cannot be jumped.
 */
function resolveJump(
  unit: Unit,
  distance: number,
  freeMax: number,
  jumpMax: number,
  rolls?: number[],
  diceDistance: number = distance
): JumpResult {
  if (distance <= freeMax) {
    return { requiresTest: false, canJump: true, dice: 0, target: 0, passed: true };
  }
  if (hasTrait(unit.specialRules, 'flying')) {
    return { requiresTest: false, canJump: true, dice: 0, target: 0, passed: true };
  }
  const target = JUMP_TARGET;
  if (distance > jumpMax) {
    return { requiresTest: false, canJump: false, dice: 0, target, passed: false };
  }
  const dice = calculateJumpDice(diceDistance, hasTrait(unit.specialRules, 'strider'));
  const passed = !!rolls && rolls.length >= dice && rolls.slice(0, dice).every((r) => r >= target);
  return { requiresTest: true, canJump: true, dice, target, passed };
}

/** Jump test for dropping off an elevation: up to 3" is regular movement, 3-6" is jumped, more falls. */
export function resolveDropJump(unit: Unit, drop: number, rolls?: number[], hopLength: number = drop): JumpResult {
  // Whether it can be jumped depends on the height; the dice on the straight-line length of the hop
  return resolveJump(unit, drop, FREE_DROP_MAX, JUMP_DROP_MAX, rolls, hopLength);
}

/** Human-readable warning for the highest drop on a path (empty when it is regular movement). */
export function describeDrop(drop: number, unit: Unit): string {
  const kind = classifyDropHeight(drop);
  if (kind === 'drop' || hasTrait(unit.specialRules, 'flying')) return '';
  if (kind === 'fall') {
    return `⚠️ HIGH DROP (${drop.toFixed(1)}"): too far to jump — falls (${fallDiceCount(drop)} dice, 1-3 wounds) and ends activation!`;
  }
  const res = resolveDropJump(unit, drop);
  return `⚠️ JUMP DOWN (${drop.toFixed(1)}"): roll ${res.dice} dice, all must be ${res.target}+ or fall (ends activation)`;
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

/** Whether any segment of the path (or its single point) crosses a flagged piece's footprint at the piece's level. */
function pathCrossesFlaggedPiece(
  state: GameState,
  path: Vector3[],
  flagged: (piece: TerrainPiece) => boolean
): boolean {
  return flaggedPiecesCrossed(state, [path], flagged).length > 0;
}

/** The flagged pieces any of the paths crosses (segment by segment), in terrain order, each once. */
function flaggedPiecesCrossed(
  state: GameState,
  paths: Vector3[][],
  flagged: (piece: TerrainPiece) => boolean
): TerrainPiece[] {
  const pieces = state.terrain.filter(flagged);
  if (pieces.length === 0) return [];
  return pieces.filter((piece) =>
    paths.some((path) => {
      if (path.length === 0) return false;
      if (path.length === 1) return segmentCrossesFootprintAtLevel(piece, path[0], path[0]);
      for (let i = 1; i < path.length; i++) {
        if (segmentCrossesFootprintAtLevel(piece, path[i - 1], path[i])) return true;
      }
      return false;
    })
  );
}

/**
 * Checks whether a movement path encounters Difficult Terrain (climbing is ordinary movement, never difficult).
 * Every segment is tested against every difficult piece's footprint at that piece's level, so a straight walk
 * across a piece counts even when both ends are outside it.
 */
export function isPathDifficult(
  state: GameState,
  path: Vector3[],
  unit?: Unit
): boolean {
  if (unit && hasTrait(unit.specialRules, 'strider')) {
    return false; // Strider ignores difficult terrain
  }
  if (unit && hasTrait(unit.specialRules, 'flying')) {
    return false; // Flying ignores all terrain effects
  }
  return pathCrossesFlaggedPiece(state, path, isDifficultPiece);
}

/**
 * Checks whether a movement path passes through Dangerous Terrain (toxic waste, fire, spikes, hazard pools),
 * segment by segment like `isPathDifficult`.
 */
export function isPathDangerous(
  state: GameState,
  path: Vector3[],
  unit?: Unit
): boolean {
  if (unit && hasTrait(unit.specialRules, 'flying')) {
    return false; // Flying models fly over dangerous ground terrain
  }
  return pathCrossesFlaggedPiece(state, path, isDangerousPiece);
}

/** Ids of the dangerous pieces any of the paths crosses, in terrain order. Flying units cross nothing. */
export function dangerousPieceIdsOnPaths(state: GameState, paths: Vector3[][], unit?: Unit): string[] {
  if (unit && hasTrait(unit.specialRules, 'flying')) return [];
  return flaggedPiecesCrossed(state, paths, isDangerousPiece).map((p) => p.id);
}

/**
 * Ids of the dangerous pieces at least one living model of `unit` stands in (centre inside the footprint at
 * the piece's level), in terrain order. The unit tests once per piece when it activates. Flying units are exempt.
 */
export function dangerousPieceIdsUnderUnit(state: GameState, unit: Unit): string[] {
  if (hasTrait(unit.specialRules, 'flying')) return [];
  const living = unit.models.filter((m) => !m.isDestroyed);
  return state.terrain
    .filter(isDangerousPiece)
    .filter((piece) => living.some((m) => pointInsideFootprintAtLevel(piece, m.position ?? unit.position)))
    .map((p) => p.id);
}

/**
 * Wounds it would take to destroy the unit: Tough minus wounds taken, summed over living models
 * (a model's `wounds` is what it has left). This is how many dice a dangerous terrain test rolls.
 */
export function woundsToDestroy(unit: Unit): number {
  const living = unit.models.filter((m) => !m.isDestroyed);
  if (living.length === 0) return Math.max(1, unit.wounds);
  return living.reduce((sum, m) => sum + Math.max(1, m.wounds), 0);
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
  /** Straight-line length (take-off to landing) of the hop with the largest drop: what jump dice are rolled on. */
  maxDropDistance: number;
} {
  let maxDrop = 0;
  let dropStartIndex = -1;
  let maxDropDistance = 0;

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
      maxDropDistance = Math.hypot(distanceHorizontal(prev, curr), drop);
    }
  }

  return { maxDrop, dropStartIndex, maxDropDistance };
}

/**
 * Returns the effective maximum movement allowed for an action, considering speed, action type,
 * special rules (Strider, Flying), and Difficult Terrain capping.
 */
export function getEffectiveMaxMovement(
  unit: Unit,
  actionType: 'move' | 'rush' | 'charge',
  isDifficult: boolean
): number {
  if (
    isDifficult &&
    !hasTrait(unit.specialRules, 'strider') &&
    !hasTrait(unit.specialRules, 'flying')
  ) {
    // Difficult Terrain caps total activation movement at 6.0" maximum.
    // Negates speed bonuses for Rush and Charge.
    return actionType === 'move' ? Math.min(getEffectiveSpeed(unit), 6.0) : 6.0;
  }

  switch (actionType) {
    case 'move':
      return getEffectiveSpeed(unit);
    case 'rush':
    case 'charge':
      return getEffectiveSpeed(unit) * 2;
  }
}

/**
 * Dice a fall of `height` inches rolls: none under 2", otherwise one per started inch fallen. Each die
 * showing 1-3 is one wound (no Defense roll).
 */
export function fallDiceCount(height: number): number {
  if (height < FALL_DAMAGE_MIN - 0.05) return 0;
  return Math.max(1, Math.ceil(height - 0.05));
}

/** Wounds a fall inflicts from its dice: each 1-3 is one wound. */
export function countFallWounds(rolls: number[]): number {
  return rolls.filter((r) => r <= 3).length;
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
  if (path.length < 2 || hasTrait(unit.specialRules, 'flying')) return none;
  const pathRun = measureElevatedGap(state, path);
  if (pathRun <= FREE_GAP_MAX) return none;
  // Jump distance is the straight line of the hop (take-off to landing), like a tape; a run chained over
  // several segments is measured as the open-air run itself
  let hop = 0;
  for (let i = 1; i < path.length; i++) {
    if (measureElevatedGap(state, [path[i - 1], path[i]]) > FREE_GAP_MAX) hop = Math.max(hop, distance3D(path[i - 1], path[i]));
  }
  const gap = Math.max(pathRun, hop);
  const res = resolveGapJump(gap, unit);
  return {
    isGapJump: res.canJump,
    gapDistance: gap,
    tooWide: !res.canJump,
    dice: res.dice,
    target: res.target,
  };
}

/** Jump test for crossing a horizontal gap (same dice as a drop: one per started inch, each 2+). */
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
  if (hasTrait(unit.specialRules, 'flying')) return null;
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
 * A gap the model at `from` is standing at the edge of but cannot cross: the landing `target` is solid floor
 * across open air, and the hop (take-off to landing, like a tape) is longer than the 6" jump limit. Returns
 * that distance for a HUD hint, or null. Never offers a jump; `findJumpOption` stays the only source of those.
 */
export function findTooWideGap(
  state: GameState,
  unit: Unit,
  from: Vector3,
  target: Vector3
): { distance: number } | null {
  if (hasTrait(unit.specialRules, 'flying')) return null;
  const fromY = from.y ?? 0;
  const targetY = target.y ?? 0;
  if (fromY < 1.0 || targetY < 1.0 || Math.abs(targetY - fromY) > 0.5) return null;
  if (!isAtFloorEdgeToward(state, from, target)) return null;
  const floor = findWalkableSurfaceAt(state, { x: target.x, y: targetY, z: target.z }, 0);
  if (!floor || Math.abs(floor.topY - targetY) > 0.3) return null;
  const cls = classifySegment(state, from, target, unit);
  if (cls.kind !== 'blocked') return null;
  if (measureElevatedGap(state, [from, target]) <= FREE_GAP_MAX) return null;
  return { distance: Math.round(cls.distance * 10) / 10 };
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
 * Evaluates a Dangerous Terrain test for a unit (one die per wound it would take to destroy it).
 * Every roll of 1 inflicts 1 unsaved wound.
 */
export function resolveDangerousTerrain(
  unit: Unit,
  diceRolls: number[]
): {
  woundsInflicted: number;
  failedCount: number;
} {
  if (hasTrait(unit.specialRules, 'flying')) {
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


/** Height of the highest walkable floor under (`x`, `z`) that lies below `startY` (at least 0.5" lower); 0 for the ground. */
export function floorHeightBelow(
  surfaces: ReturnType<typeof collectWalkableSurfaces>,
  x: number,
  z: number,
  startY: number
): number {
  let best = 0;
  for (const s of surfaces) {
    if (s.topY > startY - 0.5 || s.topY <= best) continue;
    const l = worldToLocal(s.piece, { x, y: 0, z });
    if (l.x >= s.minX && l.x <= s.maxX && l.z >= s.minZ && l.z <= s.maxZ) best = s.topY;
  }
  return best;
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
  const floorAt = (x: number, z: number): number => floorHeightBelow(surfaces, x, z, startY);
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
