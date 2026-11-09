// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  applyAction,
  applyDefaultScenario,
  createAction,
  createBlankMap,
  createInitialGameState,
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

function activationState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, { customMap: { ...createBlankMap(), id: 'blank' } });
  for (const u of state.units) u.isDeployed = true;
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.status = 'in-progress';
  return state;
}

function step(state: GameState, by: string, type: 'concede' | 'request-rematch'): GameState {
  const out = applyAction(state, createAction(by, type, { type } as any));
  if (!out.ok || !out.state) throw new Error(`${type} failed`);
  return out.state;
}

function setup(local: string, state: GameState) {
  const controller = { submitAction: vi.fn(), onReturnToLobby: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: local, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container };
}

const btn = (root: HTMLElement) =>
  root.querySelector('[data-action="play-again"]') as HTMLButtonElement | null;

describe('GameHUD Play Again (14B)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('shows Play Again to both players after a concede, the conceder included', () => {
    const over = step(activationState(), GUEST, 'concede');
    for (const who of [HOST, GUEST]) {
      document.body.innerHTML = '';
      const { container } = setup(who, over);
      expect(btn(container)!.textContent).toBe('Play Again');
      expect(btn(container)!.disabled).toBe(false);
      expect(container.querySelector('[data-action="return-lobby"]')).not.toBeNull();
    }
  });

  it('shows Play Again after an elimination ending too', () => {
    const s = activationState();
    for (const u of s.units.filter((x) => x.ownerId === GUEST)) u.isDestroyed = true;
    s.status = 'game-over';
    s.winner = HOST;
    s.endReason = 'Elimination';
    expect(btn(setup(GUEST, s).container)).not.toBeNull();
  });

  it('pressing it sends exactly one request-rematch and shows Waiting for <opponent>', () => {
    const over = step(activationState(), GUEST, 'concede');
    const { container, controller } = setup(HOST, over);
    btn(container)!.click();
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('request-rematch');
    expect(action.actorId).toBe(HOST);
    expect(btn(container)!.textContent).toBe('Waiting for Bob…');
    expect(btn(container)!.disabled).toBe(true);
    btn(container)!.click();
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
  });

  it('shows Waiting when the confirmed state already lists me', () => {
    const over = step(step(activationState(), GUEST, 'concede'), HOST, 'request-rematch');
    const { container } = setup(HOST, over);
    expect(btn(container)!.textContent).toBe('Waiting for Bob…');
    expect(btn(container)!.disabled).toBe(true);
  });

  it('the opponent sees "<name> wants a rematch" and a primary Accept rematch button', () => {
    const over = step(step(activationState(), GUEST, 'concede'), HOST, 'request-rematch');
    const { container, controller } = setup(GUEST, over);
    expect(container.querySelector('.sl-hud-gameover')!.textContent).toContain(
      'Alice wants a rematch'
    );
    const b = btn(container)!;
    expect(b.textContent).toBe('Accept rematch');
    expect(b.classList.contains('primary')).toBe(true);
    expect(b.disabled).toBe(false);
    b.click();
    expect(controller.submitAction.mock.calls[0][0].type).toBe('request-rematch');
  });

  it('is disabled with "Opponent has left" once the opponent is gone', () => {
    const over = step(activationState(), GUEST, 'concede');
    const { hud, container, controller } = setup(HOST, over);
    hud.setNetworkStatus({ peer: 'disconnected' });
    const b = btn(container)!;
    expect(b.textContent).toBe('Opponent has left');
    expect(b.disabled).toBe(true);
    b.click();
    expect(controller.submitAction).not.toHaveBeenCalled();
  });

  it('a new gameId closes the modal, toasts, and clears per-match local state', () => {
    const { hud, container } = setup(HOST, step(activationState(), GUEST, 'concede'));
    btn(container)!.click();
    const internals = hud as any;
    internals.stagedSquadModelPositions.set('m', { x: 1, y: 0, z: 1 });
    internals.casualtyPicked = ['m'];
    internals.concedePending = true;
    internals.concedeConfirmOpen = true;
    internals.flow = { mode: 'targeting', action: 'move' };
    internals.lastSeenLogIndex = 9;

    const fresh = activationState();
    fresh.gameId = 'rematch-game';
    hud.syncFromState(fresh);

    expect(container.querySelector('.sl-hud-gameover')).toBeNull();
    expect(container.querySelector('.sl-hud-toast')!.textContent).toBe(
      'Rematch started — same armies, same map'
    );
    expect(internals.stagedSquadModelPositions.size).toBe(0);
    expect(internals.casualtyPicked).toEqual([]);
    expect(internals.concedePending).toBe(false);
    expect(internals.concedeConfirmOpen).toBe(false);
    expect(internals.flow).toEqual({ mode: 'idle' });
    expect(internals.lastSeenLogIndex).toBe(0);
    expect(internals.rematchPending).toBe(false);
  });

  it('does not toast for ordinary updates of the same game, nor for the first state', () => {
    const state = activationState();
    const { hud, container } = setup(HOST, state);
    expect(container.textContent).not.toContain('Rematch started');
    hud.syncFromState({ ...state, lastActionId: 'x' });
    expect(container.textContent).not.toContain('Rematch started');
  });
});
