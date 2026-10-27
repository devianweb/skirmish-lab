import { DiceSpec, DiceResult } from '@trench-heresy/shared';
import * as crypto from 'crypto';

export class DiceRoller {
  rollDice(specs: DiceSpec[]): DiceResult[] {
    const results: DiceResult[] = [];

    for (const spec of specs) {
      const rolls: number[] = [];
      for (let i = 0; i < spec.count; i++) {
        // Use crypto.randomInt for secure RNG
        rolls.push(crypto.randomInt(1, spec.sides + 1));
      }

      const total = rolls.reduce((sum, roll) => sum + roll, 0);
      const modifier = spec.modifier || 0;
      const finalTotal = total + modifier;

      results.push({
        rolls,
        total,
        modifier,
        finalTotal,
        purpose: spec.purpose,
      });
    }

    return results;
  }

  rollSingle(sides: number): number {
    return crypto.randomInt(1, sides + 1);
  }
}
