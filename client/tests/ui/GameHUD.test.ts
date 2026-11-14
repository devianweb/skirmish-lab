// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD, MarkerSnapshot, dangerousTerrainText } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  createAction,
  createInitialGameState,
  applyDefaultScenario,
  hasLineOfSight,
  createBlankMap,
  createPushReaction,
  PUSH_AUTO_CHOICE,
  PUSH_DECLINE_CHOICE,
  PUSH_CONFIRM_CHOICE,
  STARTER_ARMIES,
} from '@skirmish-lab/shared';
import { legacyScenarioTerrain } from '../../../shared/tests/fixtures/legacyScenarioTerrain';
import { startRoundOne } from '../../../shared/tests/fixtures/setupFlow';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

function scenarioState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, {
    customMap: {
      ...createBlankMap(),
      id: 'test-terrain',
      terrain: legacyScenarioTerrain(),
    },
  }); startRoundOne(state);
  return state;
}

/** Make `playerId`'s unit `unitId` the active unit mid-activation. */
function activateUnit(state: GameState, playerId: string, unitId: string): void {
  const unit = state.units.find((u) => u.id === unitId)!;
  unit.isActivated = true;
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

/** Test fixtures move `unit.position`; keep a lone model standing on it (rules measure per model). */
function syncModels(unit: { position: { x: number; y: number; z: number }; models?: Array<{ position?: any }> }): void {
  for (const m of unit.models ?? []) m.position = { ...unit.position };
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
    // Four Human Defense Force units of the local player + five Orc Marauders enemy units are listed with stats.
    expect(container.querySelectorAll('.sl-hud-unit:not(.enemy)').length).toBe(4);
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
    expect(activatable.length).toBe(3); // routed unit excluded
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
    const move = clickByText(container, 'Advance') as HTMLButtonElement;
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
    expect(byLabel('Advance').disabled).toBe(true);
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

    clickByText(container, 'Advance');
    expect(container.textContent).toContain('Click a destination on the board');

    const destination = { x: start.x + 3, y: 0, z: start.z + 4 }; // 5" away
    hud.handleBoardPick({ kind: 'position', position: destination });

    expect(container.textContent).toContain('5.0"');
    expect(controller.submitAction).not.toHaveBeenCalled();

    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('advance');
    expect(action.payload.path).toEqual([start, destination]);
  });

  it('move flow: clamps destinations beyond remaining movement to the max movement radius (and stops before friendly fighters)', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    const start = { ...unit.position };
    activateUnit(state, HOST, unit.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Advance');
    // Picking the spot of the nearest friendly model clamps movement 1" (two base radii) short of it
    const friend = state.units.find((u) => u.ownerId === HOST && u.id !== unit.id)!;
    const nearest = friend.models
      .map((m) => m.position!)
      .sort((p, q) => Math.hypot(p.x - start.x, p.z - start.z) - Math.hypot(q.x - start.x, q.z - start.z))[0];
    const gap = Math.hypot(nearest.x - start.x, nearest.z - start.z) - 1;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(6);
    hud.handleBoardPick({ kind: 'position', position: { x: nearest.x, y: 0, z: nearest.z } });
    const clamped = Number(/([0-9.]+)" \(max 6"\) · can shoot after moving/.exec(container.textContent!)![1]);
    expect(clamped).toBeGreaterThan(0);
    expect(clamped).toBeLessThanOrEqual(gap + 0.05); // stops short of the friendly model
    clickByText(container, 'Cancel');

    // Moving forward (+z) into open ground clamps to the full remaining movement radius (6.0")
    clickByText(container, 'Advance');
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
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.id === 'pistol')
    )!;
    activateUnit(state, HOST, attacker.id);
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    target.position = { x: attacker.position.x, y: 0, z: attacker.position.z + 10 };
    syncModels(target);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Shoot');
    hud.handleBoardPick({ kind: 'unit', unitId: target.id });

    expect(container.textContent).toContain('fires Pistol at');
    clickByText(container, 'Confirm');

    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('shoot');
    expect(action.payload).toEqual({
      type: 'shoot',
      attackerId: attacker.id,
      targetId: target.id,
      weaponId: 'pistol',
      allocations: [{ weaponId: 'pistol', targetId: target.id }],
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
    syncModels(target);

    activateUnit(state, HOST, attacker.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Shoot');
    hud.handleBoardPick({ kind: 'unit', unitId: target.id });

    expect(container.textContent).toContain('fires Pistol & Sidearm');
    clickByText(container, 'Confirm');

    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('shoot');
    expect(action.payload.allocations).toEqual([
      { weaponId: 'pistol', targetId: target.id },
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
    syncModels(targetA);
    targetB.position = { x: attacker.position.x + 3, y: 0, z: attacker.position.z + 8 };
    syncModels(targetB);

    activateUnit(state, HOST, attacker.id);
    const { hud, container, controller } = setup(HOST, state);

    clickByText(container, 'Shoot');
    // Verify weapon chips are rendered
    expect(container.textContent).toContain('Pistol (12")');
    expect(container.textContent).toContain('Sidearm (12")');

    // Click target A -> default all to target A
    hud.handleBoardPick({ kind: 'unit', unitId: targetA.id });
    expect(container.textContent).toContain('fires Pistol & Sidearm');

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
      { weaponId: 'pistol', targetId: targetA.id },
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
    syncModels(target);
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

  it('prompts a Shaken unit with a one-step idle end of activation (clears Shaken) instead of normal activation', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    unit.status = ['shaken'];
    const { hud, container, controller } = setup(HOST, state);

    hud.handleBoardPick({ kind: 'unit', unitId: unit.id });
    expect(container.textContent).toContain('clears Shaken');
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

  it('an active Shaken unit can only end its activation idle', () => {
    const state = scenarioState();
    const unit = state.units.find((u) => u.ownerId === HOST)!;
    activateUnit(state, HOST, unit.id);
    unit.status = ['shaken'];
    const { container } = setup(HOST, state);

    expect(container.textContent).toContain('End Activation (idle)');
    const disabled = (action: string) =>
      (container.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).disabled;
    expect(disabled('move')).toBe(true);
    expect(disabled('rush')).toBe(true);
    expect(disabled('shoot')).toBe(true);
    expect(disabled('charge')).toBe(true);
    expect(container.querySelector('[data-action="hold"]')).toBeNull();
  });

  it('shows the Morale Tests of an activation end (rolls, Fearless die, result) from state', () => {
    const state = scenarioState();
    const [a, b] = state.units.filter((u) => u.ownerId === GUEST);
    const action = createAction(HOST, 'end-activation', { type: 'end-activation' });
    state.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
      dice: {
        rollId: action.id,
        specs: [{ count: 1, sides: 6, purpose: 'morale' }],
        results: [{ rolls: [2], total: 2, finalTotal: 2, purpose: 'morale' }],
        context: { attackerId: a.id, targetId: a.id, actionId: action.id },
        outcome: {
          attackCount: 0,
          hitCount: 0,
          blockedCount: 0,
          wounds: 0,
          targetDestroyed: false,
          moraleTests: [
            { unitId: a.id, unitName: a.name, roll: 2, effectiveQuality: 4, passed: false, outcome: 'shaken' },
            { unitId: b?.id ?? a.id, unitName: 'Second Squad', effectiveQuality: 5, passed: false, outcome: 'shaken' },
          ],
        },
      },
    });
    const { container } = setup(GUEST, state);
    expect(container.textContent).toContain('Morale');
    expect(container.textContent).toContain(`${a.name} Morale (need Q4+)`);
    expect(container.textContent).toContain('Second Squad Morale (need Q5+) (already Shaken: fails without a roll)');
    expect(container.textContent).toContain('Shaken');
  });

  it('spells out a Blast shot: multiplication, the split between units and the spill unit\'s own dice', () => {
    const state = scenarioState();
    const h = state.units.find((u) => u.ownerId === HOST)!;
    const [a, b] = state.units.filter((u) => u.ownerId === GUEST);
    const action = createAction(HOST, 'shoot', { type: 'shoot', attackerId: h.id, targetId: a.id, weaponId: 'frag-launcher' });
    state.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
      dice: {
        rollId: action.id,
        specs: [
          { count: 1, sides: 6, purpose: 'to-hit' },
          { count: 3, sides: 6, purpose: 'defense' },
        ],
        results: [
          { rolls: [6], total: 6, finalTotal: 6, purpose: 'to-hit' },
          { rolls: [2, 2, 1], total: 5, finalTotal: 5, purpose: 'defense' },
        ],
        context: { attackerId: h.id, targetId: a.id, actionId: action.id },
        outcome: {
          attackCount: 1,
          hitCount: 2,
          blockedCount: 0,
          wounds: 2,
          targetDestroyed: false,
          effectiveQuality: 4,
          effectiveDefense: 5,
          blastSplits: [
            {
              weaponId: 'frag-launcher',
              weaponName: 'Frag Launcher',
              multiplier: 3,
              totalHits: 3,
              shares: [
                { targetId: a.id, targetName: 'Squad A', hits: 2, cap: 4 },
                { targetId: b?.id ?? 'b', targetName: 'Squad B', hits: 1, cap: 4 },
              ],
              lostHits: 0,
            },
          ],
          blastSplash: [
            {
              weaponId: 'frag-launcher',
              targetId: b?.id ?? 'b',
              targetName: 'Squad B',
              hitCount: 1,
              blockedCount: 1,
              blockedRolls: [true],
              defenseRolls: [5],
              wounds: 0,
              targetDestroyed: false,
              effectiveDefense: 5,
            },
          ],
        },
      },
    });
    const { container } = setup(GUEST, state);
    const text = container.textContent ?? '';
    expect(text).toContain('Frag Launcher Blast(3): 1 hit × 3 = 3 hits → Squad A 2 · Squad B 1');
    expect(text).toContain('Blast spill on Squad B: Defense (need D5+)');
    expect(container.querySelector('.sl-hud-blast-split')).toBeTruthy();
  });

  it('shows the melee result of an activation end, with Fear and the loser, from state', () => {
    const state = scenarioState();
    const [a] = state.units.filter((u) => u.ownerId === GUEST);
    const h = state.units.find((u) => u.ownerId === HOST)!;
    a.specialRules = [...a.specialRules, 'fear(1)']; // Alpha's Fear is what counts against Bravo
    const action = createAction(HOST, 'end-activation', { type: 'end-activation' });
    state.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
      dice: {
        rollId: action.id,
        specs: [],
        results: [],
        context: { attackerId: h.id, targetId: h.id, actionId: action.id },
        outcome: {
          attackCount: 0,
          hitCount: 0,
          blockedCount: 0,
          wounds: 0,
          targetDestroyed: false,
          meleeResults: [
            {
              sides: [
                { unitId: a.id, unitName: 'Alpha', wounds: 3 },
                { unitId: h.id, unitName: 'Bravo', wounds: 1, fearBonus: 1 },
              ],
              loserId: a.id,
            },
          ],
        },
      },
    });
    const { container } = setup(GUEST, state);
    // Both units are named with their owner (a mirror match gives them the same name)
    const guestName = state.players.find((p) => p.id === GUEST)!.name;
    const hostName = state.players.find((p) => p.id === HOST)!.name;
    expect(container.textContent).toContain(
      `${guestName}'s Alpha took 3 wounds, ${hostName}'s Bravo took 1 wound (+1 Fear from ${guestName}'s 1 model in reach): ${guestName}'s Alpha loses`
    );
  });

  it('spells out how many Fear models were in reach, and puts the melee line under the activation entry', () => {
    const state = scenarioState();
    const guestUnit = state.units.find((u) => u.ownerId === GUEST)!;
    const hostUnit = state.units.find((u) => u.ownerId === HOST)!;
    hostUnit.specialRules = [...hostUnit.specialRules, 'fear(2)'];
    guestUnit.name = hostUnit.name; // a mirror match: both units share a name
    const action = createAction(HOST, 'end-activation', { type: 'end-activation' });
    state.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
      dice: {
        rollId: action.id,
        specs: [],
        results: [],
        context: { attackerId: hostUnit.id, targetId: hostUnit.id, actionId: action.id },
        outcome: {
          attackCount: 0, hitCount: 0, blockedCount: 0, wounds: 0, targetDestroyed: false,
          meleeResults: [
            {
              sides: [
                { unitId: guestUnit.id, unitName: guestUnit.name, wounds: 2, fearBonus: 6 }, // 3 models x Fear(2)
                { unitId: hostUnit.id, unitName: hostUnit.name, wounds: 5 },
              ],
              loserId: hostUnit.id,
            },
          ],
        },
      },
    });
    const { container } = setup(GUEST, state);
    const hostName = state.players.find((p) => p.id === HOST)!.name;
    const guestName = state.players.find((p) => p.id === GUEST)!.name;
    const text = container.textContent ?? '';
    expect(text).toContain(`(+6 Fear from ${hostName}'s 3 models in reach)`);
    expect(text).toContain(`${guestName}'s ${hostUnit.name} took 2 wounds`);
    expect(text).toContain(`${hostName}'s ${hostUnit.name} took 5 wounds`);
    // Own indented line below the "ended an activation" entry, not appended to it
    const entry = Array.from(container.querySelectorAll('.sl-hud-log-entry')).find((e) => e.textContent?.includes('ended an activation'))!;
    const sub = entry.querySelector('.sl-hud-log-sub');
    expect(sub?.textContent).toContain('Melee:');
    expect(entry.firstChild?.textContent).toContain('ended an activation');
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
      (u) => u.ownerId === HOST && u.weapons.some((w) => w.id === 'battle-rifle')
    )!;
    activateUnit(state2, HOST, active.id);
    hud.syncFromState(state2);
    const withActive = snapshots[snapshots.length - 1];
    expect(withActive.selectedUnitId).toBe(active.id);
    expect(withActive.movementRangeUnitId).toBeNull();

    clickByText(container, 'Advance');
    expect(snapshots[snapshots.length - 1].movementRangeUnitId).toBe(active.id);
    expect(snapshots[snapshots.length - 1].movementRangeRadius).toBe(6);
    expect(snapshots[snapshots.length - 1].movementRangeColor).toBeUndefined();
    clickByText(container, 'Cancel');
    expect(snapshots[snapshots.length - 1].movementRangeUnitId).toBeNull();

    clickByText(container, 'Rush');
    expect(snapshots[snapshots.length - 1].movementRangeUnitId).toBe(active.id);
    expect(snapshots[snapshots.length - 1].movementRangeRadius).toBe(12);
    expect(snapshots[snapshots.length - 1].movementRangeColor).toBe(0xffb74d);
    clickByText(container, 'Cancel');
    expect(snapshots[snapshots.length - 1].movementRangeUnitId).toBeNull();

    clickByText(container, 'Shoot');
    const targetingSnap = snapshots[snapshots.length - 1];
    // Rings sit one base radius (0.5") out so they show where an enemy base edge can be (24" from the shooter's base edge).
    expect(targetingSnap.attackRange).toEqual({ unitId: active.id, range: 24.5, concentricRanges: [24.5] });
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

  it('dice panel shows the Ferocious extra hit and the Bad Shot modifier of a shot', () => {
    const state = scenarioState();
    const attacker = state.units.find((u) => u.ownerId === HOST && u.weapons.some((w) => w.profile.type === 'ranged'))!;
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    const weapon = attacker.weapons.find((w) => w.profile.type === 'ranged')!;
    const action = createAction(HOST, 'shoot', { type: 'shoot', attackerId: attacker.id, targetId: target.id, weaponId: weapon.id });
    state.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
      dice: {
        rollId: action.id,
        specs: [
          { count: 2, sides: 6, purpose: 'to-hit' },
          { count: 4, sides: 6, purpose: 'defense' },
        ],
        results: [
          { rolls: [6, 3], total: 9, finalTotal: 9, purpose: 'to-hit' },
          { rolls: [1, 1, 1, 1], total: 4, finalTotal: 4, purpose: 'defense' },
        ],
        context: { attackerId: attacker.id, targetId: target.id, weaponId: weapon.id, actionId: action.id },
        outcome: {
          attackCount: 2,
          hitCount: 2,
          bonusHits: 1,
          blockedCount: 0,
          wounds: 2,
          targetDestroyed: false,
          targetShaken: false,
          baseQuality: 4,
          effectiveQuality: 5,
          hitModifiers: ['-1 Bad Shot', 'Ferocious (6s add a hit)'],
          baseDefense: 5,
          effectiveDefense: 5,
          defenseModifiers: [],
        },
      },
    });

    const { container } = setup(HOST, state);
    expect(container.textContent).toContain('-1 Bad Shot');
    expect(container.textContent).toContain('Ferocious (6s add a hit)');
    expect(container.textContent).toContain('2 hits (incl. 1 extra from 6s)');
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
    expect(hostView.container.querySelectorAll('.sl-hud-unit.team-blue').length).toBe(4);
    expect(hostView.container.querySelectorAll('.sl-hud-unit.enemy.team-red').length).toBe(5);

    // From Guest perspective: Guest units are still team-red, Host enemy units are team-blue
    const guestView = setup(GUEST, state);
    expect(guestView.container.querySelectorAll('.sl-hud-unit.team-red:not(.enemy)').length).toBe(5);
    expect(guestView.container.querySelectorAll('.sl-hud-unit.enemy.team-blue').length).toBe(4);
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

  /** A Shaken three-model guest squad on open ground, with the host unit as the attacker and the push prompt pending. */
  function pushSetup(localPlayerId: string = HOST) {
    const state = scenarioState();
    const attacker = state.units.find((u) => u.ownerId === HOST)!;
    const shaken = state.units.find((u) => u.ownerId === GUEST)!;
    const spots = [10, 11, 12];
    shaken.models = spots.map((x, i) => ({
      id: `${shaken.id}-m${i}`,
      wounds: 1,
      maxWounds: 1,
      isDestroyed: false,
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    }));
    shaken.position = { x: 11, y: 0, z: 0 };
    shaken.status = ['shaken'];
    state.turnState.pendingReaction = createPushReaction('end-1', shaken, attacker, []);
    return { shaken, attacker, ...setup(localPlayerId, state) };
  }

  it('push prompt: the attacker gets Auto, Confirm and Don\'t push; Auto and Don\'t push answer with their choice', () => {
    const { controller, container } = pushSetup();
    const ids = Array.from(container.querySelectorAll('button[data-reaction-choice]')).map((b) => (b as HTMLElement).dataset.reactionChoice);
    expect(ids).toEqual([PUSH_AUTO_CHOICE, PUSH_DECLINE_CHOICE]);
    expect(container.querySelector('button[data-action="push-confirm"]')).toBeTruthy();
    (container.querySelector(`button[data-reaction-choice="${PUSH_AUTO_CHOICE}"]`) as HTMLElement).click();
    expect(controller.submitAction.mock.calls[0][0].payload.choiceId).toBe(PUSH_AUTO_CHOICE);

    const again = pushSetup();
    (again.container.querySelector(`button[data-reaction-choice="${PUSH_DECLINE_CHOICE}"]`) as HTMLElement).click();
    expect(again.controller.submitAction.mock.calls[0][0].payload.choiceId).toBe(PUSH_DECLINE_CHOICE);
  });

  it('push prompt: the opponent just waits', () => {
    const { state } = pushSetup();
    const other = setup(GUEST, state);
    expect(other.container.querySelector('.sl-hud-reaction-waiting')?.textContent).toContain('Push');
    expect(other.container.querySelector('button[data-action="push-confirm"]')).toBeNull();
  });

  it('push prompt: Confirm lets the attacker pick a model, stage a spot (ring shown) and send a push-move', () => {
    const { hud, controller, container, shaken } = pushSetup();
    const emitted: MarkerSnapshot[] = [];
    hud.onMarkers((m) => emitted.push(m));
    (container.querySelector('button[data-action="push-confirm"]') as HTMLElement).click();
    expect((container.querySelector('button[data-action="push-send"]') as HTMLButtonElement).disabled).toBe(true);

    // A spot before a model is picked does nothing
    hud.handleBoardPick({ kind: 'position', position: { x: 11, y: 0, z: 3 } });
    expect((container.querySelector('button[data-action="push-send"]') as HTMLButtonElement).disabled).toBe(true);

    hud.handleBoardPick({ kind: 'unit', unitId: shaken.id, modelId: shaken.models[2].id });
    expect(emitted.at(-1)?.movementRangeRadius).toBe(2);
    expect(emitted.at(-1)?.movementRangePosition).toMatchObject({ x: 12, z: 0 });

    // Further than 2" is pulled back onto the ring
    hud.handleBoardPick({ kind: 'position', position: { x: 12, y: 0, z: 5 } });
    expect(container.textContent).toContain('Push 2.0"');
    (container.querySelector('button[data-action="push-send"]') as HTMLElement).click();
    const sent = controller.submitAction.mock.calls[0][0];
    expect(sent.type).toBe('push-move');
    expect(sent.payload.modelId).toBe(shaken.models[2].id);
    expect(sent.payload.destination).toMatchObject({ x: 12, z: 2 });
  });

  it('push prompt: a spot on top of another model is refused and nothing is staged', () => {
    const { hud, container, shaken } = pushSetup();
    (container.querySelector('button[data-action="push-confirm"]') as HTMLElement).click();
    hud.handleBoardPick({ kind: 'unit', unitId: shaken.id, modelId: shaken.models[2].id });
    hud.handleBoardPick({ kind: 'position', position: { x: 11, y: 0, z: 0.1 } });
    expect((container.querySelector('button[data-action="push-send"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('push prompt: hovering a spot off an elevated edge says how far the model falls', () => {
    const { hud, container, shaken, state } = pushSetup();
    state.terrain = [
      {
        id: 'deck',
        terrainType: 'platform-small',
        position: { x: 10, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 6, z: 4 },
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
        isWalkable: true,
      } as any,
    ];
    // deck spans x 8..12; models stand on top at 6"
    shaken.models.forEach((m, i) => (m.position = { x: 9 + i, y: 6, z: 0 }));
    shaken.position = { x: 10, y: 6, z: 0 };
    hud.syncFromState(state);
    (container.querySelector('button[data-action="push-confirm"]') as HTMLElement).click();
    hud.handleBoardPick({ kind: 'unit', unitId: shaken.id, modelId: shaken.models[2].id });
    hud.handleBoardHover({ kind: 'position', position: { x: 13.5, y: 0, z: 0 } });
    expect(container.textContent).toContain('falls 6.0"');
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

  it('shows a pile-in strike with the charge title and logs pile-ins correctly', () => {
    const state = scenarioState();
    const charger = state.units.find((u) => u.ownerId === HOST)!;
    const defender = state.units.find((u) => u.ownerId === GUEST)!;
    const strike = {
      rollId: 'p1',
      specs: [],
      results: [
        { purpose: 'to-hit', rolls: [6, 4] } as any,
        { purpose: 'defense', rolls: [5, 2] } as any,
      ],
      context: { attackerId: charger.id, targetId: defender.id },
      outcome: { attackCount: 2, hitCount: 1, blockedCount: 1, wounds: 0 },
    };
    state.actionLog.push({
      action: createAction(GUEST, 'respond-reaction', { type: 'respond-reaction', reactionId: 'p1', choiceId: 'auto-pile-in' }),
      status: 'accepted',
      dice: strike,
    } as any);
    const { hud, container } = setup(HOST, state);
    const title = container.querySelector('.sl-hud-dice-title')?.textContent ?? '';
    expect(title).toContain(`${charger.name} → ${defender.name}`);
    expect(title).not.toContain('Retaliation');
    expect(container.textContent).toContain('piled in (auto)');
    expect(container.textContent).not.toContain('declined retaliation');

    const moved = scenarioState();
    moved.actionLog.push({
      action: createAction(GUEST, 'pile-in-move', { type: 'pile-in-move', modelPositions: [] }),
      status: 'accepted',
      dice: { ...strike, rollId: 'p2' },
    } as any);
    hud.syncFromState(moved);
    expect(container.querySelector('.sl-hud-dice-title')?.textContent).toContain(`${charger.name} → ${defender.name}`);
    expect(container.textContent).toMatch(/piled in(?! \(auto\))/);
  });

  it('labels casualty picks correctly in the dice panel and the log (not as a retaliation)', () => {
    const state = scenarioState();
    const charger = state.units.find((u) => u.ownerId === HOST)!;
    const defender = state.units.find((u) => u.ownerId === GUEST)!;
    // This test covers the Tough 1 wording; the default defender is Tough above 1 (see GameHUD.casualties.test.ts)
    const toughOne = (st: GameState) => {
      for (const m of st.units.find((u) => u.id === defender.id)!.models ?? []) m.maxWounds = 1;
      return st;
    };
    toughOne(state);
    const stepBack = {
      rollId: 'c1',
      specs: [],
      results: [],
      context: { attackerId: charger.id, targetId: defender.id },
      outcome: { attackCount: 0, hitCount: 0, blockedCount: 0, wounds: 0, pushedBack: true },
    };
    state.actionLog.push({
      action: createAction(GUEST, 'pick-casualties', { type: 'pick-casualties', unitId: defender.id, modelIds: ['a', 'b'] }),
      status: 'accepted',
      dice: stepBack,
    } as any);
    const { hud, container } = setup(HOST, state);
    const title = container.querySelector('.sl-hud-dice-title')?.textContent ?? '';
    expect(title).toContain(`Casualties removed: ${defender.name}`);
    expect(title).not.toContain('Retaliation');
    expect(container.textContent).toContain(`removed casualties from ${defender.name}`);
    expect(container.textContent).not.toContain('declined retaliation');

    const auto = toughOne(scenarioState());
    auto.actionLog.push({
      action: createAction(GUEST, 'respond-reaction', { type: 'respond-reaction', reactionId: 'r1', choiceId: 'auto-pick-casualties' }),
      status: 'accepted',
      dice: { ...stepBack, rollId: 'c2' },
    } as any);
    hud.syncFromState(auto);
    expect(container.querySelector('.sl-hud-dice-title')?.textContent).toContain(`Casualties removed: ${defender.name}`);
    expect(container.querySelector('.sl-hud-pushback-notice')).not.toBeNull();
    expect(container.textContent).toContain('casualties picked (auto)');
    expect(container.textContent).not.toContain('declined retaliation');

    // A pick with no dice story still reads correctly in the log
    const quiet = toughOne(scenarioState());
    quiet.actionLog.push({
      action: createAction(GUEST, 'pick-casualties', { type: 'pick-casualties', unitId: defender.id, modelIds: ['a'] }),
      status: 'accepted',
    } as any);
    hud.syncFromState(quiet);
    expect(container.textContent).toContain(`removed casualties from ${defender.name}`);
  });

  it('names a pick on a Tough above 1 unit "wounds assigned" in the dice panel and the log (14C-3 PR 1H-2)', () => {
    const state = scenarioState();
    const charger = state.units.find((u) => u.ownerId === HOST)!;
    const defender = state.units.find((u) => u.ownerId === GUEST)!;
    for (const m of defender.models ?? []) m.maxWounds = 3;
    state.actionLog.push({
      action: createAction(GUEST, 'pick-casualties', { type: 'pick-casualties', unitId: defender.id, modelIds: ['a'] }),
      status: 'accepted',
      dice: {
        rollId: 'c1',
        specs: [],
        results: [],
        context: { attackerId: charger.id, targetId: defender.id },
        outcome: { attackCount: 0, hitCount: 0, blockedCount: 0, wounds: 0 },
      },
    } as any);
    const { container } = setup(HOST, state);
    expect(container.querySelector('.sl-hud-dice-title')?.textContent).toContain(`Wounds assigned: ${defender.name}`);
    expect(container.textContent).toContain(`assigned wounds on ${defender.name}`);
    expect(container.textContent).not.toContain('removed casualties');
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
    unit.weapons[0].profile.specialRules = ['relentless'];
    unit.specialRules = ['stealth'];
    activateUnit(state, HOST, unit.id);
    const { container } = setup(HOST, state);

    const badges = container.querySelectorAll('.sl-trait-badge');
    const titles = Array.from(badges).map((b) => b.getAttribute('title') ?? '');
    const relentlessTitle = titles.find((t) => t.includes('>9"'));
    expect(relentlessTitle).toBeDefined();
    expect(container.innerHTML).toContain('>9&quot;');
  });

  it('allows charging an enemy unit around an obstacle without direct Line of Sight', () => {
    const state = scenarioState();
    const attacker = state.units.find((u) => u.ownerId === HOST)!;
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    attacker.position = { x: 0, y: 0, z: 0 };
    target.position = { x: 0, y: 0, z: 5 };
    syncModels(attacker);
    syncModels(target);
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

  it('renders data card with Tough, Move, and Charge (double speed) columns without remaining movement', () => {
    const state = scenarioState();
    const leader = state.units.find((u) => u.ownerId === HOST && u.specialRules.some((r) => r.startsWith('tough')))!;
    activateUnit(state, HOST, leader.id);
    const { container } = setup(HOST, state);

    const datacard = container.querySelector('.sl-hud-datacard');
    expect(datacard).toBeTruthy();
    const headers = Array.from(datacard!.querySelectorAll('th')).map((th) => th.textContent);
    expect(headers).toContain('Tough');
    expect(datacard?.textContent).not.toContain('Toughness');
    expect(datacard?.textContent).not.toContain('6.0" / 6"');
    // Leader speed is 6, charge is 12"
    expect(datacard?.textContent).toContain('6"');
    expect(datacard?.textContent).toContain('12"');
  });

  it('renders wound progress badge (e.g. 1/3 W) for a Tough model with damage below Tough', () => {
    const state = scenarioState();
    const boss = state.units.find((u) => u.models.length === 1 && u.specialRules.includes('tough(3)'))!;
    boss.models[0].wounds = 2;
    boss.wounds = 2;
    const { container } = setup(HOST, state);

    expect(container.textContent).toContain('1/3 W');
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
    function deploymentState(hostArmyId = 'hdf'): GameState {
      const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
      applyDefaultScenario(state, {
        hostArmyId,
        guestArmyId: 'orc-marauders',
        useDeploymentPhase: true,
      });
      // The objectives phase (rolls and placement) is covered by the shared tests: start at deployment
      state.turnState.phase = 'deployment';
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
      // The ready-made armies have no Ambush unit, so this check uses the dev-only Scout/Ambush TEST army
      const state = deploymentState('test-scout-ambush-army');
      const { container } = setup(HOST, state);

      const hostRows = Array.from(container.querySelectorAll('.sl-hud-unit.team-blue'));
      expect(hostRows.length).toBe(STARTER_ARMIES['test-scout-ambush-army'].fighters.length);

      // The Ambush units wait in reserve
      const dropReserveRow = hostRows.find((r) => r.textContent?.includes('IN RESERVE (AMBUSH)'));
      expect(dropReserveRow).toBeTruthy();

      // Standard and scout units show UNDEPLOYED or SCOUT
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
      // Zones stay 24" apart: on the 44"x30" scenario board they run from the edge to z = ±12.
      expect(emittedMarkers!.deploymentZones!.hostZone.maxZ).toBe(-12);
      expect(emittedMarkers!.deploymentZones!.guestZone.minZ).toBe(12);
    });
  });

  describe('Phase 11C: Traversal HUD Warnings & Casualty Allocation', () => {
    // Batch 1E: the pathfinder only plans ordinary movement. A jump (3-6" down) or a fall (over 6") is declared
    // from an edge; the HUD for that arrives with E3, so the preview must never plan one on its own.
    it('does not auto-plan a 3-6" jump down: no jump warning, no preview that drops more than 3"', () => {
      const state = scenarioState();
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: 0, y: 4.0, z: 0 };
      activateUnit(state, HOST, unit.id);
      const { hud, container } = setup(HOST, state);

      clickByText(container, 'Advance');
      hud.handleBoardPick({ kind: 'position', position: { x: 2.0, y: 0, z: 0 } });

      expect(container.textContent).not.toContain('JUMP DOWN');
      const preview = ((hud as any).movePathPreview ?? []) as Array<{ y?: number }>;
      for (let i = 1; i < preview.length; i++) {
        expect((preview[i - 1].y ?? 0) - (preview[i].y ?? 0)).toBeLessThanOrEqual(3.05);
      }
    });

    it('does not auto-plan a fall over 6" either', () => {
      const state = scenarioState();
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: 0, y: 7.0, z: 0 };
      activateUnit(state, HOST, unit.id);
      const { hud, container } = setup(HOST, state);

      clickByText(container, 'Advance');
      hud.handleBoardPick({ kind: 'position', position: { x: 2.0, y: 0, z: 0 } });

      expect(container.textContent).not.toContain('HIGH DROP');
      const preview = ((hud as any).movePathPreview ?? []) as Array<{ y?: number }>;
      for (let i = 1; i < preview.length; i++) {
        expect((preview[i - 1].y ?? 0) - (preview[i].y ?? 0)).toBeLessThanOrEqual(3.05);
      }
    });

    it('displays dangerous terrain hazard warning', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      // Convert to multi-model squad
      squad.wounds = 2;
      squad.maxWounds = 2;
      squad.models = [
        { id: 'm1', name: 'Trooper 1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -3 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', name: 'Trooper 2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1.0, y: 0, z: -3 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);
      squad.position = { x: 0, y: 0, z: -3 };
      // toxic sludge is at (0, 0, 0)
      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Advance');
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 0 } });
      hud.handleBoardPick({ kind: 'position', position: { x: 1.0, y: 0, z: 0 } });

      // Two models with one wound each: two dice, each 1 is a wound (Decision 18), not the old per-model test
      expect(container.textContent).toContain('Dangerous terrain: 2 dice, each 1 is a wound');
      expect(container.textContent).not.toContain('Hazard test');

      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
    });

    it('rejects charge when target is on elevated ledge outside vertical melee reach (> 4.0")', () => {
      const state = scenarioState();
      const attacker = state.units.find((u) => u.ownerId === HOST)!;
      const target = state.units.find((u) => u.ownerId === GUEST)!;
      activateUnit(state, HOST, attacker.id);
      attacker.position = { x: 0, y: 0, z: 0 };
      target.position = { x: 1.0, y: 5.0, z: 0 }; // 5.0" tall ledge (> 4.0" reach)
      syncModels(attacker);
      syncModels(target);

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

      clickByText(container, 'Advance');
      hud.handleBoardPick({ kind: 'position', position: { x: -0.5, y: 0, z: -0.5 } });

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
          isObstacle: true,
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
      expect(warningEl.textContent).toContain("Can't reach that height from here");
      expect(warningEl.textContent).not.toMatch(/sheer|next turn/i);

      // Path ends at the base of the wall (y = 0) on open ground
      const preview = (hud as any).movePathPreview;
      expect(preview.length).toBeGreaterThanOrEqual(2);
      const endPoint = preview[preview.length - 1];
      expect(endPoint.y).toBe(0);
      expect(endPoint.z).toBeGreaterThanOrEqual(5.3);
      expect(endPoint.z).toBeLessThanOrEqual(6.2);
    });

    it('a Rush aimed past a rubble field at an angle runs to its edge instead of being capped at 6"', () => {
      // Owner report 2026-11-09: the preview stopped 6" out in open ground with the difficult-terrain cap warning.
      const state = scenarioState();
      state.terrain = [
        {
          id: 'rubble',
          terrainType: 'rubble-field',
          position: { x: -6, y: 0, z: 4 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 6, y: 0.25, z: 4 },
          blocksLineOfSight: false,
          providesCover: true,
          isObstacle: false,
          isWalkable: false,
          isDifficult: true,
        },
      ];
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.position = { x: 12, y: 0, z: -10 };
      unit.speed = 12;
      syncModels(unit);
      activateUnit(state, HOST, unit.id);
      const { hud, container } = setup(HOST, state);

      clickByText(container, 'Rush');
      hud.handleBoardHover({ kind: 'position', position: { x: -14, y: 0, z: 8 } });

      const warningEl = container.querySelector('.sl-hud-move-warning') as HTMLElement;
      expect(warningEl.textContent).toContain('Rush stops at the edge of difficult terrain');
      expect(warningEl.textContent).not.toContain('capped at 6.0');
      const preview = (hud as any).movePathPreview;
      const end = preview[preview.length - 1];
      // ~20" from the start, just outside the field's corner region (x -9..-3, z 2..6)
      expect(Math.hypot(end.x - 12, end.z + 10)).toBeGreaterThan(15);
      expect(end.z).toBeLessThan(2);
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
          isObstacle: true,
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
      expect(toast?.textContent).toContain("Can't reach that height from here");

      // Info badge in confirmation bar
      const badge = container.querySelector('.sl-hud-warning-badge');
      expect(badge?.textContent).toContain('Rush stops short');
      expect(badge?.textContent).toContain('Rush stops short');

      // Summary text
      expect(container.textContent).toContain("[Can't reach that height from here");
      expect(container.textContent).not.toMatch(/sheer climb|next turn/i);

      // Confirm submits rush action stopping at wall base
      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('rush');
      const finalPos = action.payload.finalPosition;
      expect(finalPos.y).toBe(0);
      expect(finalPos.z).toBeGreaterThanOrEqual(5.3);
      expect(finalPos.z).toBeLessThanOrEqual(6.2);
    });

    it('does not plan a free climb onto the deck from the wall base (climbable terrain arrives with E2)', () => {
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
          isObstacle: true,
        },
      ];
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      // Starting from the base of the wall at (0, 0, 6)
      unit.position = { x: 0, y: 0, z: 6 };
      activateUnit(state, HOST, unit.id);
      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Rush');
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 2.5, z: 8 } });

      // Batch 1E: the pathfinder never plans a sheer climb; nothing is queued to confirm
      expect(controller.submitAction).not.toHaveBeenCalled();
      const preview = ((hud as any).movePathPreview ?? []) as Array<{ y?: number }>;
      expect(preview.every((p) => (p.y ?? 0) < 0.5)).toBe(true);
    });

    it('does not auto-plan a gap jump across a platform gap > 1.0"; the preview stays on the near deck', () => {
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

      clickByText(container, 'Advance');
      hud.handleBoardPick({ kind: 'position', position: { x: 2, y: 2.5, z: 0 } });

      // Batch 1E: platforms span x -3..-1 and 1..3, a 2" gap (a 1-die jump). The pathfinder never plans a jump,
      // so the preview stops on the near deck; declaring the jump from the edge is the E3 HUD.
      expect(container.textContent).not.toContain('GAP JUMP');
      const preview = ((hud as any).movePathPreview ?? []) as Array<{ x: number }>;
      expect(preview.every((p) => p.x <= -0.8)).toBe(true);
      expect(controller.submitAction).not.toHaveBeenCalled();
    });

    it('shows movement hazard dice (jump, fall) in the dice panel and the log', () => {
      const state = scenarioState();
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      state.actionLog.push({
        action: { id: 'a1', timestamp: 0, actorId: HOST, type: 'advance', payload: { type: 'advance', unitId: unit.id } } as any,
        result: 'accepted',
        appliedAt: 0,
        dice: {
          rollId: 'a1',
          specs: [{ count: 4, sides: 6, purpose: 'jump' }, { count: 4, sides: 6, purpose: 'fall' }],
          results: [{ rolls: [3, 2, 1, 6], total: 12, finalTotal: 12, purpose: 'jump' }, { rolls: [1, 5, 6, 4], total: 16, finalTotal: 16, purpose: 'fall' }],
          context: { attackerId: unit.id, targetId: unit.id, actionId: 'a1' },
          outcome: {
            attackCount: 0,
            hitCount: 0,
            blockedCount: 0,
            wounds: 1,
            targetDestroyed: false,
            traversal: [
              { type: 'drop-jump', rolls: [3, 2, 1, 6], target: 2, passed: false, text: 'Jump down 4.0" (4 dice, each 2+): rolled 3, 2, 1, 6 → failed, falls' },
              { type: 'fall', wounds: 1, rolls: [1, 5, 6, 4], text: 'Fell 4.0" (4 dice, 1-3 wounds): rolled 1, 5, 6, 4 → 1 wound' },
            ],
          },
        },
      });
      const { container } = setup(HOST, state);
      expect(container.textContent).toContain('Movement hazards');
      expect(container.textContent).toContain('Jump down 4.0" (4 dice, each 2+)');
      expect(container.textContent).toContain('Fell 4.0"');
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

    it('melee-consolidation reaction for a multi-model squad populates modelPositions and modelPaths (G-08)', () => {
      const state = scenarioState();
      state.terrain = [];
      const squad = state.units.find((u) => u.ownerId === HOST && u.models.length > 1)!;
      squad.models.forEach((m, idx) => {
        m.isDestroyed = false;
        m.position = { x: idx * 1.2, y: 0, z: 0 };
      });
      squad.position = { x: 1.2, y: 0, z: 0 };
      for (const other of state.units) {
        if (other.id !== squad.id) {
          other.position = { x: 0, y: 0, z: 20 };
          other.models.forEach((m) => (m.position = { x: 0, y: 0, z: 20 }));
        }
      }
      state.turnState.pendingReaction = {
        id: 'rx-squad',
        type: 'melee-consolidation',
        promptingPlayerId: HOST,
        title: 'Victory Consolidation',
        description: 'Move up to 3.0" in any direction, or stay put.',
        data: {
          unitId: squad.id,
          destroyedUnitId: 'enemy-1',
          maxDistance: 3.0,
        },
        options: [{ id: 'stay', label: 'Stay Put', style: 'secondary' }],
        deadline: Date.now() + 15000,
      };

      const { hud, container, controller } = setup(HOST, state);
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 2 } });
      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('consolidate-move');
      expect(action.payload.modelPositions).toHaveLength(squad.models.filter((m) => !m.isDestroyed).length);
      expect(action.payload.modelPaths).toHaveLength(squad.models.filter((m) => !m.isDestroyed).length);
    });

    it('reaction countdown respects expiresAt when durationMs is longer after reload (G-32)', () => {
      const state = scenarioState();
      state.turnState.pendingReaction = {
        id: 'rx-expire',
        type: 'pick-strike-target',
        promptingPlayerId: HOST,
        title: 'Strike Reaction',
        description: 'React now',
        options: [{ id: 'strike', label: 'Strike' }],
        durationMs: 30000,
        expiresAt: Date.now() + 5000,
      } as any;

      const { container } = setup(HOST, state);
      const timerEl = container.querySelector('.sl-hud-reaction-timer');
      expect(timerEl).not.toBeNull();
      expect(timerEl!.textContent).toBe('5s');
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

    it('shows each model its own distance left after a split move (ring and text)', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.name = 'Warden Patrol Squad';
      squad.speed = 6;
      squad.position = { x: 0, y: 0, z: -4 };
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);
      // Leg 1 done: model 1 walked all 6", model 2 walked 2.5"
      squad.hasMoved = true;
      squad.modelMovementSpent = { m1: 6, m2: 2.5 };
      squad.remainingMovement = 3.5;

      const { hud, container } = setup(HOST, state);
      let lastMarkers: any = null;
      hud.onMarkers((m) => {
        lastMarkers = m;
      });

      clickByText(container, 'Advance');
      // Model 2 can walk 3.5", model 1 nothing: the unit-level figure is the best of them
      container.querySelector<HTMLButtonElement>('[data-action="select-squad-model"][data-model-id="m2"]')!.click();
      expect(container.textContent).toContain('Place Model 2 of 2 (Warden Patrol Squad) within 3.5"');
      expect(lastMarkers?.movementRangeRadius).toBe(3.5);
      container.querySelector<HTMLButtonElement>('[data-action="select-squad-model"][data-model-id="m1"]')!.click();
      expect(container.textContent).toContain('Place Model 1 of 2 (Warden Patrol Squad) within 0"');
      expect(lastMarkers?.movementRangeRadius).toBe(0);
    });

    it('shows the distance left on a single model\'s second move leg', () => {
      const state = scenarioState();
      const unit = state.units.find((u) => u.ownerId === HOST && (u.models?.length ?? 1) <= 1)!;
      unit.speed = 6;
      activateUnit(state, HOST, unit.id);
      unit.hasMoved = true;
      unit.remainingMovement = 2.5;
      const { container } = setup(HOST, state);
      clickByText(container, 'Advance');
      expect(container.textContent).toContain('2.5" left');
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
      clickByText(container, 'Advance');
      expect(container.textContent).toContain('Place Model 1 of 2 (Warden Patrol Squad) within 6"');

      // 2. Click to place Model 1 at (0, 0, -1) [3.0" move]
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -1 } });

      // Model 1 placed! Should now prompt for Model 2 and display coherency circle around Model 1
      expect(container.textContent).toContain('Place Model 2 of 2');
      expect(lastMarkers?.squadCoherency).toBeDefined();
      // The placed model's ring first, then the ring of where Model 2 will follow to
      expect(lastMarkers?.squadCoherency?.positions).toHaveLength(2);
      expect(lastMarkers?.squadCoherency?.positions[0].z).toBeCloseTo(-1, 1);
      expect(lastMarkers?.squadCoherency?.radius).toBe(2.0);

      // 3. Try placing Model 2 at (0, 0, 3) (> 2.0" from Model 1 at z = -1)
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 3 } });
      // Should reject with toast
      expect(container.querySelector('.sl-hud-toast')?.textContent).toMatch(/exceeds 1" limit|coherency/i);
      expect(controller.submitAction).not.toHaveBeenCalled();

      // 4. Place Model 2 legally within 2.0" coherency at (1, 0, -1) [1.0" distance from Model 1]
      hud.handleBoardPick({ kind: 'position', position: { x: 1, y: 0, z: -1 } });

      // Both models placed -> enters confirmation
      expect(container.textContent).toContain('Advance Warden Patrol Squad (2 models)');
      expect(container.textContent).toContain('Confirm');

      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('advance');
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

      clickByText(container, 'Advance');
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

    describe('confirm a squad move before every model has moved', () => {
      function fourModelSquad() {
        const state = scenarioState();
        const squad = state.units.find((u) => u.ownerId === HOST)!;
        squad.name = 'Warden Patrol Squad';
        squad.position = { x: 0.5, y: 0, z: -4.5 };
        squad.speed = 6;
        squad.remainingMovement = 6;
        const mk = (id: string, x: number, z: number) => ({
          id, wounds: 1, maxWounds: 1, isDestroyed: false, position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0 },
        });
        squad.models = [mk('m1', 0, -5), mk('m2', 1, -5), mk('m3', 0, -4), mk('m4', 1, -4)];
        activateUnit(state, HOST, squad.id);
        return { state, squad };
      }

      it('offers Confirm move after the first staged model and moves the unplaced models after it', () => {
        const { state } = fourModelSquad();
        const { hud, container, controller } = setup(HOST, state);
        clickByText(container, 'Advance');
        expect(container.querySelector('[data-action="confirm-squad-move"]')).toBeNull();

        hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -6 } });
        const btn = container.querySelector<HTMLButtonElement>('[data-action="confirm-squad-move"]');
        expect(btn).toBeTruthy();

        btn!.click();
      expect(container.textContent).toContain('Advance Warden Patrol Squad (4 models)');
        clickByText(container, 'Confirm');
        expect(controller.submitAction).toHaveBeenCalledTimes(1);
        const action = controller.submitAction.mock.calls[0][0];
        expect(action.type).toBe('advance');
        expect(action.payload.modelPositions).toHaveLength(4);
        expect(action.payload.modelPositions[0]).toEqual({ x: 0, y: 0, z: -6 });
        // The other three keep the formation: each steps the same 1" forward on its own path
        expect(action.payload.modelPositions[1]).toEqual({ x: 1, y: 0, z: -6 });
        expect(action.payload.modelPaths[1]).toEqual([{ x: 1, y: 0, z: -5 }, { x: 1, y: 0, z: -6 }]);
        expect(action.payload.modelPositions[3]).toEqual({ x: 1, y: 0, z: -5 });
      });

      it('refuses to confirm early when models that cannot move would leave the squad incoherent', () => {
        const { state, squad } = fourModelSquad();
        // The other three have no move left, so they cannot follow the model that steps ahead
        squad.modelMovementSpent = { m2: 6, m3: 6, m4: 6 };
        const { hud, container, controller } = setup(HOST, state);
        clickByText(container, 'Advance');
        hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -9 } });
        container.querySelector<HTMLButtonElement>('[data-action="confirm-squad-move"]')!.click();
        expect(container.querySelector('.sl-hud-toast')?.textContent).toMatch(/1"|coherency/i);
        expect(container.textContent).not.toContain('Advance Warden Patrol Squad (4 models)');
        expect(controller.submitAction).not.toHaveBeenCalled();
      });

      it('disables Hold and shows a hint when the squad starts out of coherency', () => {
        const { state, squad } = fourModelSquad();
        squad.models[3].position = { x: 6, y: 0, z: -4 };
        const { container } = setup(HOST, state);
        const hold = container.querySelector<HTMLButtonElement>('[data-action="hold"]')!;
        expect(hold.disabled).toBe(true);
        expect(container.textContent).toContain('Squad is out of coherency');
      });

      it('disables Shoot too while the squad is out of coherency and has not moved', () => {
        const { state, squad } = fourModelSquad();
        squad.models[3].position = { x: 6, y: 0, z: -4 };
        const { container } = setup(HOST, state);
        const shoot = container.querySelector<HTMLButtonElement>('[data-action="shoot"]')!;
        expect(shoot.disabled).toBe(true);
      });

      it('lets a regrouping squad place its stray closer even though it is still apart', () => {
        const { state, squad } = fourModelSquad();
        squad.models[3].position = { x: 12, y: 0, z: -4 };
        const { hud, container, controller } = setup(HOST, state);
        clickByText(container, 'Advance');
        // models 1-3 stay near, the stray comes 6" closer but is still apart
        hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -5.5 } });
        hud.handleBoardPick({ kind: 'position', position: { x: 1, y: 0, z: -5.5 } });
        hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -4.5 } });
        hud.handleBoardPick({ kind: 'position', position: { x: 6, y: 0, z: -4 } });
        expect(container.textContent).toContain('Advance Warden Patrol Squad (4 models)');
        clickByText(container, 'Confirm');
        expect(controller.submitAction).toHaveBeenCalledTimes(1);
      });

      it('still refuses a placement that leaves a regrouping squad no closer', () => {
        const { state, squad } = fourModelSquad();
        squad.models[3].position = { x: 12, y: 0, z: -4 };
        const { hud, container, controller } = setup(HOST, state);
        clickByText(container, 'Advance');
        hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -5.5 } });
        hud.handleBoardPick({ kind: 'position', position: { x: 1, y: 0, z: -5.5 } });
        hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -4.5 } });
        hud.handleBoardPick({ kind: 'position', position: { x: 12, y: 0, z: -3 } });
        expect(container.querySelector('.sl-hud-toast')?.textContent).toMatch(/closer to coherent|coherency/i);
        expect(controller.submitAction).not.toHaveBeenCalled();
      });
    });

    it('multiplies attack dice by living models count in shoot confirmation summary', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -10 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -10 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm3', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -9 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm4', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -9 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);
      squad.position = { x: 0, y: 0, z: -10 };
      const enemy = state.units.find((u) => u.ownerId === GUEST)!;
      enemy.position = { x: 0, y: 0, z: -5 };
      syncModels(enemy);

      const { hud, container } = setup(HOST, state);

      clickByText(container, 'Shoot');
      hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });

      // Confirmation summary must reflect 4 living models * Pistol A2 = 8d6
      expect(container.textContent).toContain('8d6');
    });

    it('allows a 4-model squad to move into one unbroken chain', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.name = 'Warden Patrol Squad';
      squad.position = { x: 0, y: 0, z: -5 };
      squad.speed = 6;
      squad.remainingMovement = 6;
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm3', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm4', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);

      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Advance');
      expect(container.textContent).toContain('Place Model 1 of 4');

      // Model 1 placed at (0, 0, -2) [Pair 1 leader]
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -2 } });
      expect(container.textContent).toContain('Place Model 2 of 4');

      // Model 2 placed at (1.0, 0, -2) [Pair 1 buddy, 1.0" base contact with M1]
      hud.handleBoardPick({ kind: 'position', position: { x: 1.0, y: 0, z: -2 } });
      expect(container.textContent).toContain('Place Model 3 of 4');

      // Model 3 placed at (4.0, 0, -4.5) [chain continues below M1]
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -3 } });
      expect(container.textContent).toContain('Place Model 4 of 4');

      // Model 4 placed at (5.0, 0, -4.5) [2.0" from M3, linked to M2: one unbroken chain]
      hud.handleBoardPick({ kind: 'position', position: { x: 2.0, y: 0, z: -3 } });

      // Should enter Move Confirmation successfully!
      expect(container.textContent).toContain('Advance Warden Patrol Squad (4 models)');
      expect(container.textContent).toContain('Confirm');

      clickByText(container, 'Confirm');
      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('advance');
      expect(action.payload.modelPositions).toHaveLength(4);
      expect(action.payload.modelPositions[0]).toEqual({ x: 0, y: 0, z: -2 });
      expect(action.payload.modelPositions[1]).toEqual({ x: 1.0, y: 0, z: -2 });
      expect(action.payload.modelPositions[2]).toEqual({ x: 0, y: 0, z: -3 });
      expect(action.payload.modelPositions[3]).toEqual({ x: 2.0, y: 0, z: -3 });
    });

    it('refuses to finish a squad move as two separate pairs and says the squad is split', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.name = 'Warden Patrol Squad';
      squad.position = { x: 0, y: 0, z: -5 };
      squad.speed = 6;
      squad.remainingMovement = 6;
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm3', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm4', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);
      const { hud, container } = setup(HOST, state);
      clickByText(container, 'Advance');
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -2 } });
      hud.handleBoardPick({ kind: 'position', position: { x: 1.0, y: 0, z: -2 } });
      hud.handleBoardPick({ kind: 'position', position: { x: 4.0, y: 0, z: -4.5 } });
      hud.handleBoardPick({ kind: 'position', position: { x: 5.0, y: 0, z: -4.5 } });
      expect(container.textContent).not.toContain('Advance Warden Patrol Squad (4 models)');
      expect(container.querySelector('.sl-hud-toast')?.textContent).toContain('split into 2 groups');
    });

    it('allows player to select squad models to move in any arbitrary order via chips or board clicks', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.name = 'Warden Patrol Squad';
      squad.position = { x: 0, y: 0, z: -5 };
      squad.speed = 6;
      squad.remainingMovement = 6;
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -5 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm3', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm4', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);

      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Advance');

      // 1. Player chooses to move Model 3 FIRST by clicking its HUD chip
      const m3Chip = container.querySelector<HTMLButtonElement>('[data-action="select-squad-model"][data-model-id="m3"]');
      expect(m3Chip).toBeTruthy();
      m3Chip!.click();
      expect(container.textContent).toContain('Place Model 3 of 4');

      // Place Model 3 at (0, 0, -2)
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -2 } });

      // 2. Next unplaced model (Model 1) auto-selected, but player clicks Model 4 on the board to move it next!
      hud.handleBoardPick({ kind: 'unit', unitId: squad.id, modelId: 'm4' });
      expect(container.textContent).toContain('Place Model 4 of 4');

      // Place Model 4 at (1.0, 0, -2) [buddy to M3 with 1.0" base contact]
      hud.handleBoardPick({ kind: 'position', position: { x: 1.0, y: 0, z: -2 } });

      // 3. Player clicks Model 1 chip and places it at (4.0, 0, -4.5)
      const m1Chip = container.querySelector<HTMLButtonElement>('[data-action="select-squad-model"][data-model-id="m1"]');
      expect(m1Chip).toBeTruthy();
      m1Chip!.click();
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -3 } });

      // 4. Finally place Model 2 at (5.0, 0, -4.5) [buddy to M1 with 1.0" base contact]
      expect(container.textContent).toContain('Place Model 2 of 4');
      hud.handleBoardPick({ kind: 'position', position: { x: 1.0, y: 0, z: -3 } });

      // All 4 models placed in arbitrary order (M3 -> M4 -> M1 -> M2)!
      expect(container.textContent).toContain('Advance Warden Patrol Squad (4 models)');
      clickByText(container, 'Confirm');

      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.type).toBe('advance');
      // Payload positions must be indexed according to living model order [m1, m2, m3, m4]
      expect(action.payload.modelPositions[0]).toEqual({ x: 0, y: 0, z: -3 }); // m1
      expect(action.payload.modelPositions[1]).toEqual({ x: 1.0, y: 0, z: -3 }); // m2
      expect(action.payload.modelPositions[2]).toEqual({ x: 0, y: 0, z: -2 });   // m3
      expect(action.payload.modelPositions[3]).toEqual({ x: 1.0, y: 0, z: -2 }); // m4
    });

    it('allows repositioning an already placed squad model before confirmation', () => {
      const state = scenarioState();
      const squad = state.units.find((u) => u.ownerId === HOST)!;
      squad.name = 'Warden Patrol Squad';
      squad.position = { x: 0, y: 0, z: -4 };
      squad.speed = 6;
      squad.remainingMovement = 6;
      squad.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: -4 }, rotation: { x: 0, y: 0, z: 0 } },
      ];
      activateUnit(state, HOST, squad.id);

      const { hud, container, controller } = setup(HOST, state);
      clickByText(container, 'Advance');

      // Place M1 at (0, 0, -2)
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -2 } });

      // Decide to change M1 placement by clicking M1 chip again
      const m1Chip = container.querySelector<HTMLButtonElement>('[data-action="select-squad-model"][data-model-id="m1"]');
      expect(m1Chip).toBeTruthy();
      m1Chip!.click();

      // Reposition M1 to (0, 0, -1)
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -1 } });

      // Place M2 at (1, 0, -1)
      hud.handleBoardPick({ kind: 'position', position: { x: 1, y: 0, z: -1 } });

      expect(container.textContent).toContain('Confirm');
      clickByText(container, 'Confirm');

      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.payload.modelPositions[0]).toEqual({ x: 0, y: 0, z: -1 });
      expect(action.payload.modelPositions[1]).toEqual({ x: 1, y: 0, z: -1 });
    });

    it('rejects move ending in melee contact with toast and does not confirm', () => {
      const state = scenarioState();
      const unit = state.units.find((u) => u.ownerId === HOST && (!u.models || u.models.length <= 1))!;
      activateUnit(state, HOST, unit.id);
      unit.position = { x: 0, y: 0, z: -5 };
      unit.speed = 6;
      unit.remainingMovement = 6;

      const enemy = state.units.find((u) => u.ownerId === GUEST)!;
      enemy.position = { x: 0, y: 0, z: 0 };
      syncModels(unit);
      syncModels(enemy);

      const { hud, container, controller } = setup(HOST, state);

      clickByText(container, 'Advance');
      // Pick a spot at z = -0.6 (0" from the enemy's base edge, deep inside melee contact): the planned move
      // stops short at the 1" keep-away distance (centre z = -2.0) instead
      hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -0.6 } });
      clickByText(container, 'Confirm');

      expect(controller.submitAction).toHaveBeenCalledTimes(1);
      const finalZ = controller.submitAction.mock.calls[0][0].payload.finalPosition.z;
      expect(finalZ).toBeLessThanOrEqual(-1.97);
      expect(finalZ).toBeGreaterThan(-2.2);
    });
  });
});

