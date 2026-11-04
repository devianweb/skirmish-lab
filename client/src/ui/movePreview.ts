import {
  DROP_STANDOFF,
  EDGE_SNAP_TOLERANCE,
  GameState,
  JumpOption,
  SegmentKind,
  UNIT_COLLISION_RADIUS,
  Unit,
  Vector3,
  classifySegment,
  collectWalkableSurfaces,
  findJumpOption,
  findWalkableSurfaceIn,
  localToWorldXZ,
  worldToLocal,
} from '@skirmish-lab/shared';

/**
 * Presentation helpers for the move preview. No rules live here: every classification, dice count and jump
 * option comes from the shared engine (`classifySegment`, `findJumpOption`); this file only turns that output
 * into labels, a style per segment and a cursor snap.
 */

/** One stretch of a previewed path, as classified by the engine. */
export interface PreviewSegment {
  from: Vector3;
  to: Vector3;
  kind: SegmentKind;
  /** Short label with its cost ("climb 2.3\"", "drop 3.0\"", "jump 4.9\" · 2 dice"), or null for plain walking. */
  label: string | null;
}

const inch = (n: number): string => `${n.toFixed(1)}"`;

function segmentLabel(kind: SegmentKind, distance: number, height: number, dice: number): string | null {
  switch (kind) {
    case 'climb':
      return `climb ${inch(height)}`;
    case 'drop':
      return `drop ${inch(distance)}`;
    case 'gap':
      return `gap ${inch(distance)}`;
    case 'jump-gap':
    case 'jump-drop':
      return `jump ${inch(distance)} · ${dice} dice`;
    case 'fall':
      return `fall ${inch(distance)}`;
    default:
      return null;
  }
}

/** Classify every leg of a previewed path (engine output only). */
export function describePathSegments(state: GameState, unit: Unit, path: Vector3[]): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  for (let i = 1; i < path.length; i++) {
    const cls = classifySegment(state, path[i - 1], path[i], unit, path[i - 2], path[i + 1]);
    out.push({
      from: path[i - 1],
      to: path[i],
      kind: cls.kind,
      label: segmentLabel(cls.kind, cls.distance, cls.height, cls.dice),
    });
  }
  return out;
}

/** The chip shown when the engine offers a declared jump. `warning` is true for the red "you will fall" case. */
export function jumpChip(option: JumpOption): { text: string; warning: boolean } {
  const d = inch(option.distance);
  if (option.kind === 'fall') {
    return {
      text: `Drop ${d}: too high to jump — the model will fall (falling damage, activation ends)`,
      warning: true,
    };
  }
  const what = option.kind === 'jump-gap' ? 'Jump gap' : 'Jump down';
  return { text: `${what} ${d} · ${option.dice} dice (${option.target}+)`, warning: false };
}

/** Joined labels of the non-trivial segments, for the summary line and the hover chip. */
export function segmentSummary(segments: PreviewSegment[]): string {
  return segments
    .filter((s) => s.label)
    .map((s) => s.label)
    .join(' · ');
}

/**
 * Edge snapping (cursor only): if the cursor is within `EDGE_SNAP_TOLERANCE` (horizontally) of the edge of an
 * elevated floor, return the point to stand at. A cursor on the deck is pulled to the spot a base radius (+0.05")
 * inside the deck's edge, at deck height (fully on the deck, never over the lip); a cursor on a lower level just outside the deck is pulled to the stand-off spot beside the edge.
 * Anything farther away comes back unchanged, so points clearly on the deck or the ground are never grabbed.
 */
