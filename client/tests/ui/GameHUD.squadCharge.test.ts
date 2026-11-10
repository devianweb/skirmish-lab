// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  Unit,
  Vector3,
  applyAction,
  applyDefaultScenario,
  createBlankMap,
  createInitialGameState,
  validateAction,
} from '@skirmish-lab/shared';
import { legacyScenarioTerrain } from '../../../shared/tests/fixtures/legacyScenarioTerrain';
import { GameHUD } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function clickByText(root: HTMLElement, text: string): HTMLElement | null {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return (found as HTMLElement) ?? null;
}

/** A 3-model host squad in a row at z = -10 (charge reach 12") and a lone enemy at z = -2. */
function setup() {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, {
    customMap: { ...createBlankMap(), id: 'fixture', terrain: legacyScenarioTerrain() },
  });
  state.terrain = [];
  const unit = state.units.find((u) => u.ownerId === HOST)!;
  const spots: Array<[number, number]> = [[-1, -10], [0, -10], [1, -10]];
  unit.models = spots.map(([x, z], i) => ({
    id: `sq-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: P(x, 0, z),
    rotation: { x: 0, y: 0, z: 0 },
  }));
  unit.position = P(0, 0, -10);
  unit.wounds = 3;
  unit.maxWounds = 3;
  unit.isActivated = true;
  unit.status = [];
  unit.specialRules = unit.specialRules.filter((r) => r !== 'immobile');
  state.turnState.activeUnitId = unit.id;
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
  const enemies = state.units.filter((u) => u.ownerId !== HOST);
  enemies.forEach((u, i) => {
    u.models = [];
    u.position = i === 0 ? P(0, 0, -2) : P(-20 + i * 3, 0, 18);
  });
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state, unit, enemy: enemies[0] };
}

function declare(ctx: ReturnType<typeof setup>): GameState {
  clickByText(ctx.container, 'Charge');
  ctx.hud.handleBoardPick({ kind: 'unit', unitId: ctx.enemy.id });
  clickByText(ctx.container, 'Confirm');
  const begin = ctx.controller.submitAction.mock.calls[0][0];
  expect(begin.type).toBe('begin-charge');
  const declared = applyAction(ctx.state, begin);
  if (!declared.ok) throw new Error(declared.reason);
  ctx.hud.syncFromState(declared.state!);
  ctx.controller.submitAction.mockClear();
  return declared.state!;
}

describe('GameHUD per-model squad charges (batch 1D PR 11)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('declares the charge first, then asks for each model with the target locked', () => {
    const ctx = setup();
    declare(ctx);
    expect(ctx.container.textContent).toContain('place Model 1 of 3');
    // Owner feedback 2026-11-09: abandoning is a quiet secondary button, never the highlighted action
    const abandon = Array.from(ctx.container.querySelectorAll('button')).find((b) => b.textContent === 'Abandon charge');
    expect(abandon).toBeTruthy();
    expect(abandon!.classList.contains('primary')).toBe(false);
    expect(Array.from(ctx.container.querySelectorAll('button')).some((b) => b.textContent === 'End (no melee)')).toBe(false);
  });

  it('a declared squad charge draws one ring, on the selected model, not a second unit-wide disc', () => {
    const ctx = setup();
    let last: any = null;
    ctx.hud.onMarkers((m) => (last = m));
    declare(ctx);
    expect(last.attackRange ?? null).toBeNull();
    expect(last.movementRangePosition).toEqual(P(-1, 0, -10));
    expect(last.movementRangeRadius).toBeCloseTo(ctx.unit.speed * 2, 5);
  });

  it('placing every model sends one charge with per-model positions and paths the host accepts', () => {
    const ctx = setup();
    const declared = declare(ctx);
    // Model 1 and 2 close into base contact (z = -3 is 1" from the enemy at z = -2), model 3 as close as it goes
    ctx.hud.handleBoardPick({ kind: 'position', position: P(0, 0, -3) });
    ctx.hud.handleBoardPick({ kind: 'position', position: P(-1, 0, -3) });
    ctx.hud.handleBoardPick({ kind: 'position', position: P(1, 0, -3) });
    expect(container(ctx)).toContain('3 of 3 models');
    clickByText(ctx.container, 'Confirm');
    const action = ctx.controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('charge');
    expect(action.payload.modelPositions).toHaveLength(3);
    expect(action.payload.modelPaths).toHaveLength(3);
    expect(action.payload.targetId).toBe(ctx.enemy.id);
    expect(validateAction(declared, action).valid).toBe(true);
  });

  it('clicking the target puts the selected model into base contact with it', () => {
    const ctx = setup();
    const declared = declare(ctx);
    ctx.hud.handleBoardPick({ kind: 'unit', unitId: ctx.enemy.id });
    expect(Array.from(ctx.container.querySelectorAll('button')).some((b) => b.textContent?.includes('✓ Model 1'))).toBe(true);
    ctx.hud.handleBoardPick({ kind: 'position', position: P(-1, 0, -2.6) });
    ctx.hud.handleBoardPick({ kind: 'position', position: P(1, 0, -2.6) });
    clickByText(ctx.container, 'Confirm');
    const action = ctx.controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('charge');
    expect(validateAction(declared, action).valid).toBe(true);
  });

  it('when no placed model touches the target the confirmation is a leg and spends each model own distance', () => {
    const ctx = setup();
    const declared = declare(ctx);
    ctx.hud.handleBoardPick({ kind: 'position', position: P(0, 0, -7) });
    ctx.hud.handleBoardPick({ kind: 'position', position: P(-1, 0, -7) });
    ctx.hud.handleBoardPick({ kind: 'position', position: P(1, 0, -7) });
    expect(ctx.container.textContent).toContain('Charge leg');
    clickByText(ctx.container, 'Confirm');
    const action = ctx.controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('charge-leg');
    expect(action.payload.modelPositions).toHaveLength(3);
    const res = applyAction(declared, action);
    expect(res.ok).toBe(true);
    // Per-model budgets: the unit figure is what the model that walked least (3") still has, not the longest walk's
    expect(res.state!.units.find((u) => u.id === action.payload.attackerId)!.remainingMovement).toBeCloseTo(9, 1);
  });

  it('Confirm charge early keeps unplaced models where they stand when the squad is still coherent', () => {
    const ctx = setup();
    declare(ctx);
    ctx.hud.handleBoardPick({ kind: 'position', position: P(-1, 0, -9) }); // model 1 steps 1" forward
    clickByText(ctx.container, 'Confirm charge');
    clickByText(ctx.container, 'Confirm');
    const action = ctx.controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('charge-leg');
    expect(action.payload.modelPositions[1]).toEqual(P(0, 0, -10));
    expect(action.payload.modelPositions[2]).toEqual(P(1, 0, -10));
  });

  it('Confirm charge with one model touching the target moves the unplaced models up as close as they can', () => {
    const ctx = setup();
    const declared = declare(ctx);
    ctx.hud.handleBoardPick({ kind: 'position', position: P(0, 0, -3) }); // model 1 in base contact
    clickByText(ctx.container, 'Confirm charge');
    expect(ctx.container.textContent).toContain('moved up as close as they can: Model 2, Model 3');
    clickByText(ctx.container, 'Confirm');
    const action = ctx.controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('charge');
    expect(action.payload.modelPositions[0]).toEqual(P(0, 0, -3));
    // Models 2 and 3 left their rank and ended next to the target, not where they stood
    for (const i of [1, 2]) {
      const end = action.payload.modelPositions[i];
      expect(end.z).toBeGreaterThan(-9);
      expect(Math.hypot(end.x - 0, end.z + 2)).toBeLessThan(2.3);
    }
    expect(validateAction(declared, action).valid).toBe(true);
  });

  it('shows the host reason when a placed model holds back from the target', () => {
    const ctx = setup();
    declare(ctx);
    ctx.hud.handleBoardPick({ kind: 'position', position: P(0, 0, -3) });
    ctx.hud.handleBoardPick({ kind: 'position', position: P(-1, 0, -3.9) }); // 1.2" short with room to move up
    ctx.hud.handleBoardPick({ kind: 'position', position: P(1, 0, -3) });
    expect(ctx.controller.submitAction).not.toHaveBeenCalled();
    expect(ctx.container.querySelector('.sl-hud-toast')?.textContent).toMatch(/Model 2 could get closer to the target/);
  });

  it('refuses a placement that would leave the squad out of coherency, with the host reason', () => {
    const ctx = setup();
    declare(ctx);
    ctx.hud.handleBoardPick({ kind: 'position', position: P(-1, 0, -4) }); // model 1 runs 6" ahead of the rest
    clickByText(ctx.container, 'Confirm charge');
    expect(ctx.controller.submitAction).not.toHaveBeenCalled();
    expect(ctx.container.textContent).toMatch(/coherency|nearest squad member/i);
  });
});

function container(ctx: { container: HTMLElement }): string {
  return ctx.container.textContent ?? '';
}
