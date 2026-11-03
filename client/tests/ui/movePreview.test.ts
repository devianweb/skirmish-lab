import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GameState,
  TerrainPiece,
  Unit,
  Vector3,
  WEAPONS,
  createInitialGameState,
  findJumpOption,
  findNavPath,
  isBaseOverhanging,
} from '@skirmish-lab/shared';
import {
  describePathSegments,
  jumpChip,
  resolveMoveTarget,
  segmentSummary,
  snapCursorToEdge,
} from '../../src/ui/movePreview';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../shared/tests/fixtures/testy-mctestface.json'), 'utf8')
)[0];
const terrain: TerrainPiece[] = fixture.terrain;

function makeUnit(position: Vector3, rules: string[] = []): Unit {
  return {
    id: 'u',
    ownerId: HOST,
    armyId: 'a',
    unitType: 'trooper',
    name: 'Trooper',
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
    remainingMovement: 12,
  };
}

function makeState(unit: Unit, pieces: TerrainPiece[] = terrain): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = pieces;
  state.status = 'in-progress';
  return state;
}

describe('snapCursorToEdge (P5: 0.5" tolerance, cursor to edge)', () => {
  const unit = makeUnit(P(0, 0, 0));
  const state = makeState(unit);
  // Platform A: centred (7, -1), 4x4, top at 3": its west edge is x = 5.

  it('a cursor on the deck within 0.5" of the edge snaps to the spot a base radius inside the edge, at deck height', () => {
    const snapped = snapCursorToEdge(state, P(5.4, 3, -1));
    expect(snapped.x).toBeCloseTo(5.5, 5);
    expect(snapped.z).toBeCloseTo(-1, 5);
    expect(snapped.y).toBe(3);
  });

  it('exactly 0.5" snaps; 0.6" does not', () => {
    expect(snapCursorToEdge(state, P(5.5, 3, -1)).x).toBeCloseTo(5.5, 5);
    const far = P(5.6, 3, -1);
    expect(snapCursorToEdge(state, far)).toEqual(far);
  });

  it('a cursor on the ground within 0.5" of the deck edge snaps to the stand-off spot beside it', () => {
    const snapped = snapCursorToEdge(state, P(4.7, 0, -1));
    expect(snapped.x).toBeCloseTo(4.45, 5); // a full base (0.55") off the edge at x = 5
    expect(snapped.y).toBe(0);
    expect(snapped.z).toBeCloseTo(-1, 5);
  });

  it('a ground cursor 0.6" from the deck edge is left alone', () => {
    const far = P(4.4, 0, -1);
    expect(snapCursorToEdge(state, far)).toEqual(far);
  });

  it('open ground far from any deck is untouched', () => {
    const p = P(-12, 0, 5);
    expect(snapCursorToEdge(state, p)).toEqual(p);
  });
});

describe('resolveMoveTarget', () => {
  it('offers the gap jump from the ledge edge and snaps the far deck cursor to its fully-on-deck spot', () => {
    const unit = makeUnit(P(-0.2, 3, 0));
    const state = makeState(unit);
    const { target, jump } = resolveMoveTarget(state, unit, unit.position, P(5.3, 3, -1), true);
    expect(target.x).toBeCloseTo(5.5, 5);
    expect(jump).not.toBeNull();
    expect(jump!.kind).toBe('jump-gap');
    expect(jump!.dice).toBe(2);
    // identical to what the engine returns for the snapped target: no client-side rules
    expect(jump).toEqual(findJumpOption(state, unit, unit.position, target));
  });

  it('offers nothing from mid-ledge, or when jumps are not allowed (squads)', () => {
    const mid = makeUnit(P(-1.5, 3, 0));
    expect(resolveMoveTarget(makeState(mid), mid, mid.position, P(5.6, 3, -1), true).jump).toBeNull();
    const edge = makeUnit(P(-0.2, 3, 0));
    expect(resolveMoveTarget(makeState(edge), edge, edge.position, P(5.6, 3, -1), false).jump).toBeNull();
  });
});

