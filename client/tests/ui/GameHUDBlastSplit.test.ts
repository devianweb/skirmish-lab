// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  createAction,
  createBlastSplitReaction,
  createInitialGameState,
  applyDefaultScenario,
  createBlankMap,
  BLAST_SPLIT_AUTO_CHOICE,
  BlastSplitData,
} from '@skirmish-lab/shared';
import { legacyScenarioTerrain } from '../../../shared/tests/fixtures/legacyScenarioTerrain';
import { startRoundOne } from '../../../shared/tests/fixtures/setupFlow';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

function scenarioState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, {
    customMap: { ...createBlankMap(), id: 'test-terrain', terrain: legacyScenarioTerrain() },
  });
  startRoundOne(state);
  return state;
}

function setup(localPlayerId: string, state: GameState) {
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state };
}

/** A pending Blast split on two guest units: 3 hits, caps 5 / 2, Auto 2 / 1. Returns the state and the host (shooter). */
function pausedBlast(blasts?: BlastSplitData['blasts']) {
  const state = scenarioState();
  const shooter = state.units.find((u) => u.ownerId === HOST)!;
  const [g1, g2] = state.units.filter((u) => u.ownerId === GUEST);
  state.turnState.activeUnitId = shooter.id;
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
  const data: BlastSplitData = {
    shoot: createAction(HOST, 'shoot', { type: 'shoot', attackerId: shooter.id, targetId: g1.id }),
    dice: [],
    blasts: blasts ?? [
      {
        allocIndex: 0,
        weaponId: 'frag-launcher',
        weaponName: 'Frag Launcher',
        totalHits: 3,
        participants: [
          { unitId: g1.id, unitName: g1.name, cap: 5 },
          { unitId: g2.id, unitName: g2.name, cap: 2 },
        ],
        auto: [2, 1],
      },
    ],
  };
  state.turnState.pendingReaction = createBlastSplitReaction('shot-1', g1.ownerId, shooter.id, g1.id, data);
  return { state, shooter, g1, g2 };
}

const counts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.sl-hud-blast-row strong')).map((e) => Number(e.textContent));
const click = (container: HTMLElement, selector: string) => (container.querySelector(selector) as HTMLElement).click();

describe('GameHUD: Blast split prompt', () => {
  it('shows the defender one stepper row per eligible unit, starting at the Auto split, with a running count', () => {
    const { state } = pausedBlast();
    const { container } = setup(GUEST, state);
    expect(container.querySelector('.sl-hud-reaction-title')?.textContent).toBe('Split Blast Hits');
    expect(container.querySelector('.sl-hud-reaction-timer')).toBeTruthy();
    expect(counts(container)).toEqual([2, 1]);
    expect(container.querySelector('.sl-hud-blast-count')?.textContent).toContain('3 of 3 hits assigned');
    expect(container.textContent).toContain('(max 5)');
    expect(container.textContent).toContain('(max 2)');
    expect(container.querySelector('button[data-action="blast-auto"]')).toBeTruthy();
    expect((container.querySelector('button[data-action="blast-confirm"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the steppers stay within 0 and the unit cap; an incomplete split disables Confirm', () => {
    const { state } = pausedBlast();
    const { container, controller } = setup(GUEST, state);
    // Row 2 has a cap of 2: a third hit cannot be added
    click(container, 'button[data-action="blast-step"][data-col="1"][data-delta="1"]');
    expect(counts(container)).toEqual([2, 2]);
    expect(container.querySelector('.sl-hud-blast-count')?.textContent).toContain('4 of 3 hits assigned');
    expect((container.querySelector('button[data-action="blast-confirm"]') as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('button[data-action="blast-step"][data-col="1"][data-delta="1"]') as HTMLButtonElement).disabled).toBe(true);
    click(container, 'button[data-action="blast-confirm"]');
    expect(controller.submitAction).not.toHaveBeenCalled();
    // Take one off the first unit: valid again
    click(container, 'button[data-action="blast-step"][data-col="0"][data-delta="-1"]');
    expect(counts(container)).toEqual([1, 2]);
    expect((container.querySelector('button[data-action="blast-confirm"]') as HTMLButtonElement).disabled).toBe(false);
    // A count never goes below zero
    click(container, 'button[data-action="blast-step"][data-col="1"][data-delta="-1"]');
    click(container, 'button[data-action="blast-step"][data-col="1"][data-delta="-1"]');
    expect(counts(container)).toEqual([1, 0]);
    expect((container.querySelector('button[data-action="blast-step"][data-col="1"][data-delta="-1"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Confirm sends the custom split as a blast-split action; Auto split puts the steppers back', () => {
    const { state } = pausedBlast();
    const { container, controller } = setup(GUEST, state);
    click(container, 'button[data-action="blast-step"][data-col="0"][data-delta="1"]');
    click(container, 'button[data-action="blast-step"][data-col="1"][data-delta="-1"]');
    expect(counts(container)).toEqual([3, 0]);
    click(container, 'button[data-action="blast-auto"]');
    expect(counts(container)).toEqual([2, 1]);
    click(container, 'button[data-action="blast-step"][data-col="0"][data-delta="1"]');
    click(container, 'button[data-action="blast-step"][data-col="1"][data-delta="-1"]');
    click(container, 'button[data-action="blast-confirm"]');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const sent = controller.submitAction.mock.calls[0][0];
    expect(sent.type).toBe('blast-split');
    expect(sent.actorId).toBe(GUEST);
    expect(sent.payload.splits).toEqual([[3, 0]]);
  });

  it('a salvo with two Blast weapons shows a split block per weapon', () => {
    const { state } = pausedBlast();
    const base = (state.turnState.pendingReaction!.data as unknown as BlastSplitData).blasts[0];
    const two = [
      { ...base, weaponName: 'Frag Launcher' },
      { ...base, allocIndex: 1, weaponId: 'trench-mortar', weaponName: 'Trench Mortar', totalHits: 4, auto: [2, 2] },
    ];
    const s2 = pausedBlast(two);
    const { container, controller } = setup(GUEST, s2.state);
    expect(container.querySelectorAll('.sl-hud-blast-weapon')).toHaveLength(2);
    expect(counts(container)).toEqual([2, 1, 2, 2]);
    click(container, 'button[data-action="blast-confirm"]');
    expect(controller.submitAction.mock.calls[0][0].payload.splits).toEqual([[2, 1], [2, 2]]);
  });

  it('the shooter only sees the waiting bar', () => {
    const { state } = pausedBlast();
    const { container } = setup(HOST, state);
    expect(container.querySelector('.sl-hud-reaction-waiting')?.textContent).toContain('Blast');
    expect(container.querySelector('button[data-action="blast-confirm"]')).toBeNull();
    expect(container.querySelector('button[data-action="blast-step"]')).toBeNull();
  });

  it('keeps the host timeout fallback as a plain Auto choice on the reaction', () => {
    const { state } = pausedBlast();
    expect(state.turnState.pendingReaction!.options.map((o) => o.id)).toEqual([BLAST_SPLIT_AUTO_CHOICE]);
  });
});
