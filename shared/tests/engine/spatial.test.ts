import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { applyAction, pathLength } from '../../src/engine/actions';
import {
  clampMoveDestinationWithObstacles,
  computeLosVisibilityPolygon,
  computeShootingRayDebug,
  computeSquadCentroid,
  createSquadPositions,
  findMoveBlocker,
  findNavPath,
  findWalkablePlatformAt,
  getSquadModelPositions,
  getStairSurfaceHeight,
  getStairWaypoints,
  hasCoverAgainstAttack,
  hasLineOfSight,
  resolveTerrainStructure,
  traceLineOfSight,
  isSegmentOnRampOrStairs,
  isSegmentSurfaceConstrained,
  validateFormationMove,
  validateSquadCoherency,
} from '../../src/engine/spatial';
import { isPathDifficult } from '../../src/engine/traversal';
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

  it('allows visibility polygon to pass through a window aperture when shooter is adjacent (<= 1.0")', () => {
    // Window wall at z = 2, aperture at center x = 0 (|x| <= 0.5)
    const windowWall: TerrainPiece = {
      id: 'win1',
      terrainType: 'wall-window',
      position: { x: 0, y: 0, z: 2 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 3, y: 1.5, z: 0.5 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    };
    // Shooter is adjacent to window (z = 0.5, within 1.0" of the wall at z = 2)
    const shooter = makeUnit('h1', HOST, { x: 0, y: 0, z: 0.5 });
    const state = makeState([shooter], [windowWall]);

    const poly = computeLosVisibilityPolygon(state, shooter.position, 12, shooter.id);

    // Straight through the aperture (|x| < 0.1, z > 2), rays should extend past the wall (> 5")
    const aperturePoints = poly.filter((p) => Math.abs(p.x) < 0.1 && p.z > 2);
    expect(aperturePoints.length).toBeGreaterThan(0);
    for (const p of aperturePoints) {
      expect(p.z).toBeGreaterThan(5);
    }

    // Rays that would cross the wall plane (z = 2) within the jamb (|x| between 1.0 and 1.4) must stop at the wall
    const jambPoints = poly.filter((p) => {
      if (p.z <= 0.5) return false;
      const xAtWall = (Math.abs(p.x) * 1.5) / (p.z - 0.5);
      return xAtWall > 1.0 && xAtWall < 1.4;
    });
    expect(jambPoints.length).toBeGreaterThan(0);
    for (const p of jambPoints) {
      expect(p.z).toBeLessThanOrEqual(2.1);
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
    // Crate at (0, 0, 5) with scale (1, 1, 1): half-extents 0.5 (full footprint) + 0.15 margin = 0.65
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
    expect(hit.tEntry).toBeCloseTo(4.35, 1);
    expect(hit.tExit).toBeCloseTo(5.65, 1);
    expect(hit.entryPoint.z).toBeCloseTo(4.35, 1);
    expect(hit.exitPoint.z).toBeCloseTo(5.65, 1);
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
    const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 7 });
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

    // A doorway is open air: standing in line with it gives no cover by itself
    const targetNear = makeUnit('g1', GUEST, { x: 0, y: 0, z: 3.8 });
    const stateNear = makeState([attacker, targetNear], [doorway]);
    expect(hasCoverAgainstAttack(stateNear, attacker, targetNear)).toBe(false);

    // ...but a target tucked behind a jamb (within 1.0", shot at obliquely) claims sight-blocker cover
    const shooterOblique = makeUnit('h2', HOST, { x: 0, y: 0, z: 0 });
    const targetBehindJamb = makeUnit('g2', GUEST, { x: 0.6, y: 0, z: 3.8 });
    const stateJamb = makeState([shooterOblique, targetBehindJamb], [doorway]);
    expect(hasLineOfSight(stateJamb, shooterOblique, targetBehindJamb)).toBe(true);
    expect(hasCoverAgainstAttack(stateJamb, shooterOblique, targetBehindJamb)).toBe(true);
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

  it('doorway opening scales with the piece (1.2" on a 4" wall) for movement and drag clamping', () => {
    const mover = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
    const door: TerrainPiece = {
      id: 'd1',
      terrainType: 'wall-doorway',
      position: { x: 0, y: 0, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 2.5, z: 0.3 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    };
    const state = makeState([mover], [door]);

    // Through the middle of the opening
    expect(findMoveBlocker(state, mover, [{ x: 0.2, y: 0, z: 0 }, { x: 0.2, y: 0, z: 6 }]).blocked).toBe(false);
    // Into the pier beside it
    expect(findMoveBlocker(state, mover, [{ x: 1.2, y: 0, z: 0 }, { x: 1.2, y: 0, z: 6 }]).blocked).toBe(true);

    // Drag clamp lets a model pass through the doorway but stops at a pier
    mover.remainingMovement = 12;
    const through = clampMoveDestinationWithObstacles(state, mover, { x: 0, y: 0, z: 6 });
    expect(through.z).toBeCloseTo(6);
    const intoPier = clampMoveDestinationWithObstacles(
      state,
      { ...mover, position: { x: 1.2, y: 0, z: 0 } },
      { x: 1.2, y: 0, z: 6 }
    );
    expect(intoPier.z).toBeLessThan(3);
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

describe('spatial: Squad Coherency & Formation Engine (Phase 9A)', () => {
  describe('validateSquadCoherency', () => {
    it('treats single model squads as vacuously coherent', () => {
      const res = validateSquadCoherency([{ x: 0, y: 0, z: 0 }]);
      expect(res.coherent).toBe(true);
      expect(res.maxDistanceBetweenModels).toBe(0);
    });

    it('validates 2 models within 1" spacing as coherent', () => {
      const res = validateSquadCoherency([
        { x: 0, y: 0, z: 0 },
        { x: 0.8, y: 0, z: 0 },
      ]);
      expect(res.coherent).toBe(true);
      expect(res.maxDistanceBetweenModels).toBeCloseTo(0.8, 2);
      expect(res.maxDistanceToNearestMember).toBeCloseTo(0.8, 2);
    });

    it('rejects 2 models exceeding coherency separation', () => {
      const res = validateSquadCoherency([
        { x: 0, y: 0, z: 0 },
        { x: 2.5, y: 0, z: 0 },
      ]);
      expect(res.coherent).toBe(false);
      expect(res.reason).toContain('exceeds 2" limit');
    });

    it('validates 3 models in triangle formation where all pairs are within coherency', () => {
      const positions = createSquadPositions({ x: 0, y: 0, z: 0 }, 3, 1.4);
      const res = validateSquadCoherency(positions);
      expect(res.coherent).toBe(true);
      expect(res.maxDistanceBetweenModels).toBeLessThanOrEqual(2.0);
    });

    it('rejects formation when a model is isolated from the squad', () => {
      const positions: Vector3[] = [
        { x: 0, y: 0, z: 0 },
        { x: 1.4, y: 0, z: 0 },
        { x: 4.0, y: 0, z: 0 }, // 2.6" away from nearest member (> 2.0")
      ];
      const res = validateSquadCoherency(positions);
      expect(res.coherent).toBe(false);
      expect(res.reason).toContain('Model 3');
      expect(res.reason).toContain('exceeds 2" limit');
    });

    it('validates formation split into 2 buddy pairs within 6" total spread', () => {
      const positions: Vector3[] = [
        { x: 0, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 3.0, y: 0, z: 0 },
        { x: 3.5, y: 0, z: 0 },
      ];
      const res = validateSquadCoherency(positions);
      expect(res.coherent).toBe(true);
      expect(res.maxDistanceBetweenModels).toBeCloseTo(3.5, 2);
      expect(res.maxDistanceToNearestMember).toBeCloseTo(0.5, 2);
    });

    it('rejects long daisy chain exceeding 6" max squad spread', () => {
      // 8 models in a straight line with 0.9" spacing (total spread 7 * 0.9 = 6.3" > 6.0")
      const positions: Vector3[] = [];
      for (let i = 0; i < 8; i++) {
        positions.push({ x: i * 0.9, y: 0, z: 0 });
      }
      const res = validateSquadCoherency(positions);
      expect(res.coherent).toBe(false);
      expect(res.reason).toContain('exceeds max coherency limit of 6"');
    });
  });

  describe('computeSquadCentroid', () => {
    it('computes exact average coordinates for squad models', () => {
      const positions: Vector3[] = [
        { x: 1, y: 0, z: 2 },
        { x: 3, y: 0, z: 4 },
        { x: 5, y: 0, z: 6 },
      ];
      const centroid = computeSquadCentroid(positions);
      expect(centroid).toEqual({ x: 3, y: 0, z: 4 });
    });

    it('handles empty positions array gracefully', () => {
      expect(computeSquadCentroid([])).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  describe('getSquadModelPositions', () => {
    it('returns positions of active models while omitting destroyed models', () => {
      const unit = makeUnit('u1', HOST, { x: 5, y: 0, z: 5 });
      unit.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5, y: 0, z: 5 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.6, y: 0, z: 5 } },
        { id: 'm3', wounds: 0, maxWounds: 1, isDestroyed: true, position: { x: 6.2, y: 0, z: 5 } },
      ];
      const positions = getSquadModelPositions(unit);
      expect(positions).toHaveLength(2);
      expect(positions[0]).toEqual({ x: 5, y: 0, z: 5 });
      expect(positions[1]).toEqual({ x: 5.6, y: 0, z: 5 });
    });

    it('falls back to unit position when models array is empty', () => {
      const unit = makeUnit('u1', HOST, { x: 2, y: 0, z: 4 });
      unit.models = [];
      expect(getSquadModelPositions(unit)).toEqual([{ x: 2, y: 0, z: 4 }]);
    });
  });

  describe('createSquadPositions', () => {
    it('generates coherent positions with clear base separation for 1, 2, 3, and 5 model formations', () => {
      for (const count of [1, 2, 3, 5]) {
        const center = { x: 4, y: 0, z: -2 };
        const positions = createSquadPositions(center, count);
        expect(positions).toHaveLength(count);
        const coherency = validateSquadCoherency(positions);
        expect(coherency.coherent).toBe(true);
        if (count > 1) {
          // Verify models have at least 0.3" edge-to-edge gap (bases with diameter 1.0" do not intersect)
          expect(coherency.maxDistanceToNearestMember).toBeGreaterThanOrEqual(1.2);
          expect(coherency.maxDistanceToNearestMember).toBeLessThanOrEqual(2.0);
        }
      }
    });
  });

  describe('validateFormationMove', () => {
    it('validates a legal rigid squad move within movement allowance', () => {
      const unit = makeUnit('u1', HOST, { x: 0, y: 0, z: 0 });
      unit.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.7, y: 0, z: 0 } },
      ];
      const state = makeState([unit], []);
      const result = validateFormationMove(state, unit, { x: 0, y: 0, z: 4 });
      expect(result.valid).toBe(true);
      expect(result.destination).toEqual({ x: 0.35, y: 0, z: 4 });
      expect(result.modelPositions).toHaveLength(2);
      expect(result.modelPositions[0]).toEqual({ x: 0, y: 0, z: 4 });
      expect(result.modelPositions[1]).toEqual({ x: 0.7, y: 0, z: 4 });
    });

    it('rejects formation move if explicit positions violate coherency', () => {
      const unit = makeUnit('u1', HOST, { x: 0, y: 0, z: 0 });
      unit.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.7, y: 0, z: 0 } },
      ];
      const state = makeState([unit], []);
      // Incoherent destination positions (2.5" apart)
      const incoherent = [
        { x: 0, y: 0, z: 3 },
        { x: 2.5, y: 0, z: 3 },
      ];
      const result = validateFormationMove(state, unit, { x: 0, y: 0, z: 3 }, incoherent);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds 2" limit');
    });

    it('rejects formation move if a model ends outside the battlefield', () => {
      const unit = makeUnit('u1', HOST, { x: 19.5, y: 0, z: 0 }); // Near edge (board halfW = 20)
      unit.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 19.5, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 20.2, y: 0, z: 0 } }, // Outside!
      ];
      const state = makeState([unit], []);
      const result = validateFormationMove(state, unit, { x: 19.8, y: 0, z: 0 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('leaves the battlefield');
    });
  });

  describe('3D Elevation Line of Sight & Plunging Fire (Phase 11B; deck geometry tests live in elevation.test.ts)', () => {
    const platform: TerrainPiece = {
      id: 'plat-1',
      terrainType: 'platform',
      isWalkable: true,
      elevation: 3.0,
      position: { x: 0, y: 3.0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.5, z: 4 }, // X from -2 to +2, Z from -2 to +2
      blocksLineOfSight: false,
      providesCover: true,
      isObstacle: false,
    };

    it('allows line of sight between models on adjacent elevated platforms at similar heights', () => {
      const platform2: TerrainPiece = {
        ...platform,
        id: 'plat-2',
        position: { x: 8, y: 3.0, z: 0 },
      };
      const elevatedAttacker = makeUnit('att', HOST, { x: 0, y: 3.0, z: 0 }); // Center of plat-1
      const elevatedDefender = makeUnit('def', GUEST, { x: 8, y: 3.0, z: 0 }); // Center of plat-2
      const state = makeState([elevatedAttacker, elevatedDefender], [platform, platform2]);

      // At equal elevation, floor blind spot does not block horizontal sight
      expect(hasLineOfSight(state, elevatedAttacker, elevatedDefender)).toBe(true);
    });

    it('plunging fire (attacker elevated >= 2.0") looks over ground-level low cover', () => {
      const elevatedAttacker = makeUnit('att', HOST, { x: 0, y: 3.0, z: 0 });
      const groundDefender = makeUnit('def', GUEST, { x: 8, y: 0, z: 0 });
      // Crate at X = 7 (defender is 1.0" behind crate)
      const lowCrate: TerrainPiece = {
        id: 'crate-1',
        terrainType: 'crate',
        position: { x: 7, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: true,
      };

      const state = makeState([elevatedAttacker, groundDefender], [platform, lowCrate]);

      // Plunging fire looks over the 1.0" tall crate: no cover granted!
      expect(hasCoverAgainstAttack(state, elevatedAttacker, groundDefender)).toBe(false);

      // But a ground shooter at (0, 0, 0) DOES suffer cover from the crate
      const groundAttacker = makeUnit('ground-att', HOST, { x: 0, y: 0, z: 0 });
      const stateGround = makeState([groundAttacker, groundDefender], [lowCrate]);
      expect(hasCoverAgainstAttack(stateGround, groundAttacker, groundDefender)).toBe(true);
    });

    it('clears line of sight when ray passes vertically above a low wall in 3D', () => {
      const highAttacker = makeUnit('att', HOST, { x: 0, y: 4.0, z: 0 });
      const groundTarget = makeUnit('tgt', GUEST, { x: 10, y: 0, z: 0 });
      // Low wall at X = 5, height = 1.0. At X = 5, ray passes at Y = 2.0 (1.0" above wall).
      const lowWall: TerrainPiece = {
        id: 'wall-low',
        terrainType: 'wall',
        position: { x: 5, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 0.5, y: 1.0, z: 4 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      };

      const state = makeState([highAttacker, groundTarget], [lowWall]);
      expect(hasLineOfSight(state, highAttacker, groundTarget)).toBe(true);

      // If wall is tall (height = 3.0), at X = 5 ray is at Y = 2.0 <= 3.0 -> blocked!
      const tallWall: TerrainPiece = {
        ...lowWall,
        scale: { x: 0.5, y: 3.0, z: 4 },
      };
      const stateBlocked = makeState([highAttacker, groundTarget], [tallWall]);
      expect(hasLineOfSight(stateBlocked, highAttacker, groundTarget)).toBe(false);
    });
  });

  describe('3D Movement, Traversal & Obstacle Navigation (Phase 11)', () => {
    it('allows movement along an elevated platform when a ground obstacle crate is below', () => {
      const platform: TerrainPiece = {
        id: 'platform-1',
        terrainType: 'platform',
        position: { x: 0, y: 2.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 6, y: 0.3, z: 6 },
        elevation: 2.5,
        isWalkable: true,
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: false,
      };
      const groundCrate: TerrainPiece = {
        id: 'crate-ground',
        terrainType: 'crate',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: true,
      };
      const unit = makeUnit('u1', HOST, { x: -2, y: 2.5, z: 0 });
      const state = makeState([unit], [platform, groundCrate]);

      const path = [
        { x: -2, y: 2.5, z: 0 },
        { x: 2, y: 2.5, z: 0 },
      ];
      const blocker = findMoveBlocker(state, unit, path);
      expect(blocker.blocked).toBe(false);
    });

    it('allows movement across walkable elevated surfaces even if marked as obstacle', () => {
      const solidBuilding: TerrainPiece = {
        id: 'building-1',
        terrainType: 'platform',
        position: { x: 0, y: 2.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 4 },
        elevation: 2.5,
        isWalkable: true,
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      };
      const unit = makeUnit('u1', HOST, { x: -1, y: 2.5, z: 0 });
      const state = makeState([unit], [solidBuilding]);

      const path = [
        { x: -1, y: 2.5, z: 0 },
        { x: 1, y: 2.5, z: 0 },
      ];
      const blocker = findMoveBlocker(state, unit, path);
      expect(blocker.blocked).toBe(false);
    });

    it('allows movement when fighters are on different elevation tiers', () => {
      const platform: TerrainPiece = {
        id: 'platform-1',
        terrainType: 'platform',
        position: { x: 0, y: 2.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 6, y: 0.3, z: 6 },
        elevation: 2.5,
        isWalkable: true,
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: false,
      };
      const groundFighter = makeUnit('ground-u', GUEST, { x: 0, y: 0, z: 0 });
      const roofFighter = makeUnit('roof-u', HOST, { x: -2, y: 2.5, z: 0 });
      const state = makeState([roofFighter, groundFighter], [platform]);

      // Roof fighter walks across (x: -2 -> 2) passing directly over ground fighter (x: 0, y: 0)
      const path = [
        { x: -2, y: 2.5, z: 0 },
        { x: 2, y: 2.5, z: 0 },
      ];
      const blocker = findMoveBlocker(state, roofFighter, path);
      expect(blocker.blocked).toBe(false);
    });

    it('clampMoveDestinationWithObstacles preserves elevation on walkable platforms', () => {
      const platform: TerrainPiece = {
        id: 'platform-1',
        terrainType: 'platform',
        position: { x: 0, y: 2.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 8, y: 0.3, z: 8 },
        elevation: 2.5,
        isWalkable: true,
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: false,
      };
      const unit = makeUnit('u1', HOST, { x: 0, y: 2.5, z: 0 });
      unit.remainingMovement = 4.0;
      const state = makeState([unit], [platform]);

      // Request move 6" away (exceeding 4.0" speed)
      const dest = clampMoveDestinationWithObstacles(state, unit, { x: 6, y: 2.5, z: 0 }, 4.0);
      expect(dest.x).toBeCloseTo(4.0, 1);
      expect(dest.y).toBe(2.5);
    });

    it('findNavPath preserves 3D platform elevation along path', () => {
      const platform: TerrainPiece = {
        id: 'platform-1',
        terrainType: 'platform',
        position: { x: 0, y: 2.5, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 8, y: 0.3, z: 8 },
        elevation: 2.5,
        isWalkable: true,
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: false,
      };
      const unit = makeUnit('u1', HOST, { x: -2, y: 2.5, z: 0 });
      const state = makeState([unit], [platform]);

      const path = findNavPath(state, unit, { x: 2, y: 2.5, z: 0 }, 6.0);
      expect(path.length).toBeGreaterThanOrEqual(2);
      expect(path[0].y).toBe(2.5);
      expect(path[path.length - 1].y).toBe(2.5);
    });

    describe('Sub-phase 13.5C: 3D Surface-Constrained Navigation & Stair Traversal', () => {
      const platformEast: TerrainPiece = {
        id: 'plat-east',
        terrainType: 'platform',
        position: { x: 6, y: 2.5, z: -2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 3, y: 0.3, z: 3 },
        elevation: 2.5,
        isWalkable: true,
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: false,
      };

      const stairsEast: TerrainPiece = {
        id: 'stairs-east',
        terrainType: 'stairs',
        climbType: 'stairs',
        position: { x: 4.5, y: 0, z: -2 },
        rotation: { x: 0, y: Math.PI / 2, z: 0 },
        scale: { x: 1.5, y: 2.5, z: 1.0 },
        elevation: 2.5,
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: false,
      };

      const ladderWest: TerrainPiece = {
        id: 'ladder-west',
        terrainType: 'ladder',
        climbType: 'ladder',
        position: { x: -4.5, y: 0, z: 2 },
        rotation: { x: 0, y: -Math.PI / 2, z: 0 },
        scale: { x: 0.5, y: 2.5, z: 1.0 },
        elevation: 2.5,
        blocksLineOfSight: false,
        providesCover: true,
        isObstacle: false,
      };

      it('computes accurate foot and head connectors for stairs and ladders', () => {
        const state = makeState([], [platformEast, stairsEast, ladderWest]);

        const stairConn = getStairWaypoints(state, stairsEast);
        expect(stairConn.foot.y).toBe(0);
        expect(stairConn.head.y).toBe(2.5);
        // With yaw = PI/2, +Z points towards +X (platform), -Z points towards -X (ground foot)
        expect(stairConn.foot.x).toBeLessThan(stairsEast.position.x);
        expect(stairConn.head.x).toBeGreaterThan(stairsEast.position.x);

        const ladderConn = getStairWaypoints(state, ladderWest);
        expect(ladderConn.foot.y).toBe(0);
        expect(ladderConn.head.y).toBe(2.5);
        expect(ladderConn.foot.x).toBe(-4.5);
        expect(ladderConn.head.x).toBe(-4.5);
      });

      it('recognizes line segments on stairs and ladders as ramp traversals', () => {
        const state = makeState([], [platformEast, stairsEast, ladderWest]);
        const stairConn = getStairWaypoints(state, stairsEast);

        expect(isSegmentOnRampOrStairs(state, stairConn.foot, stairConn.head)).toBe(true);
        // Points outside stair footprint are not on stairs
        expect(isSegmentOnRampOrStairs(state, { x: 0, y: 0, z: 0 }, { x: 6, y: 2.5, z: -2 })).toBe(false);
      });

      it('enforces surface constraints prohibiting non-airborne diagonal flight through open air', () => {
        const state = makeState([], [platformEast, stairsEast]);
        const groundUnit = makeUnit('ground-1', HOST, { x: 0, y: 0, z: 0 });
        const airborneUnit = makeUnit('air-1', HOST, { x: 0, y: 0, z: 0 });
        airborneUnit.specialRules = ['airborne'];

        // Ground point to roof point (4" horizontal, 2.5" vertical, no stairs)
        const pGround = { x: 0, y: 0, z: -2 };
        const pRoof = { x: 6, y: 2.5, z: -2 };

        // Prohibited for ground unit
        expect(isSegmentSurfaceConstrained(state, pGround, pRoof, groundUnit)).toBe(false);
        // Permitted for airborne unit
        expect(isSegmentSurfaceConstrained(state, pGround, pRoof, airborneUnit)).toBe(true);

        // Pure horizontal movement is permitted for ground unit
        expect(isSegmentSurfaceConstrained(state, { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, groundUnit)).toBe(true);
        // Pure vertical climb (e.g. against sheer wall, dh <= 0.7") is permitted for ground unit
        expect(isSegmentSurfaceConstrained(state, { x: 4.5, y: 0, z: -2 }, { x: 4.5, y: 2.5, z: -2 }, groundUnit)).toBe(true);
      });

      it('routes ground units via stairs at 1:1 speed with no Difficult Terrain penalty when available', () => {
        const unit = makeUnit('u-stair', HOST, { x: 0, y: 0, z: -2 });
        unit.speed = 12; // Rush allowance
        unit.remainingMovement = 12;
        const state = makeState([unit], [platformEast, stairsEast]);

        // Destination is on the platform deck at (6, 2.5, -2)
        const path = findNavPath(state, unit, { x: 6, y: 2.5, z: -2 }, 12.0);

        expect(path.length).toBeGreaterThanOrEqual(3);
        // Starts on ground
        expect(path[0].y).toBe(0);
        // Reaches platform elevation at destination
        expect(path[path.length - 1].y).toBe(2.5);
        expect(path[path.length - 1].x).toBeCloseTo(6, 0.5);

        // Path must pass through stairs (segment traverses stairs connector)
        const hasStairsSegment = path.some(
          (p, idx) => idx > 0 && isSegmentOnRampOrStairs(state, path[idx - 1], p)
        );
        expect(hasStairsSegment).toBe(true);

        // Clamped path partially ascends stairs when distance allowance is limited
        const clampedPath = findNavPath(state, unit, { x: 6, y: 2.5, z: -2 }, 5.5);
        const lastPt = clampedPath[clampedPath.length - 1];
        expect(lastPt.y).toBeGreaterThan(0.2);
        expect(lastPt.y).toBeLessThan(2.4);

        // Taking stairs does NOT count as Difficult Terrain
        expect(isPathDifficult(state, path, unit)).toBe(false);
      });

      it('routes through stairs connected to building roofs and platforms without being blocked by obstacle bounds', () => {
        const building: TerrainPiece = {
          id: 'workshop-bldg',
          terrainType: 'building-h',
          position: { x: -9, y: 0, z: 2 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 3.5, y: 2.5, z: 3.5 },
          elevation: 2.5,
          isWalkable: true,
          blocksLineOfSight: true,
          providesCover: true,
          isObstacle: true,
        };
        const stairs: TerrainPiece = {
          id: 'workshop-stairs',
          terrainType: 'stairs-closed-short',
          climbType: 'stairs',
          position: { x: -9, y: 0, z: -0.5 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1.2, y: 2.5, z: 1 },
          isWalkable: true,
          blocksLineOfSight: false,
          providesCover: true,
          isObstacle: false,
        };
        const unit = makeUnit('u-stairs', HOST, { x: -9, y: 0, z: -3.2 });
        unit.speed = 6;
        unit.remainingMovement = 6;
        const state = makeState([unit], [building, stairs]);

        // Destination is on the building roof at (-9, 2.5, 1.7)
        const path = findNavPath(state, unit, { x: -9, y: 2.5, z: 1.7 }, 12.0);
        expect(path.length).toBeGreaterThanOrEqual(3);
        const endPt = path[path.length - 1];
        expect(endPt.y).toBe(2.5);
        expect(endPt.z).toBeCloseTo(1.7, 0.2);

        // Path is NOT difficult terrain
        expect(isPathDifficult(state, path, unit)).toBe(false);
      });

      it('falls back to wall-base ascent when climbing sheer walls without stairs and applies Difficult Terrain cap', () => {
        const sheerPlatform: TerrainPiece = {
          id: 'plat-sheer',
          terrainType: 'platform',
          position: { x: 5, y: 2.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 0.3, z: 4 },
          elevation: 2.5,
          isWalkable: true,
          blocksLineOfSight: false,
          providesCover: true,
          isObstacle: true,
        };
        const unit = makeUnit('u-wall', HOST, { x: 0, y: 0, z: 0 });
        unit.speed = 12;
        unit.remainingMovement = 12;
        // State has platform but NO stairs/ladders
        const state = makeState([unit], [sheerPlatform]);

        const path = findNavPath(state, unit, { x: 5, y: 2.5, z: 0 }, 12.0);
        expect(path.length).toBeGreaterThanOrEqual(3);
        expect(path[0].y).toBe(0);
        expect(path[path.length - 1].y).toBe(2.5);

        // Sheer wall climb must route along ground to wall base, then ascend vertically
        const hasVerticalAscent = path.some(
          (p, idx) => idx > 0 && (p.y ?? 0) - (path[idx - 1].y ?? 0) > 1.5
        );
        expect(hasVerticalAscent).toBe(true);

        // Sheer wall climb IS Difficult Terrain
        expect(isPathDifficult(state, path, unit)).toBe(true);
      });

      it('stops at wall base when stopBeforeDifficult is requested and path exceeds 6.0" (Rush pacing)', () => {
        const sheerPlatform: TerrainPiece = {
          id: 'plat-sheer-rush',
          terrainType: 'platform',
          position: { x: 8, y: 2.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 0.3, z: 4 },
          elevation: 2.5,
          isWalkable: true,
          blocksLineOfSight: false,
          providesCover: true,
          isObstacle: true,
        };
        const unit = makeUnit('u-rush', HOST, { x: 0, y: 0, z: 0 });
        unit.speed = 12;
        unit.remainingMovement = 12;
        const state = makeState([unit], [sheerPlatform]);

        // Destination is on the platform deck at (8, 2.5, 0).
        // With stopBeforeDifficult: true, unit Rushes to the base of the wall (approx x=6, y=0)
        // without climbing or triggering Difficult Terrain.
        const path = findNavPath(state, unit, { x: 8, y: 2.5, z: 0 }, 12.0, {
          stopBeforeDifficult: true,
        });

        expect(path.length).toBeGreaterThanOrEqual(2);
        // Ends on ground at base of wall
        const lastPt = path[path.length - 1];
        expect(lastPt.y).toBe(0);
        expect(lastPt.x).toBeGreaterThanOrEqual(5.8);
        expect(lastPt.x).toBeLessThanOrEqual(6.2);

        // Path is on open ground, NOT Difficult Terrain
        expect(isPathDifficult(state, path, unit)).toBe(false);

        // Next turn: Starting from base of wall (x=6, y=0), climbing 2.5" is within 6.0"
        unit.position = { x: 6, y: 0, z: 0 };
        const climbPath = findNavPath(state, unit, { x: 8, y: 2.5, z: 0 }, 6.0, {
          stopBeforeDifficult: true,
        });
        expect(climbPath[climbPath.length - 1].y).toBe(2.5);
        expect(isPathDifficult(state, climbPath, unit)).toBe(true);
      });

      it('stops at difficult terrain boundary when stopBeforeDifficult is requested and path exceeds 6.0" (Rush pacing before mud)', () => {
        const mudPatch: TerrainPiece = {
          id: 'mud-rush',
          terrainType: 'mud',
          position: { x: 8, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 0.1, z: 4 },
          isDifficult: true,
          isWalkable: true,
          blocksLineOfSight: false,
          providesCover: false,
          isObstacle: false,
        };
        const unit = makeUnit('u-rush-mud', HOST, { x: 0, y: 0, z: 0 });
        unit.speed = 12;
        unit.remainingMovement = 12;
        const state = makeState([unit], [mudPatch]);

        // Destination is inside the mud patch at (8, 0, 0)
        // Mud spans x from 6.0 to 10.0.
        // Unit Rushes towards it; stopBeforeDifficult stops just before the mud boundary (~5.8")
        const path = findNavPath(state, unit, { x: 8, y: 0, z: 0 }, 12.0, {
          stopBeforeDifficult: true,
        });

        expect(path.length).toBeGreaterThanOrEqual(2);
        const lastPt = path[path.length - 1];
        expect(lastPt.x).toBeGreaterThanOrEqual(5.6);
        expect(lastPt.x).toBeLessThan(6.0);

        // Path is on open ground, NOT Difficult Terrain
        expect(isPathDifficult(state, path, unit)).toBe(false);
      });

      it('allows airborne units to fly diagonally directly to elevated platforms', () => {
        const sheerPlatform: TerrainPiece = {
          id: 'plat-sheer-air',
          terrainType: 'platform',
          position: { x: 4, y: 2.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 3, y: 0.3, z: 3 },
          elevation: 2.5,
          isWalkable: true,
          blocksLineOfSight: false,
          providesCover: true,
          isObstacle: false,
        };
        const airUnit = makeUnit('u-air', HOST, { x: 0, y: 0, z: 0 });
        airUnit.specialRules = ['airborne'];
        airUnit.speed = 12;
        airUnit.remainingMovement = 12;
        const state = makeState([airUnit], [sheerPlatform]);

        const path = findNavPath(state, airUnit, { x: 4, y: 2.5, z: 0 }, 12.0);
        // Airborne flies directly in 2 points [from, target]
        expect(path.length).toBe(2);
        expect(path[0]).toEqual({ x: 0, y: 0, z: 0 });
        expect(path[1].y).toBe(2.5);
      });

      it('routes units down stairs from platform to ground cleanly without falling drops', () => {
        const unit = makeUnit('u-descend', HOST, { x: 6, y: 2.5, z: -2 });
        unit.speed = 12;
        unit.remainingMovement = 12;
        const state = makeState([unit], [platformEast, stairsEast]);

        // Destination is on the ground at (0, 0, -2)
        const path = findNavPath(state, unit, { x: 0, y: 0, z: -2 }, 12.0);
        expect(path[0].y).toBe(2.5);
        expect(path[path.length - 1].y).toBe(0);

        // Descending stairs is not difficult terrain and not a dangerous drop
        expect(isPathDifficult(state, path, unit)).toBe(false);
      });

      describe('Sub-phase 13.5H: Solid Triangular Ramp Collision & Ladder Deck Arrival', () => {
        it('allows movement along the sloped hypotenuse surface at continuous height', () => {
          const state = makeState([], [platformEast, stairsEast]);
          // Stairs East: foot is around x=2.5, y=0, z=-2; head is around x=4.5, y=2.5, z=-2
          const waypoints = getStairWaypoints(state, stairsEast);

          const midPoint = {
            x: (waypoints.foot.x + waypoints.head.x) / 2,
            y: (waypoints.foot.y + waypoints.head.y) / 2,
            z: waypoints.foot.z,
          };
          const surfaceHeight = getStairSurfaceHeight(stairsEast, midPoint, state);
          expect(surfaceHeight).not.toBeNull();
          expect(surfaceHeight!).toBeCloseTo(1.25, 0.2);
        });

        it('blocks horizontal movement passing under the stair slope through the solid wedge body', () => {
          const state = makeState([], [stairsEast]);
          const blockerUnit = makeUnit('u-ground', HOST, { x: 4.5, y: 0, z: -5 });

          // Attempt to pass horizontally under the stairs along Z at y=0 (stairs are at x=4.5, z=-2)
          // Entry point at z=-2.75, y=0. Slope height at x=4.5 is ~1.25", so entry at y=0 is under slope!
          const underPath = [
            { x: 4.5, y: 0, z: -5 },
            { x: 4.5, y: 0, z: 1 },
          ];
          const blocker = findMoveBlocker(state, blockerUnit, underPath);
          expect(blocker.blocked).toBe(true);
          expect((blocker as any).reason).toMatch(/blocked by stairs/i);
        });

        it('ladder deck arrival: clamps path to ladder foot when movement allowance is insufficient to reach the head', () => {
          const state = makeState([], [platformEast, ladderWest]);
          const climber = makeUnit('u-climber', HOST, { x: -4.5, y: 0, z: 0 });
          climber.speed = 6;
          climber.remainingMovement = 6;

          // Ladder West is at (-4.5, y=0..2.5, z=2). Distance from (x=-4.5, z=0) to ladder foot is 2.0".
          // Climb to head (2.5") requires 2.0" + 2.5" = 4.5" total budget.
          // If given only 3.0" budget, unit reaches the ladder foot but CANNOT stop suspended on rungs mid-air.
          const clampedLadderPath = findNavPath(state, climber, { x: -3.0, y: 2.5, z: 2 }, 3.0);
          expect(clampedLadderPath.length).toBeGreaterThanOrEqual(2);
          const endPt = clampedLadderPath[clampedLadderPath.length - 1];
          // Must remain at ladder foot (y = 0), not suspended in mid-air
          expect(endPt.y).toBe(0);
          expect(endPt.z).toBeCloseTo(2, 1); // the ladder foot itself (its spine), not a point beside it

          // In contrast, stairs allow stopping along the slope when budget is limited
          const stairClimber = makeUnit('u-stair-climber', HOST, { x: 0, y: 0, z: -2 });
          stairClimber.speed = 6;
          stairClimber.remainingMovement = 6;
          const stairState = makeState([stairClimber], [platformEast, stairsEast]);
          const clampedStairPath = findNavPath(stairState, stairClimber, { x: 6, y: 2.5, z: -2 }, 5.5);
          const stairEndPt = clampedStairPath[clampedStairPath.length - 1];
          // Can stop midway on stair slope
          expect(stairEndPt.y).toBeGreaterThan(0.2);
          expect(stairEndPt.y).toBeLessThan(2.3);
        });
      });
    });
  });

  describe('modular terrain parts', () => {
    const ruin: TerrainPiece = {
      id: 'ruin1',
      terrainType: 'ruin-l',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 3, z: 4 },
      blocksLineOfSight: true,
      providesCover: true,
      isObstacle: true,
    };

    it('lets a model walk into the open courtyard of an L-corner ruin', () => {
      const mover = makeUnit('h1', HOST, { x: 5, y: 0, z: -1 });
      const state = makeState([mover], [ruin]);
      // Enter from the open south/east sides to the interior
      const path = [{ x: 5, y: 0, z: -1 }, { x: 0.5, y: 0, z: -1 }];
      expect(findMoveBlocker(state, mover, path).blocked).toBe(false);
    });

    it('blocks movement through the ruin walls and sills but not along open sides', () => {
      const mover = makeUnit('h1', HOST, { x: 1.5, y: 0, z: 0 });
      const state = makeState([mover], [ruin]);
      // Through the north wall jamb
      expect(
        findMoveBlocker(state, mover, [{ x: 1.5, y: 0, z: 0 }, { x: 1.5, y: 0, z: 4 }]).blocked
      ).toBe(true);
      // Through the north window sill (aperture is not walkable)
      expect(
        findMoveBlocker(state, mover, [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }]).blocked
      ).toBe(true);
      // Through the west wall
      expect(
        findMoveBlocker(state, mover, [{ x: 0, y: 0, z: 1 }, { x: -4, y: 0, z: 1 }]).blocked
      ).toBe(true);
    });

    it('permits LoS through a ruin window only when a model is manning the port', () => {
      const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 6 });
      const manned = makeUnit('h1', HOST, { x: 0, y: 0, z: 1 });
      const distant = makeUnit('h2', HOST, { x: 0, y: 0, z: -3 });
      const state = makeState([manned, distant, target], [ruin]);
      expect(hasLineOfSight(state, manned, target)).toBe(true);
      expect(hasLineOfSight(state, distant, target)).toBe(false);
    });

    it('blocks LoS through solid ruin wall sections', () => {
      const shooter = makeUnit('h1', HOST, { x: 1.5, y: 0, z: 1 });
      const target = makeUnit('g1', GUEST, { x: 1.5, y: 0, z: 6 });
      const state = makeState([shooter, target], [ruin]);
      expect(hasLineOfSight(state, shooter, target)).toBe(false);
    });

    it('honours a custom structure on a piece in preference to the catalog definition', () => {
      const custom: TerrainPiece = {
        id: 'custom',
        terrainType: 'wall',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2, z: 1 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
        // Only the left half is solid (fractions of scale); the right half is open
        structure: { solids: [{ minX: -0.5, maxX: 0, minY: 0, maxY: 1, minZ: -0.5, maxZ: 0.5 }] },
      };
      const a = makeUnit('h1', HOST, { x: 1, y: 0, z: -3 });
      const t = makeUnit('g1', GUEST, { x: 1, y: 0, z: 3 });
      const state = makeState([a, t], [custom]);
      expect(hasLineOfSight(state, a, t)).toBe(true);
      a.position = { x: -1, y: 0, z: -3 };
      t.position = { x: -1, y: 0, z: 3 };
      expect(hasLineOfSight(state, a, t)).toBe(false);
    });

    it('resolves nested groups with offsets into one flat set of boxes', () => {
      const piece: TerrainPiece = {
        id: 'nest',
        terrainType: 'custom-building',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 10, y: 2, z: 10 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
        structure: {
          groups: [
            {
              offset: { x: 0.25, z: 0 },
              groups: [{ solids: [{ minX: -0.1, maxX: 0.1, minY: 0, maxY: 1, minZ: -0.1, maxZ: 0.1 }] }],
              apertures: [{ minX: -0.1, maxX: 0.1, minY: 0.4, maxY: 0.8, minZ: 0.2, maxZ: 0.3 }],
            },
          ],
        },
      };
      const r = resolveTerrainStructure(piece);
      expect(r.solids).toHaveLength(1);
      expect(r.solids[0].minX).toBeCloseTo(1.5);
      expect(r.solids[0].maxX).toBeCloseTo(3.5);
      expect(r.solids[0].maxY).toBeCloseTo(2);
      expect(r.apertures[0].minZ).toBeCloseTo(2);
    });

    it('a manning shooter sees through the port at eye height; the sill stops rays that dip beneath it', () => {
      // Window wall: sill 0 -> 1.0", port 1.0 -> 2.25", lintel 2.25 -> 2.5"
      const win: TerrainPiece = {
        id: 'w',
        terrainType: 'wall-window',
        position: { x: 0, y: 0, z: 4 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 0.3 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      };
      // Manning shooter (within 1.5") sees a target through the port at eye height
      const shooter = makeUnit('h1', HOST, { x: 0, y: 0, z: 3 });
      const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 8 });
      const state = makeState([shooter, target], [win]);
      expect(traceLineOfSight(state, shooter, target)).toMatchObject({ clear: true, visibleSampleHeight: 1.1 });

      // A target standing well below the wall base is hidden by the sill: the eye ray dips under 1.0"
      const lowTarget = makeUnit('g2', GUEST, { x: 0, y: -1, z: 6 });
      const stateLow = makeState([shooter, lowTarget], [win]);
      expect(hasLineOfSight(stateLow, shooter, lowTarget)).toBe(false);
    });

    it('sees a target by any visible part when the head ray clips a lintel', () => {
      // Elevated shooter looks down; the head ray clips the lintel but the feet ray is clear.
      const door: TerrainPiece = {
        id: 'door',
        terrainType: 'wall-doorway',
        position: { x: 0, y: 0, z: 3 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 0.3 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      };
      const shooter = makeUnit('h1', HOST, { x: 0, y: 3.0, z: 2.2 });
      const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 3.5 });
      const state = makeState([shooter, target], [door]);
      // Eye at 4.1" looking down at the head crosses the lintel (2.2-2.5"); the torso ray passes beneath it
      const trace = traceLineOfSight(state, shooter, target);
      expect(trace.clear).toBe(true);
      expect(trace.visibleSampleHeight).not.toBe(1.1);
    });

    it('a wall blocks every sample height (no peeking over a full wall)', () => {
      const wall = makeWall('w1', { x: 0, y: 0, z: 3 });
      const a = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
      const t = makeUnit('g1', GUEST, { x: 0, y: 0, z: 6 });
      expect(traceLineOfSight(makeState([a, t], [wall]), a, t)).toMatchObject({
        clear: false,
        blockedByPieceId: 'w1',
      });
    });

    it('a distant window blocks a ray through the port; a ray clipping the sill is a normal solid block', () => {
      const win: TerrainPiece = {
        id: 'w',
        terrainType: 'wall-window',
        position: { x: 0, y: 0, z: 4 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 0.3 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      };
      const a = makeUnit('h1', HOST, { x: 0, y: 0, z: -2 });
      const t = makeUnit('g1', GUEST, { x: 0, y: 0, z: 10 });
      const state = makeState([a, t], [win]);
      const trace = traceLineOfSight(state, a, t);
      expect(trace.clear).toBe(false);
      expect(trace.blockedByPieceId).toBe('w');
    });

    it('F9 ray debug reports the same verdict, blocker and cover source as the rules', () => {
      const win: TerrainPiece = {
        id: 'w',
        terrainType: 'wall-window',
        position: { x: 0, y: 0, z: 4 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 0.3 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      };
      const distant = makeUnit('h1', HOST, { x: 0, y: 0, z: -2 });
      const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 9 });
      const blocked = computeShootingRayDebug(makeState([distant, target], [win]), distant, target);
      expect(blocked.hasLineOfSight).toBe(false);
      expect(blocked.blockedByPieceId).toBe('w');
      expect(blocked.intersections.find((i) => i.pieceId === 'w')?.isLoSBlocker).toBe(true);

      const manning = makeUnit('h2', HOST, { x: 0, y: 0, z: 3 });
      const clear = computeShootingRayDebug(makeState([manning, target], [win]), manning, target);
      expect(clear.hasLineOfSight).toBe(true);
      expect(clear.from.y).toBeCloseTo(1.1);
    });

    it('doorway lintel does not shadow the ground-level visibility fan', () => {
      const door: TerrainPiece = {
        id: 'door',
        terrainType: 'wall-doorway',
        position: { x: 0, y: 0, z: 3 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2.5, z: 0.3 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      };
      const shooter = makeUnit('h1', HOST, { x: 0, y: 0, z: 0 });
      const state = makeState([shooter], [door]);
      const poly = computeLosVisibilityPolygon(state, shooter.position, 12, shooter.id);
      const through = poly.filter((p) => Math.abs(p.x) < 0.1 && p.z > 3);
      expect(through.length).toBeGreaterThan(0);
      for (const p of through) expect(p.z).toBeGreaterThan(5);
    });

    it('permits LoS when the target is the one manning the ruin port', () => {
      const shooter = makeUnit('h1', HOST, { x: 0, y: 0, z: -3 });
      const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 3 });
      const state = makeState([shooter, target], [ruin]);
      expect(hasLineOfSight(state, shooter, target)).toBe(true);
    });

    it('measures manning from the base edge: 1.5" centre-to-wall counts, 1.6" does not', () => {
      // North wall outer face at z = 2.0; port spans x in [-0.4, 0.4]
      const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 8 });
      const near = makeUnit('h1', HOST, { x: 0, y: 0, z: 0.55 }); // 1.45" from wall inner face (z=1.75 -> 1.2) 
      const edge = makeUnit('h2', HOST, { x: 0, y: 0, z: 0.2 }); // 1.55" from inner face
      const far = makeUnit('h3', HOST, { x: 0, y: 0, z: -0.2 }); // 1.95" from inner face
      const state = makeState([near, edge, far, target], [ruin]);
      expect(hasLineOfSight(state, near, target)).toBe(true);
      expect(hasLineOfSight(state, edge, target)).toBe(false);
      expect(hasLineOfSight(state, far, target)).toBe(false);
    });

    it('counts a squad as manning the port if any model base is within reach', () => {
      const target = makeUnit('g1', GUEST, { x: 0, y: 0, z: 8 });
      const squad = makeUnit('h1', HOST, { x: 0, y: 0, z: -2 });
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -2 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 1 } },
      ];
      const state = makeState([squad, target], [ruin]);
      expect(hasLineOfSight(state, squad, target)).toBe(true);
    });

    it('allows LoS across the open courtyard without crossing the walls', () => {
      const shooter = makeUnit('h1', HOST, { x: 5, y: 0, z: -1 });
      const target = makeUnit('g1', GUEST, { x: 0.5, y: 0, z: -1 });
      const state = makeState([shooter, target], [ruin]);
      expect(hasLineOfSight(state, shooter, target)).toBe(true);
    });

    it('grants cover to a defender manning the ruin window but not one far inside', () => {
      const shooter = makeUnit('h1', HOST, { x: 0, y: 0, z: 6 });
      const manning = makeUnit('g1', GUEST, { x: 0, y: 0, z: 0.7 });
      const deep = makeUnit('g2', GUEST, { x: 0, y: 0, z: -1.5 });
      const stateA = makeState([shooter, manning], [ruin]);
      const stateB = makeState([shooter, deep], [ruin]);
      expect(hasCoverAgainstAttack(stateA, shooter, manning)).toBe(true);
      expect(hasCoverAgainstAttack(stateB, shooter, deep)).toBe(false);
    });
  });
});
