import { describe, it, expect, beforeEach } from 'vitest';
import { DiceRoller } from '../src/DiceRoller';

describe('DiceRoller', () => {
  let diceRoller: DiceRoller;

  beforeEach(() => {
    diceRoller = new DiceRoller();
  });

  it('should roll correct number of dice', () => {
    const results = diceRoller.rollDice([{ count: 3, sides: 6 }]);
    expect(results).toHaveLength(1);
    expect(results[0].rolls).toHaveLength(3);
  });

  it('should roll dice in valid range', () => {
    const results = diceRoller.rollDice([{ count: 10, sides: 6 }]);
    results[0].rolls.forEach(roll => {
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    });
  });

  it('should calculate total correctly', () => {
    const results = diceRoller.rollDice([{ count: 2, sides: 6 }]);
    const expectedTotal = results[0].rolls[0] + results[0].rolls[1];
    expect(results[0].total).toBe(expectedTotal);
  });

  it('should apply modifiers', () => {
    const results = diceRoller.rollDice([{ count: 1, sides: 6, modifier: 2 }]);
    expect(results[0].modifier).toBe(2);
    expect(results[0].finalTotal).toBe(results[0].total + 2);
  });

  it('should preserve purpose', () => {
    const results = diceRoller.rollDice([{ count: 1, sides: 6, purpose: 'to-hit' }]);
    expect(results[0].purpose).toBe('to-hit');
  });

  it('should roll multiple different dice specs', () => {
    const results = diceRoller.rollDice([
      { count: 2, sides: 6, purpose: 'to-hit' },
      { count: 1, sides: 3, purpose: 'damage' }
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].rolls).toHaveLength(2);
    expect(results[1].rolls).toHaveLength(1);
  });

  it('should roll single die', () => {
    const roll = diceRoller.rollSingle(6);
    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(6);
  });

  describe('input validation (G-01)', () => {
    it('rejects non-array, empty array, or more than 64 dice specs', () => {
      expect(diceRoller.isValidSpecs(null)).toBe(false);
      expect(diceRoller.isValidSpecs(undefined)).toBe(false);
      expect(diceRoller.isValidSpecs({})).toBe(false);
      expect(diceRoller.isValidSpecs([])).toBe(false);
      const tooMany = Array.from({ length: 65 }, () => ({ count: 1, sides: 6 }));
      expect(diceRoller.isValidSpecs(tooMany)).toBe(false);
      const maxAllowed = Array.from({ length: 64 }, () => ({ count: 1, sides: 6 }));
      expect(diceRoller.isValidSpecs(maxAllowed)).toBe(true);
    });

    it('enforces integer count in 1..500 and integer sides in 2..20', () => {
      expect(diceRoller.isValidSpecs([{ count: 0, sides: 6 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: -1, sides: 6 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 1.5, sides: 6 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 501, sides: 6 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 500, sides: 6 }])).toBe(true);

      expect(diceRoller.isValidSpecs([{ count: 1, sides: 0 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 1, sides: 1 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 1, sides: -6 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 1, sides: 2.5 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 1, sides: 21 }])).toBe(false);
      expect(diceRoller.isValidSpecs([{ count: 1, sides: 2 }])).toBe(true);
      expect(diceRoller.isValidSpecs([{ count: 1, sides: 20 }])).toBe(true);
    });

    it('enforces a maximum total dice count of 2000 across all specs', () => {
      const exact2000 = [
        { count: 500, sides: 6 },
        { count: 500, sides: 6 },
        { count: 500, sides: 6 },
        { count: 500, sides: 6 },
      ];
      expect(diceRoller.isValidSpecs(exact2000)).toBe(true);

      const over2000 = [...exact2000, { count: 1, sides: 6 }];
      expect(diceRoller.isValidSpecs(over2000)).toBe(false);
    });

    it('compares dice spec arrays accurately for rollCache collision checks (G-05)', () => {
      expect(
        diceRoller.areSpecsEqual(
          [{ count: 2, sides: 6, purpose: 'to-hit' }],
          [{ count: 2, sides: 6, purpose: 'to-hit' }]
        )
      ).toBe(true);
      expect(
        diceRoller.areSpecsEqual(
          [{ count: 2, sides: 6, purpose: 'to-hit' }],
          [{ count: 3, sides: 6, purpose: 'to-hit' }]
        )
      ).toBe(false);
      expect(
        diceRoller.areSpecsEqual(
          [{ count: 2, sides: 6, purpose: 'to-hit' }],
          [{ count: 2, sides: 3, purpose: 'to-hit' }]
        )
      ).toBe(false);
      expect(
        diceRoller.areSpecsEqual(
          [{ count: 2, sides: 6, purpose: 'to-hit' }],
          [{ count: 2, sides: 6, purpose: 'defense' }]
        )
      ).toBe(false);
    });
  });
});
