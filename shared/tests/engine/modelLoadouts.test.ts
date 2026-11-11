import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, DiceSpec, GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { firingModels } from '../../src/engine/squadTargeting';
import { findMeleeWeapons, hasMeleeWeapon } from '../../src/engine/specialRules';
import { strikingModelCount } from '../../src/engine/unitGeometry';
import { PILE_IN_AUTO_CHOICE } from '../../src/engine/pileIn';
import { createUnitFromFighter, FighterDefinition } from '../../src/data/armies';
import { cloneGameState } from '../../src/gameState';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

// --- weapons -------------------------------------------------------------
const w = (id: string, name: string, type: 'ranged' | 'melee', attacks: number, range: number, rules: string[] = []): Weapon => ({
  id,
  weaponType: id,
  name,
  profile: { type, range, attacks, specialRules: rules },
  isEquipped: true,
});
const battleRifle = () => w('battle-rifle', 'Battle Rifle', 'ranged', 2, 24);
const grenadeLauncher = () => w('grenade-launcher', 'Grenade Launcher', 'ranged', 2, 24, ['blast(3)']);
const handWeapon = () => w('hand-weapon', 'Hand Weapon', 'melee', 6, 1);
const pistol = () => w('pistol', 'Pistol', 'ranged', 2, 12, ['assault']);
const sword = () => w('sword', 'Sword', 'melee', 2, 1);
const axe = () => w('axe', 'Axe', 'melee', 3, 1);
const counterBlade = () => w('counter-blade', 'Counter Blade', 'melee', 2, 1, ['counter']);

// --- fixtures ------------------------------------------------------------
interface UnitOpts {
  at?: Vector3;
  spots?: Vector3[];
  tough?: number;
  weapons: Weapon[];
  /** Weapon ids per model (omit for "every model carries everything"). */
  loadouts?: string[][];
  status?: Unit['status'];
  rules?: string[];
}

