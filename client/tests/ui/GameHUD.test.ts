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
  hasLineOfSight,
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

function setup(
  localPlayerId: string = HOST,
  state: GameState = scenarioState(),
  options: { roomCode?: string } = {}
) {
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId, roomCode: options.roomCode, controller });
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

  it('disables maneuvers while engaged (no fight button, tabletop push-back separates units)', () => {
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
    expect(byLabel('Rush').disabled).toBe(true);
    expect(byLabel('Shoot').disabled).toBe(true);
    expect(byLabel('Charge').disabled).toBe(true);
    expect(buttons.some((b) => b.textContent?.startsWith('Fight'))).toBe(false);
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
    // Picking a destination in front of Warden Trooper 2 at (-4, 0, -12) shows remaining movement
    hud.handleBoardPick({ kind: 'position', position: { x: start.x + 3.3, y: 0, z: start.z } });
    expect(container.textContent).toContain('3.3" (max 6") · can shoot after moving');
    clickByText(container, 'Cancel');

    // Moving forward (+z) into open ground clamps to the full remaining movement radius (6.0")
    clickByText(container, 'Move');
    hud.handleBoardPick({ kind: 'position', position: { x: start.x, y: 0, z: start.z + 20 } });

    expect(container.textContent).toContain('6.0" (max 6") · can shoot after moving');
    expect(container.textContent).toContain('Confirm');
    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const submitted = controller.submitAction.mock.calls[0][0].payload;
    expect(submitted.path.length).toBeGreaterThanOrEqual(2);
    expect(submitted.finalPosition).toEqual(submitted.path[submitted.path.length - 1]);
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
      allocations: [{ weaponId: 'rifle', targetId: target.id }],
    });
  });

  it('shoot flow: fires multiple equipped ranged weapons in range', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'ranged')
    )!;
    // Add second ranged weapon
    attacker.weapons.push({
      id: 'pistol-sidearm',
      weaponType: 'pistol',
      name: 'Sidearm',
      isEquipped: true,
      profile: { type: 'ranged', range: 12, attacks: 2, specialRules: [] },
    });
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    target.position = { x: attacker.position.x, y: 0, z: attacker.position.z + 8 }; // within range 12 of both weapons

    activateUnit(state, HOST, attacker.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Shoot');
    hud.handleBoardPick({ kind: 'unit', unitId: target.id });

    expect(container.textContent).toContain('fires Hand Cannon & Sidearm');
    clickByText(container, 'Confirm');

    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('shoot');
    expect(action.payload.allocations).toEqual([
      { weaponId: 'handcannon', targetId: target.id },
      { weaponId: 'pistol-sidearm', targetId: target.id },
    ]);
  });

  it('shoot flow: split fire targeting allocates weapons independently to multiple distinct targets', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'ranged')
    )!;
    attacker.weapons.push({
      id: 'pistol-sidearm',
      weaponType: 'pistol',
      name: 'Sidearm',
      isEquipped: true,
      profile: { type: 'ranged', range: 12, attacks: 2, specialRules: [] },
    });
    const guestUnits = state.units.filter((u) => u.ownerId === GUEST);
    const targetA = guestUnits[0];
    const targetB = guestUnits[1];
    targetA.position = { x: attacker.position.x, y: 0, z: attacker.position.z + 8 };
    targetB.position = { x: attacker.position.x + 5, y: 0, z: attacker.position.z + 8 };

    activateUnit(state, HOST, attacker.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Shoot');
    // Verify weapon chips are rendered
    expect(container.textContent).toContain('Hand Cannon (12")');
    expect(container.textContent).toContain('Sidearm (12")');

    // Click target A -> default all to target A
    hud.handleBoardPick({ kind: 'unit', unitId: targetA.id });
    expect(container.textContent).toContain('fires Hand Cannon & Sidearm');

    // Now click the Sidearm chip to reassign it
    const sidearmChip = container.querySelector<HTMLButtonElement>('[data-weapon-id="pistol-sidearm"]')!;
    expect(sidearmChip).toBeDefined();
    sidearmChip.click();

    // Pick target B for Sidearm
    hud.handleBoardPick({ kind: 'unit', unitId: targetB.id });

    // Verify split fire summary
    expect(container.textContent).toContain('split fires');
    expect(container.textContent).toContain(targetA.name);
    expect(container.textContent).toContain(targetB.name);

    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('shoot');
    expect(action.payload.allocations).toEqual([
      { weaponId: 'handcannon', targetId: targetA.id },
      { weaponId: 'pistol-sidearm', targetId: targetB.id },
    ]);
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

  it('rush flow: destination pick up to double speed → distance summary → confirmed action', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const start = { ...unit.position };
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Rush');
    expect(container.textContent).toContain('Click a destination to Rush');

    // Rush forward 10" (speed is 6", double speed is 12")
    const destination = { x: start.x, y: 0, z: start.z + 10 };
    hud.handleBoardPick({ kind: 'position', position: destination });

    expect(container.textContent).toContain('Rush');
    expect(container.textContent).toContain('double move');
    expect(controller.submitAction).not.toHaveBeenCalled();

    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('rush');
    expect(action.payload.unitId).toBe(unit.id);
    expect(action.payload.path.length).toBeGreaterThanOrEqual(2);
  });

  it('charge flow: picks reachable enemy, shows auto-melee strike confirmation with dice preview', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'melee')
    )!;
    activateUnit(state, HOST, attacker.id);
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    // Position target 5" away (well within double speed of 12")
    target.position = { x: attacker.position.x, y: 0, z: attacker.position.z + 5 };
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Charge');
    expect(container.textContent).toContain('Click an enemy unit within charge range');

    hud.handleBoardPick({ kind: 'unit', unitId: target.id });

    expect(container.textContent).toContain('charges');
    expect(container.textContent).toContain('strikes with');
    expect(container.textContent).toContain('Hit Q');
    expect(container.textContent).toContain('Def D');
    expect(controller.submitAction).not.toHaveBeenCalled();

    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('charge');
    expect(action.payload.attackerId).toBe(attacker.id);
    expect(action.payload.targetId).toBe(target.id);
    expect(action.payload.weaponId).toBeDefined();
    expect(action.payload.path.length).toBeGreaterThanOrEqual(2);
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

  it('keeps Move and Shoot buttons enabled during incremental micro-moves within movement budget', () => {
    const state = scenarioState();
    const unit = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'ranged')
    )!;
    activateUnit(state, HOST, unit.id);
    // Unit has made a 2.5" micro-move, leaving 3.5" of movement
    unit.hasMoved = true;
    unit.remainingMovement = 3.5;
    unit.hasAttacked = false;
    unit.isRushing = false;
    const { hud, container } = setup(HOST, state);

    // Both Move and Shoot remain enabled
    const moveBtn = container.querySelector<HTMLButtonElement>('button[data-action="move"]');
    const shootBtn = container.querySelector<HTMLButtonElement>('button[data-action="shoot"]');
    const rushBtn = container.querySelector<HTMLButtonElement>('button[data-action="rush"]');
    expect(moveBtn).toBeTruthy();
    expect(moveBtn?.disabled).toBe(false);
    expect(shootBtn).toBeTruthy();
    expect(shootBtn?.disabled).toBe(false);
    // Cannot Rush after starting standard Advance
    expect(rushBtn?.disabled).toBe(true);

    // After movement budget is exhausted (remainingMovement = 0)
    const stateExhausted = scenarioState();
    const unitExhausted = stateExhausted.units.find((u) => u.id === unit.id)!;
    activateUnit(stateExhausted, HOST, unitExhausted.id);
    unitExhausted.hasMoved = true;
    unitExhausted.remainingMovement = 0;
    unitExhausted.hasAttacked = false;
    hud.syncFromState(stateExhausted);

    const moveBtnExhausted = container.querySelector<HTMLButtonElement>('button[data-action="move"]');
    const shootBtnExhausted = container.querySelector<HTMLButtonElement>('button[data-action="shoot"]');
    expect(moveBtnExhausted?.disabled).toBe(true);
    // Can still shoot!
    expect(shootBtnExhausted?.disabled).toBe(false);

    // In a rush: can move remaining budget, but cannot shoot
    const stateRush = scenarioState();
    const unitRush = stateRush.units.find((u) => u.id === unit.id)!;
    activateUnit(stateRush, HOST, unitRush.id);
    unitRush.hasMoved = true;
    unitRush.isRushing = true;
    unitRush.remainingMovement = 4.0;
    hud.syncFromState(stateRush);

    const moveBtnRush = container.querySelector<HTMLButtonElement>('button[data-action="move"]');
    const rushBtnRush = container.querySelector<HTMLButtonElement>('button[data-action="rush"]');
    const shootBtnRush = container.querySelector<HTMLButtonElement>('button[data-action="shoot"]');
    expect(moveBtnRush?.disabled).toBe(false);
    expect(rushBtnRush?.disabled).toBe(false);
    expect(shootBtnRush?.disabled).toBe(true);
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
    expect(container.textContent).toContain('1 unsaved wound');
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
    expect(targetingSnap.attackRange).toEqual({ unitId: active.id, range: 24, concentricRanges: [24] });
    // Enemies within 24" and Line of Sight appear in reachableTargetIds.
    expect(targetingSnap.reachableTargetIds?.length).toBeGreaterThan(0);
  });

  it('renders defender retaliation and 1" push-back notice in dice panel when charge combat resolves', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'melee')
    )!;
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    const action = createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: attacker.id,
      targetId: target.id,
      path: [{ x: 0, y: 0, z: 4 }],
      weaponId: 'blade',
    });

    state.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
      dice: {
        rollId: action.id,
        specs: [
          { count: 2, sides: 6, purpose: 'to-hit' },
          { count: 2, sides: 6, purpose: 'defense' },
          { count: 2, sides: 6, purpose: 'retaliation-to-hit' },
          { count: 2, sides: 6, purpose: 'retaliation-defense' },
        ],
        results: [
          { rolls: [5, 6], total: 11, finalTotal: 11, purpose: 'to-hit' },
          { rolls: [2, 1], total: 3, finalTotal: 3, purpose: 'defense' },
          { rolls: [6, 4], total: 10, finalTotal: 10, purpose: 'retaliation-to-hit' },
          { rolls: [5, 6], total: 11, finalTotal: 11, purpose: 'retaliation-defense' },
        ],
        context: {
          attackerId: attacker.id,
          targetId: target.id,
          weaponId: 'blade',
          actionId: action.id,
        },
        outcome: {
          attackCount: 2,
          hitCount: 2,
          blockedCount: 0,
          wounds: 2,
          targetDestroyed: false,
          targetShaken: true,
          pushedBack: true,
          retaliation: {
            weaponId: 'blade',
            weaponName: 'Blade',
            attackCount: 2,
            hitCount: 1,
            blockedCount: 1,
            wounds: 0,
            targetDestroyed: false,
            targetShaken: false,
            baseQuality: 4,
            effectiveQuality: 6,
            hitModifiers: ['Fatigued (need 6)'],
            baseDefense: 4,
            effectiveDefense: 4,
            defenseModifiers: [],
          },
        },
      },
    });

    const { container } = setup(HOST, state);
    expect(container.textContent).toContain('Defender Retaliation');
    expect(container.textContent).toContain('Charger pushed back 1" — both units Fatigued');
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

  it('toggles the terrain debug card and hoveredTerrainId marker with F9', () => {
    const state = scenarioState();
    const { hud, container } = setup(HOST, state);
    const emitted: MarkerSnapshot[] = [];
    hud.onMarkers((m) => emitted.push(m));

    // Hover over terrain-wall-north at (0, 0, 5) while F9 debugger is OFF (default)
    hud.handleBoardHover({
      kind: 'position',
      position: { x: 0, y: 0, z: 5 },
      terrainId: 'terrain-wall-north',
    });
    expect(container.querySelector('.sl-hud-terrain-debug')).toBeNull();
    expect(emitted.at(-1)?.hoveredTerrainId).toBeNull();

    // Press F9 to turn the terrain debugger ON
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));
    const debugCard = container.querySelector('.sl-hud-terrain-debug');
    expect(debugCard).toBeTruthy();
    expect(debugCard?.textContent).toContain('terrain-wall-north');
    expect(debugCard?.textContent).toContain('models/wall.glb');
    expect(debugCard?.textContent).toContain('3.00" × 0.50"');
    expect(emitted.at(-1)?.hoveredTerrainId).toBe('terrain-wall-north');

    // Press F9 again to turn it OFF
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));
    expect(container.querySelector('.sl-hud-terrain-debug')).toBeNull();
    expect(emitted.at(-1)?.hoveredTerrainId).toBeNull();
  });

  it('renders top alert banners when opponent or signaling disconnects', () => {
    const state = scenarioState();
    const { hud, container } = setup(HOST, state);
    expect(container.querySelector('.sl-hud-alert')).toBeNull();

    hud.setNetworkStatus({ peer: 'disconnected' });
    expect(container.querySelector('.sl-hud-alert-error')?.textContent).toContain('Opponent disconnected');
    expect(container.querySelector('.sl-hud-alert-error')?.textContent).toContain('Grace period: 5m');

    hud.setNetworkStatus({ peer: 'connected', signaling: 'reconnecting' });
    expect(container.querySelector('.sl-hud-alert-warn')?.textContent).toContain('Signaling disconnected');

    hud.setNetworkStatus({ signaling: 'connected' });
    expect(container.querySelector('.sl-hud-alert')).toBeNull();
  });

  it('freezes reaction timer display during peer disconnect and resumes upon reconnect', () => {
    const state = scenarioState();
    state.turnState.pendingReaction = {
      id: 'reaction-1',
      actionType: 'charge',
      promptingPlayerId: HOST,
      reactorUnitId: 'u1',
      activeUnitId: 'u2',
      durationMs: 15000,
      expiresAt: Date.now() + 15000,
      options: [{ id: 'opt1', label: 'Hold', isDefault: true }],
    };

    const { hud, container } = setup(HOST, state);
    const initialSec = parseInt(container.querySelector('.sl-hud-reaction-timer')?.textContent || '0', 10);
    expect(initialSec).toBeGreaterThanOrEqual(14);

    // Disconnect peer
    hud.setNetworkStatus({ peer: 'disconnected' });
    const frozenSec = parseInt(container.querySelector('.sl-hud-reaction-timer')?.textContent || '0', 10);

    // Calling update timer while disconnected still reports frozen remaining time
    (hud as any).updateReactionTimerDisplay();
    const stillFrozenSec = parseInt(container.querySelector('.sl-hud-reaction-timer')?.textContent || '0', 10);
    expect(stillFrozenSec).toBe(frozenSec);

    // Reconnect peer
    hud.setNetworkStatus({ peer: 'connected' });
    (hud as any).updateReactionTimerDisplay();
    const resumedSec = parseInt(container.querySelector('.sl-hud-reaction-timer')?.textContent || '0', 10);
    expect(resumedSec).toBe(frozenSec);
  });

  it('applies red team styling to Guest units and blue team styling to Host units', () => {
    const state = scenarioState();
    // From Host perspective: Host units are team-blue, Guest units are team-red
    const hostView = setup(HOST, state);
    expect(hostView.container.querySelectorAll('.sl-hud-unit.team-blue').length).toBe(5);
    expect(hostView.container.querySelectorAll('.sl-hud-unit.enemy.team-red').length).toBe(5);

    // From Guest perspective: Guest units are still team-red, Host enemy units are team-blue
    const guestView = setup(GUEST, state);
    expect(guestView.container.querySelectorAll('.sl-hud-unit.team-red:not(.enemy)').length).toBe(5);
    expect(guestView.container.querySelectorAll('.sl-hud-unit.enemy.team-blue').length).toBe(5);
  });

  it('renders trait tooltips with describeTrait explanations', () => {
    const state = scenarioState();
    const { container } = setup(HOST, state);
    const badges = Array.from(container.querySelectorAll('.sl-trait-badge'));
    expect(badges.length).toBeGreaterThan(0);
    // Every trait badge must have an explanatory title attribute
    for (const badge of badges) {
      expect(badge.getAttribute('title')).toBeTruthy();
      expect(badge.getAttribute('title')!.length).toBeGreaterThan(5);
    }
  });

  it('emits shootingDebugRay and renders shooting debug card when F9 is active during shoot targeting', () => {
    const state = scenarioState();
    const attacker = state.units.find(
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'ranged')
    )!;
    const enemy = state.units.find((u) => u.ownerId === GUEST)!;
    activateUnit(state, HOST, attacker.id);

    const { hud, container } = setup(HOST, state);
    const emitted: MarkerSnapshot[] = [];
    hud.onMarkers((m) => emitted.push(m));

    // Turn F9 ON
    hud.toggleTerrainDebug(true);
    expect(emitted.at(-1)?.debugActive).toBe(true);

    // Click Shoot
    clickByText(container, 'Shoot');
    expect(container.textContent).toContain('Select an enemy target');

    // Hover an enemy unit
    hud.handleBoardHover({ kind: 'unit', unitId: enemy.id });
    const lastMarker = emitted.at(-1);
    expect(lastMarker?.shootingDebugRay).toBeDefined();
    expect(lastMarker?.shootingDebugRay?.attackerId).toBe(attacker.id);
    expect(lastMarker?.shootingDebugRay?.targetId).toBe(enemy.id);

    // Inspector card shows shooting debug
    const debugCards = container.querySelectorAll('.sl-hud-terrain-debug');
    expect(debugCards.length).toBeGreaterThan(0);
    const shootingCard = Array.from(debugCards).find((c) =>
      c.textContent?.includes('Shooting Ray Debug (F9)')
    );
    expect(shootingCard).toBeTruthy();
    expect(shootingCard?.textContent).toContain('LoS:');
    expect(shootingCard?.textContent).toContain('Cover:');

    // Hover ground position instead
    hud.handleBoardHover({ kind: 'position', position: { x: 5, y: 0, z: 5 } });
    const groundMarker = emitted.at(-1);
    expect(groundMarker?.shootingDebugRay).toBeDefined();
    expect(groundMarker?.shootingDebugRay?.targetId).toBeUndefined();
    expect(groundMarker?.shootingDebugRay?.to.x).toBe(5);
  });

  it('renders reaction prompt dock with countdown and option buttons for defender', () => {
    const state = scenarioState();
    const charger = state.units.find((u) => u.ownerId === HOST)!;
    const defender = state.units.find((u) => u.ownerId === GUEST)!;

    state.turnState.pendingReaction = {
      id: 'reaction-123',
      type: 'melee-retaliation',
      promptingPlayerId: GUEST,
      sourceUnitId: charger.id,
      targetUnitId: defender.id,
      title: 'Melee Retaliation',
      description: `${charger.name} charged ${defender.name}! Strike back with Blade?`,
      warning: 'Striking back will make this unit Fatigued.',
      options: [
        { id: 'strike-back', label: 'Strike Back (Blade 2d6)', isDefault: true, style: 'primary' },
        { id: 'decline', label: 'Decline (Avoid Fatigue)', style: 'secondary' },
      ],
      expiresAt: Date.now() + 15000,
    };

    const { hud, controller, container } = setup(GUEST, state);

    // Defender sees reaction prompt
    expect(container.querySelector('.sl-hud-reaction')).toBeTruthy();
    expect(container.querySelector('.sl-hud-reaction-title')?.textContent).toBe('Melee Retaliation');
    expect(container.querySelector('.sl-hud-reaction-timer')?.textContent).toMatch(/\d+s/);
    expect(container.querySelector('.sl-hud-reaction-desc')?.textContent).toContain(
      `${charger.name} charged ${defender.name}`
    );
    expect(container.querySelector('.sl-hud-reaction-warning')?.textContent).toContain('Fatigued');

    const strikeBackBtn = container.querySelector(
      'button[data-reaction-choice="strike-back"]'
    ) as HTMLElement;
    const declineBtn = container.querySelector(
      'button[data-reaction-choice="decline"]'
    ) as HTMLElement;
    expect(strikeBackBtn).toBeTruthy();
    expect(declineBtn).toBeTruthy();

    // Clicking strike-back submits respond-reaction action
    strikeBackBtn.click();
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const submitted = controller.submitAction.mock.calls[0][0];
    expect(submitted.type).toBe('respond-reaction');
    expect(submitted.actorId).toBe(GUEST);
    expect(submitted.payload.reactionId).toBe('reaction-123');
    expect(submitted.payload.choiceId).toBe('strike-back');
  });

  it('renders waiting banner for opponent during reaction', () => {
    const state = scenarioState();
    const charger = state.units.find((u) => u.ownerId === HOST)!;
    const defender = state.units.find((u) => u.ownerId === GUEST)!;

    state.turnState.pendingReaction = {
      id: 'reaction-456',
      type: 'melee-retaliation',
      promptingPlayerId: GUEST,
      sourceUnitId: charger.id,
      targetUnitId: defender.id,
      title: 'Melee Retaliation',
      description: `${charger.name} charged ${defender.name}!`,
      options: [
        { id: 'strike-back', label: 'Strike Back' },
        { id: 'decline', label: 'Decline' },
      ],
      expiresAt: Date.now() + 12000,
    };

    // Host (the charger) views the HUD while Guest is deciding
    const { container } = setup(HOST, state);

    expect(container.querySelector('.sl-hud-reaction')).toBeNull();
    const waitingEl = container.querySelector('.sl-hud-reaction-waiting');
    expect(waitingEl).toBeTruthy();
    expect(waitingEl?.textContent).toContain('Waiting for opponent: Melee Retaliation');
    expect(waitingEl?.textContent).toMatch(/\d+s/);
  });

  it('renders reaction dice outcomes in dice panel for strike-back and decline', () => {
    const state = scenarioState();
    const charger = state.units.find((u) => u.ownerId === HOST)!;
    const defender = state.units.find((u) => u.ownerId === GUEST)!;

    // 1. Strike Back outcome:
    state.actionLog.push({
      action: createAction(GUEST, 'respond-reaction', {
        type: 'respond-reaction',
        reactionId: 'r1',
        choiceId: 'strike-back',
      }),
      status: 'accepted',
      dice: {
        rollId: 'r1',
        specs: [],
        results: [
          { purpose: 'to-hit', rolls: [6, 4] } as any,
          { purpose: 'defense', rolls: [5, 2] } as any,
        ],
        context: { attackerId: defender.id, targetId: charger.id },
        outcome: {
          hitCount: 1,
          blockedCount: 1,
          wounds: 0,
          pushedBack: true,
        },
      },
    });

    const { hud, container } = setup(HOST, state);
    expect(container.querySelector('.sl-hud-dice-title')?.textContent).toContain(
      `Defender Retaliation: ${defender.name} → ${charger.name}`
    );
    expect(container.querySelector('.sl-hud-pushback-notice')?.textContent).toContain(
      'Charger pushed back 1" — both units Fatigued'
    );

    // 2. Decline outcome:
    const declineState = scenarioState();
    declineState.actionLog.push({
      action: createAction(GUEST, 'respond-reaction', {
        type: 'respond-reaction',
        reactionId: 'r2',
        choiceId: 'decline',
      }),
      status: 'accepted',
      dice: {
        rollId: 'r2',
        specs: [],
        results: [],
        context: { attackerId: defender.id, targetId: charger.id },
        outcome: {
          hitCount: 0,
          blockedCount: 0,
          wounds: 0,
          pushedBack: true,
        },
      },
    });

    hud.syncFromState(declineState);
    expect(container.querySelector('.sl-hud-dice-title')?.textContent).toContain(
      `Retaliation Declined: ${defender.name} held ground`
    );
    expect(container.querySelector('.sl-hud-pushback-notice')?.textContent).toContain(
      'Defender declined retaliation (no Fatigue)'
    );
  });

  describe('Phase 7: Objectives & 4-Round Mission UI', () => {
    it('displays round number out of 4 and live objective score badges in header', () => {
      const state = scenarioState();
      state.turnState.roundNumber = 3;
      state.objectives = [
        { id: 'o1', name: 'Alpha', position: { x: -5, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o2', name: 'Bravo', position: { x: 5, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o3', name: 'Charlie', position: { x: 0, y: 0, z: 5 }, controllingPlayerId: GUEST, isContested: false },
        { id: 'o4', name: 'Delta', position: { x: 0, y: 0, z: -5 }, controllingPlayerId: null, isContested: true },
      ];

      const { container } = setup(HOST, state);

      const roundEl = container.querySelector('.sl-hud-round');
      expect(roundEl?.textContent).toBe('Round 3 / 4');

      const scoreEl = container.querySelector('.sl-hud-objectives-score');
      expect(scoreEl?.textContent).toContain('Objectives:');
      expect(scoreEl?.textContent).toContain('Host 2');
      expect(scoreEl?.textContent).toContain('Guest 1');
    });

    it('renders objective inspection datacard when hovering on or near an objective', () => {
      const state = scenarioState();
      state.objectives = [
        { id: 'alpha', name: 'Objective Alpha', position: { x: -10, y: 0, z: -4 }, controllingPlayerId: HOST, isContested: false },
      ];

      const { hud, container } = setup(HOST, state);

      // Even when a unit is active, hovering an objective inspects the objective
      activateUnit(state, HOST, state.units[0].id);

      // Hovering ground near Objective Alpha (within 3.0")
      hud.handleBoardHover({ kind: 'position', position: { x: -11, y: 0, z: -4 } });

      const card = container.querySelector('.sl-hud-datacard');
      expect(card?.textContent).toContain('Objective Alpha');
      expect(card?.textContent).toContain('Controlled by Host');
      expect(card?.textContent).toContain('3.0" control radius');
      expect(card?.textContent).toContain('Unit Presence:');
    });

    it('displays final objective score and breakdown on game over screen', () => {
      const state = scenarioState();
      state.status = 'game-over';
      state.turnState.phase = 'game-over';
      state.winner = HOST;
      state.endReason = 'Objective victory (3 to 1)';
      state.objectives = [
        { id: 'o1', name: 'Alpha', position: { x: -5, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o2', name: 'Bravo', position: { x: 5, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o3', name: 'Charlie', position: { x: 0, y: 0, z: 5 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o4', name: 'Delta', position: { x: 0, y: 0, z: -5 }, controllingPlayerId: GUEST, isContested: false },
      ];

      const { container } = setup(HOST, state);

      const modal = container.querySelector('.sl-hud-gameover');
      expect(modal).toBeTruthy();
      expect(modal?.querySelector('.sl-hud-gameover-reason')?.textContent).toBe('Objective victory (3 to 1)');
      expect(modal?.textContent).toContain('Final Objective Score');
      expect(modal?.textContent).toContain('Host: 3');
      expect(modal?.textContent).toContain('Guest: 1');
      expect(modal?.textContent).toContain('Alpha: Host');
      expect(modal?.textContent).toContain('Delta: Guest');
    });
  });

  it('escapes trait descriptions with quotes and angle brackets in HTML attributes', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    unit.weapons[0].profile.specialRules = ['sustained'];
    unit.specialRules = ['camouflaged'];
    activateUnit(state, HOST, unit.id);
    const { container } = setup(HOST, state);

    const badges = container.querySelectorAll('.sl-trait-badge');
    const titles = Array.from(badges).map((b) => b.getAttribute('title') ?? '');
    const sustainedTitle = titles.find((t) => t.includes('>9"'));
    expect(sustainedTitle).toBeDefined();
    expect(container.innerHTML).toContain('>9&quot;');
  });

  it('allows charging an enemy unit around an obstacle without direct Line of Sight', () => {
    const state = scenarioState();
    const attacker = state.units.find((u) => u.ownerId === HOST)!;
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    attacker.position = { x: 0, y: 0, z: 0 };
    target.position = { x: 0, y: 0, z: 5 };
    state.terrain = [
      {
        id: 'wall-1',
        terrainType: 'wall',
        position: { x: 0, y: 0, z: 2.5 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 2, z: 0.5 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      },
    ];
    activateUnit(state, HOST, attacker.id);
    const { hud, container } = setup(HOST, state);

    expect(hasLineOfSight(state, attacker, target)).toBe(false);

    clickByText(container, 'Charge');
    hud.handleBoardPick({ kind: 'unit', unitId: target.id });
    expect(container.textContent).toContain('charges');
    expect(container.textContent).toContain('into base contact');
  });

  it('positions disconnect alerts below header so lobby room code is not obscured', () => {
    const state = scenarioState();
    const { hud, container } = setup(HOST, state, { roomCode: 'ABC-123' });
    hud.setNetworkStatus({ peer: 'disconnected' });

    expect(container.textContent).toContain('Room: ABC-123');
    expect(container.textContent).toContain('Opponent disconnected');
    const alertsEl = container.querySelector('.sl-hud-alerts') as HTMLElement;
    expect(alertsEl).not.toBeNull();
  });

  it('renders data card with Toughness, Move, and Charge (double speed) columns without remaining movement', () => {
    const state = scenarioState();
    const leader = state.units.find((u) => u.ownerId === HOST && u.specialRules.some((r) => r.startsWith('resilient')))!;
    activateUnit(state, HOST, leader.id);
    const { container } = setup(HOST, state);

    const datacard = container.querySelector('.sl-hud-datacard');
    expect(datacard).toBeTruthy();
    expect(datacard?.textContent).toContain('Toughness');
    expect(datacard?.textContent).not.toContain('6.0" / 6"');
    // Leader speed is 6, charge is 12"
    expect(datacard?.textContent).toContain('6"');
    expect(datacard?.textContent).toContain('12"');
  });

  it('renders wound progress badge (e.g. 1/3 WT) for multi-wound units with damage below threshold', () => {
    const state = scenarioState();
    const boss = state.units.find((u) => u.specialRules.includes('resilient(3)'))!;
    boss.traumaTokens = 1;
    const { container } = setup(HOST, state);

    expect(container.textContent).toContain('1/3 WT');
    expect(container.textContent).not.toContain('+1W');
  });

  it('renders Rupture badge and reflects blockedRolls accurately in dice resolution log', () => {
    const state = scenarioState();
    const attacker = state.units.find((u) => u.ownerId === HOST)!;
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    attacker.specialRules = ['rupture'];

    state.actionLog.push({
      action: createAction('shoot', HOST, {
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: attacker.weapons[0].id,
      }),
      dice: {
        rollId: 'roll-1',
        specs: [],
        results: [
          { purpose: 'to-hit', rolls: [6, 5], total: 11, modifier: 0, finalTotal: 11 },
          { purpose: 'defense', rolls: [5, 5], total: 10, modifier: 0, finalTotal: 10 },
        ],
        context: {
          attackerId: attacker.id,
          targetId: target.id,
          actionId: 'action-1',
        },
        outcome: {
          attackCount: 2,
          hitCount: 2,
          blockedCount: 1,
          blockedRolls: [false, true], // First roll failed vs Rupture, second roll passed
          wounds: 1,
          targetDestroyed: false,
          effectiveQuality: 4,
          effectiveDefense: 5,
        },
      },
    });

    const { container } = setup(HOST, state);
    const diceEl = container.querySelector('.sl-hud-dice');
    expect(diceEl).toBeTruthy();
    expect(diceEl?.innerHTML).toContain('RUP');
    expect(diceEl?.textContent).toContain('Rupture');

    const defDice = diceEl?.querySelectorAll('.sl-die.def-fail, .sl-die.def-pass');
    expect(defDice?.length).toBe(2);
    // 1st die is def-fail, 2nd die is def-pass
    expect(defDice?.[0].classList.contains('def-fail')).toBe(true);
    expect(defDice?.[1].classList.contains('def-pass')).toBe(true);
  });

  it('uses double speed for charge range fan radius', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const { hud } = setup(HOST, state);
    const range = (hud as any).actionMaxRange(unit, 'charge');
    expect(range).toBe(unit.speed * 2);
  });

  describe('Phase 10C: Interactive Deployment HUD', () => {
    function deploymentState(): GameState {
      const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
      applyDefaultScenario(state, {
        hostArmyId: 'frontier-wardens-starter',
        guestArmyId: 'rust-raiders-starter',
        useDeploymentPhase: true,
      });
      return state;
    }

    it('renders deployment header badge and deployment prompt during deployment phase', () => {
      const state = deploymentState();
      const { container } = setup(HOST, state);

      expect(container.querySelector('.sl-hud-round')?.textContent).toContain('Deployment');
      expect(container.querySelector('.sl-hud-turn')?.textContent).toContain('Your turn to deploy');
      expect(container.querySelector('.sl-hud-deployment-bar')).toBeTruthy();
      expect(container.querySelector('.sl-hud-deploy-prompt')?.textContent).toContain('Deploying');
    });

    it('displays undeployed status tags on units and highlights deployable fighters', () => {
      const state = deploymentState();
      const { container } = setup(HOST, state);

      const hostRows = Array.from(container.querySelectorAll('.sl-hud-unit.team-blue'));
      expect(hostRows.length).toBe(4);

      // Patrol squad has drop-reserve
      const dropReserveRow = hostRows.find((r) => r.textContent?.includes('DROP RESERVE'));
      expect(dropReserveRow).toBeTruthy();

      // Standard and vanguard units show UNDEPLOYED or VANGUARD
      const deployableRow = hostRows.find((r) => r.classList.contains('deployable'));
      expect(deployableRow).toBeTruthy();
    });

    it('allows board picking within 12" zone, showing confirm bar and submitting deploy-unit', () => {
      const state = deploymentState();
      const { hud, controller, container } = setup(HOST, state);

      // Click at a valid host deployment position: x: 0, z: -12
      hud.handleBoardPick({
        kind: 'position',
        position: { x: 0, y: 0, z: -12 },
      });

      const confirmBar = container.querySelector('.sl-hud-confirm');
      expect(confirmBar).toBeTruthy();
      expect(confirmBar?.textContent).toContain('Deploy');

      // Click confirm
      const confirmBtn = container.querySelector('button[data-action="confirm"]') as HTMLButtonElement;
      confirmBtn.click();

      expect(controller.submitAction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'deploy-unit',
          actorId: HOST,
          payload: expect.objectContaining({
            position: { x: 0, y: 0, z: -12 },
          }),
        })
      );
    });

    it('rejects deployment outside 12" zone with toast error', () => {
      const state = deploymentState();
      const { hud, controller, container } = setup(HOST, state);

      // Host deployment zone is z: -18..-6; z: 0 is in the middle of the board
      hud.handleBoardPick({
        kind: 'position',
        position: { x: 0, y: 0, z: 0 },
      });

      expect(controller.submitAction).not.toHaveBeenCalled();
      const toast = container.querySelector('.sl-hud-toast');
      expect(toast?.textContent).toContain('outside');
    });

    it('emits deploymentZones marker data during deployment phase', () => {
      const state = deploymentState();
      const { hud } = setup(HOST, state);

      let emittedMarkers: MarkerSnapshot | null = null;
      hud.onMarkers((m) => {
        emittedMarkers = m;
      });

      (hud as any).emitMarkers();

      expect(emittedMarkers).toBeTruthy();
      expect(emittedMarkers!.deploymentZones).toBeTruthy();
      expect(emittedMarkers!.deploymentZones!.hostZone.maxZ).toBe(-6);
      expect(emittedMarkers!.deploymentZones!.guestZone.minZ).toBe(6);
    });
  });

  describe('Phase 11C: Traversal HUD Warnings & Casualty Allocation', () => {
    it('displays high drop warning in confirmation bar when dropping > 3.0"', () => {
      const state = scenarioState();
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: 0, y: 4.0, z: 0 };
      activateUnit(state, HOST, unit.id);
      const { hud, container } = setup(HOST, state);

      clickByText(container, 'Move');
      hud.handleBoardPick({ kind: 'position', position: { x: 2.0, y: 0, z: 0 } });

      expect(container.textContent).toContain('HIGH DROP');
      expect(container.textContent).toContain('Falling damage');
    });

    it('displays dangerous terrain hazard warning and allocates squad casualties', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      // Convert to multi-model squad
      squad.wounds = 2;
      squad.maxWounds = 2;
      squad.models = [
        { id: 'm1', name: 'Trooper 1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -3 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', name: 'Trooper 2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0.5, y: 0, z: -3 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);
      squad.position = { x: 0, y: 0, z: -3 };
      // toxic sludge is at (0, 0, 0)
      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Move');
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 0 } });
      hud.handleBoardPick({ kind: 'position', position: { x: 0.5, y: 0, z: 0 } });

      expect(container.textContent).toContain('DANGEROUS TERRAIN');
      expect(container.textContent).toContain('Hazard Casualty Priority');

      // Click Trooper 2 casualty chip
      const trooper2Btn = container.querySelector<HTMLButtonElement>('[data-casualty-model-id="m2"]');
      expect(trooper2Btn).toBeTruthy();
      trooper2Btn!.click();

      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.payload.casualtyModelIds).toEqual(['m2']);
    });

    it('rejects charge when target is on elevated ledge outside vertical melee reach (> 4.0")', () => {
      const state = scenarioState();
      const attacker = state.units.find((u) => u.ownerId === HOST)!;
      const target = state.units.find((u) => u.ownerId === GUEST)!;
      activateUnit(state, HOST, attacker.id);
      attacker.position = { x: 0, y: 0, z: 0 };
      target.position = { x: 1.0, y: 5.0, z: 0 }; // 5.0" tall ledge (> 4.0" reach)

      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Charge');
      hud.handleBoardPick({ kind: 'unit', unitId: target.id });

      expect(controller.submitAction).not.toHaveBeenCalled();
      const toast = container.querySelector('.sl-hud-toast');
      expect(toast?.textContent).toContain('outside vertical melee reach');
    });

    it('displays difficult terrain speed cap warning in move confirmation bar', () => {
      const state = scenarioState();
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: 0, y: 0, z: 0 };
      activateUnit(state, HOST, unit.id);
      // toxic sludge at (0, 0, 0) is isDifficult: true
      const { hud, container } = setup(HOST, state);

      clickByText(container, 'Move');
      hud.handleBoardPick({ kind: 'position', position: { x: 0.5, y: 0, z: 0.5 } });

      expect(container.textContent).toContain('Difficult Terrain: 6.0" speed cap');
    });

    it('stops rush preview at wall base and shows info banner when hovering elevated obstacle', () => {
      const state = scenarioState();
      state.terrain = [
        {
          id: 'plat1',
          type: 'building',
          name: 'Platform 1',
          position: { x: 0, y: 0, z: 8 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 2.5, z: 4 },
          isWalkable: true,
          elevation: 2.5,
        },
      ];
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: 0, y: 0, z: 0 };
      activateUnit(state, HOST, unit.id);
      const { hud, container } = setup(HOST, state);

      clickByText(container, 'Rush');
      expect(container.textContent).toContain('Click a destination to Rush');

      // Hover over destination on sheer platform (approx 8.4" away)
      hud.handleBoardHover({ kind: 'position', position: { x: 0, y: 2.5, z: 8 } });

      // Live hover info banner displayed
      const warningEl = container.querySelector('.sl-hud-move-warning') as HTMLElement;
      expect(warningEl.style.display).toBe('block');
      expect(warningEl.textContent).toContain('Rushing to wall base');
      expect(warningEl.textContent).toContain('Stops before sheer climb');

      // Path ends at the base of the wall (y = 0) on open ground
      const preview = (hud as any).movePathPreview;
      expect(preview.length).toBeGreaterThanOrEqual(2);
      const endPoint = preview[preview.length - 1];
      expect(endPoint.y).toBe(0);
      expect(endPoint.z).toBeGreaterThanOrEqual(5.8);
      expect(endPoint.z).toBeLessThanOrEqual(6.2);
    });

    it('stops rush destination at wall base and displays confirmation info badge when scaling sheer elevation', () => {
      const state = scenarioState();
      state.terrain = [
        {
          id: 'plat1',
          type: 'building',
          name: 'Platform 1',
          position: { x: 0, y: 0, z: 8 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 2.5, z: 4 },
          isWalkable: true,
          elevation: 2.5,
        },
      ];
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: 0, y: 0, z: 0 };
      activateUnit(state, HOST, unit.id);
      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Rush');
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 2.5, z: 8 } });

      // Toast feedback
      const toast = container.querySelector('.sl-hud-toast');
      expect(toast?.textContent).toContain('Rushed to wall base (sheer climb deferred to next turn)');

      // Info badge in confirmation bar
      const badge = container.querySelector('.sl-hud-warning-badge');
      expect(badge?.textContent).toContain('Rush to Obstacle');
      expect(badge?.textContent).toContain('sheer climb / crossing deferred to next turn');

      // Summary text
      expect(container.textContent).toContain('Stops at wall base; sheer climb deferred to next turn');

      // Confirm submits rush action stopping at wall base
      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('rush');
      const finalPos = action.payload.finalPosition;
      expect(finalPos.y).toBe(0);
      expect(finalPos.z).toBeGreaterThanOrEqual(5.8);
      expect(finalPos.z).toBeLessThanOrEqual(6.2);
    });

    it('allows climbing onto platform deck on turn 2 when starting from wall base', () => {
      const state = scenarioState();
      state.terrain = [
        {
          id: 'plat1',
          type: 'building',
          name: 'Platform 1',
          position: { x: 0, y: 0, z: 8 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 2.5, z: 4 },
          isWalkable: true,
          elevation: 2.5,
        },
      ];
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      // Starting from the base of the wall at (0, 0, 6)
      unit.position = { x: 0, y: 0, z: 6 };
      activateUnit(state, HOST, unit.id);
      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Rush');
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 2.5, z: 8 } });

      // Because the unit starts at the wall base, climbing 2.5" is within the 6.0" difficult terrain cap
      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('rush');
      const finalPos = action.payload.finalPosition;
      expect(finalPos.y).toBe(2.5);
    });

    it('displays gap jump risk warning in move confirmation bar when traversing platform gap > 1.0"', () => {
      const state = scenarioState();
      state.terrain = [
        {
          id: 'plat1',
          type: 'building',
          name: 'Platform 1',
          position: { x: -2, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 2.5, z: 2 },
          isWalkable: true,
          elevation: 2.5,
        },
        {
          id: 'plat2',
          type: 'building',
          name: 'Platform 2',
          position: { x: 2, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 2.5, z: 2 },
          isWalkable: true,
          elevation: 2.5,
        },
      ];
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: -2, y: 2.5, z: 0 };
      activateUnit(state, HOST, unit.id);
      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Move');
      hud.handleBoardPick({ kind: 'position', position: { x: 2, y: 2.5, z: 0 } });

      expect(container.textContent).toContain('GAP JUMP');
      expect(container.textContent).toContain(`Quality Q${unit.quality}+ check required`);

      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.payload.gapJump).toBeDefined();
      expect(action.payload.gapJump.gapDistance).toBe(4);
    });

    it('melee-consolidation reaction: picks destination, locks path preview on hover while confirming, and submits', () => {
      const state = scenarioState();
      const victor = state.units.find((u) => u.ownerId === HOST)!;
      victor.position = { x: 0, y: 0, z: 0 };
      state.turnState.pendingReaction = {
        id: 'rx-1',
        type: 'melee-consolidation',
        promptingPlayerId: HOST,
        title: 'Victory Consolidation',
        description: 'Move up to 3.0" in any direction, or stay put.',
        data: {
          unitId: victor.id,
          destroyedUnitId: 'enemy-1',
          maxDistance: 3.0,
        },
        options: [{ id: 'stay', label: 'Stay Put', style: 'secondary' }],
        deadline: Date.now() + 15000,
      };

      const { hud, container, controller } = setup(HOST, state);
      expect(container.textContent).toContain('Victory Consolidation');

      // Click destination 2" away
      const dest = { x: 2, y: 0, z: 0 };
      hud.handleBoardPick({ kind: 'position', position: dest });

      expect(container.textContent).toContain('Consolidate');
      expect(container.textContent).toContain('Confirm');

      let emittedMovePath: any = null;
      hud.onMarkers((markers) => {
        emittedMovePath = markers.movePath;
      });

      // Hover elsewhere (e.g. over the confirm button / board at x: -5)
      hud.handleBoardHover({ kind: 'position', position: { x: -5, y: 0, z: 0 } });

      // Path should remain locked to the picked destination (x: 2), not dragged to x: -5
      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('consolidate-move');
      expect(action.payload.unitId).toBe(victor.id);
      expect(action.payload.path[action.payload.path.length - 1].x).toBeCloseTo(2, 1);
    });

    it('objective card inspection respects horizontal and vertical cylinder bounds', () => {
      const state = scenarioState();
      state.objectives = [
        {
          id: 'obj-test',
          name: 'Objective Test',
          position: { x: 5, y: 0, z: 5 },
          controllingPlayerId: null,
          isContested: false,
        },
      ];

      const { hud, container } = setup(HOST, state);

      // Hover within 3" horizontal and <= 3" vertical -> shows card
      hud.handleBoardHover({ kind: 'position', position: { x: 6, y: 1.5, z: 5 } });
      expect(container.textContent).toContain('Objective Test');
      expect(container.textContent).toContain('Objective (3.0" control radius, ±3.0" vertical)');

      // Hover within 3" horizontal but > 3" vertical (e.g. elevated roof at y = 4.0) -> does not show card
      hud.handleBoardHover({ kind: 'position', position: { x: 6, y: 4.0, z: 5 } });
      expect(container.textContent).not.toContain('Objective Test');
    });

    it('displays squad model counts in friendly and enemy roster rows and DataCard', () => {
      const state = scenarioState();
      const friendlySquad = state.units.find((u) => u.ownerId === HOST)!;
      friendlySquad.name = 'Warden Patrol Squad';
      friendlySquad.models = [
        { id: 'fm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: -2, y: 0, z: -12 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'fm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: -1, y: 0, z: -12 }, rotation: { x: 0, y: 0, z: 0 } },
      ];

      const enemySquad = state.units.find((u) => u.ownerId === GUEST)!;
      enemySquad.name = 'Rust Runner Mob';
      enemySquad.models = [
        { id: 'em1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 2, y: 0, z: 12 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'em2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 3, y: 0, z: 12 }, rotation: { x: 0, y: 0, z: 0 } },
      ];

      const { hud, container } = setup(HOST, state);

      // Verify friendly roster displays active and total models
      const friendlyRow = container.querySelector(`[data-unit-id="${friendlySquad.id}"]`)!;
      expect(friendlyRow.textContent).toContain('Models: 2/2');

      // Verify enemy roster displays active and total models
      const enemyRow = container.querySelector(`[data-unit-id="${enemySquad.id}"]`)!;
      expect(enemyRow.textContent).toContain('Models: 2/2');

      // Inspect friendly squad -> DataCard
      hud.handleBoardHover({ kind: 'unit', unitId: friendlySquad.id });
      const dataCard = container.querySelector('.sl-hud-datacard')!;
      expect(dataCard.textContent).toContain('Models: 2/2');
      expect(dataCard.textContent).toContain('Models'); // Header column

      // Inflict a casualty on friendly model 1
      friendlySquad.models[0].isDestroyed = true;
      friendlySquad.models[0].wounds = 0;
      hud.syncFromState(state);

      const updatedFriendlyRow = container.querySelector(`[data-unit-id="${friendlySquad.id}"]`)!;
      expect(updatedFriendlyRow.textContent).toContain('Models: 1/2 (1 casualty)');
      expect(container.querySelector('.sl-hud-datacard')!.textContent).toContain('Models: 1/2 (1 casualty)');
    });

    it('sequential model placement enforces 2.0" coherency and submits staged positions', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.name = 'Warden Patrol Squad';
      squad.speed = 6;
      squad.remainingMovement = 6;
      squad.position = { x: 0, y: 0, z: -4 };
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);

      const { hud, container, controller } = setup(HOST, state);

      let lastMarkers: any = null;
      hud.onMarkers((m) => {
        lastMarkers = m;
      });

      // 1. Click Move -> activates Model 1 placement
      clickByText(container, 'Move');
      expect(container.textContent).toContain('Place Model 1 of 2 (Warden Patrol Squad) within 6"');

      // 2. Click to place Model 1 at (0, 0, -1) [3.0" move]
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -1 } });

      // Model 1 placed! Should now prompt for Model 2 and display coherency circle around Model 1
      expect(container.textContent).toContain('Place Model 2 of 2 within 2.0" coherency of placed models');
      expect(lastMarkers?.squadCoherency).toBeDefined();
      expect(lastMarkers?.squadCoherency?.positions).toHaveLength(1);
      expect(lastMarkers?.squadCoherency?.positions[0].z).toBeCloseTo(-1, 1);
      expect(lastMarkers?.squadCoherency?.radius).toBe(2.0);

      // 3. Try placing Model 2 at (0, 0, 3) (> 2.0" from Model 1 at z = -1)
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 3 } });
      // Should reject with toast
      expect(container.querySelector('.sl-hud-toast')?.textContent).toMatch(/exceeds 2" limit|coherency/i);
      expect(controller.submitAction).not.toHaveBeenCalled();

      // 4. Place Model 2 legally within 2.0" coherency at (1, 0, -1) [1.0" distance from Model 1]
      hud.handleBoardPick({ kind: 'position', position: { x: 1, y: 0, z: -1 } });

      // Both models placed -> enters confirmation
      expect(container.textContent).toContain('Move Warden Patrol Squad (2 models)');
      expect(container.textContent).toContain('Confirm');

      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('move-unit');
      expect(action.payload.modelPositions).toHaveLength(2);
      expect(action.payload.modelPositions[0]).toEqual({ x: 0, y: 0, z: -1 });
      expect(action.payload.modelPositions[1]).toEqual({ x: 1, y: 0, z: -1 });
      expect(action.payload.finalPosition.x).toBeCloseTo(0.5, 1);
      expect(action.payload.finalPosition.z).toBeCloseTo(-1, 1);
    });

    it('can reset sequential model placement midway through', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.name = 'Warden Patrol Squad';
      squad.position = { x: 0, y: 0, z: -4 };
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);

      const { hud, container } = setup(HOST, state);

      let lastMarkers: any = null;
      hud.onMarkers((m) => {
        lastMarkers = m;
      });

      clickByText(container, 'Move');
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -1 } });

      expect(container.textContent).toContain('Place Model 2 of 2');
      expect(container.querySelector('[data-action="reset-squad-move"]')).toBeTruthy();

      // Click Reset Placement
      const resetBtn = container.querySelector<HTMLButtonElement>('[data-action="reset-squad-move"]')!;
      resetBtn.click();

      // Should return to Model 1 placement
      expect(container.textContent).toContain('Place Model 1 of 2');
      expect(lastMarkers?.squadCoherency).toBeUndefined();
    });
  });
});
