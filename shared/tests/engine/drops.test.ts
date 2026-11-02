import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import {
  calculateJumpDice,
  describeDrop,
  detectPathGapJump,
  pathMovementCost,
  resolveDropJump,
} from '../../src/engine/traversal';
import { applyAction, getDiceSpecs } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';

function makeUnit(id: string, position: Vector3, rules: string[] = []): Unit {
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
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: rules,
    hasMoved: false,
    remainingMovement: 6,
  };
}

function deck(topY: number): TerrainPiece {
  // Legacy-style elevated floor: whole footprint is walkable at `elevation`
  return {
    id: 'deck',
    terrainType: 'platform',
    position: { x: 0, y: topY, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 4, y: 0.3, z: 4 },
    elevation: topY,
    isWalkable: true,
    blocksLineOfSight: false,
    providesCover: false,
    isObstacle: false,
  };
}

function makeState(unit: Unit, topY: number): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = [deck(topY)];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  unit.isActivated = true;
  return state;
}

const dropPath = (topY: number): Vector3[] => [
  { x: 0, y: topY, z: 0 },
  { x: 2.5, y: topY, z: 0 },
  { x: 2.5, y: 0, z: 0 },
  { x: 3.5, y: 0, z: 0 },
];

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

describe('drops: movement cost (measured along the board)', () => {
  const unit = makeUnit('u', { x: 0, y: 3, z: 0 });
  const state = makeState(unit, 3);

  it('a drop costs only its horizontal distance; a climb costs its full length', () => {
    const down = [{ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 }];
    expect(pathMovementCost(state, down)).toBeCloseTo(0); // pure vertical step-off
    const diagonal = [{ x: 0, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }];
    expect(pathMovementCost(state, diagonal)).toBeCloseTo(1);
    const up = [{ x: 1, y: 0, z: 0 }, { x: 1, y: 3, z: 0 }];
    expect(pathMovementCost(state, up)).toBeCloseTo(3);
  });

  it('flat movement is unchanged', () => {
    expect(pathMovementCost(state, [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }])).toBeCloseTo(5);
  });
});

describe('drops: jump test (3-6" drops)', () => {
  const trooper = makeUnit('u', { x: 0, y: 0, z: 0 });

  it('X + 1 dice: one per full 3" plus one', () => {
    expect(calculateJumpDice(3.5)).toBe(2);
    expect(calculateJumpDice(5.9)).toBe(2);
    expect(calculateJumpDice(6)).toBe(3);
  });

  it('drops of 3" or less are regular movement: no test', () => {
    expect(resolveDropJump(trooper, 3.0)).toMatchObject({ requiresTest: false, passed: true });
  });

  it('a 4" drop needs 2 dice, all 3+', () => {
    const none = resolveDropJump(trooper, 4);
    expect(none).toMatchObject({ requiresTest: true, canJump: true, dice: 2, target: 3, passed: false });
    expect(resolveDropJump(trooper, 4, [3, 6]).passed).toBe(true);
    expect(resolveDropJump(trooper, 4, [3, 2]).passed).toBe(false);
    expect(resolveDropJump(trooper, 4, [1, 6]).passed).toBe(false);
  });

  it('a 6" drop needs 3 dice', () => {
    expect(resolveDropJump(trooper, 6, [3, 4, 5]).passed).toBe(true);
    expect(resolveDropJump(trooper, 6, [3, 4, 2]).passed).toBe(false);
  });

  it('Pathfinder needs 2+; Airborne auto-passes; above 6" cannot be jumped', () => {
    expect(resolveDropJump(makeUnit('p', { x: 0, y: 0, z: 0 }, ['pathfinder']), 4, [2, 2]).passed).toBe(true);
    expect(resolveDropJump(makeUnit('a', { x: 0, y: 0, z: 0 }, ['airborne']), 5)).toMatchObject({ requiresTest: false, passed: true });
    expect(resolveDropJump(trooper, 7, [6, 6, 6])).toMatchObject({ canJump: false, passed: false });
  });

  it('warns about the jump or the fall for the move preview', () => {
    expect(describeDrop(2.5, trooper)).toBe('');
    expect(describeDrop(4, trooper)).toMatch(/JUMP DOWN.*2 dice.*3\+/);
    expect(describeDrop(7, trooper)).toMatch(/too far to jump/);
  });
});

