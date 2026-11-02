import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import {
  FLOOR_TIER,
  findMoveBlocker,
  findNavPath,
  findWalkablePlatformAt,
  findWalkableSurfaceAt,
  hasCoverAgainstAttack,
  hasLineOfSight,
  getStairWaypoints,
  isSegmentOnRampOrStairs,
  isSuspendedInMidAir,
  computeShootingRayDebug,
} from '../../src/engine/spatial';
import { detectPathGapJump } from '../../src/engine/traversal';
import { createAction } from '../../src/gameState';
import { validateAction } from '../../src/engine/actions';

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

/** Place a catalog piece at its default scale (the same flags the map editor would give it). */
function piece(type: string, x: number, y: number, z: number, rotY = 0, id = `${type}-${x}-${z}`): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id,
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
  return state;
}

describe('elevation: floor tier', () => {
  it('standard floor tier is 3.0"', () => {
    expect(FLOOR_TIER).toBe(3.0);
  });
});

describe('elevation: walkable decks', () => {
  const plat = piece('platform-small', 0, 0, 0);

  it('a model on the deck finds the platform at y = 3.0; ground beside it has none', () => {
    const surface = findWalkableSurfaceAt(makeState([], [plat]), { x: 0, y: 3, z: 0 });
    expect(surface?.piece.id).toBe(plat.id);
    expect(surface?.topY).toBeCloseTo(3.0);
    expect(findWalkablePlatformAt(makeState([], [plat]), { x: 5, y: 0, z: 0 })).toBeNull();
  });

  it('models walk under a platform deck and under a catwalk, but pillar legs block', () => {
    const catwalk = piece('catwalk', 8, 0, 0);
    const mover = makeUnit('m', HOST, { x: -3, y: 0, z: 0 });
    const state = makeState([mover], [plat, catwalk]);
    // straight through the middle under the deck (between the pillars)
    expect(findMoveBlocker(state, mover, [{ x: -3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }]).blocked).toBe(false);
    // through a corner pillar (at x=1.5, z=1.5)
    expect(findMoveBlocker(state, mover, [{ x: -3, y: 0, z: 1.5 }, { x: 3, y: 0, z: 1.5 }]).blocked).toBe(true);
    // under the legless catwalk anywhere
    expect(findMoveBlocker(state, mover, [{ x: 4, y: 0, z: 0.5 }, { x: 12, y: 0, z: 0.5 }]).blocked).toBe(false);
  });

  it('a model standing on the deck moves across it without colliding with the deck body', () => {
    const mover = makeUnit('m', HOST, { x: -1.5, y: 3, z: 0 });
    const state = makeState([mover], [plat]);
    expect(findMoveBlocker(state, mover, [{ x: -1.5, y: 3, z: 0 }, { x: 1.5, y: 3, z: 0 }]).blocked).toBe(false);
  });
});

