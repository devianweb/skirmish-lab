import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignalingDiceProvider } from '../../src/network/SignalingDiceProvider';
import { SignalingClient } from '../../src/network/SignalingClient';
import { DiceResult, SignalingMessage } from '@skirmish-lab/shared';

describe('SignalingDiceProvider', () => {
  let handlers: Map<string, Function[]>;
  let signaling: SignalingClient;

  beforeEach(() => {
    handlers = new Map();
    signaling = {
      on: vi.fn((type: string, handler: Function) => {
        handlers.set(type, [...(handlers.get(type) ?? []), handler]);
      }),
      off: vi.fn((type: string, handler: Function) => {
        handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== handler));
      }),
      requestDiceRoll: vi.fn(),
    } as unknown as SignalingClient;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function deliver(message: SignalingMessage) {
    for (const handler of handlers.get('roll-dice-result') ?? []) handler(message);
  }

  const specs = [{ count: 2, sides: 6, purpose: 'to-hit' }];
  const results: DiceResult[] = [
    { rolls: [4, 5], total: 9, finalTotal: 9, purpose: 'to-hit' },
  ];

  it('requests the roll from the signaling server and resolves on the matching rollId', async () => {
    const provider = new SignalingDiceProvider(signaling);
    const pending = provider.requestRoll('roll-1', specs);

    expect(signaling.requestDiceRoll).toHaveBeenCalledWith('roll-1', specs);

    // A result for a different rollId must not resolve the request.
    deliver({ type: 'roll-dice-result', rollId: 'roll-other', results });
    const settled = await Promise.race([pending.then(() => 'resolved'), 'pending']);
    expect(settled).toBe('pending');

    deliver({ type: 'roll-dice-result', rollId: 'roll-1', results });
    await expect(pending).resolves.toEqual(results);
  });

  it('unsubscribes its listener once resolved', async () => {
    const provider = new SignalingDiceProvider(signaling);
    const pending = provider.requestRoll('roll-1', specs);
    deliver({ type: 'roll-dice-result', rollId: 'roll-1', results });
    await expect(pending).resolves.toEqual(results);

    expect(handlers.get('roll-dice-result')).toHaveLength(0);
    expect(signaling.off).toHaveBeenCalled();
  });

  it('rejects on timeout when the server never answers', async () => {
    vi.useFakeTimers();
    const provider = new SignalingDiceProvider(signaling, 25);
    const pending = provider.requestRoll('roll-1', specs);

    const expectation = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30);
    await expectation;

    // Listener cleaned up after the timeout too.
    expect(handlers.get('roll-dice-result')).toHaveLength(0);
  });

  it('retries requestDiceRoll on configured retry interval until resolved', async () => {
    vi.useFakeTimers();
    const provider = new SignalingDiceProvider(signaling, {
      timeoutMs: 5000,
      retryIntervalMs: 1000,
      maxRetries: 3,
    });

    const pending = provider.requestRoll('roll-retry', specs);
    expect(signaling.requestDiceRoll).toHaveBeenCalledTimes(1);

    // After 1000ms: retry 1
    await vi.advanceTimersByTimeAsync(1000);
    expect(signaling.requestDiceRoll).toHaveBeenCalledTimes(2);

    // After 2000ms: retry 2
    await vi.advanceTimersByTimeAsync(1000);
    expect(signaling.requestDiceRoll).toHaveBeenCalledTimes(3);

    // Deliver result on retry
    deliver({ type: 'roll-dice-result', rollId: 'roll-retry', results });
    await expect(pending).resolves.toEqual(results);

    // Timers stopped: no further retries
    await vi.advanceTimersByTimeAsync(1000);
    expect(signaling.requestDiceRoll).toHaveBeenCalledTimes(3);
  });

  it('attempts ensureConnected before requesting roll if disconnected', async () => {
    const isConnectedMock = vi.fn(() => false);
    const ensureConnectedMock = vi.fn(async () => {});
    (signaling as any).isConnected = isConnectedMock;
    (signaling as any).ensureConnected = ensureConnectedMock;

    const provider = new SignalingDiceProvider(signaling);
    const pending = provider.requestRoll('roll-reconn', specs);

    expect(isConnectedMock).toHaveBeenCalled();
    expect(ensureConnectedMock).toHaveBeenCalled();

    // Allow ensureConnected promise to resolve and attach the listener
    await Promise.resolve();

    deliver({ type: 'roll-dice-result', rollId: 'roll-reconn', results });
    await expect(pending).resolves.toEqual(results);
  });
});
