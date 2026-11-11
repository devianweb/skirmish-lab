import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { DiceResult, DiceSpec, GameState, Unit, Vector3, Weapon } from '../../src/gameTypes';
import { applyAction, getDiceSpecs } from '../../src/engine/actions';
import { PICK_CASUALTIES_AUTO_CHOICE } from '../../src/engine/casualties';

const HOST = 'host1';
const GUEST = 'guest1';
const P = (x: number, z: number): Vector3 => ({ x, y: 0, z });

const w = (id: string, type: 'ranged' | 'melee', attacks: number, range: number, rules: string[] = []): Weapon => ({
  id,
  weaponType: id,
  name: id,
  profile: { type, range, attacks, specialRules: rules },
  isEquipped: true,
});

function mkUnit(id: string, ownerId: string, spots: Vector3[], tough: number, weapons: Weapon[]): Unit {
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
    status: [],
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
    })),
    weapons,
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
  };
}

function mkState(units: Unit[]): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = 'h1';
  return state;
}

/** Every attack hits (6) and every defense roll fails (1), so each attack becomes a wound. */
function allHit(specs: DiceSpec[]): DiceResult[] {
  return specs.map((spec) => {
    const v = /to-hit$/.test(spec.purpose) ? 6 : 1;
    const rolls = Array(spec.count).fill(v);
    const total = rolls.reduce((a: number, b: number) => a + b, 0);
    return { rolls, total, finalTotal: total, purpose: spec.purpose };
  });
}

const pick = (unitId: string, modelIds: string[]) =>
  createAction(GUEST, 'pick-casualties', { type: 'pick-casualties', unitId, modelIds } as any);
const unitOf = (state: GameState, id: string) => state.units.find((u) => u.id === id)!;
const modelOf = (state: GameState, unitId: string, i: number) => unitOf(state, unitId).models[i];

/**
 * A 3-model Tough(3) squad takes 2 plain wounds and one Deadly(3) hit in one attack. Deadly first: the Deadly
 * hit kills an unhurt model (3 wounds) and the plain wounds land on another. Plain first would have wounded one
 * model twice and the Deadly hit then killed that same model, wasting most of its damage.
 */
const squad = (id: string) => mkUnit(id, GUEST, [P(0, 1.5), P(1.2, 1.5), P(2.4, 1.5)], 3, [w('sword', 'melee', 1, 1)]);

describe('Deadly weapons resolve first (shooting)', () => {
  const plain = () => w('plain', 'ranged', 2, 24);
  const deadly = () => w('deadly', 'ranged', 1, 24, ['deadly(3)']);
  const shoot = (order: Array<'plain' | 'deadly'>) =>
    createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: order.map((weaponId) => ({ weaponId, targetId: 'g1' })),
    } as any);
  const shooter = () => {
    const h1 = mkUnit('h1', HOST, [P(0, -10)], 1, [plain(), deadly()]);
    h1.hasMoved = true;
    return h1;
  };

  for (const order of [['plain', 'deadly'], ['deadly', 'plain']] as Array<Array<'plain' | 'deadly'>>) {
    it(`whatever the list order (${order.join(', ')}): the Deadly hit kills an unhurt model, the plain wounds land on another`, () => {
      const state = mkState([shooter(), squad('g1')]);
      const action = shoot(order);
      const out = applyAction(state, action, allHit(getDiceSpecs(state, action)!));
      expect(out.ok).toBe(true);
      // The squad survives, so its owner picks the casualty first
      expect(out.state!.turnState.pendingReaction?.type).toBe('pick-casualties');
      const done = applyAction(out.state!, pick('g1', ['g1-m0'])).state!;
      expect(modelOf(done, 'g1', 0).isDestroyed).toBe(true);
      expect(modelOf(done, 'g1', 1).wounds).toBe(1);
      expect(modelOf(done, 'g1', 2).wounds).toBe(3);
      expect(unitOf(done, 'g1').wounds).toBe(4);
    });
  }

  it('the log keeps the allocations in the order they were declared', () => {
    const state = mkState([shooter(), squad('g1')]);
    const action = shoot(['plain', 'deadly']);
    const out = applyAction(state, action, allHit(getDiceSpecs(state, action)!));
    expect(out.logEntry!.dice!.outcome.allocations!.map((a) => a.weaponId)).toEqual(['plain', 'deadly']);
  });

  it('the timeout pick (auto) replays in the same order', () => {
    const state = mkState([shooter(), squad('g1')]);
    const action = shoot(['plain', 'deadly']);
    const out = applyAction(state, action, allHit(getDiceSpecs(state, action)!));
    const auto = createAction(GUEST, 'respond-reaction', {
      type: 'respond-reaction',
      reactionId: out.state!.turnState.pendingReaction!.id,
      choiceId: PICK_CASUALTIES_AUTO_CHOICE,
    });
    const done = applyAction(out.state!, auto).state!;
    const g1 = unitOf(done, 'g1');
    expect(g1.models.filter((m) => m.isDestroyed)).toHaveLength(1);
    expect(g1.wounds).toBe(4);
  });

  it('with no Deadly weapon the order is unchanged', () => {
    const h1 = mkUnit('h1', HOST, [P(0, -10)], 1, [plain(), w('plain2', 'ranged', 1, 24)]);
    h1.hasMoved = true;
    const state = mkState([h1, squad('g1')]);
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: 'h1',
      allocations: [{ weaponId: 'plain', targetId: 'g1' }, { weaponId: 'plain2', targetId: 'g1' }],
    } as any);
    const out = applyAction(state, action, allHit(getDiceSpecs(state, action)!));
    const done = applyAction(out.state!, pick('g1', ['g1-m0'])).state!;
    // 3 plain wounds fill the picked model (it dies) and nothing else is hurt
    expect(unitOf(done, 'g1').wounds).toBe(6);
  });
});

describe('Deadly weapons resolve first (melee)', () => {
  const sword = () => w('sword', 'melee', 2, 1);
  const lance = () => w('lance', 'melee', 1, 1, ['deadly(3)']);

  for (const weapons of [['sword', 'lance'], ['lance', 'sword']]) {
    it(`a fight with melee weapons listed ${weapons.join(', ')}: the Deadly strike goes first`, () => {
      const list = weapons.map((id) => (id === 'sword' ? sword() : lance()));
      const state = mkState([mkUnit('h1', HOST, [P(0, 0)], 1, list), squad('g1')]);
      for (const u of state.units) u.status.push('engaged');
      const action = createAction(HOST, 'fight', { type: 'fight', attackerId: 'h1', targetId: 'g1', weaponId: weapons[0] } as any);
      const out = applyAction(state, action, allHit(getDiceSpecs(state, action)!));
      expect(out.ok).toBe(true);
      const done = applyAction(out.state!, pick('g1', ['g1-m0'])).state!;
      expect(modelOf(done, 'g1', 0).isDestroyed).toBe(true);
      expect(modelOf(done, 'g1', 1).wounds).toBe(1);
      expect(unitOf(done, 'g1').wounds).toBe(4);
      // Results stay in weapon order for the dice panel
      expect(out.logEntry!.dice!.outcome.meleeStrikes!.map((m) => m.weaponId)).toEqual(weapons);
    });
  }
});