describe('elevation: line of sight is geometry, not setback rules', () => {
  const plat = piece('platform-small', 0, 0, 0);

  it('pillar legs block sight at eye level; the open space under the deck does not', () => {
    const shooter = makeUnit('s', HOST, { x: -4, y: 0, z: 1.5 });
    const target = makeUnit('t', GUEST, { x: 4, y: 0, z: 1.5 });
    const through = makeState([shooter, target], [plat]);
    expect(hasLineOfSight(through, shooter, target)).toBe(false); // along the pillar line
    shooter.position = { x: -4, y: 0, z: 0 };
    target.position = { x: 4, y: 0, z: 0 };
    expect(hasLineOfSight(through, shooter, target)).toBe(true); // between the pillars, under the deck
  });

  it('a close ground shooter cannot see a model standing 2" back from the deck edge', () => {
    const shooter = makeUnit('s', HOST, { x: 3.5, y: 0, z: 0 });
    const target = makeUnit('t', GUEST, { x: 0, y: 3, z: 0 });
    expect(hasLineOfSight(makeState([shooter, target], [plat]), shooter, target)).toBe(false);
  });

  it('a distant ground shooter can see over the deck edge (the angle clears it)', () => {
    const shooter = makeUnit('s', HOST, { x: 10, y: 0, z: 0 });
    const target = makeUnit('t', GUEST, { x: 0, y: 3, z: 0 });
    expect(hasLineOfSight(makeState([shooter, target], [plat]), shooter, target)).toBe(true);
  });

  it('a close ground shooter sees a model at the deck edge, and that model gets cover from the deck edge', () => {
    const shooter = makeUnit('s', HOST, { x: 3.0, y: 0, z: 0 });
    const target = makeUnit('t', GUEST, { x: 1.5, y: 3, z: 0 });
    const state = makeState([shooter, target], [plat]);
    expect(hasLineOfSight(state, shooter, target)).toBe(true);
    expect(hasCoverAgainstAttack(state, shooter, target)).toBe(true);
  });

  it('an elevated shooter sees a distant ground target, but not one hugging the base of the deck', () => {
    const shooter = makeUnit('s', HOST, { x: 0, y: 3, z: 0 });
    const far = makeUnit('far', GUEST, { x: 8, y: 0, z: 0 });
    const hugging = makeUnit('near', GUEST, { x: 3, y: 0, z: 0 });
    expect(hasLineOfSight(makeState([shooter, far], [plat]), shooter, far)).toBe(true);
    expect(hasLineOfSight(makeState([shooter, hugging], [plat]), shooter, hugging)).toBe(false);
  });
});

describe('elevation: stacking low cover and walls on a deck', () => {
  const plat = piece('platform-small', 0, 0, 0);

  it('a 0.5" barricade is seen over; a wall stacked on the deck hides the model behind it', () => {
    const shooter = makeUnit('s', HOST, { x: -1.5, y: 3, z: 0 });
    const target = makeUnit('t', GUEST, { x: 1.5, y: 3, z: 0 });
    const barricade = piece('barricade', 0, 3, 0, Math.PI / 2, 'barricade');
    const wall = piece('wall', 0, 3, 0, Math.PI / 2, 'wall');
    expect(hasLineOfSight(makeState([shooter, target], [plat, barricade]), shooter, target)).toBe(true);
    expect(hasLineOfSight(makeState([shooter, target], [plat, wall]), shooter, target)).toBe(false);
  });

  it('a barricade on the deck blocks movement through it and gives low cover within 1" behind it', () => {
    const mover = makeUnit('m', HOST, { x: -1.5, y: 3, z: 0 });
    const barricade = piece('barricade', 0, 3, 0, Math.PI / 2, 'barricade');
    const state = makeState([mover], [plat, barricade]);
    expect(findMoveBlocker(state, mover, [{ x: -1.5, y: 3, z: 0 }, { x: 1.5, y: 3, z: 0 }]).blocked).toBe(true);

    const shooter = makeUnit('s', HOST, { x: -1.9, y: 3, z: 0 });
    const behind = makeUnit('t', GUEST, { x: 0.8, y: 3, z: 0 });
    const cover = makeState([shooter, behind], [plat, barricade]);
    expect(hasCoverAgainstAttack(cover, shooter, behind)).toBe(true);
  });
});

describe('low cover and scatter pieces (13.6D)', () => {
  it('crate, barricade and pipe are low cover (seen over); the container blocks sight', () => {
    const shooter = makeUnit('s', HOST, { x: -5, y: 0, z: 0 });
    const target = makeUnit('t', GUEST, { x: 5, y: 0, z: 0 });
    for (const type of ['barricade', 'crate', 'industrial-pipe']) {
      const p = piece(type, 0, 0, 0, Math.PI / 2, type);
      expect(hasLineOfSight(makeState([shooter, target], [p]), shooter, target), type).toBe(true);
    }
    const container = piece('shipping-container', 0, 0, 0, Math.PI / 2, 'container');
    expect(hasLineOfSight(makeState([shooter, target], [container]), shooter, target)).toBe(false);
  });

  it('the container roof is a walkable floor at 2.25"', () => {
    const container = piece('shipping-container', 0, 0, 0);
    const surface = findWalkableSurfaceAt(makeState([], [container]), { x: 0, y: 2.25, z: 0 });
    expect(surface?.topY).toBeCloseTo(2.25);
  });

  it('low cover gives +1 only to a defender within 1" behind it (low-cover proximity rule is unchanged)', () => {
    const shooter = makeUnit('s', HOST, { x: -4, y: 0, z: 0 });
    const barricade = piece('barricade', 0, 0, 0, Math.PI / 2, 'barricade'); // 3" long across the line of fire
    const near = makeUnit('near', GUEST, { x: 0.9, y: 0, z: 0 });
    const far = makeUnit('far', GUEST, { x: 4, y: 0, z: 0 });
    expect(hasCoverAgainstAttack(makeState([shooter, near], [barricade]), shooter, near)).toBe(true);
    expect(hasCoverAgainstAttack(makeState([shooter, far], [barricade]), shooter, far)).toBe(false);
  });
});

