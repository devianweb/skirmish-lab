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

function conceded(state: GameState, by: string): GameState {
  const out = applyAction(state, createAction(by, 'concede', { type: 'concede' }));
  if (!out.ok || !out.state) throw new Error('concede failed');
  return out.state;
}

function setup(local: string, state: GameState = activationState()) {
  const controller = { submitAction: vi.fn(), onReturnToLobby: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: local, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state };
}

const q = (root: HTMLElement, action: string) =>
  root.querySelector(`[data-action="${action}"]`) as HTMLButtonElement | null;

describe('GameHUD concede and results screen (14A)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the Concede button to both players, deployment included, and hides it at game over', () => {
    for (const who of [HOST, GUEST]) {
      document.body.innerHTML = '';
      expect(q(setup(who).container, 'concede-open')).not.toBeNull();
    }
    document.body.innerHTML = '';
    const deploy = activationState();
    deploy.turnState.phase = 'deployment';
    expect(q(setup(HOST, deploy).container, 'concede-open')).not.toBeNull();
    document.body.innerHTML = '';
    const over = conceded(activationState(), GUEST);
    expect(q(setup(HOST, over).container, 'concede-open')).toBeNull();
  });

  it('opens a confirmation; Cancel sends nothing', () => {
    const { container, controller } = setup(GUEST);
    q(container, 'concede-open')!.click();
    expect(container.textContent).toContain('Concede the match? You lose and your opponent wins.');
    q(container, 'concede-cancel')!.click();
    expect(container.textContent).not.toContain('Concede the match?');
    expect(controller.submitAction).not.toHaveBeenCalled();
    expect(q(container, 'concede-open')!.textContent).toBe('Concede');
  });

  it('confirming sends exactly one concede action and shows Conceding...', () => {
    const { container, controller, state } = setup(GUEST);
    q(container, 'concede-open')!.click();
    q(container, 'concede-confirm')!.click();
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('concede');
    expect(action.actorId).toBe(GUEST);
    expect(applyAction(state, action).ok).toBe(true);
    const btn = q(container, 'concede-open')!;
    expect(btn.textContent).toBe('Conceding…');
    expect(btn.disabled).toBe(true);
    expect(container.textContent).not.toContain('Concede the match?');
  });

  it('the conceder sees Defeat and stays on the results screen without leaving', () => {
    const { hud, container, controller, state } = setup(GUEST);
    q(container, 'concede-open')!.click();
    q(container, 'concede-confirm')!.click();
    hud.syncFromState(conceded(state, GUEST));
    const modal = container.querySelector('.sl-hud-gameover')!;
    expect(modal.querySelector('h2')!.textContent).toBe('Defeat');
    expect(modal.querySelector('.sl-hud-gameover-reason')!.textContent).toBe('Bob conceded');
    expect(q(container, 'return-lobby')).not.toBeNull();
    expect(controller.onReturnToLobby).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(container.textContent).not.toContain("Couldn't reach your opponent");
  });

  it('the guest gets the button back and a toast when no state arrives within 5 s', () => {
    const { container } = setup(GUEST);
    q(container, 'concede-open')!.click();
    q(container, 'concede-confirm')!.click();
    vi.advanceTimersByTime(4900);
    expect(q(container, 'concede-open')!.disabled).toBe(true);
    vi.advanceTimersByTime(200);
    const btn = q(container, 'concede-open')!;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Concede');
    expect(container.querySelector('.sl-hud-toast')!.textContent).toBe(
      "Couldn't reach your opponent; the concede wasn't sent."
    );
    expect(container.querySelector('.sl-hud-gameover')).toBeNull();
  });

  it('with the disconnect banner up, the toast stacks under the banner instead of behind it', () => {
    // Owner feedback 2026-11-09 (checklist 9.4): the toast was hidden behind the "Opponent disconnected" banner.
    const { container, hud } = setup(GUEST);
    hud.setNetworkStatus({ peer: 'disconnected' });
    q(container, 'concede-open')!.click();
    q(container, 'concede-confirm')!.click();
    vi.advanceTimersByTime(5100);
    const stack = container.querySelector('.sl-hud-alerts')!;
    expect(stack.textContent).toContain('Opponent disconnected');
    const toast = stack.querySelector('.sl-hud-toast');
    expect(toast?.textContent).toBe("Couldn't reach your opponent; the concede wasn't sent.");
    expect(container.querySelectorAll('.sl-hud-toast').length).toBe(1);
  });

  it('the host never times out waiting', () => {
    const { container } = setup(HOST);
    q(container, 'concede-open')!.click();
    q(container, 'concede-confirm')!.click();
    vi.advanceTimersByTime(20000);
    expect(q(container, 'concede-open')!.textContent).toBe('Conceding…');
  });

  it('a rejection brings the button back', () => {
    const { hud, container } = setup(GUEST);
    q(container, 'concede-open')!.click();
    q(container, 'concede-confirm')!.click();
    hud.notifyRejected('Game is over');
    expect(q(container, 'concede-open')!.disabled).toBe(false);
  });

  it('the opponent sees Victory, the reason, rounds, loss lines and the objective breakdown', () => {
    const state = activationState();
    state.turnState.roundNumber = 3;
    state.objectives = [
      { id: 'o1', name: 'Alpha', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
    ];
    const guestUnit = state.units.find((u) => u.ownerId === GUEST)!;
    guestUnit.isDestroyed = true;
    for (const m of guestUnit.models) m.isDestroyed = true;
    const { container } = setup(HOST, conceded(state, GUEST));
    const modal = container.querySelector('.sl-hud-gameover')!;
    expect(modal.querySelector('h2')!.textContent).toBe('Victory');
    expect(modal.querySelector('.sl-hud-gameover-reason')!.textContent).toBe('Bob conceded');
    expect(modal.textContent).toContain('Rounds played: 3 of 4');
    expect(modal.textContent).toContain('Alpha: Host');
    const lines = Array.from(modal.querySelectorAll('.sl-hud-gameover-loss')).map((e) => e.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Alice lost 0 of \d+ units \(0 of \d+ models\)$/);
    expect(lines[1]).toMatch(/^Bob lost 1 of \d+ units \(\d+ of \d+ models\)$/);
  });

  it('after game over, a disconnect shows no banner but a "has left" line', () => {
    const over = conceded(activationState(), GUEST);
    const { hud, container } = setup(HOST, over);
    expect(container.textContent).not.toContain('has left.');
    hud.setNetworkStatus({ peer: 'disconnected' });
    expect(container.textContent).not.toContain('Opponent disconnected');
    expect(container.querySelector('.sl-hud-gameover-left')!.textContent).toBe('Bob has left.');
  });

  it('mid-match, a disconnect still shows the banner', () => {
    const { hud, container } = setup(HOST);
    hud.setNetworkStatus({ peer: 'disconnected' });
    expect(container.textContent).toContain('Opponent disconnected');
  });

  it('a round-4 tie shows Draw with the loss lines', () => {
    const state = activationState();
    state.status = 'game-over';
    state.turnState.phase = 'game-over';
    state.turnState.roundNumber = 4;
    state.endReason = 'Objectives tied (2 to 2)';
    const { container } = setup(GUEST, state);
    const modal = container.querySelector('.sl-hud-gameover')!;
    expect(modal.querySelector('h2')!.textContent).toBe('Draw');
    expect(modal.querySelector('.sl-hud-gameover-reason')!.textContent).toBe('Objectives tied (2 to 2)');
    expect(modal.textContent).toContain('Rounds played: 4 of 4');
    expect(modal.querySelectorAll('.sl-hud-gameover-loss')).toHaveLength(2);
  });
});
