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
});
