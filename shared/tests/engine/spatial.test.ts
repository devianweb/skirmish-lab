import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { applyAction, pathLength } from '../../src/engine/actions';
import {
  clampMoveDestinationWithObstacles,
  computeLosVisibilityPolygon,
  computeShootingRayDebug,
  findMoveBlocker,
  findNavPath,
  hasCoverAgainstAttack,
  hasLineOfSight,
} from '../../src/engine/spatial';
import { WEAPONS } from '../../src/data/weapons';

const HOST = 'host-1';
const GUEST = 'guest-1';

function makeUnit(id: string, ownerId: string, position: Vector3): Unit {
  return {
    id,
    ownerId,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...position },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function makeWall(id: string, position: Vector3, blocksLineOfSight = true): TerrainPiece {
  return {
    id,
    terrainType: 'wall',
    position,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 4, y: 1.5, z: 0.5 },
    blocksLineOfSight,
    providesCover: true,
    isObstacle: true,
  };
}

function makeCrate(id: string, position: Vector3): TerrainPiece {
  return {
    id,
    terrainType: 'crate',
    position,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: true,
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  return state;
}

describe('spatial: movement collision & clamping', () => {
  it('blocks moving through an obstacle terrain piece', () => {
    const u1 = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const wall = makeWall('w1', { x: 0, y: 0, z: 3 });
    const state = makeState([u1], [wall]);

    const res = findMoveBlocker(state, u1, [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 5 },
    ]);
    expect(res).toEqual({ blocked: true, reason: 'Move path is blocked by terrain' });

    // Clamping stops the unit in front of the wall instead of passing through it.
    const clamped = clampMoveDestinationWithObstacles(state, u1, { x: 0, y: 0, z: 5 }, 6);
    expect(clamped.z).toBeLessThan(3);
    expect(clamped.z).toBeGreaterThan(2);
  });

  it('blocks moving through or onto another living fighter', () => {
    const u1 = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const u2 = makeUnit('h2', HOST, { x: 0, y: 0, z: 3 });
    const state = makeState([u1, u2]);

    const res = findMoveBlocker(state, u1, [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 5 },
    ]);
    expect(res).toEqual({ blocked: true, reason: 'Move path is blocked by another fighter' });

    const clamped = clampMoveDestinationWithObstacles(state, u1, { x: 0, y: 0, z: 5 }, 6);
    expect(clamped.z).toBeLessThan(2.5);
  });

  it('rejects move-unit in applyAction when path crosses obstacle terrain', () => {
    const u1 = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    u1.isActivated = true;
    const g1 = makeUnit('g1', GUEST, { x: 10, y: 0, z: 10 });
    const wall = makeWall('w1', { x: 0, y: 0, z: 3 });
    const state = makeState([u1, g1], [wall]);
    state.turnState.activeUnitId = 'h1';

    const action = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'h1',
      path: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 5 },
      ],
      finalPosition: { x: 0, y: 0, z: 5 },
    });
    expect(applyAction(state, action).reason).toBe('Move path is blocked by terrain');
  });
});

