// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  STARTER_ARMIES,
  Vector3,
  createInitialGameState,
  createUnitsFromStarterArmy,
  validateAction,
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
const BLOCK = [P(0, 0, 0), P(1, 0, 0), P(0, 0, 1), P(1, 0, 1)];

function setup(opts: { foeAt?: Vector3; starts?: Vector3[] } = {}) {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.status = 'in-progress';
  state.terrain = [];
  const squad = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST)[0];
  const starts = opts.starts ?? BLOCK;
  squad.models.forEach((m, i) => (m.position = { ...starts[i] }));
  squad.position = { ...starts[0] };
  squad.speed = 6;
  squad.remainingMovement = 6;
  squad.isDeployed = true;
  squad.isActivated = true;
  const foe = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], GUEST)[0];
  foe.models.forEach((m, i) => (m.position = i === 0 && opts.foeAt ? { ...opts.foeAt } : P(-20 + i * 2, 0, 30)));
  foe.position = { ...foe.models[0].position! };
  foe.isDeployed = true;
  state.units = [squad, foe];
  state.turnState.activeUnitId = squad.id;
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';

  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  hud.show();
  hud.syncFromState(state);
  const internals = hud as any;
  internals.flow = { mode: 'targeting', action: 'move' };
  internals.selectedSquadModelId = squad.models[0].id;
  return { hud, internals, state, squad, container };
}

describe('GameHUD squad follow-through', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('placing one of four models offers Confirm move straight away', () => {
    const { internals, container } = setup();
    internals.handleSquadModelPick(P(0, 0, 5), 'move');
    internals.render();
    expect(internals.stagedSquadModelPositions.size).toBe(1);
    expect(container.querySelector('[data-action="confirm-squad-move"]')).toBeTruthy();
    expect(container.textContent).toContain('the other 3 will follow');
  });

  it('shows where the rest will go as soon as one model is placed, and reuses the plan until something changes', () => {
    const { internals } = setup();
    internals.handleSquadModelPick(P(0, 0, 5), 'move');
    const emitted: any[] = [];
    internals.onMarkersChange = (m: any) => emitted.push(m);
    const first = internals.squadFollowPlan('move');
    expect(first.ok).toBe(true);
    expect(first.placements.size).toBe(3);
    // Re-renders and marker emits (mouse moves) reuse the same computation
    internals.render();
    internals.emitMarkers();
    expect(internals.squadFollowPlan('move')).toBe(first);
    // Placing another model changes the inputs: a fresh plan for the two that remain
    internals.selectedSquadModelId = internals.activeAliveSquadModels[3].id;
    internals.handleSquadModelPick(P(1, 0, 6), 'move');
    const second = internals.squadFollowPlan('move');
    expect(second).not.toBe(first);
    expect(second.placements.size).toBe(2);
  });

  it('Confirm sends a full payload the host accepts, with the three followers in formation', () => {
    const { internals, squad, container } = setup();
    internals.handleSquadModelPick(P(0, 0, 5), 'move');
    (container.querySelector('[data-action="confirm-squad-move"]') as HTMLElement).click();
    expect(internals.flow.mode).toBe('confirming');
    const payload = internals.flow.action.payload;
    expect(payload.modelPositions).toHaveLength(4);
    expect(payload.modelPositions[0]).toMatchObject({ x: 0, z: 5 });
    expect(payload.modelPositions[1]).toMatchObject({ x: 1, z: 5 });
    expect(payload.modelPositions[2]).toMatchObject({ x: 0, z: 6 });
    expect(payload.modelPositions[3]).toMatchObject({ x: 1, z: 6 });
    expect(payload.modelPaths).toHaveLength(4);
    expect(validateAction(internals.state, internals.flow.action)).toEqual({ valid: true });
    expect(squad.models).toHaveLength(4);
  });

  it('a hand-placed model is never moved by the follow-through', () => {
    const { internals, squad, container } = setup();
    internals.handleSquadModelPick(P(0, 0, 5), 'move');
    // Place model 4 by hand somewhere other than its formation spot
    internals.selectedSquadModelId = squad.models[3].id;
    internals.handleSquadModelPick(P(1.5, 0, 4.2), 'move');
    const hand = internals.stagedSquadModelPositions.get(squad.models[3].id);
    (container.querySelector('[data-action="confirm-squad-move"]') as HTMLElement).click();
    const payload = internals.flow.action.payload;
    expect(payload.modelPositions[3]).toEqual(hand);
    expect(payload.modelPositions[0]).toMatchObject({ x: 0, z: 5 });
    expect(validateAction(internals.state, internals.flow.action)).toEqual({ valid: true });
  });

  it('a Rush follows within its own 12" allowance', () => {
    const { internals, container } = setup();
    internals.flow = { mode: 'targeting', action: 'rush' };
    internals.handleSquadModelPick(P(0, 0, 12), 'rush');
    (container.querySelector('[data-action="confirm-squad-move"]') as HTMLElement).click();
    const payload = internals.flow.action.payload;
    expect(payload.type).toBe('rush');
    expect(payload.modelPositions[3]).toMatchObject({ x: 1, z: 13 });
    expect(validateAction(internals.state, internals.flow.action)).toEqual({ valid: true });
  });

  it('refuses with the model named when a follower cannot move and the squad would break apart', () => {
    const { internals, squad, container } = setup();
    squad.modelMovementSpent = { [squad.models[3].id]: 6 }; // model 4 has no move left
    internals.syncFromState?.(internals.state);
    internals.handleSquadModelPick(P(0, 0, 5), 'move');
    const toast = vi.spyOn(internals, 'showToast');
    (container.querySelector('[data-action="confirm-squad-move"]') as HTMLElement).click();
    expect(internals.flow.mode).toBe('targeting'); // nothing was sent for confirmation
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Model 4 /));
    expect(internals.squadBlockedModels.get(squad.models[3].id)).toMatch(/^Not placed: Model 4 /);
  });

  it('Reset placement clears the hand placements and the ghosts', () => {
    const { internals, container } = setup();
    internals.handleSquadModelPick(P(0, 0, 5), 'move');
    (container.querySelector('[data-action="reset-squad-move"]') as HTMLElement).click();
    expect(internals.stagedSquadModelPositions.size).toBe(0);
    expect(internals.squadFollowPlan('move')).toBeNull();
  });
});
