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
    // Five units of the local player + five enemy units are listed with stats.
    expect(container.querySelectorAll('.sl-hud-unit:not(.enemy)').length).toBe(5);
    expect(container.querySelectorAll('.sl-hud-unit.enemy').length).toBe(5);
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
    const byLabel = (label: string) => buttons.find((b) => b.textContent?.startsWith(label))!;
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
    expect(container.textContent).toContain('Click a destination on the board');

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

  it('move flow: clamps destinations beyond remaining movement to the max movement radius (and stops before friendly fighters)', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const start = { ...unit.position };
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Move');
    // Moving sideways (+x) toward Warden Trooper 2 at (-4, 0, -12) stops in front of the fighter (~3.3")
    hud.handleBoardPick({ kind: 'position', position: { x: start.x + 20, y: 0, z: start.z } });
    expect(container.textContent).toContain('3.3" — 2.7" left');
    clickByText(container, 'Cancel');

    // Moving forward (+z) into open ground clamps to the full remaining movement radius (6.0")
    clickByText(container, 'Move');
    hud.handleBoardPick({ kind: 'position', position: { x: start.x, y: 0, z: start.z + 20 } });

    expect(container.textContent).toContain(`${unit.remainingMovement.toFixed(1)}" — all movement spent`);
    expect(container.textContent).toContain('Confirm');
    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    expect(controller.submitAction.mock.calls[0][0].payload.finalPosition).toEqual({
      x: start.x,
      y: 0,
      z: start.z + unit.remainingMovement,
    });
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

  it('hold and end-activation require confirmation too (Hold before acting, End Activation after)', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    // Before moving or attacking, Hold is shown instead of End Activation.
    expect(clickByText(container, 'End Activation')).toBeFalsy();
    clickByText(container, 'Hold');
    expect(container.textContent).toContain('holds position');
    clickByText(container, 'Confirm');
    expect(controller.submitAction.mock.calls[0][0].type).toBe('hold');

    // Once a unit has moved or attacked, End Activation is shown instead of Hold.
    const state2 = scenarioState();
    const other = state2.units.find((u) => u.ownerId === HOST && u.id !== unit.id)!;
    activateUnit(state2, HOST, other.id);
    other.hasMoved = true;
    hud.syncFromState(state2);

    expect(clickByText(container, 'Hold')).toBeFalsy();
    clickByText(container, 'End Activation');
    expect(container.textContent).toContain('End ');
    clickByText(container, 'Confirm');
    expect(controller.submitAction.mock.calls[1][0].type).toBe('end-activation');
  });

  it('allows switching to another unit while confirming an activation without clicking Cancel', () => {
    const state = scenarioState();
    const [u1, u2] = state.units.filter((u) => u.ownerId === HOST);
    const { hud, container, controller } = setup(HOST, state);

    hud.handleBoardPick({ kind: 'unit', unitId: u1.id });
    expect(container.textContent).toContain(`Activate ${u1.name}`);

    // Directly pick u2 without cancelling first:
    hud.handleBoardPick({ kind: 'unit', unitId: u2.id });
    expect(container.textContent).toContain(`Activate ${u2.name}`);
    clickByText(container, 'Confirm');

    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    expect(controller.submitAction.mock.calls[0][0].payload.unitId).toBe(u2.id);
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

  it('emits marker snapshots as the flow changes (including selection, attack range, and hover)', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const unitId = unit.id;
    const { hud, container } = setup(HOST, state);
    const snapshots: MarkerSnapshot[] = [];
    hud.onMarkers((markers) => snapshots.push(markers));

    // Selecting a unit for activation marks that unit immediately.
    hud.handleBoardPick({ kind: 'unit', unitId });
    expect(snapshots[snapshots.length - 1].selectedUnitId).toBe(unitId);

    clickByText(container, 'Confirm');
    const last = snapshots[snapshots.length - 1];
    expect(last.outcome).toBeNull();

    // With an active unit, selection is shown, but movement-range ring is ONLY shown when Move is hovered/clicked.
    const state2 = scenarioState();
    const active = state2.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.id === 'rifle')
    )!;
    activateUnit(state2, HOST, active.id);
    hud.syncFromState(state2);
    const withActive = snapshots[snapshots.length - 1];
    expect(withActive.selectedUnitId).toBe(active.id);
    expect(withActive.movementRangeUnitId).toBeNull();

    clickByText(container, 'Move');
    expect(snapshots[snapshots.length - 1].movementRangeUnitId).toBe(active.id);
    clickByText(container, 'Cancel');
    expect(snapshots[snapshots.length - 1].movementRangeUnitId).toBeNull();

    clickByText(container, 'Shoot');
    const targetingSnap = snapshots[snapshots.length - 1];
    expect(targetingSnap.attackRange).toEqual({ unitId: active.id, range: 24 });
    // Enemies within 24" and Line of Sight appear in reachableTargetIds.
    expect(targetingSnap.reachableTargetIds?.length).toBeGreaterThan(0);
  });

  it('auto-selects the target and jumps to confirmation when clicking Fight with only one enemy in melee range', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'melee')
    )!;
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    target.position = { x: attacker.position.x, y: 0, z: attacker.position.z + 1 };
    attacker.status = ['engaged'];
    target.status = ['engaged'];
    activateUnit(state, HOST, attacker.id);

    const { container, controller } = setup(HOST, state);

    clickByText(container, 'Fight');
    // Should skip manual targeting and go straight to confirmation for the single engaged enemy.
    expect(container.textContent).toContain(`strikes ${target.name}`);
    expect(container.textContent).toContain('Confirm');

    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    expect(controller.submitAction.mock.calls[0][0].type).toBe('fight');
    expect(controller.submitAction.mock.calls[0][0].payload.targetId).toBe(target.id);
  });

  it('renders an RTS-style unit data card above the action bar when a unit is active or selected', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state, HOST, unit.id);
    const { container } = setup(HOST, state);

    const card = container.querySelector('.sl-hud-datacard');
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain(unit.name);
    expect(card?.textContent).toContain(`Q${unit.quality}+`);
    expect(card?.textContent).toContain(`D${unit.defense}+`);
  });

  it('displays the room code in the top-right header when provided', () => {
    const controller = { submitAction: vi.fn() };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new GameHUD(container, {
      localPlayerId: HOST,
      roomCode: 'ABC-123',
      controller,
    });
    hud.show();
    hud.syncFromState(scenarioState());

    expect(container.querySelector('.sl-hud-room')?.textContent).toBe('Room: ABC-123');
  });
});