describe('elevation: L-corner ruin ledge', () => {
  const ruin = piece('ruin-l', 0, 0, 0);

  it('the ledge is a floor at y = 3.0 along the north and west walls; the courtyard is not', () => {
    const state = makeState([], [ruin]);
    expect(findWalkableSurfaceAt(state, { x: 0, y: 3, z: 1.2 })?.topY).toBeCloseTo(3.0);
    expect(findWalkableSurfaceAt(state, { x: -1.2, y: 3, z: -1 })?.topY).toBeCloseTo(3.0);
    expect(findWalkableSurfaceAt(state, { x: 0.5, y: 0, z: -0.5 })).toBeNull();
  });

  it('the courtyard stays walkable at y = 0, including beneath the ledge', () => {
    const mover = makeUnit('m', HOST, { x: 5, y: 0, z: -1 });
    const state = makeState([mover], [ruin]);
    expect(findMoveBlocker(state, mover, [{ x: 5, y: 0, z: -1 }, { x: 0.5, y: 0, z: -1 }]).blocked).toBe(false);
    expect(findMoveBlocker(state, mover, [{ x: 1, y: 0, z: 1.2 }, { x: -1, y: 0, z: 1.2 }]).blocked).toBe(false);
  });

  it('a model on the ledge walks along it but cannot walk through the wall', () => {
    const mover = makeUnit('m', HOST, { x: -1, y: 3, z: 1.2 });
    const state = makeState([mover], [ruin]);
    expect(findMoveBlocker(state, mover, [{ x: -1, y: 3, z: 1.2 }, { x: 1, y: 3, z: 1.2 }]).blocked).toBe(false);
    expect(findMoveBlocker(state, mover, [{ x: 1, y: 3, z: 1.2 }, { x: 1, y: 3, z: 3 }]).blocked).toBe(true);
  });
});

describe('elevation: reaching the deck', () => {
  it('stairs onto a platform follow the continuous ramp and finish on the deck at y = 3.0', () => {
    const plat = piece('platform-small', 0, 0, 0);
    // Stairs run along local Z; head end meets the deck edge at x = -2 (rotated to run along X)
    const stairs = piece('stairs', -4, 0, 0, Math.PI / 2, 'stairs-1');
    const unit = makeUnit('u', HOST, { x: -8, y: 0, z: 0 });
    unit.speed = 12;
    unit.remainingMovement = 12;
    const state = makeState([unit], [plat, stairs]);
    const path = findNavPath(state, unit, { x: 0, y: 3, z: 0 }, 14);
    const end = path[path.length - 1];
    expect(end.y).toBeCloseTo(3.0);
    expect(path.some((p, i) => i > 0 && isSegmentOnRampOrStairs(state, path[i - 1], p))).toBe(true);
  });

  it('a ladder climb to the deck reaches y = 3.0, and cannot stop suspended on the rungs', () => {
    const plat = piece('platform-small', 0, 0, 0);
    const ladder = piece('ladder', -2.25, 0, 0, Math.PI / 2, 'ladder-1');
    const unit = makeUnit('u', HOST, { x: -5, y: 0, z: 0 });
    unit.speed = 6;
    unit.remainingMovement = 6;
    const state = makeState([unit], [plat, ladder]);
    const full = findNavPath(state, unit, { x: -1, y: 3, z: 0 }, 12);
    expect(full[full.length - 1].y).toBeCloseTo(3.0);
    // The climb runs up the ladder's spine: through the foot and the head, vertically
    const foot = full.findIndex((p) => Math.abs(p.x + 2.25) < 0.01 && Math.abs(p.z) < 0.01 && p.y === 0);
    expect(foot).toBeGreaterThanOrEqual(0);
    expect(full[foot + 1]).toMatchObject({ x: full[foot].x, z: full[foot].z });
    expect(full[foot + 1].y).toBeCloseTo(3.0);
    // Budget that reaches the foot but not the head: stays on the ground
    const short = findNavPath(state, unit, { x: -1, y: 3, z: 0 }, 4);
    expect(short[short.length - 1].y).toBe(0);
  });
});