describe('spatial: line of sight & visibility polygon', () => {
  it('blocks line of sight through blocksLineOfSight terrain, but not through low cover (crates)', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 10 });
    const wall = makeWall('w1', { x: 0, y: 0, z: 5 }, true);
    const crate = makeWall('c1', { x: 0, y: 0, z: 5 }, false);

    expect(hasLineOfSight(makeState([attacker, target], [wall]), attacker, target)).toBe(false);
    expect(hasLineOfSight(makeState([attacker, target], [crate]), attacker, target)).toBe(true);
  });

  it('blocks line of sight through friendly and enemy fighters between attacker and target', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g2', GUEST, { x: 0, y: 0, z: 10 });
    const friendlyBlocker = makeUnit('h2', HOST, { x: 0, y: 0, z: 5 });
    const enemyBlocker = makeUnit('g1', GUEST, { x: 0, y: 0, z: 5 });

    expect(hasLineOfSight(makeState([attacker, friendlyBlocker, target]), attacker, target)).toBe(
      false
    );
    expect(hasLineOfSight(makeState([attacker, enemyBlocker, target]), attacker, target)).toBe(
      false
    );
  });

  it('computes a 2D visibility polygon that cuts out shadow wedges behind walls and fighters', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const wall = makeWall('w1', { x: 0, y: 0, z: 5 }, true);
    const state = makeState([attacker], [wall]);

    const poly = computeLosVisibilityPolygon(state, attacker.position, 12, attacker.id);
    expect(poly.length).toBeGreaterThan(180);

    // Along +Z (toward the wall at z = 5), the visibility distance must be < 5.
    const northPoints = poly.filter((p) => Math.abs(p.x) < 0.2 && p.z > 0);
    expect(northPoints.length).toBeGreaterThan(0);
    for (const p of northPoints) {
      expect(p.z).toBeLessThan(5);
    }

    // Along -Z (away from the wall), visibility reaches full 12" range.
    const southPoints = poly.filter((p) => Math.abs(p.x) < 0.2 && p.z < 0);
    expect(southPoints.length).toBeGreaterThan(0);
    for (const p of southPoints) {
      expect(Math.abs(p.z)).toBeCloseTo(12, 0);
    }
  });

  it('clips the visibility polygon to the board boundaries so the shooting fan never overhangs the board edge', () => {
    const attacker = makeUnit('h1', HOST, { x: -12, y: 0, z: -12 });
    const state = makeState([attacker]);
    const halfW = (state.board.width * state.board.gridSize) / 2;
    const halfH = (state.board.height * state.board.gridSize) / 2;

    const poly = computeLosVisibilityPolygon(state, attacker.position, 30, attacker.id);
    for (const pt of poly) {
      expect(pt.x).toBeGreaterThanOrEqual(-halfW - 1e-6);
      expect(pt.x).toBeLessThanOrEqual(halfW + 1e-6);
      expect(pt.z).toBeGreaterThanOrEqual(-halfH - 1e-6);
      expect(pt.z).toBeLessThanOrEqual(halfH + 1e-6);
    }
  });
});

describe('spatial: hasCoverAgainstAttack', () => {

  it('grants cover when target is behind a crate within 1.0" along the line of fire, but NOT when open downrange', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const targetNear = makeUnit('g1', GUEST, { x: 0, y: 0, z: 6 });
    const targetFar = makeUnit('g2', GUEST, { x: 0, y: 0, z: 10 });
    const crate = makeCrate('c1', { x: 0, y: 0, z: 5 });
    const stateNear = makeState([attacker, targetNear], [crate]);
    const stateFar = makeState([attacker, targetFar], [crate]);

    expect(hasCoverAgainstAttack(stateNear, attacker, targetNear)).toBe(true);
    expect(hasCoverAgainstAttack(stateFar, attacker, targetFar)).toBe(false);
  });

  it('does NOT grant cover to an open target when the attacker is shooting out of adjacent cover', () => {
    // Attacker is next to a crate (z = 0.5), shooting at a target in the open (z = 10)
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 10 });
    const crate = makeCrate('c1', { x: 0, y: 0, z: 0.5 });
    const state = makeState([attacker, target], [crate]);

    expect(hasCoverAgainstAttack(state, attacker, target)).toBe(false);
  });

  it('does NOT grant cover when a wall is behind the target even if target touches the wall', () => {
    // Attacker at (0, 0, 0), target at (0, 0, 10).
    // Wall is at (0, 0, 10.8) (behind target). Target center and flanks have completely clear LoS.
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 10 });
    const wall = makeWall('w1', { x: 0, y: 0, z: 10.8 }, true);
    const state = makeState([attacker, target], [wall]);

    expect(hasLineOfSight(state, attacker, target)).toBe(true);
    expect(hasCoverAgainstAttack(state, attacker, target)).toBe(false);
  });

  it('grants cover when target is corner-peeking behind a wall that partially obscures the unit', () => {
    // Attacker at (0, 0, 0), target at (0, 0, 10).
    // Wall spans x: 0.25 to 4.25, z: 9.75 to 10.25.
    // Center-to-center line along x=0 is completely clear (hasLineOfSight: true).
    // Right flank of target (x = -0.3) is clear, but left flank (x = +0.3) is obscured by the wall corner at x=0.25.
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 10 });
    // Wall center at x = 2.25, scale x = 4 -> half-extent hx = 2.0 -> x from 0.25 to 4.25
    const wall = makeWall('w1', { x: 2.25, y: 0, z: 10 }, true);
    const state = makeState([attacker, target], [wall]);

    expect(hasLineOfSight(state, attacker, target)).toBe(true);
    expect(hasCoverAgainstAttack(state, attacker, target)).toBe(true);
  });
});

