// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DiceResult,
  DiceSpec,
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  STARTER_ARMIES,
  Unit,
  Vector3,
  WEAPONS,
  applyAction,
  createAction,
  createInitialGameState,
  createUnitsFromStarterArmy,
  getDiceSpecs,
} from '@skirmish-lab/shared';
import { GameHUD } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

/** The TEST: Loadouts Check army's units, placed in a line facing each other. */
function armyUnits(ownerId: string, squadAt: Vector3, leaderAt: Vector3): { squad: Unit; leader: Unit } {
  const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-loadouts-army'], ownerId) as Unit[];
  const squad = units.find((u) => u.name.startsWith('Test Mixed Squad'))!;
  const leader = units.find((u) => u.name.startsWith('Test Two-Weapon Leader'))!;
  const place = (u: Unit, at: Vector3) => {
    u.position = { ...at };
    u.models.forEach((m, i) => (m.position = { x: at.x + i * 1.2, y: at.y, z: at.z }));
  };
  place(squad, squadAt);
  place(leader, leaderAt);
  return { squad, leader };
}

function baseState(units: Unit[], activeId: string, currentPlayer = HOST): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.units = units;
  state.terrain = [];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = currentPlayer;
  state.turnState.activeUnitId = activeId;
  for (const u of units) u.isActivated = u.id === activeId;
  state.turnState.unitsActivatedThisRound = [activeId];
  return state;
}

function setup(local: string, state: GameState) {
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: local, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container };
}

function clickByText(root: HTMLElement, text: string): boolean {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return !!found;
}

function diceFor(specs: DiceSpec[], value = 1): DiceResult[] {
  return specs.map((spec) => ({
    rolls: Array(spec.count).fill(value),
    total: value * spec.count,
    finalTotal: value * spec.count,
    purpose: spec.purpose,
  }));
}

const unitRow = (root: HTMLElement, id: string) => root.querySelector(`.sl-hud-unit[data-unit-id="${id}"]`) as HTMLElement;