export function snapCursorToEdge(state: GameState, cursor: Vector3): Vector3 {
  const cy = cursor.y ?? 0;
  const surfaces = collectWalkableSurfaces(state);
  let best: { dist: number; point: Vector3 } | null = null;
  for (const s of surfaces) {
    if (s.topY <= 0.5) continue;
    const l = worldToLocal(s.piece, cursor);
    const onDeck = Math.abs(cy - s.topY) <= 0.3;
    const below = cy < s.topY - 0.5;
    if (!onDeck && !below) continue;
    const inside = l.x >= s.minX && l.x <= s.maxX && l.z >= s.minZ && l.z <= s.maxZ;
    if (below && inside) continue; // beneath the floor, not beside it
    if (onDeck && !inside) continue; // hovering over air beside a deck: not a deck point
    let ex: number;
    let ez: number;
    let nx = 0;
    let nz = 0;
    let dist: number;
    if (inside) {
      const nearest = [
        { d: l.x - s.minX, x: s.minX, z: l.z, nx: -1, nz: 0 },
        { d: s.maxX - l.x, x: s.maxX, z: l.z, nx: 1, nz: 0 },
        { d: l.z - s.minZ, x: l.x, z: s.minZ, nx: 0, nz: -1 },
        { d: s.maxZ - l.z, x: l.x, z: s.maxZ, nx: 0, nz: 1 },
      ].sort((a, b) => a.d - b.d)[0];
      dist = nearest.d;
      ex = nearest.x;
      ez = nearest.z;
      nx = nearest.nx;
      nz = nearest.nz;
    } else {
      ex = Math.max(s.minX, Math.min(s.maxX, l.x));
      ez = Math.max(s.minZ, Math.min(s.maxZ, l.z));
      const dx = l.x - ex;
      const dz = l.z - ez;
      dist = Math.hypot(dx, dz);
      if (Math.abs(dx) >= Math.abs(dz)) nx = Math.sign(dx);
      else nz = Math.sign(dz);
    }
    if (dist > EDGE_SNAP_TOLERANCE + 1e-6) continue;
    let tx = ex;
    let tz = ez;
    let ty = s.topY;
    if (below) {
      tx = ex + nx * DROP_STANDOFF;
      tz = ez + nz * DROP_STANDOFF;
      ty = cy;
    } else {
      // Stand a full base (plus a hair) inside the edge, so the model is entirely on the deck, not over its lip
      const inset = UNIT_COLLISION_RADIUS + 0.05;
      const clampIn = (v: number, lo: number, hi: number) => (hi - lo < 2 * inset ? (lo + hi) / 2 : Math.max(lo + inset, Math.min(hi - inset, v)));
      if (nx !== 0) {
        tx = nx < 0 ? s.minX + inset : s.maxX - inset;
        tz = clampIn(l.z, s.minZ, s.maxZ);
      } else {
        tz = nz < 0 ? s.minZ + inset : s.maxZ - inset;
        tx = clampIn(l.x, s.minX, s.maxX);
      }
      // An edge shared with another floor at the same height (one deck made of several parts) is not an edge
      const out = localToWorldXZ(s.piece, ex + nx * 0.3, ez + nz * 0.3);
      const neighbour = findWalkableSurfaceIn(surfaces, { x: out.x, z: out.z, y: s.topY }, 0, s.piece.id);
      if (neighbour && Math.abs(neighbour.topY - s.topY) < 0.3) continue;
    }
    if (!best || dist < best.dist) {
      const w = localToWorldXZ(s.piece, tx, tz);
      best = { dist, point: { x: Math.round(w.x * 100) / 100, y: ty, z: Math.round(w.z * 100) / 100 } };
    }
  }
  return best ? best.point : cursor;
}

export interface MoveTarget {
  /** The cursor after edge snapping. */
  target: Vector3;
  /** The declared jump the engine offers from `from` to `target`, or null (then plan the safe path). */
  jump: JumpOption | null;
}

/**
 * Snap the cursor to an edge, then ask the engine whether a jump (or fall) can be declared from `from`.
 * `allowJump` is true for single models and squad models alike (each model declares its own jump).
 */
export function resolveMoveTarget(
  state: GameState,
  unit: Unit,
  from: Vector3,
  cursor: Vector3,
  allowJump: boolean
): MoveTarget {
  const target = snapCursorToEdge(state, cursor);
  const jump = allowJump ? findJumpOption(state, unit, from, target) : null;
  return { target, jump };
}