describe('jumpChip', () => {
  const unit = makeUnit(P(-0.2, 3, 0));
  const state = makeState(unit);

  it('gap jump text carries distance, dice and target', () => {
    const opt = findJumpOption(state, unit, unit.position, P(5.6, 3, -1))!;
    const chip = jumpChip(opt);
    expect(chip.warning).toBe(false);
    expect(chip.text).toBe(`Jump gap ${opt.distance.toFixed(1)}" · 2 dice (3+)`);
  });

  it('jump down and the red fall warning', () => {
    const deck = (h: number): TerrainPiece => ({
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
    const u4 = makeUnit(P(1.8, 4, 0));
    const down = findJumpOption(makeState(u4, [deck(4)]), u4, u4.position, P(3, 0, 0))!;
    expect(jumpChip(down)).toEqual({ text: 'Jump down 4.0" · 2 dice (3+)', warning: false });
    const u7 = makeUnit(P(1.8, 7, 0));
    const fall = findJumpOption(makeState(u7, [deck(7)]), u7, u7.position, P(3, 0, 0))!;
    const chip = jumpChip(fall);
    expect(chip.warning).toBe(true);
    expect(chip.text).toContain('Drop 7.0"');
    expect(chip.text).toContain('too high to jump');
    expect(chip.text).toContain('the model will fall');
  });
});

describe('describePathSegments (P6 labels from classifySegment)', () => {
  const unit = makeUnit(P(0, 0, 0));
  const state = makeState(unit, []);

  it('plain walking has no label', () => {
    const segs = describePathSegments(state, unit, [P(0, 0, 0), P(3, 0, 0)]);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('walk');
    expect(segs[0].label).toBeNull();
  });

  it('a 3" drop is an amber drop labelled with its height', () => {
    const segs = describePathSegments(state, unit, [P(0, 3, 0), P(1, 0, 0)]);
    expect(segs[0].kind).toBe('drop');
    expect(segs[0].label).toBe('drop 3.0"');
  });

  it('a declared jump is labelled with distance and dice', () => {
    const segs = describePathSegments(state, unit, [P(0, 4, 0), P(1, 0, 0)]);
    expect(segs[0].kind).toBe('jump-drop');
    expect(segs[0].label).toBe('jump 4.0" · 2 dice');
    expect(segmentSummary(segs)).toBe('jump 4.0" · 2 dice');
  });

  it('a climb is labelled with its rise', () => {
    const climber = makeUnit(P(-5.95, 0, -3));
    const s = makeState(climber);
    // Shipping container at (-9, -3), top 2.25": the climb goes straight up from the stand-off spot beside it
    const segs = describePathSegments(s, climber, [P(-5.95, 0, -3), P(-5.95, 2.25, -3)]);
    expect(segs[0].kind).toBe('climb');
    expect(segs[0].label).toBe('climb 2.3"');
  });

  it('a climb onto the ruin ledge reads "climb 3.0" with no gap label, and ends fully on the ledge', () => {
    const climber = makeUnit(P(-1, 0, -2.5));
    const s = makeState(climber);
    // a cursor near the ledge's south lip (z = -0.5): snapped, then planned by the engine
    const { target } = resolveMoveTarget(s, climber, climber.position, P(-1, 3, -0.3), false);
    const path = findNavPath(s, climber, target, 12);
    const segs = describePathSegments(s, climber, path);
    expect(segmentSummary(segs)).toBe('climb 3.0"');
    expect(segs.some((x) => x.kind === 'gap')).toBe(false);
    const end = path[path.length - 1];
    expect(end.y).toBe(3);
    expect(isBaseOverhanging(s, end)).toBe(false);
  });

  it('the step off a deck edge before a drop is not labelled a gap', () => {
    const walker = makeUnit(P(7, 3, -1));
    const s = makeState(walker);
    const segs = describePathSegments(s, walker, [P(7, 3, -1), P(5, 3, -1), P(4.45, 3, -1), P(4.45, 0, -1)]);
    expect(segs.map((x) => x.label)).toEqual([null, null, 'drop 3.0"']);
  });
});
