// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Lobby, PeerReadyContext } from '../../src/ui/Lobby';

describe('Lobby UI', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders starter army selection controls and deployment checkbox', () => {
    const lobby = new Lobby(container);
    (lobby as any).render();

    const hostSelect = container.querySelector('#hostArmySelect') as HTMLSelectElement;
    const guestSelect = container.querySelector('#guestArmySelect') as HTMLSelectElement;
    const deployCheck = container.querySelector('#deployPhaseCheck') as HTMLInputElement;

    expect(hostSelect).toBeTruthy();
    expect(guestSelect).toBeTruthy();
    expect(deployCheck).toBeTruthy();
    expect(deployCheck.checked).toBe(true);

    expect(hostSelect.value).toBe('frontier-wardens-starter');
    expect(guestSelect.value).toBe('rust-raiders-starter');
  });

  it('updates starter force selection and deployment mode on user change', () => {
    const lobby = new Lobby(container);
    (lobby as any).render();

    const hostSelect = container.querySelector('#hostArmySelect') as HTMLSelectElement;
    const deployCheck = container.querySelector('#deployPhaseCheck') as HTMLInputElement;

    hostSelect.value = 'rust-raiders-starter';
    hostSelect.dispatchEvent(new Event('change'));

    deployCheck.checked = false;
    deployCheck.dispatchEvent(new Event('change'));

    expect((lobby as any).hostArmyId).toBe('rust-raiders-starter');
    expect((lobby as any).useDeploymentPhase).toBe(false);
  });

  it('passes selected starter armies and deployment settings to onPeerReady', () => {
    let capturedContext: PeerReadyContext | null = null;
    const lobby = new Lobby(container, {
      onPeerReady: (ctx) => {
        capturedContext = ctx;
      },
    });
    (lobby as any).render();

    const hostSelect = container.querySelector('#hostArmySelect') as HTMLSelectElement;
    hostSelect.value = 'rust-raiders-starter';
    hostSelect.dispatchEvent(new Event('change'));

    (lobby as any).roomCode = 'TEST-123';
    (lobby as any).role = 'host';
    (lobby as any).webrtcClient = {
      isConnected: () => true,
    };

    (lobby as any).maybeFirePeerReady();

    expect(capturedContext).toBeTruthy();
    expect(capturedContext!.hostArmyId).toBe('rust-raiders-starter');
    expect(capturedContext!.guestArmyId).toBe('rust-raiders-starter');
    expect(capturedContext!.useDeploymentPhase).toBe(true);
    expect(capturedContext!.role).toBe('host');
    expect(capturedContext!.roomCode).toBe('TEST-123');
  });
});