function mkUnit(id: string, ownerId: string, opts: UnitOpts): Unit {
  const spots = opts.spots ?? [opts.at ?? P(0, 0)];
  const tough = opts.tough ?? 1;
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { ...spots[0] },
    rotation: { x: 0, y: 0, z: 0 },
    status: opts.status ?? [],
    wounds: spots.length * tough,
    maxWounds: spots.length * tough,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models: spots.map((p, i) => ({
      id: `${id}-m${i}`,
      wounds: tough,
      maxWounds: tough,
      isDestroyed: false,
      position: { ...p },
      rotation: { x: 0, y: 0, z: 0 },
      ...(opts.loadouts ? { weaponIds: [...opts.loadouts[i]] } : {}),
    })),
    weapons: opts.weapons,
    specialRules: opts.rules ?? [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function mkState(units: Unit[], activeId = 'h1'): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = activeId;
  return state;
}

/** Server-style dice: every die of a purpose shows `values[purpose]` (default 1: misses, failed blocks). */
function diceFor(specs: DiceSpec[], values: Record<string, number | number[]> = {}): DiceResult[] {
  return specs.map((spec) => {
    const v = values[spec.purpose] ?? 1;
    const rolls = Array.isArray(v) ? Array.from({ length: spec.count }, (_, i) => v[i] ?? 1) : Array(spec.count).fill(v);
    const total = rolls.reduce((a: number, b: number) => a + b, 0);
    return { rolls, total, finalTotal: total, purpose: spec.purpose };
  });
}
const count = (specs: DiceSpec[] | null, purpose: string) => specs?.find((s) => s.purpose === purpose)?.count;
const unitOf = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;

// ===========================================================================
// Shooting
// ===========================================================================
describe('per-model loadouts: shooting', () => {
  // 3-model squad in a row: two Battle Rifles and one Grenade Launcher (the HDF Veterans pattern)
  const veterans = (extra: Partial<UnitOpts> = {}) => {
    const u = mkUnit('h1', HOST, {
      spots: [P(0, 0), P(1.2, 0), P(2.4, 0)],
      weapons: [battleRifle(), grenadeLauncher()],
      loadouts: [['battle-rifle'], ['battle-rifle'], ['grenade-launcher']],
      ...extra,
    });
    u.hasMoved = true; // keeps the shoot validation off the "start out of coherency" rule; the squad is coherent anyway
    return u;
  };
  const target = () => mkUnit('g1', GUEST, { spots: [P(0, 10), P(1.2, 10), P(2.4, 10), P(3.6, 10), P(4.8, 10), P(6, 10)], weapons: [sword()], tough: 5 });
  const shootBoth = () =>
    createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: [
        { weaponId: 'battle-rifle', targetId: 'g1' },
        { weaponId: 'grenade-launcher', targetId: 'g1' },
      ],
    } as any);

  it('fires A2 x 2 carriers with the Battle Rifle and A2 x 1 carrier with the Grenade Launcher', () => {
    const state = mkState([veterans(), target()]);
    const specs = getDiceSpecs(state, shootBoth())!;
    expect(count(specs, 'alloc_0_to-hit')).toBe(4);
    expect(count(specs, 'alloc_1_to-hit')).toBe(2);
  });

  it('Blast multiplies only the launcher hits', () => {
    const state = mkState([veterans(), target()]);
    const action = shootBoth();
    const specs = getDiceSpecs(state, action)!;
    const out = applyAction(state, action, diceFor(specs, { 'alloc_0_to-hit': 6, 'alloc_1_to-hit': 6, 'alloc_0_defense': 1, 'alloc_1_defense': 1 }));
    expect(out.ok).toBe(true);
    const [rifles, launcher] = out.logEntry!.dice!.outcome.allocations!;
    expect(rifles).toMatchObject({ weaponId: 'battle-rifle', attackCount: 4, hitCount: 4 });
    expect(launcher).toMatchObject({ weaponId: 'grenade-launcher', attackCount: 2, hitCount: 6 }); // 2 hits x Blast(3)
  });

  it('a single weapon allocation sizes the roll by its own carriers', () => {
    const state = mkState([veterans(), target()]);
    const action = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'grenade-launcher' } as any);
    expect(count(getDiceSpecs(state, action), 'to-hit')).toBe(2);
  });

  it('a carrier out of range does not add attacks', () => {
    const u = veterans();
    u.models[1].position = P(1.2, -30); // second Battle Rifle: 40" from the target, range 24"
    const state = mkState([u, target()]);
    const action = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'battle-rifle' } as any);
    expect(firingModels(state, u, unitOf(state, 'g1'), u.weapons[0])).toHaveLength(1);
    expect(count(getDiceSpecs(state, action), 'to-hit')).toBe(2); // 2 attacks x 1 carrier
  });

  it('a non-carrier in range does not fire a weapon it does not carry', () => {
    const u = veterans();
    // The launcher carrier is far away; the two rifle models are close: launcher has nobody who can fire it
    u.models[2].position = P(2.4, -30);
    const state = mkState([u, target()]);
    const action = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'grenade-launcher' } as any);
    expect(validateAction(state, action)).toMatchObject({ valid: false, reason: 'Target out of range' });
  });

  it('killing the launcher model removes the launcher: the host rejects an allocation for it', () => {
    const u = veterans();
    u.models[2].isDestroyed = true;
    u.wounds = 2;
    const state = mkState([u, target()]);
    const result = validateAction(state, shootBoth());
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/No living model carries Grenade Launcher/);
    // The rifles are unaffected
    const rifles = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'battle-rifle' } as any);
    expect(validateAction(state, rifles).valid).toBe(true);
    expect(count(getDiceSpecs(state, rifles), 'to-hit')).toBe(4);
  });

  it('losing one of two rifle models halves the rifle attacks', () => {
    const u = veterans();
    u.models[0].isDestroyed = true;
    const state = mkState([u, target()]);
    const rifles = createAction(HOST, 'shoot', { type: 'shoot', attackerId: 'h1', targetId: 'g1', weaponId: 'battle-rifle' } as any);
    expect(count(getDiceSpecs(state, rifles), 'to-hit')).toBe(2);
  });

  it('a unit without per-model loadouts is unchanged: every model fires every weapon', () => {
    const u = mkUnit('h1', HOST, { spots: [P(0, 0), P(1.2, 0), P(2.4, 0)], weapons: [battleRifle(), grenadeLauncher()] });
    u.hasMoved = true;
    const state = mkState([u, target()]);
    expect(count(getDiceSpecs(state, shootBoth()), 'alloc_0_to-hit')).toBe(6);
    expect(count(getDiceSpecs(state, shootBoth()), 'alloc_1_to-hit')).toBe(6);
  });
});

