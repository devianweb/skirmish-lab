import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, validateAction } from '../../src/engine/actions';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(id: string, pos: Vector3): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG['platform-small'];
  return {
    id,
    terrainType: 'platform-small',
    position: pos,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

const takeoff = P(-0.3, 3, 0);
const landing = P(2.6, 3, 0); // 2" gap between the decks (x 0..2); the landing is 2.9" from the take-off

function makeUnit(position: Vector3, remaining: number): Unit {
  return {
    id: 'u',
    ownerId: HOST,
    armyId: 'a',
    unitType: 'trooper',
    name: 'u',
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: 3,
    maxWounds: 3,
    isActivated: true,
    isDestroyed: false,
    models: [{ id: 'u-m0', wounds: 3, maxWounds: 3, isDestroyed: false, position: { ...position } }] as any,
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: true,
    remainingMovement: remaining,
  };
}

function makeState(unit: Unit): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = [unit];
  state.terrain = [piece('deck-a', P(-2, 0, 0)), piece('deck-b', P(4, 0, 0))];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = unit.id;
  return state;
}

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

const jumpAction = (path: Vector3[] = [takeoff, landing]) =>
  createAction(HOST, 'advance', {
    type: 'advance',
    unitId: 'u',
    path,
    finalPosition: path[path.length - 1],
    traversal: { kind: 'jump-gap', takeoff, landing },
  });

describe('the jump is free after moving (Decision 41)', () => {
  it('a model with 1" of move left at the edge of a 2" gap can jump it and lands beyond its remaining-move ring', () => {
    const state = makeState(makeUnit(takeoff, 1));
    const action = jumpAction();
    expect(validateAction(state, action)).toEqual({ valid: true });
    const out = applyAction(state, action, [roll('jump', [6, 6, 6]), roll('fall', [6, 6])]);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.units[0].position).toMatchObject({ x: 2.6, y: 3 });
  });

  it('a model that must walk 0.5" to reach the edge and has 0.5" left can still cross', () => {
    const start = P(-0.8, 3, 0);
    const state = makeState(makeUnit(start, 0.5));
    expect(validateAction(state, jumpAction([start, takeoff, landing]))).toEqual({ valid: true });
  });

  it('a model with 0" left cannot move at all', () => {
    const state = makeState(makeUnit(takeoff, 0));
    expect(validateAction(state, jumpAction()).valid).toBe(false);
  });

  it('a model that cannot afford the walk to the edge cannot cross', () => {
    const start = P(-1.8, 3, 0);
    const state = makeState(makeUnit(start, 0.5));
    expect(validateAction(state, jumpAction([start, takeoff, landing])).valid).toBe(false);
  });
});
