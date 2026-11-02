import { GameState, TerrainPiece, Unit, Model } from '../gameTypes';
import { Vector3 } from '../types';
import { hasTrait } from '../rules/traits';
import {
  computeSquadCentroid,
  findTerrainAtPosition,
  findWalkableSurfaceAt,
  isFreeDropSegment,
  isSegmentOnRampOrStairs,
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

/**
 * Movement a path uses from a model's allowance. Tabletop movement is measured along the board, so
 * drops (regular, jumped or fallen) cost only their horizontal distance; climbs, stairs, ramps and
 * ladders cost their full length.
 */
export function pathMovementCost(state: GameState, path: Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    total += isFreeDropSegment(state, a, b) ? distanceHorizontal(a, b) : distance3D(a, b);
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
  if (drop <= FREE_DROP_MAX || hasTrait(unit.specialRules, 'airborne')) return '';
  if (drop > JUMP_DROP_MAX) {
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
 * Checks whether a movement path encounters Difficult Terrain or scales sheer vertical walls.
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

  // Check sheer wall climb (vertical ascent > 0.5" without a designated ladder/stairs/ramp)
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const verticalRise = (curr.y ?? 0) - (prev.y ?? 0);
    if (verticalRise > 0.5) {
      const piece = findTerrainAtPosition(state, curr) || findTerrainAtPosition(state, prev);
      const isClimbPiece =
        piece &&
        (piece.terrainType === 'ladder' ||
          piece.terrainType === 'stairs' ||
          piece.climbType === 'ladder' ||
          piece.climbType === 'stairs' ||
          piece.climbType === 'ramp');
      const isClimbRamp = isClimbPiece || isSegmentOnRampOrStairs(state, prev, curr);
      if (!isClimbRamp) {
        return true; // Free-climbing a sheer wall counts as Difficult Terrain
      }
    }
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
        const isStairsOrLadder = isSegmentOnRampOrStairs(state, prev, curr);
        if (isStairsOrLadder) {
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
export function calculateFallingDamage(verticalDrop: number): {
  isDangerous: boolean;
  damageHits: number;
  armorPiercing: number;
} {
  if (verticalDrop <= 3.05) {
    return { isDangerous: false, damageHits: 0, armorPiercing: 0 };
  }
  const full3Inches = Math.floor((verticalDrop + 0.05) / 3.0);
  const ap = Math.max(1, full3Inches);
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
  defenseRoll?: number
): {
  isDangerous: boolean;
  damageHits: number;
  armorPiercing: number;
  saved: boolean;
  wounds: number;
} {
  const calc = calculateFallingDamage(verticalDrop);
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
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const pt = { x: a.x + (b.x - a.x) * t, y: aY + (bY - aY) * t, z: a.z + (b.z - a.z) * t };
      const surface = findWalkableSurfaceAt(state, pt, 0.05);
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
