import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import {
  TERRAIN_PALETTE_CATALOG,
  isAreaPiece,
  isDangerousPiece,
  isDifficultPiece,
} from '../../src/data/mapSchema';
import { WEAPONS } from '../../src/data/weapons';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { resolveTerrainStructure } from '../../src/engine/terrainStructure';
import { findCoverSource, findEndOverlap, findNavPath, segmentCrossesFootprintAtLevel } from '../../src/engine/spatial';
import { isPathDangerous, isPathDifficult } from '../../src/engine/traversal';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(type: string, x: number, y: number, z: number, extra: Partial<TerrainPiece> = {}): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[type];
  return {
    id: `${type}-${x}-${y}-${z}`,
    terrainType: type,
    position: P(x, y, z),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    ...(meta.isWalkable ? { isWalkable: true } : {}),
    ...extra,
  };
}

function makeUnit(id: string, at: Vector3, opts: { models?: number; rules?: string[]; owner?: string } = {}): Unit {
  const count = opts.models ?? 1;
  return {
    id,
    ownerId: opts.owner ?? HOST,
    armyId: 'army-1',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...at },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: count,
    maxWounds: count,
    isActivated: false,
    isDestroyed: false,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      wounds: 1,
      maxWounds: 1,
      isDestroyed: false,
      position: { ...at, x: at.x + i * 1.2 },
    })),
    weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: opts.rules ?? [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function makeState(units: Unit[], terrain: TerrainPiece[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  return state;
}

const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

describe('area terrain catalog', () => {
  it('rubble field: difficult, gives cover, no sight block, not an obstacle, not walkable', () => {
    const m = TERRAIN_PALETTE_CATALOG['rubble-field'];
    expect(m.category).toBe('area');
    expect(m.defaultScale).toEqual({ x: 6, y: 0.25, z: 4 });
    expect(m).toMatchObject({
      isArea: true,
      isDifficult: true,
      providesCover: true,
      blocksLineOfSight: false,
      isObstacle: false,
    });
    expect(m.isDangerous).toBeUndefined();
    expect(m.isWalkable).toBeFalsy();
  });

  it('hazard pool: dangerous only, no cover, no sight block, not an obstacle, not walkable', () => {
    const m = TERRAIN_PALETTE_CATALOG['hazard-pool'];
    expect(m.category).toBe('area');
    expect(m.defaultScale).toEqual({ x: 4, y: 0.1, z: 4 });
    expect(m).toMatchObject({
      isArea: true,
      isDangerous: true,
      providesCover: false,
      blocksLineOfSight: false,
      isObstacle: false,
    });
    expect(m.isDifficult).toBeUndefined();
    expect(m.isWalkable).toBeFalsy();
  });

  it.each(['rubble-field', 'hazard-pool'])('%s has a structure with no solids and no apertures', (type) => {
    const resolved = resolveTerrainStructure(piece(type, 0, 0, 0));
    expect(resolved.solids).toHaveLength(0);
    expect(resolved.apertures).toHaveLength(0);
  });
});

describe('isDifficultPiece / isDangerousPiece', () => {
  it('catalog defaults apply when the piece has no flag', () => {
    expect(isDifficultPiece(piece('rubble-field', 0, 0, 0))).toBe(true);
    expect(isDangerousPiece(piece('hazard-pool', 0, 0, 0))).toBe(true);
    expect(isDangerousPiece(piece('rubble-field', 0, 0, 0))).toBe(false);
    expect(isDifficultPiece(piece('hazard-pool', 0, 0, 0))).toBe(false);
  });

  it('a piece flag beats the catalog, and an explicit false beats a catalog true', () => {
    expect(isDifficultPiece(piece('crate', 0, 0, 0, { isDifficult: true }))).toBe(true);
    expect(isDangerousPiece(piece('crate', 0, 0, 0, { isDangerous: true }))).toBe(true);
    expect(isDifficultPiece(piece('rubble-field', 0, 0, 0, { isDifficult: false }))).toBe(false);
    expect(isDangerousPiece(piece('hazard-pool', 0, 0, 0, { isDangerous: false }))).toBe(false);
  });

  it.each(['trench', 'forest', 'mud'])('legacy type %s is still difficult without flags', (t) => {
    const p = { terrainType: t } as TerrainPiece;
    expect(isDifficultPiece(p)).toBe(true);
    expect(isDangerousPiece(p)).toBe(false);
  });

  it.each(['toxic', 'hazard', 'fire'])('legacy type %s is still dangerous without flags', (t) => {
    const p = { terrainType: t } as TerrainPiece;
    expect(isDangerousPiece(p)).toBe(true);
    expect(isDifficultPiece(p)).toBe(false);
  });

  it('unknown types without flags are neither', () => {
    const p = { terrainType: 'mystery' } as TerrainPiece;
    expect(isDifficultPiece(p)).toBe(false);
    expect(isDangerousPiece(p)).toBe(false);
  });

  it('only catalog area pieces are area terrain', () => {
    expect(isAreaPiece({ terrainType: 'rubble-field' })).toBe(true);
    expect(isAreaPiece({ terrainType: 'hazard-pool' })).toBe(true);
    expect(isAreaPiece({ terrainType: 'crate' })).toBe(false);
  });
});

describe('difficult terrain along the whole path', () => {
  const rubble = piece('rubble-field', 0, 0, 0); // x -3..3, z -2..2
  const state = makeState([makeUnit('u', P(-8, 0, 0))], [rubble]);
  const unit = state.units[0];

  it('a straight two-point path across it is difficult even with both ends outside', () => {
    expect(isPathDifficult(state, [P(-8, 0, 0), P(8, 0, 0)], unit)).toBe(true);
  });

  it('a path passing 0.5" outside it is not', () => {
    expect(isPathDifficult(state, [P(-8, 0, 2.5), P(8, 0, 2.5)], unit)).toBe(false);
  });

  it('a path that only brushes the 0.15" margin still counts', () => {
    expect(isPathDifficult(state, [P(-8, 0, 2.1), P(8, 0, 2.1)], unit)).toBe(true);
  });

  it('a path on a deck 3" above it is not', () => {
    expect(isPathDifficult(state, [P(-8, 3, 0), P(8, 3, 0)], unit)).toBe(false);
  });

  it('Strider and Flying units are exempt', () => {
    expect(isPathDifficult(state, [P(-8, 0, 0), P(8, 0, 0)], makeUnit('p', P(-8, 0, 0), { rules: ['strider'] }))).toBe(false);
    expect(isPathDifficult(state, [P(-8, 0, 0), P(8, 0, 0)], makeUnit('a', P(-8, 0, 0), { rules: ['flying'] }))).toBe(false);
  });

  it('a rotated piece is tested in its own frame', () => {
    const turned = piece('rubble-field', 0, 0, 0, { rotation: { x: 0, y: Math.PI / 2, z: 0 } }); // now x -2..2, z -3..3
    const s = makeState([makeUnit('u', P(-8, 0, 0))], [turned]);
    expect(isPathDifficult(s, [P(-8, 0, 3.5), P(8, 0, 3.5)], s.units[0])).toBe(false);
    expect(isPathDifficult(s, [P(2.6, 0, -8), P(2.6, 0, 8)], s.units[0])).toBe(false);
    expect(isPathDifficult(s, [P(1.5, 0, -8), P(1.5, 0, 8)], s.units[0])).toBe(true);
  });

  it('a Rush across it is capped at 6" by the host; the same Rush around it is not', () => {
    const rusher = makeUnit('u', P(-8, 0, 0));
    const s = makeState([rusher, makeUnit('e', P(0, 0, 30), { owner: GUEST })], [rubble]);
    s.turnState.activeUnitId = 'u';
    rusher.isActivated = true;
    const across = createAction(HOST, 'rush', {
      type: 'rush',
      unitId: 'u',
      path: [P(-8, 0, 0), P(0.5, 0, 0), P(5, 0, 0)],
      finalPosition: P(5, 0, 0),
    });
    const res = validateAction(s, across);
    expect(res.valid).toBe(false);
    const around = createAction(HOST, 'rush', {
      type: 'rush',
      unitId: 'u',
      path: [P(-8, 0, 0), P(-3.5, 0, 3), P(2, 0, 4)],
      finalPosition: P(2, 0, 4),
    });
    expect(validateAction(s, around).valid).toBe(true);
  });

  it('the planner stops a Rush at the edge of a rubble field it would cross', () => {
    const rusher = makeUnit('u', P(-8, 0, 0));
    rusher.speed = 12;
    rusher.remainingMovement = 12;
    const s = makeState([rusher], [rubble]);
    const path = findNavPath(s, rusher, P(8, 0, 0), 16, { stopBeforeDifficult: true });
    const last = path[path.length - 1];
    expect(last.x).toBeLessThan(-3.15);
    expect(isPathDifficult(s, path, rusher)).toBe(false);
  });

  // Owner report 2026-11-09: a Rush aimed past a rubble field at an angle was capped at 6" in open ground,
  // because the stop point sat inside the 0.15" detection margin, so the stopped path still counted as difficult.
  it.each([
    ['oblique approach to an axis-aligned field', 0, P(12, 0, -10), P(-14, 0, 8)],
    ['diagonal approach', 0, P(14, 0, -14), P(-5, 0, 5)],
    ['field rotated 45 degrees', Math.PI / 4, P(12, 0, 0), P(-12, 0, 6)],
    ['field rotated 30 degrees, oblique', Math.PI / 6, P(12, 0, -10), P(-14, 0, 8)],
  ])('the stopped Rush path is not difficult (%s)', (_label, yaw, from, to) => {
    const rusher = makeUnit('u', from);
    rusher.speed = 24;
    rusher.remainingMovement = 24;
    const field = piece('rubble-field', -6, 0, 4, { rotation: { x: 0, y: yaw, z: 0 } });
    const s = makeState([rusher], [field]);
    expect(isPathDifficult(s, [from, to], rusher)).toBe(true); // the straight line does cross it
    const path = findNavPath(s, rusher, to, 48, { stopBeforeDifficult: true });
    const last = path[path.length - 1];
    expect(isPathDifficult(s, path, rusher)).toBe(false);
    // it stops close to the field (within 0.5" of the detection margin), not somewhere short of it
    expect(isPathDifficult(s, [last, to], rusher)).toBe(true);
    expect(segmentCrossesFootprintAtLevel(field, last, last, 0.5)).toBe(true);
  });
});

describe('dangerous terrain along the whole path', () => {
  const pool = piece('hazard-pool', 0, 0, 0); // x -2..2, z -2..2
  const rubble = piece('rubble-field', 10, 0, 0);

  it('a straight path across a hazard pool is dangerous; across rubble it is not; flying is exempt', () => {
    const s = makeState([makeUnit('u', P(-6, 0, 0))], [pool, rubble]);
    const u = s.units[0];
    expect(isPathDangerous(s, [P(-6, 0, 0), P(6, 0, 0)], u)).toBe(true);
    expect(isPathDangerous(s, [P(6, 0, 0), P(14, 0, 0)], u)).toBe(false);
    expect(isPathDangerous(s, [P(-6, 0, 0), P(6, 0, 0)], makeUnit('a', P(-6, 0, 0), { rules: ['flying'] }))).toBe(false);
  });

  it('a single model crossing asks for one hazard die; a squad of 3 asks for 3', () => {
    const single = makeState([makeUnit('u', P(-6, 0, 0))], [pool]);
    single.turnState.activeUnitId = 'u';
    const move = (unitId: string) =>
      createAction(HOST, 'advance', { type: 'advance', unitId, path: [P(-6, 0, 0), P(6, 0, 0)], finalPosition: P(6, 0, 0) });
    expect(getDiceSpecs(single, move('u'))).toEqual([{ count: 1, sides: 6, purpose: 'hazard' }]);

    const squad = makeState([makeUnit('s', P(-6, 0, 0), { models: 3 })], [pool]);
    squad.turnState.activeUnitId = 's';
    expect(getDiceSpecs(squad, move('s'))).toEqual([{ count: 3, sides: 6, purpose: 'hazard' }]);
  });

  it('crossing rubble needs no hazard dice', () => {
    const s = makeState([makeUnit('u', P(6, 0, 0))], [rubble]);
    s.turnState.activeUnitId = 'u';
    const act = createAction(HOST, 'advance', { type: 'advance', unitId: 'u', path: [P(6, 0, 0), P(14, 0, 0)], finalPosition: P(14, 0, 0) });
    expect(getDiceSpecs(s, act)).toBeNull();
  });

  it('a squad model that declares a jump still tags its own dice m<index>_', () => {
    const s = makeState([makeUnit('s', P(-6, 0, 0), { models: 2 })], [pool]);
    s.turnState.activeUnitId = 's';
    const squadMove = createAction(HOST, 'advance', {
      type: 'advance',
      unitId: 's',
      path: [P(-6, 0, 0), P(6, 0, 0)],
      finalPosition: P(6, 0, 0),
      modelPositions: [P(6, 0, 0), P(7.2, 0, 0)],
      modelPaths: [
        [P(-6, 0, 0), P(6, 0, 0)],
        [P(-4.8, 0, 0), P(7.2, 0, 0)],
      ],
    });
    // walking squad: one shared hazard roll of one die per living model
    expect(getDiceSpecs(s, squadMove)).toEqual([{ count: 2, sides: 6, purpose: 'hazard' }]);
  });

  it('a legacy toxic piece (no flags) still asks for hazard dice', () => {
    const toxic: TerrainPiece = {
      id: 'legacy-toxic',
      terrainType: 'toxic',
      position: P(0, 0, 0),
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2.5, y: 0.05, z: 2.5 },
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
    };
    const s = makeState([makeUnit('u', P(-6, 0, 0))], [toxic]);
    s.turnState.activeUnitId = 'u';
    const act = createAction(HOST, 'advance', { type: 'advance', unitId: 'u', path: [P(-6, 0, 0), P(6, 0, 0)], finalPosition: P(6, 0, 0) });
    expect(getDiceSpecs(s, act)).toEqual([{ count: 1, sides: 6, purpose: 'hazard' }]);
  });
});

describe('cover for models inside area terrain', () => {
  const rubble = piece('rubble-field', 0, 0, 0); // x -3..3, z -2..2
  const pool = piece('hazard-pool', 0, 0, 0);

  it('a model with its centre inside has cover from a ground shooter', () => {
    const shooter = makeUnit('s', P(0, 0, -15), { owner: GUEST });
    const target = makeUnit('t', P(0, 0, 0));
    const s = makeState([shooter, target], [rubble]);
    expect(findCoverSource(s, shooter, target)).not.toBeNull();
  });

  it('also against plunging fire from a 3" deck', () => {
    const shooter = makeUnit('s', P(0, 3, -15), { owner: GUEST });
    const target = makeUnit('t', P(0, 0, 0));
    const s = makeState([shooter, target], [rubble]);
    expect(findCoverSource(s, shooter, target)).not.toBeNull();
  });

  it('a model 0.5" behind the field (centre outside) gets no cover from it', () => {
    const shooter = makeUnit('s', P(0, 0, -15), { owner: GUEST });
    const target = makeUnit('t', P(0, 0, 2.5));
    const s = makeState([shooter, target], [rubble]);
    expect(findCoverSource(s, shooter, target)).toBeNull();
  });

  it('a shooter standing in the field gives the open target no cover from it', () => {
    const shooter = makeUnit('s', P(0, 0, 0), { owner: GUEST });
    const target = makeUnit('t', P(0, 0, 8));
    const s = makeState([shooter, target], [rubble]);
    expect(findCoverSource(s, shooter, target)).toBeNull();
  });

  it('a model on a deck above the field has no cover from it', () => {
    const shooter = makeUnit('s', P(0, 0, -15), { owner: GUEST });
    const target = makeUnit('t', P(0, 3, 0));
    const s = makeState([shooter, target], [rubble]);
    expect(findCoverSource(s, shooter, target)).toBeNull();
  });

  it('a model inside a hazard pool gets no cover', () => {
    const shooter = makeUnit('s', P(0, 0, -15), { owner: GUEST });
    const target = makeUnit('t', P(0, 0, 0));
    const s = makeState([shooter, target], [pool]);
    expect(findCoverSource(s, shooter, target)).toBeNull();
  });

  describe('squads need the whole base inside', () => {
    const shooter = makeUnit('s', P(0, 0, -15), { owner: GUEST });
    // Rubble spans x -3..3, z -2..2. A base fits when |x| <= 2.5 and |z| <= 1.5.
    const placeSquad = (xs: number[], zs: number[] = xs.map(() => 0)) => {
      const squad = makeUnit('t', P(0, 0, 0), { models: xs.length });
      squad.models.forEach((m, i) => {
        m.position = P(xs[i], 0, zs[i]);
      });
      squad.position = P(xs[0], 0, zs[0]);
      return squad;
    };
    // cover is judged per model (the squad majority rule is applied on top by squadTargeting)
    const modelCover = (squad: Unit, i: number, s: GameState) =>
      findCoverSource(s, shooter, { ...squad, position: squad.models[i].position! }) !== null;

    it('3 of 4 fully inside: those three are in cover (majority)', () => {
      const squad = placeSquad([-2, -1, 0, 2.9], [0, 0, 0, 0]);
      const s = makeState([shooter, squad], [rubble]);
      const covered = squad.models.filter((_, i) => modelCover(squad, i, s)).length;
      expect(covered).toBe(3);
      expect(covered * 2).toBeGreaterThan(squad.models.length);
    });

    it('2 of 4 fully inside: not a majority', () => {
      const squad = placeSquad([-2, 0, 2.9, -3.2]);
      const s = makeState([shooter, squad], [rubble]);
      const covered = squad.models.filter((_, i) => modelCover(squad, i, s)).length;
      expect(covered).toBe(2);
      expect(covered * 2).toBeLessThanOrEqual(squad.models.length);
    });

    it('3 of 4 with centres inside but bases over the edge: none count', () => {
      // x 2.6, 2.8, 2.9 have centres inside (|x| <= 3) but bases poke over the east edge
      const squad = placeSquad([2.6, 2.8, 2.9, -8]);
      const s = makeState([shooter, squad], [rubble]);
      const covered = squad.models.filter((_, i) => modelCover(squad, i, s)).length;
      expect(covered).toBe(0);
    });

    it('a single model with centre inside but base over the edge has cover', () => {
      const lone = makeUnit('t', P(2.9, 0, 0));
      const s = makeState([shooter, lone], [rubble]);
      expect(findCoverSource(s, shooter, lone)).not.toBeNull();
    });

    it('a squad down to one living model is judged by its centre', () => {
      const squad = placeSquad([2.9, -8]);
      squad.models[1].isDestroyed = true;
      const s = makeState([shooter, squad], [rubble]);
      expect(findCoverSource(s, shooter, { ...squad, position: squad.models[0].position! })).not.toBeNull();
    });
  });
});

describe('models stay on the ground in area terrain', () => {
  const rubble = piece('rubble-field', 0, 0, 0);

  it('a nav path across a rubble field keeps every waypoint at y = 0', () => {
    const u = makeUnit('u', P(-6, 0, 0));
    u.remainingMovement = 12;
    u.speed = 12;
    const s = makeState([u], [rubble]);
    const path = findNavPath(s, u, P(1, 0, 0), 12);
    expect(path.length).toBeGreaterThanOrEqual(2);
    for (const p of path) expect(p.y ?? 0).toBe(0);
  });

  it('ending a move inside the field is not an end-overlap, and the host accepts it', () => {
    const u = makeUnit('u', P(-6, 0, 0));
    const s = makeState([u, makeUnit('e', P(0, 0, 30), { owner: GUEST })], [rubble]);
    s.turnState.activeUnitId = 'u';
    u.isActivated = true;
    expect(findEndOverlap(s, 'u', P(1, 0, 0))).toBeNull();
    const inside = createAction(HOST, 'advance', { type: 'advance', unitId: 'u', path: [P(-6, 0, 0), P(0, 0, 0)], finalPosition: P(0, 0, 0) });
    expect(validateAction(s, inside)).toEqual({ valid: true });
    const out = applyAction(s, inside);
    expect(out.ok).toBe(true);
    expect(out.state!.units[0].position.y ?? 0).toBe(0);
  });
});

describe('activation hazard test', () => {
  const pool = piece('hazard-pool', 0, 0, 0); // x -2..2, z -2..2

  const activate = (unitId: string) => createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId });

  it('asks for no dice when nobody stands in dangerous terrain', () => {
    const s = makeState([makeUnit('u', P(8, 0, 0))], [pool]);
    expect(getDiceSpecs(s, activate('u'))).toBeNull();
  });

  it('a single model inside rolls one activation_hazard die, and a 1 wounds it', () => {
    const u = makeUnit('u', P(0, 0, 0));
    u.wounds = 3;
    u.maxWounds = 3;
    u.models[0].wounds = 3;
    u.models[0].maxWounds = 3;
    const s = makeState([u, makeUnit('e', P(0, 0, 30), { owner: GUEST })], [pool]);
    expect(getDiceSpecs(s, activate('u'))).toEqual([{ count: 1, sides: 6, purpose: 'activation_hazard' }]);

    const hit = applyAction(s, activate('u'), [roll('activation_hazard', [1])]);
    expect(hit.ok).toBe(true);
    expect(hit.state!.units[0].wounds).toBe(2);
    const ev = hit.state!.actionLog[hit.state!.actionLog.length - 1].dice!.outcome.traversal!;
    expect(ev).toHaveLength(1);
    expect(ev[0].text).toContain('Hazard (activated in dangerous terrain)');
    expect(ev[0].wounds).toBe(1);

    const safe = applyAction(s, activate('u'), [roll('activation_hazard', [2])]);
    expect(safe.state!.units[0].wounds).toBe(3);
  });

  it('only the models standing inside roll, tagged m<index>_ in living-model order; the roller is the casualty', () => {
    const squad = makeUnit('s', P(0, 0, 0), { models: 3 });
    squad.models[0].position = P(8, 0, 0);
    squad.models[1].position = P(0, 0, 0);
    squad.models[2].position = P(1, 0, 0);
    squad.position = P(8, 0, 0);
    squad.models[0].id = 'm-out';
    squad.models[1].id = 'm-a';
    squad.models[2].id = 'm-b';
    const s = makeState([squad, makeUnit('e', P(0, 0, 30), { owner: GUEST })], [pool]);
    expect(getDiceSpecs(s, activate('s'))).toEqual([
      { count: 1, sides: 6, purpose: 'm1_activation_hazard' },
      { count: 1, sides: 6, purpose: 'm2_activation_hazard' },
    ]);
    const out = applyAction(s, activate('s'), [roll('m1_activation_hazard', [3]), roll('m2_activation_hazard', [1])]);
    expect(out.ok).toBe(true);
    const after = out.state!.units[0];
    expect(after.models.find((m) => m.id === 'm-b')!.isDestroyed).toBe(true);
    expect(after.models.find((m) => m.id === 'm-a')!.isDestroyed).toBe(false);
    expect(after.models.find((m) => m.id === 'm-out')!.isDestroyed).toBe(false);
  });

  it('flying units are exempt', () => {
    const s = makeState([makeUnit('u', P(0, 0, 0), { rules: ['flying'] })], [pool]);
    expect(getDiceSpecs(s, activate('u'))).toBeNull();
  });

  it('a model on a deck above the pool is not tested', () => {
    const s = makeState([makeUnit('u', P(0, 3, 0))], [pool]);
    expect(getDiceSpecs(s, activate('u'))).toBeNull();
  });

  it('a rubble field (difficult only) does not trigger the test', () => {
    const s = makeState([makeUnit('u', P(0, 0, 0))], [piece('rubble-field', 0, 0, 0)]);
    expect(getDiceSpecs(s, activate('u'))).toBeNull();
  });

  it('a unit that is tested and then crosses dangerous ground the same activation rolls only once', () => {
    const u = makeUnit('u', P(0, 0, 0));
    u.wounds = 3;
    u.maxWounds = 3;
    u.models[0].wounds = 3;
    u.models[0].maxWounds = 3;
    const s = makeState([u, makeUnit('e', P(0, 0, 30), { owner: GUEST })], [pool]);
    const activated = applyAction(s, activate('u'), [roll('activation_hazard', [4])]).state!;
    expect(activated.units[0].activationHazardModelIds).toEqual(['u-m0']);
    const move = createAction(HOST, 'advance', { type: 'advance', unitId: 'u', path: [P(0, 0, 0), P(5, 0, 0)], finalPosition: P(5, 0, 0) });
    expect(getDiceSpecs(activated, move)).toBeNull();
  });

  it('a squad model not yet tested still rolls for a crossing; tested ones do not', () => {
    const squad = makeUnit('s', P(-6, 0, 0), { models: 3 });
    squad.models[0].position = P(0, 0, 0); // inside the pool
    squad.models[1].position = P(-6, 0, 1);
    squad.models[2].position = P(-6, 0, -1);
    const s = makeState([squad], [pool]);
    const activated = applyAction(s, activate('s'), [roll('m0_activation_hazard', [4])]).state!;
    activated.turnState.activeUnitId = 's';
    const move = createAction(HOST, 'advance', {
      type: 'advance', unitId: 's', path: [P(-6, 0, 0), P(6, 0, 0)], finalPosition: P(6, 0, 0),
    });
    expect(getDiceSpecs(activated, move)).toEqual([{ count: 2, sides: 6, purpose: 'hazard' }]);
  });

  it('the tested list is cleared when the unit next activates', () => {
    const u = makeUnit('u', P(8, 0, 0));
    u.activationHazardModelIds = ['u-m0'];
    const s = makeState([u], [pool]);
    const out = applyAction(s, activate('u')).state!;
    expect(out.units[0].activationHazardModelIds).toBeUndefined();
    expect('activationHazardModelIds' in out.units[0]).toBe(false);
  });

  it('a hold that starts the activation is tested too', () => {
    const s = makeState([makeUnit('u', P(0, 0, 0))], [pool]);
    const hold = createAction(HOST, 'hold', { type: 'hold', unitId: 'u' });
    expect(getDiceSpecs(s, hold)).toEqual([{ count: 1, sides: 6, purpose: 'activation_hazard' }]);
  });
});
