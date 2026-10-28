// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  createAction,
  createInitialGameState,
  applyDefaultScenario,
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

function scenarioState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state);
  return state;
}

/** Make `playerId`'s unit `unitId` the active unit mid-activation. */
function activateUnit(state: GameState, playerId: string, unitId: string): void {
  const unit = state.units.find((u) => u.id === unitId)!;
  unit.isActivated = true;
  unit.status = unit.status.filter((s) => s !== 'stunned');
  state.turnState.activeUnitId = unitId;
  state.turnState.unitsActivatedThisRound.push(unitId);
  state.turnState.currentPlayerId = playerId;
  state.turnState.phase = 'activation';
}

function setup(localPlayerId: string = HOST, state: GameState = scenarioState()) {
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state };
}

function clickByText(root: HTMLElement, text: string): HTMLElement | null {
  const elements = Array.from(root.querySelectorAll('button, .sl-hud-unit'));
  const found = elements.find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return found;
}

describe('GameHUD', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders round, turn, and unit info from confirmed state', () => {
    const { hud, container } = setup();
    hud.syncFromState({ ...scenarioState(), turnState: {
      ...scenarioState().turnState, roundNumber: 3,
    }});

    expect(container.textContent).toContain('Round 3');
    expect(container.textContent).toContain("Your turn");
    expect(container.textContent).toContain('Alice — Fighters');
    // Five units of the local player are listed with stats.
    expect(container.querySelectorAll('.sl-hud-unit').length).toBe(5);
    expect(container.textContent).toContain('Q4+');
  });

  it("shows whose turn it is when it's the opponent's turn", () => {
    const state = scenarioState();
    state.turnState.currentPlayerId = GUEST;
    const { container } = setup(HOST, state);
    expect(container.textContent).toContain("Bob's turn");
  });

  it('lists only activatable units as clickable during my turn (routed excluded)', () => {
    const state = scenarioState();
    const routed = state.units.find((u) => u.ownerId === HOST)!;
    routed.status = ['routed'];
    const { container } = setup(HOST, state);

    const activatable = container.querySelectorAll('.sl-hud-unit.activatable');
    expect(activatable.length).toBe(4); // routed unit excluded
  });

  it('requires confirmation before any action is submitted', () => {
    const { hud, container, controller, state } = setup();
    const unitId = state.units.find((u) => u.ownerId === HOST)!.id;

    // Select a unit via a board pick — must show a confirmation first.
    hud.handleBoardPick({ kind: 'unit', unitId });

    expect(container.textContent).toContain('Confirm');
    expect(controller.submitAction).not.toHaveBeenCalled(); // nothing sent yet

    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('activate-unit');
    expect(action.payload).toEqual({ type: 'activate-unit', unitId });
    expect(action.actorId).toBe(HOST);
  });

  it('ignores enemy units when selecting for activation', () => {
    const { hud, controller, container } = setup();
    const enemy = scenarioState().units.find((u) => u.ownerId === GUEST)!;

    hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });

    expect(container.textContent).not.toContain('Confirm');
    expect(controller.submitAction).not.toHaveBeenCalled();
  });

  it('shows the action bar with legal actions for the active unit', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state, HOST, unit.id);
    const { container } = setup(HOST, state);

    expect(container.textContent).toContain(unit.name);
    const move = clickByText(container, 'Move') as HTMLButtonElement;
    const shoot = container.querySelectorAll('button')[0];
    expect(move).toBeTruthy();
    expect(shoot.disabled).toBe(false);
  });

  it('disables move and shoot while engaged, enabling fight', () => {
    const state = scenarioState();
    const unit = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'melee')
    )!;
    activateUnit(state, HOST, unit.id);
    unit.status = ['engaged'];
    const { container } = setup(HOST, state);

    const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
    const byLabel = (label: string) => buttons.find((b) => b.textContent === label)!;
    expect(byLabel('Move').disabled).toBe(true);
    expect(byLabel('Shoot').disabled).toBe(true);
    expect(byLabel('Fight').disabled).toBe(false);
    expect(byLabel('Charge').disabled).toBe(true);
  });

  it('move flow: destination pick → distance summary → confirmed action with path', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const start = { ...unit.position };
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Move');
    expect(container.textContent).toContain('Select a destination');

    const destination = { x: start.x + 3, y: 0, z: start.z + 4 }; // 5" away
    hud.handleBoardPick({ kind: 'position', position: destination });

    expect(container.textContent).toContain('5.0"');
    expect(controller.submitAction).not.toHaveBeenCalled();

    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('move-unit');
    expect(action.payload.path).toEqual([start, destination]);
  });

  it('move flow: refuses destinations beyond remaining movement without confirming', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const start = { ...unit.position };
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Move');
    hud.handleBoardPick({ kind: 'position', position: { x: start.x + 20, y: 0, z: start.z } });

    expect(container.textContent).toContain('Too far');
    expect(container.textContent).not.toContain('Confirm');
    expect(controller.submitAction).not.toHaveBeenCalled();
  });

  it('shoot flow: enemy target in range → confirmed action with weapon', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.id === 'rifle')
    )!;
    activateUnit(state, HOST, attacker.id);
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    target.position = { x: attacker.position.x, y: 0, z: attacker.position.z + 10 };
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Shoot');
    hud.handleBoardPick({ kind: 'unit', unitId: target.id });

    expect(container.textContent).toContain('fires Rifle at');
    clickByText(container, 'Confirm');

    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('shoot');
    expect(action.payload).toEqual({
      type: 'shoot',
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: 'rifle',
    });
  });

  it('shoot flow: out-of-range target is refused locally', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'ranged')
    )!;
    activateUnit(state, HOST, attacker.id);
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    target.position = { x: attacker.position.x, y: 0, z: attacker.position.z + 30 }; // beyond 24"
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Shoot');
    hud.handleBoardPick({ kind: 'unit', unitId: target.id });

    expect(container.textContent).toContain('Out of range');
    expect(controller.submitAction).not.toHaveBeenCalled();
  });

  it('hold and end-activation require confirmation too', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Hold');
    expect(container.textContent).toContain('holds position');
    clickByText(container, 'Confirm');
    expect(controller.submitAction.mock.calls[0][0].type).toBe('hold');

    // The hold resolved (state update arrives): simulate the confirmed state
    // where another unit is now mid-activation.
    const state2 = scenarioState();
    const other = state2.units.find((u) => u.ownerId === HOST && u.id !== unit.id)!;
    activateUnit(state2, HOST, other.id);
    hud.syncFromState(state2);

    clickByText(container, 'End Activation');
    expect(container.textContent).toContain('End ');
    clickByText(container, 'Confirm');
    expect(controller.submitAction.mock.calls[1][0].type).toBe('end-activation');
  });

  it('cancel returns to the idle flow without submitting anything', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const unitId = unit.id;
    const { hud, container, controller } = setup(HOST, state);

    hud.handleBoardPick({ kind: 'unit', unitId });
    clickByText(container, 'Cancel');
    expect(controller.submitAction).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Confirm');
  });

  it('prompts a stunned unit with a one-step Hold (clears stun) instead of normal activation', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    unit.status = ['stunned'];
    const { hud, container, controller } = setup(HOST, state);

    hud.handleBoardPick({ kind: 'unit', unitId: unit.id });
    expect(container.textContent).toContain('clears stun');
    clickByText(container, 'Confirm');

    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    expect(controller.submitAction.mock.calls[0][0].type).toBe('hold');
  });

  it('renders the latest dice resolution for both players (state-driven)', () => {
    const state = scenarioState();
    const attacker = state.units[0];
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    const action = createAction(HOST, 'shoot', {
      type: 'shoot',
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: 'rifle',
    });
    state.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
      dice: {
        rollId: action.id,
        specs: [
          { count: 1, sides: 6, purpose: 'to-hit' },
          { count: 1, sides: 6, purpose: 'defense' },
        ],
        results: [
          { rolls: [5], total: 5, finalTotal: 5, purpose: 'to-hit' },
          { rolls: [2], total: 2, finalTotal: 2, purpose: 'defense' },
        ],
        context: {
          attackerId: attacker.id,
          targetId: target.id,
          weaponId: 'rifle',
          actionId: action.id,
        },
        outcome: {
          attackCount: 1,
          hitCount: 1,
          blockedCount: 0,
          wounds: 1,
          targetDestroyed: false,
        },
      },
    });

    // The guest sees the same dice display from the same state.
    const { container } = setup(GUEST, state);
    expect(container.textContent).toContain('1 hit');
    expect(container.textContent).toContain('0 blocked');
    expect(container.textContent).toContain('1 wound');
  });

  it('surfaces host rejections and stops waiting', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Hold');
    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);

    hud.notifyRejected('Not your turn');
    expect(container.textContent).toContain('Action rejected: Not your turn');
    // Not stuck in waiting: a new action can be started.
    expect(container.textContent).toContain('Hold');
  });

  it('transitions directly to the action bar when submitAction synchronously calls syncFromState (host flow)', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const container = document.createElement('div');
    document.body.appendChild(container);

    let hud!: GameHUD;
    const controller = {
      submitAction: vi.fn((action) => {
        // Simulate host GameManager synchronously emitting the updated state:
        const next = JSON.parse(JSON.stringify(state)) as GameState;
        activateUnit(next, HOST, action.payload.unitId);
        hud.syncFromState(next);
      }),
    };
    hud = new GameHUD(container, { localPlayerId: HOST, controller });
    hud.show();
    hud.syncFromState(state);

    hud.handleBoardPick({ kind: 'unit', unitId: unit.id });
    clickByText(container, 'Confirm');

    // Must not get stuck on "Waiting for the host…" — action bar should be visible!
    expect(container.textContent).not.toContain('Waiting for the host');
    expect(container.querySelectorAll('.sl-hud-actions').length).toBe(1);
  });

  it('shows a game-over banner instead of the action bar', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state, HOST, unit.id);
    state.status = 'game-over';
    state.winner = GUEST;
    state.turnState.phase = 'game-over';
    const { container } = setup(HOST, state);

    expect(container.textContent).toContain('Defeat');
    expect(container.querySelectorAll('.sl-hud-actions').length).toBe(0);
  });

  it('emits marker snapshots as the flow changes', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const unitId = unit.id;
    const { hud, container } = setup(HOST, state);
    const snapshots: MarkerSnapshot[] = [];
    hud.onMarkers((markers) => snapshots.push(markers));

    // Selecting a unit for activation should mark it.
    hud.handleBoardPick({ kind: 'unit', unitId });
    clickByText(container, 'Confirm');

    const last = snapshots[snapshots.length - 1];
    expect(last.selectedUnitId).toBeNull(); // no active unit yet in stale state
    expect(last.outcome).toBeNull();

    // With an active unit, the marker snapshot reflects it.
    const state2 = scenarioState();
    const active = state2.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state2, HOST, active.id);
    hud.syncFromState(state2);
    const withActive = snapshots[snapshots.length - 1];
    expect(withActive.selectedUnitId).toBe(active.id);
  });
});
