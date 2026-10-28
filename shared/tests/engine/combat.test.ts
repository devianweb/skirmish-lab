import { describe, it, expect } from 'vitest';
import {
  extractAttackRolls,
  getAttackDiceSpecs,
  resolveAttack,
} from '../../src/engine/combat';

describe('combat', () => {
  it('computes dice specs: attack dice plus matched defense dice', () => {
    const specs = getAttackDiceSpecs(3);
    expect(specs).toEqual([
      { count: 3, sides: 6, purpose: 'to-hit' },
      { count: 3, sides: 6, purpose: 'defense' },
    ]);
  });

  it('scores hits when the roll meets or beats the attacker quality', () => {
    const outcome = resolveAttack(
      { quality: 3 },
      { defense: 6 },
      4,
      { toHit: [1, 2, 3, 6], defense: [6, 6, 6, 6] }
    );
    // Q3+ hits on 3, 4, 5, 6 — the 1 and 2 miss.
    expect(outcome.hitRolls).toEqual([false, false, true, true]);
    expect(outcome.hitCount).toBe(2);
  });

  it('blocks hits when the defense roll meets or beats the defender defense', () => {
    const outcome = resolveAttack(
      { quality: 2 },
      { defense: 5 },
      2,
      { toHit: [6, 6], defense: [4, 5] }
    );
    // D5+ blocks on 5 or 6 — the 4 fails, the 5 blocks.
    expect(outcome.blockedRolls).toEqual([false, true]);
    expect(outcome.blockedCount).toBe(1);
    expect(outcome.wounds).toBe(1);
  });

  it('pairs defense dice with hits in order, ignoring defense dice for missed attacks', () => {
    const outcome = resolveAttack(
      { quality: 4 },
      { defense: 4 },
      3,
      { toHit: [6, 1, 5], defense: [2, 6, 6] }
    );
    // Hits: rolls 6 and 5. Defense dice pair with hits: 1st hit vs defense 2
    // (fails to block), 2nd hit vs defense 6 (blocks). The 3rd defense die
    // belongs to the missed attack and is never used.
    expect(outcome.hitCount).toBe(2);
    expect(outcome.blockedRolls).toEqual([false, true]);
    expect(outcome.wounds).toBe(1);
  });

  it('applies a cover penalty: covered targets are harder to hit', () => {
    const uncovered = resolveAttack({ quality: 4 }, { defense: 6 }, 1, {
      toHit: [4],
      defense: [6],
    });
    const covered = resolveAttack({ quality: 4 }, { defense: 6, inCover: true }, 1, {
      toHit: [4],
      defense: [6],
    });
    expect(uncovered.hitCount).toBe(1);
    // Q4 becomes Q5 in cover — a roll of 4 now misses.
    expect(covered.hitCount).toBe(0);
  });

  it('throws when the dice arrays are shorter than the attack count', () => {
    expect(() =>
      resolveAttack({ quality: 4 }, { defense: 4 }, 3, { toHit: [6, 6], defense: [6] })
    ).toThrow(/Incomplete dice results/);
  });

  it('extracts to-hit and defense rolls from server results by purpose', () => {
    const rolls = extractAttackRolls([
      { rolls: [3, 5], total: 8, finalTotal: 8, purpose: 'to-hit' },
      { rolls: [6, 2], total: 8, finalTotal: 8, purpose: 'defense' },
    ]);
    expect(rolls).toEqual({ toHit: [3, 5], defense: [6, 2] });
  });

  it('throws when results are missing a purpose', () => {
    expect(() =>
      extractAttackRolls([{ rolls: [3], total: 3, finalTotal: 3, purpose: 'to-hit' }])
    ).toThrow(/to-hit.*defense/);
  });
});
