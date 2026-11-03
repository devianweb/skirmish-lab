import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { classifySegment, findJumpOption } from '../../src/engine/traversal';
import { findNavPath, isBaseOverhanging } from '../../src/engine/spatial';
import { validateAction } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function makeUnit(position: Vector3, budget = 12): Unit {
  return {
    id: 'm',
    ownerId: HOST,
    armyId: 'army-1',
    unitType: 'trooper',
    name: 'm',
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
    specialRules: [],
    hasMoved: false,
    remainingMovement: budget,
  };
}

function makeState(unit: Unit, pieces: TerrainPiece[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = pieces;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  return state;
}

const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/testy-mctestface.json'), 'utf8'))[0];
const ruin: TerrainPiece = fixture.terrain.find((p: TerrainPiece) => p.terrainType === 'ruin-l');
// The ruin's front ledge (3") has its south lip at z = -0.5 for x = -1; the courtyard is the ground south of it.

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

const moveAction = (path: Vector3[]) =>
  createAction(HOST, 'move-unit', { type: 'move-unit', unitId: 'm', path, finalPosition: path[path.length - 1] });

const kindsOf = (state: GameState, unit: Unit, path: Vector3[]) =>
  path.slice(1).map((b, i) => classifySegment(state, path[i], b, unit, path[i - 1], path[i + 2]).kind);

describe('no overhanging ends', () => {
  describe('isBaseOverhanging', () => {
    it('is false with the whole base on the ledge, true when the centre is only 0.2" inside the lip', () => {
      const state = makeState(makeUnit(P(-1, 3, 0)), [ruin]);
      expect(isBaseOverhanging(state, P(-1, 3, 0))).toBe(false);
      expect(isBaseOverhanging(state, P(-1, 3, -0.05))).toBe(false); // exactly a base radius in
      expect(isBaseOverhanging(state, P(-1, 3, -0.3))).toBe(true);
      expect(isBaseOverhanging(state, P(-1, 3, -0.5))).toBe(true); // on the lip
    });

    it('is a union of floors: standing across the seam of two flush decks is fine, the outer lip is not', () => {
      const state = makeState(makeUnit(P(0, 3, 0)), [deckAt('a', 0), deckAt('b', 4)]); // a: -2..2, b: 2..6
      expect(isBaseOverhanging(state, P(2, 3, 0))).toBe(false);
      expect(isBaseOverhanging(state, P(6, 3, 0))).toBe(true);
      const lone = makeState(makeUnit(P(0, 3, 0)), [deckAt('a', 0)]);
      expect(isBaseOverhanging(lone, P(2, 3, 0))).toBe(true);
    });

    it('does not judge the ground', () => {
      const state = makeState(makeUnit(P(0, 0, 0)), [deckAt('a', 0)]);
      expect(isBaseOverhanging(state, P(2, 0, 0))).toBe(false);
    });
  });

  describe('host validation', () => {
    it('rejects a move ending with the centre 0.2" inside the ledge lip', () => {
      const unit = makeUnit(P(-1, 3, 0.5));
      const state = makeState(unit, [ruin]);
      const result = validateAction(state, moveAction([P(-1, 3, 0.5), P(-1, 3, -0.3)]));
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/overhang/i);
    });

    it('accepts an end a full base inside the lip', () => {
      const unit = makeUnit(P(-1, 3, 0.5));
      const state = makeState(unit, [ruin]);
      expect(validateAction(state, moveAction([P(-1, 3, 0.5), P(-1, 3, -0.05)])).valid).toBe(true);
    });

    it('accepts standing across a flush deck seam', () => {
      const unit = makeUnit(P(0, 3, 0));
      const state = makeState(unit, [deckAt('a', 0), deckAt('b', 4)]);
      expect(validateAction(state, moveAction([P(0, 3, 0), P(2, 3, 0)])).valid).toBe(true);
    });
  });

  describe('planned paths', () => {
    const climbTo = (z: number, budget = 12) => {
      const unit = makeUnit(P(-1, 0, -2.5), budget);
      const state = makeState(unit, [ruin]);
      const path = findNavPath(state, unit, P(-1, 3, z), budget);
      return { unit, state, path, end: path[path.length - 1] };
    };

    it.each([0, -0.3, -0.5, -0.9])('courtyard to a ledge cursor at z=%f ends with the base fully on the ledge', (z) => {
      const { state, end, path } = climbTo(z);
      expect(end.y).toBe(3);
      expect(end.z).toBeGreaterThanOrEqual(-0.05 - 1e-6); // a base radius inside the lip at z=-0.5
      expect(isBaseOverhanging(state, end)).toBe(false);
      expect(validateAction(state, moveAction(path)).valid).toBe(true);
    });

    it('stops at the stand-off spot on the ground when the budget cannot reach a full base onto the ledge', () => {
      // 1.45 to the stand-off spot, 3 up, 0.55 to the lip = 5.0; a full base on needs about 0.5 more
      const { state, end } = climbTo(-0.5, 5.2);
      expect(end.y).toBe(0);
      expect(end.z).toBeCloseTo(-1.05, 1);
      expect(isBaseOverhanging(state, end)).toBe(false);
    });

    it('a walk along the deck toward the lip is pulled back to the last fully supported spot', () => {
      const unit = makeUnit(P(-1, 3, 0.5));
      const state = makeState(unit, [ruin]);
      const path = findNavPath(state, unit, P(-1, 3, -0.4), 12);
      const end = path[path.length - 1];
      expect(end.z).toBeGreaterThanOrEqual(-0.05 - 1e-6);
      expect(isBaseOverhanging(state, end)).toBe(false);
    });
  });

  describe('labels', () => {
    it('the level step after a climb is walking, not a gap', () => {
      const unit = makeUnit(P(-1, 0, -2.5));
      const state = makeState(unit, [ruin]);
      const path = findNavPath(state, unit, P(-1, 3, 0), 12);
      expect(kindsOf(state, unit, path)).toEqual(['walk', 'climb', 'walk']);
    });

    it('the step off an edge before a drop is not a gap', () => {
      const unit = makeUnit(P(0, 3, 0));
      const state = makeState(unit, [deckAt('a', 0)]);
      const path = [P(0, 3, 0), P(2, 3, 0), P(2.55, 3, 0), P(2.55, 0, 0)];
      expect(kindsOf(state, unit, path)).toEqual(['walk', 'walk', 'drop']);
    });

    it('a real gap with nothing climbed or dropped around it is still a gap', () => {
      const unit = makeUnit(P(0, 3, 0));
      const state = makeState(unit, [deckAt('a', 0), deckAt('b', 4.8)]); // 0.8" gap
      expect(classifySegment(state, P(1.8, 3, 0), P(2.8, 3, 0), unit).kind).toBe('gap');
    });
  });

  describe('declared jump landings', () => {
    it('is not offered when the landing would leave the base over the far lip, and is offered a base inside it', () => {
      const unit = makeUnit(P(1.8, 3, 0));
      const state = makeState(unit, [deckAt('a', 0), deckAt('b', 6)]); // a: -2..2, b: 4..8
      expect(findJumpOption(state, unit, P(1.8, 3, 0), P(4.2, 3, 0))).toBeNull();
      expect(findJumpOption(state, unit, P(1.8, 3, 0), P(4.6, 3, 0))).not.toBeNull();
    });
  });
});