describe('spatial: shooting ray debug calculations', () => {
  it('computes ray intersections with a crate along the line of fire', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 6 });
    // Crate at (0, 0, 5) with scale (1, 1, 1), half-extents (0.35, 0.35) + 0.15 margin = 0.5
    const crate = {
      id: 'c1',
      terrainType: 'crate',
      position: { x: 0, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: true,
    };
    const state = makeState([attacker, target], [crate]);

    const debug = computeShootingRayDebug(state, attacker, target);
    expect(debug.attackerId).toBe('h1');
    expect(debug.targetId).toBe('g1');
    expect(debug.distance).toBe(6);
    expect(debug.hasLineOfSight).toBe(true);
    expect(debug.providesCover).toBe(true);
    expect(debug.coverPieceId).toBe('c1');
    expect(debug.intersections.length).toBe(1);

    const hit = debug.intersections[0];
    expect(hit.pieceId).toBe('c1');
    expect(hit.isCoverProvider).toBe(true);
    expect(hit.isLoSBlocker).toBe(false);
    expect(hit.tEntry).toBeCloseTo(4.5, 1);
    expect(hit.tExit).toBeCloseTo(5.5, 1);
    expect(hit.entryPoint.z).toBeCloseTo(4.5, 1);
    expect(hit.exitPoint.z).toBeCloseTo(5.5, 1);
  });

  it('detects Line of Sight blocking by a solid wall', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 10 });
    const wall = makeWall('w1', { x: 0, y: 0, z: 5 }, true);
    const state = makeState([attacker, target], [wall]);

    const debug = computeShootingRayDebug(state, attacker, target);
    expect(debug.hasLineOfSight).toBe(false);
    expect(debug.blockedByPieceId).toBe('w1');
    expect(debug.intersections.some((i) => i.isLoSBlocker)).toBe(true);
  });

  it('evaluates flank rays for wall corner peeking', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 10 });
    const wall = makeWall('w1', { x: 2.25, y: 0, z: 10 }, true);
    const state = makeState([attacker, target], [wall]);

    const debug = computeShootingRayDebug(state, attacker, target);
    expect(debug.hasLineOfSight).toBe(true);
    expect(debug.providesCover).toBe(true);
    expect(debug.flankRays).toBeDefined();
    expect(debug.flankRays!.length).toBe(2);

    const leftFlank = debug.flankRays!.find((f) => f.side === 'left');
    const rightFlank = debug.flankRays!.find((f) => f.side === 'right');
    expect(rightFlank?.blocked).toBe(true);
    expect(leftFlank?.blocked).toBe(false);
  });
});