describe('GameHUD per-model loadouts (14C-3 PR 1C)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('unit panel', () => {
    it('lists each weapon with how many living models carry it', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id, GUEST);
      const { container } = setup(HOST, state);
      const text = unitRow(container, mine.squad.id).textContent!;
      expect(text).toContain('2× Rifle');
      expect(text).toContain('1× Frag Launcher');
      expect(text).toContain('3× Blade');
    });

    it('drops the count when a carrier dies, and drops the weapon when its last carrier is gone', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      mine.squad.models[0].isDestroyed = true; // one of the two Rifle carriers
      mine.squad.models[2].isDestroyed = true; // the only Frag Launcher carrier
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id, GUEST);
      const { container } = setup(HOST, state);
      const text = unitRow(container, mine.squad.id).textContent!;
      expect(text).toContain('Rifle');
      expect(text).not.toContain('2× Rifle');
      expect(text).not.toContain('Frag Launcher');
      expect(text).toContain('Blade (A2)');
    });

    it('a lone model shows its weapons without a count', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id, GUEST);
      const { container } = setup(HOST, state);
      const text = unitRow(container, mine.leader.id).textContent!;
      expect(text).toContain('Power Sword');
      expect(text).toContain('Assault Rifle');
      expect(text).not.toMatch(/\d× Power Sword/);
    });
  });

  describe('shoot panel', () => {
    it('shows how many models fire each weapon at the chosen target, and offers only carried weapons', () => {
      const mine = armyUnits(HOST, P(0, 0), P(30, 0));
      const foe = armyUnits(GUEST, P(0, 25.6), P(30, 25.6));
      // a column facing the foe: the first Rifle carrier is just out of reach (24" from base edge), the rest are in
      mine.squad.models.forEach((m, i) => (m.position = P(0, i * 1.2)));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id);
      const { hud, container } = setup(HOST, state);
      clickByText(container, 'Shoot');
      expect(container.querySelector('[data-weapon-id="rifle"]')).not.toBeNull();
      expect(container.querySelector('[data-weapon-id="frag-launcher"]')).not.toBeNull();
      hud.handleBoardPick({ kind: 'unit', unitId: foe.squad.id });
      const rifleChip = container.querySelector('[data-weapon-id="rifle"]')!.textContent!;
      const launcherChip = container.querySelector('[data-weapon-id="frag-launcher"]')!.textContent!;
      expect(rifleChip).toContain('2× Rifle');
      expect(rifleChip).toContain('1 fire'); // only one of the two carriers reaches
      expect(launcherChip).toContain('1× Frag Launcher');
      expect(launcherChip).toContain('1 fire');
      expect(container.textContent).toContain('1× Rifle & 1× Frag Launcher');
    });

    it('does not offer a weapon whose carriers are all dead', () => {
      const mine = armyUnits(HOST, P(0, 0), P(30, 0));
      const foe = armyUnits(GUEST, P(0, 10), P(30, 10));
      mine.squad.models[2].isDestroyed = true; // the Frag Launcher carrier
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id);
      const { hud, container, controller } = setup(HOST, state);
      clickByText(container, 'Shoot');
      // one ranged weapon left: the single-weapon flow goes straight to the confirmation, with no launcher in it
      hud.handleBoardPick({ kind: 'unit', unitId: foe.squad.id });
      expect(container.querySelector('[data-weapon-id="frag-launcher"]')).toBeNull();
      expect(container.textContent).toContain('2× Rifle');
      expect(container.textContent).not.toContain('Frag Launcher');
      clickByText(container, 'Confirm');
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.payload.allocations).toEqual([{ weaponId: 'rifle', targetId: foe.squad.id }]);
    });
  });

  describe('melee UI', () => {
    it('charge: there is no weapon picker; the confirmation lists every melee weapon of the unit', () => {
      const mine = armyUnits(HOST, P(0, 0), P(0, 5));
      const foe = armyUnits(GUEST, P(0, 12), P(30, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.leader.id);
      mine.squad.position = P(-20, -20);
      mine.squad.models.forEach((m, k) => (m.position = P(-20 + k * 1.2, -20)));
      const { hud, container, controller } = setup(HOST, state);
      clickByText(container, 'Charge');
      expect(container.querySelector('[data-melee-weapon-id], .sl-hud-melee-weapon, select')).toBeNull();
      hud.handleBoardPick({ kind: 'unit', unitId: foe.squad.id });
      const text = container.textContent!;
      expect(text).toContain('strikes with Power Sword + Assault Rifle');
      expect(text).toMatch(/across Power Sword 2 \+ Assault Rifle 2/);
      clickByText(container, 'Confirm');
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('charge');
      expect(typeof action.payload.weaponId).toBe('string'); // still a valid id for compatibility
    });
  });

  describe('strike-back prompt', () => {
    it('lists every weapon the charged unit strikes back with', () => {
      const attacker = armyUnits(HOST, P(0, 0), P(30, 0));
      const defender = armyUnits(GUEST, P(0, 40), P(0, 5));
      const state = baseState([attacker.squad, attacker.leader, defender.squad, defender.leader], attacker.leader.id);
      // The squad is the charger here: one model charging the lone two-weapon leader
      attacker.squad.id = 'h-squad';
      state.turnState.activeUnitId = 'h-squad';
      attacker.squad.isActivated = true;
      attacker.squad.models = attacker.squad.models.slice(0, 1);
      const charge = createAction(HOST, 'charge', {
        type: 'charge',
        attackerId: 'h-squad',
        targetId: defender.leader.id,
        path: [P(0, 0), P(0, 4)],
      } as any);
      const specs = getDiceSpecs(state, charge)!;
      const out = applyAction(state, charge, diceFor(specs));
      expect(out.ok).toBe(true);
      const pending = out.state!.turnState.pendingReaction!;
      expect(pending.data?.weaponIds).toHaveLength(2);
      const { container } = setup(GUEST, out.state!);
      const prompt = container.textContent!;
      expect(prompt).toContain('Power Sword');
      expect(prompt).toContain('Assault Rifle');
      const strikeBack = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Strike Back'))!;
      expect(strikeBack.textContent).toContain('Power Sword + Assault Rifle');
    });
  });

  describe('dice panel and log', () => {
    it('shows one line per melee weapon with attacks, hits and wounds, and keeps the totals', () => {
      const mine = armyUnits(HOST, P(0, 0), P(0, 5));
      const foe = armyUnits(GUEST, P(0, 6.5), P(30, 20));
      mine.leader.status = ['engaged'];
      foe.squad.status = ['engaged'];
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.leader.id);
      const fight = createAction(HOST, 'fight', {
        type: 'fight',
        attackerId: mine.leader.id,
        targetId: foe.squad.id,
        weaponId: 'power-sword',
      } as any);
      const specs = getDiceSpecs(state, fight)!;
      const out = applyAction(state, fight, diceFor(specs, 6));
      expect(out.ok).toBe(true);
      const strikes = out.logEntry!.dice!.outcome.meleeStrikes!;
      expect(strikes.map((s) => s.weaponId)).toEqual(['power-sword', 'assault-rifle']);
      const { container } = setup(HOST, out.state!);
      const panel = container.querySelector('.sl-hud-dice')!.textContent!;
      for (const s of strikes) {
        expect(panel).toContain(`${s.weaponName}: ${s.attackCount} attacks, ${s.hitCount} hit`);
      }
      const total = out.logEntry!.dice!.outcome;
      expect(panel).toContain(`${total.hitCount} hit`); // totals still shown
      // the log repeats the per-weapon lines
      const log = container.querySelector('.sl-hud-log-entry')!.textContent!;
      expect(log).toContain('Power Sword: 2 attacks');
      expect(log).toContain('Assault Rifle: 2 attacks');
    });
  });

  it('keeps weapons of a normal squad (no loadouts) listed per model', () => {
    const u = armyUnits(HOST, P(0, 0), P(10, 0)).squad;
    delete u.models[0].weaponIds;
    delete u.models[1].weaponIds;
    delete u.models[2].weaponIds;
    u.weapons = [{ ...WEAPONS.rifle }];
    const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
    const state = baseState([u, foe.squad, foe.leader], u.id, GUEST);
    const { container } = setup(HOST, state);
    expect(unitRow(container, u.id).textContent).toContain('3× Rifle');
  });
});