describe('drops: resolution through the host', () => {
  const moveAction = (path: Vector3[]) =>
    createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'u',
      path,
      finalPosition: path[path.length - 1],
    });

  it('requests jump dice (and fall dice as a fallback) for a 4" drop; none for a 3" drop', () => {
    const unit = makeUnit('u', { x: 0, y: 4, z: 0 });
    const specs = getDiceSpecs(makeState(unit, 4), moveAction(dropPath(4)))!;
    expect(specs.find((d) => d.purpose === 'drop_jump')?.count).toBe(2);
    expect(specs.some((d) => d.purpose === 'falling_defense')).toBe(true);

    const low = makeUnit('u', { x: 0, y: 3, z: 0 });
    expect(getDiceSpecs(makeState(low, 3), moveAction(dropPath(3)))).toBeNull();
  });

  it('a 7" drop cannot be jumped: no jump dice, only fall dice', () => {
    const unit = makeUnit('u', { x: 0, y: 7, z: 0 });
    const specs = getDiceSpecs(makeState(unit, 7), moveAction(dropPath(7)))!;
    expect(specs.some((d) => d.purpose === 'drop_jump')).toBe(false);
    expect(specs.some((d) => d.purpose === 'falling_defense')).toBe(true);
  });

  it('a successful jump lands with no damage and the activation continues', () => {
    const unit = makeUnit('u', { x: 0, y: 4, z: 0 });
    const state = makeState(unit, 4);
    const out = applyAction(state, moveAction(dropPath(4)), [
      roll('drop_jump', [3, 5]),
      roll('falling_defense', [1]),
      roll('trauma', [6]),
    ]);
    const u = out.state.units[0];
    expect(u.wounds).toBe(0);
    expect(u.position.y).toBe(0);
    expect(out.state.turnState.activeUnitId).toBe('u'); // activation not forced to end
    // The dice story is in the action log so both players see the rolls
    const logged = out.state.actionLog[out.state.actionLog.length - 1].dice!;
    expect(logged.outcome.traversal).toHaveLength(1);
    expect(logged.outcome.traversal![0]).toMatchObject({ type: 'drop-jump', rolls: [3, 5], passed: true });
    expect(logged.outcome.traversal![0].text).toMatch(/Jump down 4\.0".*3, 5.*landed/);
    expect(logged.results.map((r) => r.purpose)).toContain('drop_jump');
  });

  it('a failed jump falls: Falling damage and the activation ends', () => {
    const unit = makeUnit('u', { x: 0, y: 4, z: 0 });
    const state = makeState(unit, 4);
    const out = applyAction(state, moveAction(dropPath(4)), [
      roll('drop_jump', [3, 2]),
      roll('falling_defense', [1]), // natural 1 always fails the save
      roll('trauma', [1]),
    ]);
    expect(out.state.units[0].wounds).toBeGreaterThan(0);
    expect(out.state.turnState.activeUnitId).not.toBe('u'); // activation ended
    const events = out.state.actionLog[out.state.actionLog.length - 1].dice!.outcome.traversal!;
    expect(events.map((e) => e.type)).toEqual(['drop-jump', 'fall']);
    expect(events[0]).toMatchObject({ passed: false, rolls: [3, 2] });
    expect(events[1].wounds).toBeGreaterThan(0);
  });
});

describe('gaps: only real open air is a gap', () => {
  const deckAt = (id: string, x: number, z: number): TerrainPiece => ({
    id,
    terrainType: 'platform',
    position: { x, y: 3, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 4, y: 0.3, z: 4 },
    elevation: 3,
    isWalkable: true,
    blocksLineOfSight: false,
    providesCover: false,
    isObstacle: false,
  });
  const trooper = makeUnit('u', { x: 0, y: 3, z: 0 });

  it('crossing from one deck onto a flush neighbour is not a gap, however far the path runs', () => {
    const state = createInitialGameState(HOST, GUEST);
    state.terrain = [deckAt('a', 0, 0), deckAt('b', 4, 0)]; // x -2..2 and 2..6: flush
    const res = detectPathGapJump(state, [{ x: 0, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }], trooper);
    expect(res.isGapJump).toBe(false);
  });

  it('a 2" gap between decks is a jump of 1 die; a gap over 6" is too wide', () => {
    const state = createInitialGameState(HOST, GUEST);
    state.terrain = [deckAt('a', 0, 0), deckAt('b', 6, 0)]; // x -2..2 and 4..8: 2" gap
    const res = detectPathGapJump(state, [{ x: 0, y: 3, z: 0 }, { x: 6, y: 3, z: 0 }], trooper);
    expect(res).toMatchObject({ isGapJump: true, tooWide: false, dice: 1, target: 3 });
    expect(res.gapDistance).toBeCloseTo(2, 0);

    const far = createInitialGameState(HOST, GUEST);
    far.terrain = [deckAt('a', 0, 0), deckAt('b', 14, 0)]; // 10" gap
    expect(detectPathGapJump(far, [{ x: 0, y: 3, z: 0 }, { x: 14, y: 3, z: 0 }], trooper).tooWide).toBe(true);
  });

  it('Airborne never has a gap', () => {
    const state = createInitialGameState(HOST, GUEST);
    state.terrain = [deckAt('a', 0, 0), deckAt('b', 14, 0)];
    const flyer = makeUnit('f', { x: 0, y: 3, z: 0 }, ['airborne']);
    expect(detectPathGapJump(state, [{ x: 0, y: 3, z: 0 }, { x: 14, y: 3, z: 0 }], flyer).isGapJump).toBe(false);
  });
});
