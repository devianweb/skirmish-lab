import { DiceSpec, DiceResult } from '@skirmish-lab/shared';
import * as crypto from 'crypto';

export const MIN_DICE_SPECS = 1;
export const MAX_DICE_SPECS = 64;
export const MIN_DIE_COUNT = 1;
export const MAX_DIE_COUNT = 500;
export const MAX_TOTAL_DICE_COUNT = 2000;
export const MIN_DIE_SIDES = 2;
export const MAX_DIE_SIDES = 20;

export class DiceRoller {
  isValidSpecs(specs: unknown): specs is DiceSpec[] {
    if (!Array.isArray(specs) || specs.length < MIN_DICE_SPECS || specs.length > MAX_DICE_SPECS) {
      return false;
    }

    let totalCount = 0;
    for (const spec of specs) {
      if (!spec || typeof spec !== 'object') {
        return false;
      }
      const { count, sides, modifier, purpose } = spec as Record<string, unknown>;
      if (
        typeof count !== 'number' ||
        !Number.isInteger(count) ||
        count < MIN_DIE_COUNT ||
        count > MAX_DIE_COUNT
      ) {
        return false;
      }
      if (
        typeof sides !== 'number' ||
        !Number.isInteger(sides) ||
        sides < MIN_DIE_SIDES ||
        sides > MAX_DIE_SIDES
      ) {
        return false;
      }
      if (modifier !== undefined && (typeof modifier !== 'number' || !Number.isFinite(modifier))) {
        return false;
      }
      if (purpose !== undefined && typeof purpose !== 'string') {
        return false;
      }
      totalCount += count;
      if (totalCount > MAX_TOTAL_DICE_COUNT) {
        return false;
      }
    }

    return true;
  }

  areSpecsEqual(a: DiceSpec[], b: DiceSpec[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (
        a[i].count !== b[i].count ||
        a[i].sides !== b[i].sides ||
        (a[i].purpose ?? undefined) !== (b[i].purpose ?? undefined) ||
        (a[i].modifier ?? 0) !== (b[i].modifier ?? 0)
      ) {
        return false;
      }
    }
    return true;
  }

  rollDice(specs: DiceSpec[]): DiceResult[] {
    if (!this.isValidSpecs(specs)) {
      throw new Error('Invalid dice specs');
    }

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
    if (
      typeof sides !== 'number' ||
      !Number.isInteger(sides) ||
      sides < MIN_DIE_SIDES ||
      sides > MAX_DIE_SIDES
    ) {
      throw new Error('Invalid die sides');
    }
    return crypto.randomInt(1, sides + 1);
  }
}