describe('spatial: apertures (doorways and windows)', () => {
  it('allows model movement and line of sight through wall-doorway opening', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 6 });
    const doorway: TerrainPiece = {
      id: 'd1',
      terrainType: 'wall-doorway',
      position: { x: 0, y: 0, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    };
    const state = makeState([attacker, target], [doorway]);

    // Path directly through center of doorway
    const pathThroughDoor = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 }];
    expect(findMoveBlocker(state, attacker, pathThroughDoor).blocked).toBe(false);

    // Path through the jamb (x = 1.0)
    const pathThroughJamb = [{ x: 1.0, y: 0, z: 0 }, { x: 1.0, y: 0, z: 5 }];
    expect(findMoveBlocker(state, attacker, pathThroughJamb).blocked).toBe(true);

    // LoS through doorway
    expect(hasLineOfSight(state, attacker, target)).toBe(true);

    // Target within 1.0" of doorway receiving fire through it gains Cover
    const targetNear = makeUnit('g1', GUEST, { x: 0, y: 0, z: 3.8 });
    const stateNear = makeState([attacker, targetNear], [doorway]);
    expect(hasCoverAgainstAttack(stateNear, attacker, targetNear)).toBe(true);
  });

  it('handles wall-window: blocks movement, permits LoS when peeking, blocks distant keyholing', () => {
    const attacker = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 8 });
    const windowPiece: TerrainPiece = {
      id: 'w1',
      terrainType: 'wall-window',
      position: { x: 0, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    };

    // Movement through window is always blocked
    const state = makeState([attacker, target], [windowPiece]);
    const pathThroughWindow = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 6 }];
    expect(findMoveBlocker(state, attacker, pathThroughWindow).blocked).toBe(true);

    // Both models > 1.0" from window -> LoS blocked (no distant geometric keyholing)
    expect(hasLineOfSight(state, attacker, target)).toBe(false);

    // Attacker within 1.0" of window (manning the firing port) -> LoS clear
    attacker.position = { x: 0, y: 0, z: 3.2 };
    expect(hasLineOfSight(state, attacker, target)).toBe(true);

    // Attacker back at origin, target within 1.0" of window (z = 4.8) -> LoS clear and target gains Cover (+1 Def)
    attacker.position = { x: 0, y: 0, z: 0 };
    target.position = { x: 0, y: 0, z: 4.8 };
    expect(hasLineOfSight(state, attacker, target)).toBe(true);
    expect(hasCoverAgainstAttack(state, attacker, target)).toBe(true);
  });
});

describe('spatial: findNavPath obstacle pathfinding', () => {
  it('returns direct path when line to destination is clear', () => {
    const unit = makeUnit('u1', HOST, { x: 0, y: 0, z: 0 });
    const state = makeState([unit], []);

    const path = findNavPath(state, unit, { x: 0, y: 0, z: 4 }, 6);
    expect(path).toHaveLength(2);
    expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(path[1]).toEqual({ x: 0, y: 0, z: 4 });
  });

  it('navigates around an obstacle crate to reach the destination behind it', () => {
    const unit = makeUnit('u1', HOST, { x: 0, y: 0, z: 0 });
    const crate = makeCrate('c1', { x: 0, y: 0, z: 3 });
    const state = makeState([unit], [crate]);

    // Destination is directly behind crate at (0, 0, 6)
    const path = findNavPath(state, unit, { x: 0, y: 0, z: 6 }, 10);
    expect(path.length).toBeGreaterThan(2); // Has waypoints going around crate
    expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(path[path.length - 1].z).toBeCloseTo(6, 1);
    expect(Math.abs(path[path.length - 1].x)).toBeCloseTo(0, 1);

    // Verify none of the path segments collide with the crate
    expect(findMoveBlocker(state, unit, path).blocked).toBe(false);
  });

  it('clamps path along polyline when destination exceeds max movement', () => {
    const unit = makeUnit('u1', HOST, { x: 0, y: 0, z: 0 });
    const crate = makeCrate('c1', { x: 0, y: 0, z: 3 });
    const state = makeState([unit], [crate]);

    // Only 3" of movement allowed
    const path = findNavPath(state, unit, { x: 0, y: 0, z: 6 }, 3);
    const len = pathLength(path);
    expect(len).toBeCloseTo(3, 1);
    expect(findMoveBlocker(state, unit, path).blocked).toBe(false);
  });
});