// ===========================================================================
// Melee
// ===========================================================================
describe('all-weapons melee', () => {
  const fightAction = (weaponId = 'hand-weapon') =>
    createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId } as any);
  const engage = (state: GameState) => {
    for (const u of state.units) u.status = [...u.status.filter((s) => s !== 'engaged'), 'engaged'];
    return state;
  };

  it('a Leader-style model strikes with A6 melee and A2 Assault pistol: 6 + 2', () => {
    const leader = mkUnit('h1', HOST, { at: P(0, 0), weapons: [handWeapon(), pistol()], tough: 9 });
    const foe = mkUnit('g1', GUEST, { at: P(0, 1.5), weapons: [sword()], tough: 30 });
    const state = engage(mkState([leader, foe]));
    const specs = getDiceSpecs(state, fightAction())!;
    expect(count(specs, 'to-hit')).toBe(6);
    expect(count(specs, 'w1-to-hit')).toBe(2);
    const out = applyAction(state, fightAction(), diceFor(specs, { 'to-hit': 6, 'w1-to-hit': 6 }));
    expect(out.ok).toBe(true);
    const outcome = out.logEntry!.dice!.outcome;
    expect(outcome.attackCount).toBe(8);
    expect(outcome.wounds).toBe(8); // melee-result totals sum every weapon
    expect(outcome.meleeStrikes!.map((m) => [m.weaponId, m.attackCount, m.wounds])).toEqual([
      ['hand-weapon', 6, 6],
      ['pistol', 2, 2],
    ]);
    expect(unitOf(out.state!, 'g1').wounds).toBe(22);
    expect(unitOf(out.state!, 'h1').status).toContain('fatigued');
  });

  it('fighting ignores which weapon the payload names: the unit still strikes with all of them', () => {
    const leader = mkUnit('h1', HOST, { at: P(0, 0), weapons: [handWeapon(), pistol()], tough: 9 });
    const foe = mkUnit('g1', GUEST, { at: P(0, 1.5), weapons: [sword()], tough: 30 });
    const state = engage(mkState([leader, foe]));
    expect(count(getDiceSpecs(state, fightAction('pistol')), 'w1-to-hit')).toBe(2);
    expect(count(getDiceSpecs(state, fightAction('pistol')), 'to-hit')).toBe(6);
  });

  it('a purely ranged weapon without Assault does not strike', () => {
    const leader = mkUnit('h1', HOST, { at: P(0, 0), weapons: [handWeapon(), battleRifle()], tough: 9 });
    const foe = mkUnit('g1', GUEST, { at: P(0, 1.5), weapons: [sword()] });
    const state = engage(mkState([leader, foe]));
    const specs = getDiceSpecs(state, fightAction())!;
    expect(specs.some((s) => s.purpose.startsWith('w1-'))).toBe(false);
  });

  describe('per weapon, only models within 3" count', () => {
    // m0 and m1 carry a Sword; m2 carries an Axe as well and stands far from the foe (or close, per test)
    const squad = (axeSpot: Vector3) =>
      mkUnit('h1', HOST, {
        spots: [P(0, 0), P(1.2, 0), axeSpot],
        weapons: [sword(), axe()],
        loadouts: [['sword'], ['sword'], ['sword', 'axe']],
      });
    const foe = () => mkUnit('g1', GUEST, { at: P(0, 1.5), weapons: [sword()], tough: 30 });

    it('a carrier within reach adds that weapon\'s attacks', () => {
      const state = engage(mkState([squad(P(2.4, 0)), foe()]));
      const specs = getDiceSpecs(state, fightAction('sword'))!;
      expect(count(specs, 'to-hit')).toBe(6); // 3 sword carriers x 2
      expect(count(specs, 'w1-to-hit')).toBe(3); // 1 axe carrier x 3
    });

    it('a carrier out of reach adds nothing, and a weapon with no carrier in reach rolls no dice', () => {
      const state = engage(mkState([squad(P(9, 0)), foe()]));
      const specs = getDiceSpecs(state, fightAction('sword'))!;
      expect(count(specs, 'to-hit')).toBe(4); // two sword carriers within reach
      expect(specs.some((s) => s.purpose.startsWith('w1-'))).toBe(false);
      expect(strikingModelCount(unitOf(state, 'h1'), unitOf(state, 'g1'), 'axe')).toBe(0);
      const out = applyAction(state, fightAction('sword'), diceFor(specs, { 'to-hit': 6 }));
      expect(out.ok).toBe(true);
      expect(out.logEntry!.dice!.outcome.meleeStrikes!.map((m) => m.weaponId)).toEqual(['sword']);
    });
  });

  it('a unit whose only melee weapon is carried by dead models cannot fight', () => {
    const u = mkUnit('h1', HOST, {
      spots: [P(0, 0), P(1.2, 0)],
      weapons: [sword(), axe()],
      loadouts: [['sword'], ['axe']],
    });
    u.models[0].isDestroyed = true; // the Sword carrier
    expect(findMeleeWeapons(u).map((x) => x.id)).toEqual(['axe']);
    u.models[1].isDestroyed = true;
    expect(hasMeleeWeapon(u)).toBe(false);
  });

  describe('charge: Counter first, then the rest', () => {
    const CHARGE = () =>
      createAction(HOST, 'charge', { type: 'charge', attackerId: 'h1', targetId: 'g1', path: [P(0, 0), P(0, 4)] } as any);
    const setup = (targetOpts: Partial<UnitOpts> = {}) =>
      mkState([
        mkUnit('h1', HOST, { at: P(0, 0), weapons: [handWeapon(), pistol()], tough: 9 }),
        mkUnit('g1', GUEST, { at: P(0, 5), weapons: [counterBlade(), sword(), pistol()], tough: 30, ...targetOpts }),
        mkUnit('h2', HOST, { at: P(-20, -20) }),
      ]);

    it('the charger strikes with every melee weapon, in order, after the Counter strike', () => {
      const state = setup();
      const specs = getDiceSpecs(state, CHARGE())!;
      expect(count(specs, 'counter0-to-hit')).toBe(2);
      expect(count(specs, 'to-hit')).toBe(6);
      expect(count(specs, 'w1-to-hit')).toBe(2);
      const out = applyAction(state, CHARGE(), diceFor(specs, { 'counter0-to-hit': 6, 'to-hit': 6, 'w1-to-hit': 6 }));
      expect(out.ok).toBe(true);
      const outcome = out.logEntry!.dice!.outcome;
      expect(outcome.counterStrikes).toHaveLength(1);
      expect(outcome.attackCount).toBe(8);
      expect(outcome.meleeStrikes!.map((m) => m.weaponId)).toEqual(['hand-weapon', 'pistol']);
      expect(unitOf(out.state!, 'h1').wounds).toBe(7); // the Counter strike
      expect(unitOf(out.state!, 'g1').wounds).toBe(22);
    });

    it('after a Counter strike the defender is offered all its non-Counter weapons, and strikes with each', () => {
      const state = setup();
      const specs = getDiceSpecs(state, CHARGE())!;
      const charged = applyAction(state, CHARGE(), diceFor(specs, { 'counter0-to-hit': 1, 'to-hit': 1, 'w1-to-hit': 1 }));
      expect(charged.ok).toBe(true);
      const pending = charged.state!.turnState.pendingReaction!;
      expect(pending.type).toBe('melee-retaliation');
      expect(pending.data?.weaponIds).toEqual(['sword', 'pistol']);
      const respond = createAction(GUEST, 'respond-reaction', { type: 'respond-reaction', reactionId: pending.id, choiceId: 'strike-back' });
      const backSpecs = getDiceSpecs(charged.state!, respond)!;
      expect(count(backSpecs, 'to-hit')).toBe(2); // Sword A2 x 1 model
      expect(count(backSpecs, 'w1-to-hit')).toBe(2); // Pistol A2 x 1 model
      expect(backSpecs.some((s) => s.purpose.startsWith('counter'))).toBe(false);
      const back = applyAction(charged.state!, respond, diceFor(backSpecs, { 'to-hit': 6, 'w1-to-hit': 6 }));
      expect(back.ok).toBe(true);
      const outcome = back.logEntry!.dice!.outcome;
      expect(outcome.meleeStrikes!.map((m) => [m.weaponId, m.attackCount])).toEqual([
        ['sword', 2],
        ['pistol', 2],
      ]);
      expect(outcome.attackCount).toBe(4);
      expect(outcome.wounds).toBe(4);
    });

    it('a defender that made no Counter strike strikes back with all its melee weapons, Counter ones included', () => {
      const state = setup({ status: ['fatigued'] }); // Fatigued: no Counter strike
      const specs = getDiceSpecs(state, CHARGE())!;
      expect(specs.some((s) => s.purpose.startsWith('counter'))).toBe(false);
      const charged = applyAction(state, CHARGE(), diceFor(specs));
      const pending = charged.state!.turnState.pendingReaction!;
      expect(pending.data?.weaponIds).toEqual(['counter-blade', 'sword', 'pistol']);
      const respond = createAction(GUEST, 'respond-reaction', { type: 'respond-reaction', reactionId: pending.id, choiceId: 'strike-back' });
      const backSpecs = getDiceSpecs(charged.state!, respond)!;
      expect(backSpecs.filter((s) => s.purpose.endsWith('to-hit')).map((s) => s.purpose)).toEqual(['to-hit', 'w1-to-hit', 'w2-to-hit']);
    });
  });

  describe('casualty pauses (dice rolled up front as an upper bound)', () => {
    // 5 chargers ringed round a lone Counter target at (0, 5); m3 and m4 carry an Axe on top of the Sword
    const RING = [-120, -60, 0, 60, 120].map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return P(Math.sin(rad), 5 - Math.cos(rad));
    });
    const setup = () =>
      mkState([
        mkUnit('h1', HOST, {
          spots: [0, 1, 2, 3, 4].map((i) => P(-2.4 + i * 1.2, 0)),
          weapons: [sword(), axe()],
          loadouts: [['sword'], ['sword'], ['sword'], ['sword', 'axe'], ['sword', 'axe']],
          tough: 1,
        }),
        mkUnit('g1', GUEST, { at: P(0, 5), weapons: [counterBlade()], tough: 40 }),
        mkUnit('h2', HOST, { at: P(-20, -20) }),
      ]);
    const squadCharge = (state: GameState) => {
      const starts = unitOf(state, 'h1').models.map((m) => m.position!);
      return createAction(HOST, 'charge', {
        type: 'charge',
        attackerId: 'h1',
        targetId: 'g1',
        path: [P(0, 0), P(0, 4)],
        modelPositions: RING,
        modelPaths: starts.map((s, i) => [s, RING[i]]),
      } as any);
    };
    const pick = (ids: string[]) => createAction(HOST, 'pick-casualties', { type: 'pick-casualties', unitId: 'h1', modelIds: ids } as any);
    const hits = { 'counter0-to-hit': 6, 'counter0-defense': 1, 'to-hit': 6, 'w1-to-hit': 6, defense: 1, 'w1-defense': 1 };

    function paused() {
      const state = setup();
      const specs = getDiceSpecs(state, squadCharge(state))!;
      // Dice for the full squad: 5 Sword carriers x 2 and 2 Axe carriers x 3
      expect(count(specs, 'to-hit')).toBe(10);
      expect(count(specs, 'w1-to-hit')).toBe(6);
      const out = applyAction(state, squadCharge(state), diceFor(specs, hits));
      expect(out.ok).toBe(true);
      expect(out.state!.turnState.pendingReaction!.type).toBe('pick-casualties');
      return out.state!;
    }

    it('losing both Axe carriers to the Counter strike drops the Axe strike and counts the surviving Sword carriers', () => {
      const resolved = applyAction(paused(), pick(['h1-m3', 'h1-m4']));
      expect(resolved.ok).toBe(true);
      const strikes = resolved.logEntry!.dice!.outcome.meleeStrikes!;
      expect(strikes.map((m) => [m.weaponId, m.attackCount])).toEqual([['sword', 6]]);
      expect(unitOf(resolved.state!, 'g1').wounds).toBe(34);
    });

    it('losing only Sword-only carriers keeps both weapons striking with the survivors', () => {
      const resolved = applyAction(paused(), pick(['h1-m0', 'h1-m1']));
      expect(resolved.ok).toBe(true);
      const strikes = resolved.logEntry!.dice!.outcome.meleeStrikes!;
      expect(strikes.map((m) => [m.weaponId, m.attackCount])).toEqual([
        ['sword', 6], // m2, m3, m4
        ['axe', 6], // m3, m4
      ]);
      expect(resolved.logEntry!.dice!.outcome.attackCount).toBe(12);
    });

    it('losing one Axe carrier lets the other strike with the Axe alone (the later weapon keeps its dice slot)', () => {
      const resolved = applyAction(paused(), pick(['h1-m0', 'h1-m3']));
      const strikes = resolved.logEntry!.dice!.outcome.meleeStrikes!;
      expect(strikes.map((m) => [m.weaponId, m.attackCount])).toEqual([
        ['sword', 6],
        ['axe', 3],
      ]);
    });
  });

  describe('pile-in strike', () => {
    it('rolls and resolves one batch per weapon once the defenders are placed', () => {
      const h1 = mkUnit('h1', HOST, {
        spots: [P(0, 0), P(1, 0), P(2, 0), P(3, 0)],
        weapons: [sword(), axe()],
        loadouts: [['sword', 'axe'], ['sword', 'axe'], ['sword'], ['sword']],
      });
      const g1 = mkUnit('g1', GUEST, { spots: [P(0, 9), P(1, 9), P(0.5, 10)], weapons: [sword()], tough: 30 });
      h1.speed = 4;
      h1.remainingMovement = 4;
      const state = mkState([h1, g1]);
      const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
      const charge = createAction(HOST, 'charge', {
        type: 'charge',
        attackerId: 'h1',
        targetId: 'g1',
        path: [P(0, 0), ends[0]],
        modelPositions: ends,
        modelPaths: h1.models.map((m, i) => [m.position!, ends[i]]),
      } as any);
      const charged = applyAction(state, charge, undefined);
      expect(charged.reason).toBeUndefined();
      expect(charged.state!.turnState.pendingReaction!.type).toBe('pile-in');
      const auto = createAction(GUEST, 'respond-reaction', {
        type: 'respond-reaction',
        reactionId: charged.state!.turnState.pendingReaction!.id,
        choiceId: PILE_IN_AUTO_CHOICE,
      });
      const specs = getDiceSpecs(charged.state!, auto)!;
      const swordDice = count(specs, 'to-hit')!;
      const axeDice = count(specs, 'w1-to-hit')!;
      expect(swordDice).toBeGreaterThan(0);
      expect(axeDice).toBeGreaterThan(0);
      const resolved = applyAction(charged.state!, auto, diceFor(specs, { 'to-hit': 6, 'w1-to-hit': 6 }));
      expect(resolved.ok).toBe(true);
      const strikes = resolved.logEntry!.dice!.outcome.meleeStrikes!;
      expect(strikes.map((m) => m.weaponId)).toEqual(['sword', 'axe']);
      expect(strikes[0].attackCount).toBe(swordDice);
      expect(strikes[1].attackCount).toBe(axeDice);
    });
  });
});

