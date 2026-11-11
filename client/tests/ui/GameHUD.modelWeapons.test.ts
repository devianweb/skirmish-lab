// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  STARTER_ARMIES,
  Unit,
  Vector3,
  createInitialGameState,
  createPickCasualtiesReaction,
  createUnitsFromStarterArmy,
} from '@skirmish-lab/shared';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

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
  const snapshots: MarkerSnapshot[] = [];
  hud.onMarkers((m) => snapshots.push(m));
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, snapshots };
}

function clickByText(root: HTMLElement, text: string): boolean {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return !!found;
}

const cardText = (root: HTMLElement) => root.querySelector('.sl-hud-datacard')?.textContent ?? '';

describe('which model carries which weapon (14C-3 PR 1E)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('unit data card', () => {
    it('lists the weapons per model by fixed number for a mixed squad', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id);
      const { container } = setup(HOST, state);
      const text = cardText(container);
      expect(text).toContain('Model 1: Rifle, Blade');
      expect(text).toContain('Model 2: Rifle, Blade');
      expect(text).toContain('Model 3: Blade, Frag Launcher');
    });

    it('shows a dead model as removed and does not renumber the others', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      mine.squad.models[1].isDestroyed = true;
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id);
      const { container } = setup(HOST, state);
      const text = cardText(container);
      expect(text).toContain('Model 1: Rifle, Blade');
      expect(text).toContain('Model 2: removed');
      expect(text).toContain('Model 3: Blade, Frag Launcher');
      expect(container.querySelector('.sl-hud-model-removed')).not.toBeNull();
    });

    it('keeps the plain weapon table for a unit whose models all carry the same weapons', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.leader.id);
      const { container } = setup(HOST, state);
      const text = cardText(container);
      expect(text).not.toContain('Model 1:');
      expect(text).toContain('Power Sword');
      expect(text).toContain('Assault Rifle');
    });

    it('the compact unit list on the left keeps the counts', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id, GUEST);
      const { container } = setup(HOST, state);
      const row = container.querySelector(`.sl-hud-unit[data-unit-id="${mine.squad.id}"]`) as HTMLElement;
      expect(row.textContent).toContain('2× Rifle');
      expect(row.textContent).not.toContain('Model 1:');
    });
  });

  describe('hovering a model', () => {
    it('shows that model\'s number and weapons on the hover card', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.leader.id, GUEST);
      const { hud, container } = setup(HOST, state);
      hud.handleBoardHover({ kind: 'unit', unitId: mine.squad.id, modelId: mine.squad.models[2].id });
      const hovered = container.querySelector('.sl-hud-hovered-model');
      expect(hovered?.textContent).toContain('Model 3');
      expect(hovered?.textContent).toContain('Blade, Frag Launcher');
    });

    it('uses the fixed number after an earlier model died', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      mine.squad.models[0].isDestroyed = true;
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.leader.id, GUEST);
      const { hud, container } = setup(HOST, state);
      hud.handleBoardHover({ kind: 'unit', unitId: mine.squad.id, modelId: mine.squad.models[1].id });
      expect(container.querySelector('.sl-hud-hovered-model')?.textContent).toContain('Model 2');
    });

    it('shows nothing extra for a unit whose models carry the same weapons', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 20), P(10, 20));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id, GUEST);
      const { hud, container } = setup(HOST, state);
      hud.handleBoardHover({ kind: 'unit', unitId: mine.leader.id, modelId: mine.leader.models[0].id });
      expect(container.querySelector('.sl-hud-hovered-model')).toBeNull();
    });
  });

  describe('shoot preview', () => {
    it('labels each aim line with the weapons that model fires', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 15), P(10, 15));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id);
      const { hud, container, snapshots } = setup(HOST, state);
      expect(clickByText(container, 'Shoot')).toBe(true);
      hud.handleBoardHover({ kind: 'unit', unitId: foe.squad.id });
      const lines = snapshots[snapshots.length - 1].aimLines!.lines;
      expect(lines.map((l) => l.label)).toEqual(['Rifle', 'Rifle', 'Frag Launcher']);
    });

    it('leaves a model that cannot see the target unlabelled', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 15), P(10, 15));
      mine.squad.models[0].position = P(0, -40);
      mine.squad.hasMoved = true;
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id);
      const { hud, container, snapshots } = setup(HOST, state);
      clickByText(container, 'Shoot');
      hud.handleBoardHover({ kind: 'unit', unitId: foe.squad.id });
      const lines = snapshots[snapshots.length - 1].aimLines!.lines;
      expect(lines[0].fires).toBe(false);
      expect(lines[0].label).toBeUndefined();
      expect(lines[2].label).toBe('Frag Launcher');
    });

    it('does not label lines for a unit whose models all carry the same weapons', () => {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 15), P(10, 15));
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.leader.id);
      const { hud, container, snapshots } = setup(HOST, state);
      clickByText(container, 'Shoot');
      hud.handleBoardHover({ kind: 'unit', unitId: foe.squad.id });
      const lines = snapshots[snapshots.length - 1].aimLines!.lines;
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => l.label === undefined)).toBe(true);
    });
  });

  describe('casualty prompt', () => {
    function pickState(): GameState {
      const mine = armyUnits(HOST, P(0, 0), P(10, 0));
      const foe = armyUnits(GUEST, P(0, 12), P(10, 12));
      foe.squad.models[0].isDestroyed = true; // Model 1 is gone: the rest keep numbers 2 and 3
      const state = baseState([mine.squad, mine.leader, foe.squad, foe.leader], mine.squad.id);
      state.turnState.pendingReaction = createPickCasualtiesReaction('act1', 0, foe.squad, mine.squad, {
        entry: { unitId: foe.squad.id, count: 1, remainingWounds: 0, applications: [] },
        rest: [],
        after: { kind: 'shoot', attackerId: mine.squad.id },
      });
      return state;
    }

    it('shows each model\'s fixed number and weapons next to its button', () => {
      const { container } = setup(GUEST, pickState());
      const chips = Array.from(container.querySelectorAll('[data-action="toggle-casualty-model"]')).map((c) => c.textContent ?? '');
      expect(chips).toHaveLength(2);
      expect(chips[0]).toContain('Model 2');
      expect(chips[0]).toContain('Rifle, Blade');
      expect(chips[1]).toContain('Model 3');
      expect(chips[1]).toContain('Blade, Frag Launcher');
    });
  });
});
