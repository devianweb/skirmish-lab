import { DiceResult, DiceSpec, SignalingMessage } from '@skirmish-lab/shared';
import { SignalingClient } from './SignalingClient';

export interface SignalingDiceProviderOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
  maxRetries?: number;
}

/**
 * Dice provider backed by the signaling server.
 *
 * All rolls go through the server's RNG (never client-side) and are
 * broadcast to both peers simultaneously. The host requests rolls for
 * confirmed attack actions and resolves when the matching rollId arrives.
 * Resilient against temporary disconnects: attempts reconnection and retries
 * requests before timing out.
 */
export class SignalingDiceProvider {
  private signaling: SignalingClient;
  private timeoutMs: number;
  private retryIntervalMs: number;
  private maxRetries: number;

  constructor(
    signaling: SignalingClient,
    options: SignalingDiceProviderOptions | number = 10000
  ) {
    this.signaling = signaling;
    if (typeof options === 'number') {
      this.timeoutMs = options;
      this.retryIntervalMs = 2000;
      this.maxRetries = 3;
    } else {
      this.timeoutMs = options.timeoutMs ?? 10000;
      this.retryIntervalMs = options.retryIntervalMs ?? 2000;
      this.maxRetries = options.maxRetries ?? 3;
    }
  }

  /**
   * Request a roll from the signaling server and resolve with the results
   * for this rollId. Retries on dropped packets or socket reconnects.
   * Rejects on timeout (server unreachable / room gone).
   */
  async requestRoll(rollId: string, specs: DiceSpec[]): Promise<DiceResult[]> {
    if (typeof this.signaling.isConnected === 'function' && !this.signaling.isConnected()) {
      try {
        await this.signaling.ensureConnected?.();
      } catch {
        // Continue to promise handler; retries and timeout will handle connection settling
      }
    }

    return new Promise<DiceResult[]>((resolve, reject) => {
      let settled = false;
      let retries = 0;

      const handler = (message: SignalingMessage) => {
        if (message.type !== 'roll-dice-result' || message.rollId !== rollId) return;
        cleanup();
        settled = true;
        resolve(message.results);
      };

      const cleanup = () => {
        clearTimeout(timeoutTimer);
        clearInterval(retryTimer);
        this.signaling.off('roll-dice-result', handler);
      };

      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error('Dice roll timed out'));
      }, this.timeoutMs);

      const retryTimer = setInterval(() => {
        if (settled) return;
        if (retries < this.maxRetries) {
          retries++;
          this.signaling.requestDiceRoll(rollId, specs);
        }
      }, this.retryIntervalMs);

      this.signaling.on('roll-dice-result', handler);
      this.signaling.requestDiceRoll(rollId, specs);
    });
  }
}