describe('elevation: hopping between decks', () => {
  it('a short hop between adjacent platform and catwalk is free; a wide gap needs a jump', () => {
    const plat = piece('platform-small', 0, 0, 0);
    const catwalk = piece('catwalk', 5, 0, 0); // spans x 2..8: flush against the platform edge at x = 2
    const state = makeState([], [plat, catwalk]);
    const unit = makeUnit('u', HOST, { x: 1.5, y: 3, z: 0 });
    const hop = detectPathGapJump(state, [{ x: 1.5, y: 3, z: 0 }, { x: 2.3, y: 3, z: 0 }], unit);
    expect(hop.isGapJump).toBe(false);

    const farCatwalk = piece('catwalk', 8, 0, 0, 0, 'far-catwalk'); // spans x 5..11: 3" gap
    const gapState = makeState([], [plat, farCatwalk]);
    const jump = detectPathGapJump(gapState, [{ x: 1.5, y: 3, z: 0 }, { x: 5.5, y: 3, z: 0 }], unit);
    expect(jump.isGapJump).toBe(true);
  });
});

describe('elevation: climbing down (no hanging in mid-air)', () => {
  const ruin = piece('ruin-l', 0, 0, 0);

  it('a 3" drop costs no movement: a budget that reaches the edge finishes the drop', () => {
    const unit = makeUnit('u', HOST, { x: 0, y: 3, z: 1.2 });
    const state = makeState([unit], [ruin]);
    // 0.7" along the ledge to the edge; the 3" drop itself is free
    const path = findNavPath(state, unit, { x: 0, y: 0, z: 0.2 }, 1.0);
    expect(path[path.length - 1].y).toBe(0);
  });

  it('a budget that cannot even reach the edge keeps the model on the ledge, not hanging in the air', () => {
    const unit = makeUnit('u', HOST, { x: 0, y: 3, z: 1.2 });
    const state = makeState([unit], [ruin]);
    const short = findNavPath(state, unit, { x: 0, y: 0, z: 0.2 }, 0.4);
    const end = short[short.length - 1];
    expect(end.y).toBeCloseTo(3.0);
    expect(end.z).toBeGreaterThan(0.5);
  });

  it('every clamped path end is either on a floor, on the ground or on a slope, never suspended', () => {
    const unit = makeUnit('u', HOST, { x: 0, y: 3, z: 1.2 });
    const state = makeState([unit], [ruin]);
    for (const budget of [0.5, 1, 1.5, 2, 3, 3.7, 4, 5, 6]) {
      const path = findNavPath(state, unit, { x: 0.5, y: 0, z: -1 }, budget);
      expect(isSuspendedInMidAir(state, path[path.length - 1]), `budget ${budget}`).toBe(false);
    }
  });

  it('the host rejects a move that ends suspended in mid-air', () => {
    const unit = makeUnit('u', HOST, { x: 0, y: 3, z: 1.2 });
    const state = makeState([unit], [ruin]);
    state.turnState.activeUnitId = 'u';
    state.turnState.currentPlayerId = HOST;
    unit.isActivated = true;
    const hanging = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'u',
      path: [{ x: 0, y: 3, z: 1.2 }, { x: 0, y: 3, z: 0.5 }, { x: 0, y: 1.5, z: 0.5 }],
      finalPosition: { x: 0, y: 1.5, z: 0.5 },
    });
    const res = validateAction(state, hanging);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/suspended in mid-air/i);
    const landed = createAction(HOST, 'move-unit', {
      type: 'move-unit',
      unitId: 'u',
      path: [{ x: 0, y: 3, z: 1.2 }, { x: 0, y: 3, z: 0.5 }, { x: 0, y: 0, z: 0.5 }],
      finalPosition: { x: 0, y: 0, z: 0.5 },
    });
    expect(validateAction(state, landed).reason ?? '').not.toMatch(/suspended in mid-air/i);
  });
});

