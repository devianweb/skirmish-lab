import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, DiceSpec, GameState, TerrainPiece, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { autoSplitBlastHits, computeCombatModifiers, resolveAttack } from '../../src/engine/combat';
import { getBlastParticipants } from '../../src/engine/blast';
import { firingModels } from '../../src/engine/squadTargeting';
import { PICK_CASUALTIES_AUTO_CHOICE } from '../../src/engine/casualties';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });

function weapon(id: string, attacks?: number, name?: string, extraId?: string): Weapon {
  const base = WEAPONS[id];
  return {
    ...base,
    ...(extraId ? { id: extraId } : {}),
    ...(name ? { name } : {}),
    profile: { ...base.profile, ...(attacks ? { attacks } : {}) },
  };
}

/** A unit of `count` models in a row starting at (x, z), 1" apart. */
function mkUnit(
  id: string,
  owner: string,
  x: number,
  z: number,
  opts: { count?: number; weapons?: Weapon[]; rules?: string[]; defense?: number; status?: Unit['status'] } = {}
): Unit {
  const count = opts.count ?? 1;
  return {
    id,
    ownerId: owner,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: opts.defense ?? 5,
    speed: 6,
    position: P(x + (count - 1) / 2, z),
    rotation: { x: 0, y: 0, z: 0 },
    status: opts.status ?? [],
    wounds: count,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      wounds: 1,
      maxWounds: 1,
      isDestroyed: false,
      position: P(x + i, z),
      rotation: { x: 0, y: 0, z: 0 },
    })),
    weapons: opts.weapons ?? [weapon('rifle')],
    specialRules: opts.rules ?? [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function mkState(units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.terrain = terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = units[0].id;
  units[0].isActivated = true;
  return state;
}

const wall = (x: number, z: number): TerrainPiece => {
  const meta = TERRAIN_PALETTE_CATALOG.wall;
  return {
    id: `wall-${x}-${z}`,
    terrainType: 'wall',
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
  };
};

const unitOf = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
const roll = (purpose: string, rolls: number[]): DiceResult => ({
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  finalTotal: rolls.reduce((a, b) => a + b, 0),
  purpose,
});

const shootAt = (allocations: Array<{ weaponId: string; targetId: string }>, attackerId = 'h1') =>
  createAction(HOST, 'shoot', {
    type: 'shoot',
    attackerId,
    targetId: allocations[0].targetId,
    weaponId: allocations[0].weaponId,
    allocations,
  });

/** Answer every requested die: to-hit dice from `toHit`, every other batch with `fill` (default 1: fail). */
function fire(state: GameState, action = shootAt([{ weaponId: 'frag-launcher', targetId: 'g1' }]), toHit = [6], fill = 1) {
  const specs: DiceSpec[] = getDiceSpecs(state, action) ?? [];
  const dice = specs.map((s) => roll(s.purpose, s.purpose.endsWith('to-hit') ? toHit : Array(s.count).fill(fill)));
  return { specs, out: applyAction(state, action, dice) };
}

describe('autoSplitBlastHits', () => {
  const cands = (...caps: number[]) => caps.map((cap, i) => ({ unitId: `u${i}`, cap }));

  it('splits evenly and the odd hit goes to the target (first), then to the nearer units', () => {
    expect(autoSplitBlastHits(6, cands(9, 9))).toEqual([3, 3]);
    expect(autoSplitBlastHits(5, cands(9, 9))).toEqual([3, 2]);
    expect(autoSplitBlastHits(7, cands(9, 9, 9))).toEqual([3, 2, 2]);
    expect(autoSplitBlastHits(8, cands(9, 9, 9))).toEqual([3, 3, 2]);
  });

  it('caps each unit at its living models and re-spreads the surplus', () => {
    expect(autoSplitBlastHits(6, cands(1, 9))).toEqual([1, 5]);
    expect(autoSplitBlastHits(9, cands(2, 9, 9))).toEqual([2, 4, 3]);
  });

  it('hits above every cap are lost', () => {
    expect(autoSplitBlastHits(9, cands(2, 3))).toEqual([2, 3]);
    expect(autoSplitBlastHits(3, cands(1))).toEqual([1]);
    expect(autoSplitBlastHits(0, cands(4, 4))).toEqual([0, 0]);
  });
});

describe('Blast: per-unit cap on resolveAttack', () => {
  const rules = { quality: 4, weaponRules: ['blast(3)'] };

  it('caps the total hits on one unit at its living models, not each hit separately', () => {
    // 2 attacks, both hit: 6 Blast hits, but a 4-model unit takes at most 4 (the old per-hit cap gave 6).
    const outcome = resolveAttack(rules, { defense: 5, modelCount: 4 }, 2, { toHit: [5, 5], defense: [1, 1, 1, 1] });
    expect(outcome.hitCount).toBe(4);
    expect(outcome.wounds).toBe(4);
  });

  it('a unit with more models than hits takes every hit', () => {
    const outcome = resolveAttack(rules, { defense: 5, modelCount: 10 }, 2, { toHit: [5, 5], defense: Array(6).fill(1) });
    expect(outcome.hitCount).toBe(6);
  });

  it('takes only its slice of the shot when given a share, rolling its own Defense', () => {
    const toHit = [5, 5]; // 6 Blast hits
    const first = resolveAttack(rules, { defense: 5, modelCount: 9 }, 2, { toHit, defense: [6, 6, 1] }, { offset: 0, count: 3 });
    const second = resolveAttack(
      rules,
      { defense: 3, modelCount: 9 },
      2,
      { toHit, defense: [3, 3, 2] },
      { offset: 3, count: 3 }
    );
    expect(first.hitCount).toBe(3);
    expect(first.wounds).toBe(1); // D5: two 6s block
    expect(second.hitCount).toBe(3);
    expect(second.wounds).toBe(1); // D3: 3+ blocks, the 2 fails
  });

  it('ignores cover for every unit', () => {
    const outcome = resolveAttack(rules, { defense: 5, inCover: true, modelCount: 5 }, 1, { toHit: [5], defense: [4, 4, 4] });
    expect(outcome.coverApplied).toBe(false);
    expect(outcome.wounds).toBe(3); // 4 + 0 < 5
  });
});

describe('Blast: spread on the table', () => {
  // h1 (1 model, 2-attack frag launcher) shoots g1 (3 models); g2 (3 models) stands 2" behind g1's models, g3 is far away.
  const blastShooter = () => mkUnit('h1', HOST, 0, 0, { weapons: [weapon('frag-launcher', 2)] });
  const scene = () =>
    mkState([
      blastShooter(),
      mkUnit('g1', GUEST, 0, 10, { count: 3 }),
      mkUnit('g2', GUEST, 0, 13, { count: 3 }),
      mkUnit('g3', GUEST, 0, 20, { count: 3 }),
    ]);

  it('lists the target first, then enemy units within 3" of it (nearest first), never friends or far units', () => {
    const state = scene();
    state.units.push(mkUnit('h2', HOST, 0, 11)); // a friendly unit next to the target is not hit
    state.units.push(mkUnit('g4', GUEST, 0, 7.5)); // 1.5" gap, nearer than g2 (2")
    const ids = getBlastParticipants(state, unitOf(state, 'h1'), unitOf(state, 'g1')).map((p) => p.unit.id);
    expect(ids).toEqual(['g1', 'g4', 'g2']);
  });

  it('3.0" is in the spread, just over is not; destroyed and routed units are skipped', () => {
    const state = scene();
    unitOf(state, 'g2').models.forEach((m) => (m.position = P(m.position.x, 14))); // 3.0" gap
    const ids = () => getBlastParticipants(state, unitOf(state, 'h1'), unitOf(state, 'g1')).map((p) => p.unit.id);
    expect(ids()).toEqual(['g1', 'g2']);
    unitOf(state, 'g2').models.forEach((m) => (m.position = P(m.position.x, 14.1)));
    expect(ids()).toEqual(['g1']);
    unitOf(state, 'g2').models.forEach((m) => (m.position = P(m.position.x, 13)));
    unitOf(state, 'g2').status.push('routed');
    expect(ids()).toEqual(['g1']);
  });

  it('asks for a separate defense batch for each neighbour (and none for far units)', () => {
    const state = scene();
    const purposes = getDiceSpecs(state, shootAt([{ weaponId: 'frag-launcher', targetId: 'g1' }]))!.map((s) => s.purpose);
    expect(purposes).toContain('blast_g2_defense');
    expect(purposes.some((p) => p.includes('g3'))).toBe(false);
  });

  it('splits 6 hits 3/3 (each unit capped at its 3 models) and each unit rolls its own Defense', () => {
    const state = scene();
    // Both attacks hit: 6 Blast hits; 3 models each: 3 / 3. g1 defends with D5, g2 with D2.
    unitOf(state, 'g2').defense = 2;
    const { out } = fire(state, undefined, [5, 5], 3); // every defense die shows 3: fails D5, blocks D2
    expect(out.ok).toBe(true);
    const outcome = out.logEntry!.dice!.outcome;
    expect(outcome.hitCount).toBe(3);
    expect(outcome.wounds).toBe(3);
    expect(outcome.blastSplash).toHaveLength(1);
    expect(outcome.blastSplash![0]).toMatchObject({ targetId: 'g2', hitCount: 3, wounds: 0, blockedCount: 3 });
    // g1 is wiped out, g2 took no wounds and g3 was never in the spread
    expect(unitOf(out.state!, 'g1').isDestroyed).toBe(true);
    expect(unitOf(out.state!, 'g2').wounds).toBe(3);
    expect(unitOf(out.state!, 'g3').wounds).toBe(3);
  });

  it('the odd hit goes to the target', () => {
    // 1 attack, 1 hit: 3 Blast hits, split 2 (target) / 1 (neighbour).
    const state = mkState([
      mkUnit('h1', HOST, 0, 0, { weapons: [weapon('frag-launcher')] }),
      mkUnit('g1', GUEST, 0, 10, { count: 5 }),
      mkUnit('g2', GUEST, 0, 13, { count: 5 }),
    ]);
    const { out } = fire(state, undefined, [5]);
    const outcome = out.logEntry!.dice!.outcome;
    expect(outcome.hitCount).toBe(2);
    expect(outcome.blastSplash![0]).toMatchObject({ targetId: 'g2', hitCount: 1 });
    // The dice panel record: 1 hit x 3 = 3 hits, 2 to the target and 1 to the neighbour, none lost
    expect(outcome.blastSplits).toEqual([
      {
        weaponId: 'frag-launcher',
        weaponName: expect.any(String),
        multiplier: 3,
        totalHits: 3,
        shares: [
          { targetId: 'g1', targetName: expect.any(String), hits: 2, cap: 5 },
          { targetId: 'g2', targetName: expect.any(String), hits: 1, cap: 5 },
        ],
        lostHits: 0,
      },
    ]);
    expect(outcome.blastSplash![0].defenseRolls).toHaveLength(1);
  });

  it('records hits lost when every unit is at its cap', () => {
    // 2 hits x 3 = 6 Blast hits on a lone 4-model unit: 4 land, 2 are lost.
    const state = mkState([
      mkUnit('h1', HOST, 0, 0, { count: 2, weapons: [weapon('frag-launcher')] }),
      mkUnit('g1', GUEST, 0, 10, { count: 4 }),
    ]);
    const { out } = fire(state, undefined, [5, 5]);
    const split = out.logEntry!.dice!.outcome.blastSplits![0];
    expect(split).toMatchObject({ totalHits: 6, lostHits: 2 });
    expect(split.shares).toEqual([{ targetId: 'g1', targetName: expect.any(String), hits: 4, cap: 4 }]);
  });

  it('ignores cover for the target and for neighbours behind a wall', () => {
    // A wall right in front of both units gives them cover against a normal shot; Blast ignores it.
    const mk = (weaponId: string) =>
      mkState(
        [
          mkUnit('h1', HOST, 0, 0, { weapons: [weapon(weaponId)] }),
          mkUnit('g1', GUEST, 0, 10, { status: ['in-cover'] }),
          mkUnit('g2', GUEST, 0, 12, { status: ['in-cover'] }),
        ],
        []
      );
    // Defense 4 on D5: fails without cover; with cover (+1) it would block. Blast: both fail.
    const { out } = fire(mk('frag-launcher'), shootAt([{ weaponId: 'frag-launcher', targetId: 'g1' }]), [5], 4);
    const outcome = out.logEntry!.dice!.outcome;
    expect(outcome.coverApplied).toBe(false);
    expect(outcome.wounds).toBe(1);
    expect(outcome.blastSplash![0].wounds).toBe(1);
    expect(outcome.blastSplash![0].defenseModifiers ?? []).not.toContain('+1 Cover');
  });

  it('a surviving neighbour at half strength tests morale at the end of the activation', () => {
    const state = mkState([
      mkUnit('h1', HOST, 0, 0, { weapons: [weapon('frag-launcher')] }),
      mkUnit('g1', GUEST, 0, 10, { count: 6 }),
      mkUnit('g2', GUEST, 0, 12, { count: 6 }),
    ]);
    state.turnState.activeUnitId = 'h1';
    // 1 attack, 1 hit: 3 Blast hits split 2 / 1. The neighbour starts with 4 of 6 models.
    unitOf(state, 'g2').models.slice(0, 2).forEach((m) => {
      m.isDestroyed = true;
      m.wounds = 0;
    });
    unitOf(state, 'g2').wounds = 4;
    // Baseline is recorded when the activation began
    state.turnState.woundBaseline = { h1: 1, g1: 6, g2: 4 };
    let s = fire(state, undefined, [5]).out.state!;
    while (s.turnState.pendingReaction) {
      const r = s.turnState.pendingReaction;
      s = applyAction(
        s,
        createAction(r.promptingPlayerId, 'respond-reaction', {
          type: 'respond-reaction',
          reactionId: r.id,
          choiceId: PICK_CASUALTIES_AUTO_CHOICE,
        })
      ).state!;
    }
    // g2: 4 models left, 1 hit failed -> 3 left of 6 = half: it owes a test, g1 (6 -> 4) does not
    expect(unitOf(s, 'g2').models.filter((m) => !m.isDestroyed)).toHaveLength(3);
    const end = createAction(HOST, 'end-activation', { type: 'end-activation' });
    const specs = getDiceSpecs(s, end) ?? [];
    expect(specs.length).toBeGreaterThan(0);
    const done = applyAction(s, end, specs.map((sp) => roll(sp.purpose, Array(sp.count).fill(1))));
    expect(done.ok).toBe(true);
    const tests = done.logEntry!.dice!.outcome.moraleTests!;
    expect(tests.map((t) => t.unitId)).toEqual(['g2']);
    expect(unitOf(done.state!, 'g2').status).toContain('shaken');
  });
});

describe('two targets and weapon groups', () => {
  const duo = () =>
    mkUnit('h1', HOST, 0, 0, {
      weapons: [
        weapon('rifle', undefined, 'Rifle', 'r1'),
        weapon('carbine', undefined, 'Carbine', 'c1'),
        weapon('plasma-rifle', undefined, 'Plasma Rifle', 'p1'),
        weapon('rifle', undefined, 'Rifle', 'r2'),
      ],
    });
  const field = () => [
    duo(),
    mkUnit('g1', GUEST, -4, 10),
    mkUnit('g2', GUEST, 0, 10),
    mkUnit('g3', GUEST, 4, 10),
  ];

  it('two distinct targets are fine; a third is rejected by the host', () => {
    const state = mkState(field());
    const two = shootAt([
      { weaponId: 'r1', targetId: 'g1' },
      { weaponId: 'c1', targetId: 'g2' },
      { weaponId: 'p1', targetId: 'g1' },
    ]);
    expect(validateAction(state, two).valid).toBe(true);
    const three = shootAt([
      { weaponId: 'r1', targetId: 'g1' },
      { weaponId: 'c1', targetId: 'g2' },
      { weaponId: 'p1', targetId: 'g3' },
    ]);
    const res = validateAction(state, three);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/2 distinct targets/);
  });

  it('weapons sharing a name must all shoot the same target', () => {
    const state = mkState(field());
    const split = shootAt([
      { weaponId: 'r1', targetId: 'g1' },
      { weaponId: 'r2', targetId: 'g2' },
    ]);
    const res = validateAction(state, split);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/same target/);
    const together = shootAt([
      { weaponId: 'r1', targetId: 'g1' },
      { weaponId: 'r2', targetId: 'g1' },
      { weaponId: 'c1', targetId: 'g2' },
    ]);
    expect(validateAction(state, together).valid).toBe(true);
  });
});

