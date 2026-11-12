import { describe, it, expect } from 'vitest';
import { createInitialGameState, createAction } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { validateAction } from '../../src/engine/actions';
import {
  findEndOverlap,
  findMoveBlocker,
  findNavPath,
  hasCoverAgainstAttack,
  hasLineOfSight,
  isStepOverPiece,
} from '../../src/engine/spatial';
import { pathMovementCost } from '../../src/engine/traversal';

const HOST = 'host-1';
const GUEST = 'guest-1';

function makeUnit(id: string, position: Vector3, ownerId = HOST): Unit {
  return {
    id, ownerId, armyId: 'army-1', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: { ...position }, rotation: { x: 0, y: 0, z: 0 }, status: [], wounds: 1, maxWounds: 1,
    isActivated: false, isDestroyed: false, models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [], hasMoved: false, remainingMovement: 6,
  };
}

function piece(type: string, x: number, y: number, z: number, rotY = 0): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id: `${type}-${x}-${y}-${z}`,
    terrainType: type,
    position: { x, y, z },
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
  state.turnState.activeUnitId = units[0].id;
  state.turnState.currentPlayerId = HOST;
  units[0].isActivated = true;
  return state;
}

const pt = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

describe('step over low terrain (<= 1")', () => {
  for (const type of ['barricade', 'crate', 'industrial-pipe']) {
    it(`a model walks straight across a ${type} at straight-line cost`, () => {
      const unit = makeUnit('u', pt(-3, 0, 0));
      const p = piece(type, 0, 0, 0, Math.PI / 2);
      const state = makeState([unit], [p]);
      expect(isStepOverPiece(p)).toBe(true);
      expect(findMoveBlocker(state, unit, [pt(-3, 0, 0), pt(3, 0, 0)]).blocked).toBe(false);
      expect(pathMovementCost(state, [pt(-3, 0, 0), pt(3, 0, 0)])).toBeCloseTo(6);
      // the planner goes straight over: no detour waypoints
      const path = findNavPath(state, unit, pt(3, 0, 0), 6);
      expect(path).toEqual([pt(-3, 0, 0), pt(3, 0, 0)]);
    });
  }

  it('the host accepts a move across a barricade that ends clear of it', () => {
    const unit = makeUnit('u', pt(-3, 0, 0));
    const state = makeState([unit, makeUnit('e', pt(0, 0, 20), GUEST)], [piece('barricade', 0, 0, 0, Math.PI / 2)]);
    const act = createAction(HOST, 'advance', {
      type: 'advance', unitId: 'u', path: [pt(-3, 0, 0), pt(3, 0, 0)], finalPosition: pt(3, 0, 0),
    });
    expect(validateAction(state, act).valid).toBe(true);
  });

  it('the host rejects a move that ends on top of the barricade', () => {
    const unit = makeUnit('u', pt(-3, 0, 0));
    const state = makeState([unit, makeUnit('e', pt(0, 0, 20), GUEST)], [piece('barricade', 0, 0, 0, Math.PI / 2)]);
    expect(findEndOverlap(state, 'u', pt(0, 0, 0))).toMatchObject({ kind: 'terrain' });
    const act = createAction(HOST, 'advance', {
      type: 'advance', unitId: 'u', path: [pt(-3, 0, 0), pt(0, 0, 0)], finalPosition: pt(0, 0, 0),
    });
    const res = validateAction(state, act);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/overlapping terrain/i);
  });

  it('the planner clamps a move whose budget runs out over a barricade to a clear spot', () => {
    const unit = makeUnit('u', pt(-3, 0, 0));
    const state = makeState([unit], [piece('barricade', 0, 0, 0, Math.PI / 2)]);
    const path = findNavPath(state, unit, pt(3, 0, 0), 3);
    const end = path[path.length - 1];
    expect(findEndOverlap(state, 'u', end)).toBeNull();
  });

  it('a barricade stacked on a deck is stepped over by a model on that deck', () => {
    const deck = piece('platform-small', 0, 0, 0);
    const barricade = piece('barricade', 0, 3, 0, Math.PI / 2);
    const unit = makeUnit('u', pt(-1.5, 3, 0));
    const state = makeState([unit], [deck, barricade]);
    expect(isStepOverPiece(barricade)).toBe(true);
    expect(findMoveBlocker(state, unit, [pt(-1.5, 3, 0), pt(1.5, 3, 0)]).blocked).toBe(false);
    expect(pathMovementCost(state, [pt(-1.5, 3, 0), pt(1.5, 3, 0)])).toBeCloseTo(3);
  });

  it('pieces taller than 1" still block: wall, column, container', () => {
    for (const type of ['wall', 'column', 'shipping-container']) {
      const p = piece(type, 0, 0, 0, Math.PI / 2);
      const unit = makeUnit('u', pt(-6, 0, 0));
      const state = makeState([unit], [p]);
      expect(isStepOverPiece(p), type).toBe(false);
      expect(findMoveBlocker(state, unit, [pt(-6, 0, 0), pt(6, 0, 0)]).blocked, type).toBe(true);
    }
  });

  it('a custom piece is stepped over only when every solid is within 1" of its floor', () => {
    const low = { ...piece('crate', 0, 0, 0), scale: { x: 1, y: 1.0, z: 1 } };
    const tall = { ...piece('crate', 0, 0, 0), scale: { x: 1, y: 1.25, z: 1 } };
    expect(isStepOverPiece(low)).toBe(true);
    expect(isStepOverPiece(tall)).toBe(false);
    const unit = makeUnit('u', pt(-3, 0, 0));
    expect(findMoveBlocker(makeState([unit], [tall]), unit, [pt(-3, 0, 0), pt(3, 0, 0)]).blocked).toBe(true);
  });

  it('cover and line of sight over a barricade are unchanged', () => {
    const barricade = piece('barricade', 0, 0, 0, Math.PI / 2);
    const shooter = makeUnit('s', pt(-4, 0, 0));
    const near = makeUnit('near', pt(0.9, 0, 0), GUEST);
    const far = makeUnit('far', pt(4, 0, 0), GUEST);
    expect(hasLineOfSight(makeState([shooter, near], [barricade]), shooter, near)).toBe(true);
    expect(hasCoverAgainstAttack(makeState([shooter, near], [barricade]), shooter, near)).toBe(true);
    expect(hasCoverAgainstAttack(makeState([shooter, far], [barricade]), shooter, far)).toBe(false);
  });
});