describe('F9 shooting ray: the line follows the 3D ray (not one flat plane)', () => {
  it('entry/exit heights interpolate from the shooter eye to the target', () => {
    const wall = piece('wall', 0, 0, 6);
    const shooter = makeUnit('s', HOST, { x: 0, y: 0, z: 0 });
    const target = makeUnit('t', GUEST, { x: 0, y: 3, z: 12 });
    const debug = computeShootingRayDebug(makeState([shooter, target], [wall]), shooter, target);
    expect(debug.from.y).toBeCloseTo(1.1);
    expect(debug.to.y).toBeCloseTo(4.1);
    const hit = debug.intersections.find((i) => i.pieceId === wall.id)!;
    // Halfway along the ray the height is halfway between eye (1.1) and target (4.1)
    const mid = (hit.entryPoint.y + hit.exitPoint.y) / 2;
    expect(mid).toBeCloseTo(2.6, 0);
    expect(hit.entryPoint.y).toBeGreaterThan(debug.from.y);
    expect(hit.exitPoint.y).toBeGreaterThanOrEqual(hit.entryPoint.y);
  });
});

describe('stairs orientation is data, not neighbours', () => {
  it('the head (top) end is always local +Z, whichever side a deck is on', () => {
    for (const deckZ of [4, -4, 100]) {
      const stairs = piece('stairs', 0, 0, 0, 0, 'stairs-1');
      const state = makeState([], [stairs, piece('platform-small', 0, 0, deckZ, 0, 'deck')]);
      const { foot, head } = getStairWaypoints(state, stairs);
      expect(head.z).toBeGreaterThan(foot.z); // rotation 0: +Z is up the stairs
      expect(head.y).toBeCloseTo(3.0);
      expect(foot.y).toBe(0);
    }
  });
});

describe('ladder paths stay on the spine from any approach', () => {
  it('approaching from the side of a platform, the climb still goes through the ladder foot and head', () => {
    const plat = piece('platform-small', 0, 0, 0);
    const ladder = piece('ladder', 2, 0, 1, -Math.PI / 2, 'ladder-east');
    const unit = makeUnit('u', HOST, { x: 6, y: 0, z: -3 });
    unit.speed = 12;
    unit.remainingMovement = 12;
    const state = makeState([unit], [plat, ladder]);
    const path = findNavPath(state, unit, { x: 0, y: 3, z: 0 }, 20);
    const climb = path.findIndex((p, i) => i > 0 && p.y > path[i - 1].y + 1);
    expect(climb).toBeGreaterThan(0);
    expect(path[climb - 1]).toMatchObject({ x: 2, z: 1, y: 0 });
    expect(path[climb]).toMatchObject({ x: 2, z: 1 });
    expect(path[climb].y).toBeCloseTo(3.0);
  });

  it('climbing down uses the same spine', () => {
    const plat = piece('platform-small', 0, 0, 0);
    const ladder = piece('ladder', 2, 0, 1, -Math.PI / 2, 'ladder-east');
    const unit = makeUnit('u', HOST, { x: 0, y: 3, z: 0 });
    unit.speed = 12;
    unit.remainingMovement = 12;
    const state = makeState([unit], [plat, ladder]);
    const path = findNavPath(state, unit, { x: 5, y: 0, z: -2 }, 20);
    const descent = path.findIndex((p, i) => i > 0 && p.y < path[i - 1].y - 1);
    expect(path[descent - 1]).toMatchObject({ x: 2, z: 1 });
    expect(path[descent]).toMatchObject({ x: 2, z: 1, y: 0 });
  });
});