describe('dangerousTerrainText (Decision 41)', () => {
  const mk = (models: Array<{ wounds: number; isDestroyed?: boolean }>) =>
    ({
      wounds: models.reduce((n, m) => n + m.wounds, 0),
      models: models.map((m, i) => ({ id: `m${i}`, wounds: m.wounds, maxWounds: 3, isDestroyed: !!m.isDestroyed })),
    }) as any;

  it('counts one die per wound it would take to destroy the unit', () => {
    expect(dangerousTerrainText(mk([{ wounds: 1 }, { wounds: 1 }, { wounds: 1 }, { wounds: 1 }, { wounds: 1 }]))).toBe(
      '⚠️ Dangerous terrain: 5 dice, each 1 is a wound'
    );
  });

  it('counts what a wounded Tough model has left, and ignores dead models', () => {
    expect(dangerousTerrainText(mk([{ wounds: 2 }]))).toBe('⚠️ Dangerous terrain: 2 dice, each 1 is a wound');
    expect(dangerousTerrainText(mk([{ wounds: 1 }, { wounds: 3, isDestroyed: true }]))).toBe(
      '⚠️ Dangerous terrain: 1 die, each 1 is a wound'
    );
  });
});

describe('HTML escaping in GameHUD (G-06)', () => {
  it('renders a rejection message containing <img src=x onerror=…> as text, not as an element', () => {
    const { hud, container } = setup(HOST);
    hud.notifyRejected('<img src=x onerror=alert("rejected")>');

    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.textContent).toContain('Action rejected: <img src=x onerror=alert("rejected")>');
    expect(container.innerHTML).toContain('&lt;img');
  });

  it('renders a unit name and room code containing <img src=x onerror=…> as text, not as an element', () => {
    const state = scenarioState();
    const myUnit = state.units.find((u) => u.ownerId === HOST)!;
    myUnit.name = '<img src=x onerror=alert("my-unit")>';

    state.actionLog.push({
      action: createAction(HOST, 'activate-unit', { type: 'activate-unit', unitId: myUnit.id }),
      result: 'accepted',
    } as any);

    const { hud, container } = setup(HOST, state, { roomCode: '<img src=x onerror=alert("room")>' });

    // Inspect the unit so datacard renders
    (hud as any).selectedUnitId = myUnit.id;
    (hud as any).render();

    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.textContent).toContain('<img src=x onerror=alert("my-unit")>');
    expect(container.textContent).toContain('Room: <img src=x onerror=alert("room")>');
    expect(container.innerHTML).toContain('&lt;img');
  });
});

