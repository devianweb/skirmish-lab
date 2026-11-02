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
  isSegmentOnRampOrStairs,
} from '../../src/engine/spatial';
import { detectPathGapJump } from '../../src/engine/traversal';

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

describe('elevation: stacking rails and parapets on a deck', () => {
  const plat = piece('platform-small', 0, 0, 0);

  it('a 1.0" railing is seen over (low cover); a 1.5" parapet hides the model behind it', () => {
    const shooter = makeUnit('s', HOST, { x: -1.5, y: 3, z: 0 });
    const target = makeUnit('t', GUEST, { x: 1.5, y: 3, z: 0 });
    const rail = piece('deck-railing', 0, 3, 0, Math.PI / 2, 'rail');
    const parapet = piece('deck-parapet', 0, 3, 0, Math.PI / 2, 'parapet');
    expect(hasLineOfSight(makeState([shooter, target], [plat, rail]), shooter, target)).toBe(true);
    expect(hasLineOfSight(makeState([shooter, target], [plat, parapet]), shooter, target)).toBe(false);
  });

  it('a railing on the deck blocks movement through it', () => {
    const mover = makeUnit('m', HOST, { x: -1.5, y: 3, z: 0 });
    const rail = piece('deck-railing', 0, 3, 0, Math.PI / 2, 'rail');
    const state = makeState([mover], [plat, rail]);
    expect(findMoveBlocker(state, mover, [{ x: -1.5, y: 3, z: 0 }, { x: 1.5, y: 3, z: 0 }]).blocked).toBe(true);
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