describe('bridging: a catwalk is reachable deck-to-deck without leaving the deck level', () => {
  it('walks straight from a platform onto an attached catwalk (any rotation, flush or with a small gap), also when rushing', () => {
    const rotations = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    for (const platformType of ['platform-small', 'platform-large']) {
      for (const rot of rotations) {
        for (const gap of [0, 0.5, 1]) {
          const plat = piece(platformType, 0, 0, 0, 0);
          const halfLen = platformType === 'platform-small' ? 2 : 3;
          // Catwalk (6" x 2") centred along +X from the platform edge, rotated about its own centre
          const cx = halfLen + gap + (rot % Math.PI === 0 ? 3 : 1);
          const cat = piece('catwalk', cx, 0, 0, rot, 'cat');
          const unit = makeUnit('u', HOST, { x: 0, y: 3, z: 0 });
          unit.speed = 12;
          unit.remainingMovement = 12;
          const state = makeState([unit], [plat, cat]);
          const dest = { x: cx, y: 3, z: 0 };
          for (const opts of [{}, { stopBeforeDifficult: true }]) {
            const path = findNavPath(state, unit, dest, 24, opts);
            expect(Math.min(...path.map((p) => p.y)), `${platformType} rot ${rot} gap ${gap}`).toBeGreaterThan(2.9);
            expect(path[path.length - 1]).toMatchObject({ x: cx, z: 0 });
          }
        }
      }
    }
  });
});

describe('maps saved with a stray legacy `elevation` (e.g. elevation: 0 on a catwalk)', () => {
  // Taken from a real saved map: catwalk bridging two large platforms, each carrying isWalkable/elevation metadata
  const stray = (type: string, x: number, z: number, rot: number, elevation: number): TerrainPiece => ({
    ...piece(type, x, 0, z, rot),
    elevation,
  });
  const terrain = [
    stray('platform-large', -7, 3, 0, 0),
    stray('catwalk', -6, -2, Math.PI / 2, 0),
    stray('platform-large', -7, -7, 0, 0),
  ];

  it('structured floors ignore a stray elevation: the deck is still at 3.0" and the pillars still block', () => {
    const state = makeState([], terrain);
    expect(findWalkableSurfaceAt(state, { x: -6, y: 3, z: -2 })?.topY).toBeCloseTo(3.0);
    const mover = makeUnit('m', HOST, { x: -11, y: 0, z: 3 });
    const withPillars = makeState([mover], terrain);
    // platform-large pillars sit 2.5" in from the centre along X and 1.5" along Z: (-9.5, 4.5)
    expect(
      findMoveBlocker(withPillars, mover, [{ x: -12, y: 0, z: 4.5 }, { x: -8, y: 0, z: 4.5 }]).blocked
    ).toBe(true);
  });

  it('walking platform -> catwalk -> platform is not a gap jump (the decks are flush)', () => {
    const state = makeState([], terrain);
    const unit = makeUnit('u', HOST, { x: -7, y: 3, z: 3 });
    for (const path of [
      [{ x: -7, y: 3, z: 3 }, { x: -6, y: 3, z: -2 }],
      [{ x: -7, y: 3, z: 3 }, { x: -7, y: 3, z: -7 }],
    ]) {
      expect(detectPathGapJump(state, path, unit).isGapJump).toBe(false);
    }
  });

  it('a unit on one platform paths straight along the deck onto the catwalk and the far platform', () => {
    const unit = makeUnit('u', HOST, { x: -7, y: 3, z: 3 });
    unit.speed = 12;
    unit.remainingMovement = 12;
    const state = makeState([unit], terrain);
    for (const dest of [{ x: -6, y: 3, z: -2 }, { x: -7, y: 3, z: -7 }]) {
      const path = findNavPath(state, unit, dest, 24, { stopBeforeDifficult: true });
      expect(Math.min(...path.map((p) => p.y))).toBeGreaterThan(2.9);
      expect(path[path.length - 1]).toMatchObject({ x: dest.x, z: dest.z });
    }
  });
});
