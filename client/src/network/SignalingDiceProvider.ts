import { DiceResult, DiceSpec, SignalingMessage } from '@skirmish-lab/shared';
import { SignalingClient } from './SignalingClient';

/**
 * Dice provider backed by the signaling server.
 *
 * All rolls go through the server's RNG (never client-side) and are
 * broadcast to both peers simultaneously. The host requests rolls for
 * confirmed attack actions and resolves when the matching rollId arrives.
 */
export class SignalingDiceProvider {
  private signaling: SignalingClient;
  private timeoutMs: number;

  constructor(signaling: SignalingClient, timeoutMs = 10000) {
    this.signaling = signaling;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Request a roll from the signaling server and resolve with the results
   * for this rollId. Rejects on timeout (server unreachable / room gone).
   */
  requestRoll(rollId: string, specs: DiceSpec[]): Promise<DiceResult[]> {
    return new Promise<DiceResult[]>((resolve, reject) => {
      let settled = false;

      const handler = (message: SignalingMessage) => {
        if (message.type !== 'roll-dice-result' || message.rollId !== rollId) return;
        cleanup();
        settled = true;
        resolve(message.results);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error('Dice roll timed out'));
      }, this.timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.signaling.off('roll-dice-result', handler);
      };

      this.signaling.on('roll-dice-result', handler);
      this.signaling.requestDiceRoll(rollId, specs);
    });
  }
}