// ===========================================================================
// Data and serialization
// ===========================================================================
describe('FighterDefinition.modelLoadouts', () => {
  const def = (extra: Partial<FighterDefinition> = {}): FighterDefinition => ({
    id: 'test-vets',
    name: 'Test Vets',
    faction: 'test',
    points: 100,
    quality: 4,
    defense: 5,
    wounds: 1,
    speed: 6,
    modelType: 'trooper',
    modelCount: 3,
    weapons: ['rifle', 'frag-launcher'],
    modelLoadouts: [['rifle'], ['rifle'], ['frag-launcher']],
    specialRules: [],
    ...extra,
  });

  it('spawns models with their own weapon ids and a unit carrying the distinct union', () => {
    const unit = createUnitFromFighter(def(), HOST, 'army', P(0, 0));
    expect(unit.models.map((m) => m.weaponIds)).toEqual([['rifle'], ['rifle'], ['frag-launcher']]);
    expect(unit.weapons.map((x) => x.id)).toEqual(['rifle', 'frag-launcher']);
  });

  it('a definition without modelLoadouts leaves weaponIds absent (every model carries all)', () => {
    const unit = createUnitFromFighter(def({ modelLoadouts: undefined }), HOST, 'army', P(0, 0));
    expect(unit.models.every((m) => m.weaponIds === undefined)).toBe(true);
    expect(unit.weapons.map((x) => x.id)).toEqual(['rifle', 'frag-launcher']);
  });

  it('rejects a loadout list whose length is not the model count', () => {
    expect(() => createUnitFromFighter(def({ modelLoadouts: [['rifle']] }), HOST, 'army', P(0, 0))).toThrow(/modelLoadouts/);
  });

  it('Model.weaponIds survives a JSON round trip and a state clone', () => {
    const unit = createUnitFromFighter(def(), HOST, 'army', P(0, 0));
    const state = mkState([unit], unit.id);
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(round.units[0].models.map((m) => m.weaponIds)).toEqual([['rifle'], ['rifle'], ['frag-launcher']]);
    expect(cloneGameState(state).units[0].models.map((m) => m.weaponIds)).toEqual([['rifle'], ['rifle'], ['frag-launcher']]);
  });
});