describe('GameHUD cleanup and round transitions (G-23)', () => {
  it('dispose() clears the reactionTimerInterval', () => {
    const state = scenarioState();
    state.turnState.pendingReaction = {
      id: 'reaction-1',
      type: 'strike-back',
      targetUnitId: state.units[0].id,
      promptingPlayerId: HOST,
      durationMs: 30000,
      expiresAt: Date.now() + 30000,
    } as any;

    const { hud } = setup(HOST, state);
    expect((hud as any).reactionTimerInterval).not.toBeNull();

    hud.dispose();
    expect((hud as any).reactionTimerInterval).toBeNull();
  });

  it('syncFromState does not exit early on round transition and updates audio / turn state', () => {
    const state = scenarioState();
    const { hud } = setup(HOST, state);

    // Initial state: round 1, Host's turn
    expect(state.turnState.roundNumber).toBe(1);
    (hud as any).prevCurrentPlayerId = GUEST; // simulate was guest turn

    // Next state: round 2, Host's turn
    const stateRound2 = JSON.parse(JSON.stringify(state));
    stateRound2.turnState.roundNumber = 2;
    stateRound2.turnState.currentPlayerId = HOST;

    hud.syncFromState(stateRound2);

    // prevCurrentPlayerId must be updated (not left stale by early return)
    expect((hud as any).prevCurrentPlayerId).toBe(HOST);
  });
});