describe('Indirect', () => {
  const mortar = () => mkUnit('h1', HOST, 0, 0, { weapons: [weapon('trench-mortar')] });
  const blocked = (shooter: Unit) =>
    mkState([shooter, mkUnit('g1', GUEST, 0, 10)], [wall(0, 5)]);
  const action = shootAt([{ weaponId: 'trench-mortar', targetId: 'g1' }]);

  it('fires without line of sight when the unit held (did not move)', () => {
    const state = blocked(mortar());
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('needs line of sight after the unit moved', () => {
    const shooter = mortar();
    shooter.hasMoved = true;
    const state = blocked(shooter);
    const res = validateAction(state, action);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/line of sight/i);
    // With a clear line, the moved mortar can fire
    const clear = mkState([{ ...mortar(), hasMoved: true }, mkUnit('g1', GUEST, 0, 10)]);
    expect(validateAction(clear, action).valid).toBe(true);
  });

  it('still needs range when it held', () => {
    const state = mkState([mortar(), mkUnit('g1', GUEST, 0, 40)]);
    expect(validateAction(state, action).reason).toMatch(/range/i);
  });

  it('firingModels follows the same rule', () => {
    const held = mortar();
    const moved = { ...mortar(), hasMoved: true };
    const target = mkUnit('g1', GUEST, 0, 10);
    expect(firingModels(blocked(held), held, target, held.weapons[0])).toHaveLength(1);
    expect(firingModels(blocked(moved), moved, target, moved.weapons[0])).toHaveLength(0);
  });

  it('has no -1 to hit after moving', () => {
    const mods = computeCombatModifiers(
      { quality: 4, weaponRules: ['indirect'], hasMoved: true, distance: 12 },
      { defense: 5 }
    );
    expect(mods.effectiveQuality).toBe(4);
    expect(mods.hitModifiers).toEqual([]);
  });
});
