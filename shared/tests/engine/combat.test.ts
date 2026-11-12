import { describe, it, expect } from 'vitest';
import {
  extractAttackRolls,
  getAttackDiceSpecs,
  resolveAttack,
  resolveMoraleTest,
} from '../../src/engine/combat';

describe('combat: core Quality / Defense & Cover axioms', () => {
  it('computes dice specs: attack dice plus matched defense dice', () => {
    const specs = getAttackDiceSpecs(3);
    expect(specs).toEqual([
      { count: 3, sides: 6, purpose: 'to-hit' },
      { count: 3, sides: 6, purpose: 'defense' },
    ]);
  });

  it('scores hits when the roll meets or beats the attacker quality (natural 1 misses, 6 hits)', () => {
    const outcome = resolveAttack(
      { quality: 3 },
      { defense: 6 },
      4,
      { toHit: [1, 2, 3, 6], defense: [6, 6, 6, 6] }
    );
    expect(outcome.hitRolls).toEqual([false, false, true, true]);
    expect(outcome.hitCount).toBe(2);
  });

  it('enforces natural 1 always fails and natural 6 always succeeds despite modifiers', () => {
    // Q2+ with Thrust's charge bonus (+1) still misses on natural 1.
    const nat1 = resolveAttack(
      { quality: 2, specialRules: ['thrust'], isMelee: true, isCharging: true },
      { defense: 2, weaponRules: ['ap(4)'] } as any,
      1,
      { toHit: [1], defense: [6] }
    );
    expect(nat1.hitCount).toBe(0);

    // Q6+ against Stealth (-1 at >9") still hits on natural 6; D6+ against AP(4) still blocks on natural 6.
    const nat6 = resolveAttack(
      { quality: 6, weaponRules: ['ap(4)'], distance: 18 },
      { defense: 6, specialRules: ['stealth'] },
      1,
      { toHit: [6], defense: [6] }
    );
    expect(nat6.hitCount).toBe(1);
    expect(nat6.blockedCount).toBe(1);
    expect(nat6.wounds).toBe(0);
  });

  it('blocks hits when the defense roll meets or beats the defender defense', () => {
    const outcome = resolveAttack(
      { quality: 2 },
      { defense: 5 },
      2,
      { toHit: [6, 6], defense: [4, 5] }
    );
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
    expect(outcome.hitCount).toBe(2);
    expect(outcome.blockedRolls).toEqual([false, true]);
    expect(outcome.wounds).toBe(1);
  });

  it('applies a +1 Defense bonus when the defender is in cover against ranged attacks', () => {
    // D5+ normally fails on a defense roll of 4, but in cover (4 + 1 >= 5) it blocks.
    const uncovered = resolveAttack({ quality: 4 }, { defense: 5 }, 1, {
      toHit: [4],
      defense: [4],
    });
    const covered = resolveAttack({ quality: 4 }, { defense: 5, inCover: true }, 1, {
      toHit: [4],
      defense: [4],
    });
    expect(uncovered.wounds).toBe(1);
    expect(covered.blockedCount).toBe(1);
    expect(covered.wounds).toBe(0);
    expect(covered.coverApplied).toBe(true);
    expect(covered.effectiveDefense).toBe(4);
  });

  it('ignores cover in melee and against Blast(X) weapons', () => {
    const meleeCovered = resolveAttack(
      { quality: 4, isMelee: true },
      { defense: 5, inCover: true },
      1,
      { toHit: [4], defense: [4] }
    );
    expect(meleeCovered.wounds).toBe(1);

    const blastCovered = resolveAttack(
      { quality: 4, weaponRules: ['blast(3)'] },
      { defense: 5, inCover: true, modelCount: 1 },
      1,
      { toHit: [4], defense: [4] }
    );
    expect(blastCovered.wounds).toBe(1);
    expect(blastCovered.coverApplied).toBe(false);
  });

  it('throws when the dice arrays are shorter than the attack count', () => {
    expect(() =>
      resolveAttack({ quality: 4 }, { defense: 4 }, 3, { toHit: [6, 6], defense: [6] })
    ).toThrow(/Incomplete dice results/);
  });

  it('extracts to-hit, defense, and regeneration rolls from server results by purpose', () => {
    const rolls = extractAttackRolls([
      { rolls: [3, 5], total: 8, finalTotal: 8, purpose: 'to-hit' },
      { rolls: [6, 2], total: 8, finalTotal: 8, purpose: 'defense' },
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'regeneration' },
    ]);
    expect(rolls).toEqual({ toHit: [3, 5], defense: [6, 2], regeneration: [5] });
  });

  it('throws when results are missing a required purpose', () => {
    expect(() =>
      extractAttackRolls([{ rolls: [3], total: 3, finalTotal: 3, purpose: 'to-hit' }])
    ).toThrow(/to-hit.*defense/);
  });
});

describe('combat: special rules & weapon traits', () => {
  it('AP(X): subtracts X from defense rolls', () => {
    // D4+ with AP(2) requires a 6 to block (5 - 2 = 3 < 4).
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['ap(2)'] },
      { defense: 4 },
      2,
      { toHit: [4, 5], defense: [5, 6] }
    );
    expect(outcome.blockedRolls).toEqual([false, true]);
    expect(outcome.wounds).toBe(1);
  });

  it('Blast(X): multiplies hits capped by defender modelCount', () => {
    // 1 hit with Blast(3) against a 2-model squad produces 2 hits (capped at modelCount = 2).
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['blast(3)'] },
      { defense: 5, modelCount: 2 },
      1,
      { toHit: [5], defense: [2, 3] }
    );
    expect(outcome.hitCount).toBe(2);
    expect(outcome.wounds).toBe(2);
  });

  it('Deadly(X): multiplies each unsaved wound by X', () => {
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['deadly(3)'] },
      { defense: 5 },
      1,
      { toHit: [5], defense: [2] }
    );
    expect(outcome.wounds).toBe(3);
  });

  it('Reliable: always hits on 2+ regardless of unit quality', () => {
    const outcome = resolveAttack(
      { quality: 6, weaponRules: ['reliable'] },
      { defense: 6 },
      2,
      { toHit: [2, 1], defense: [2, 2] }
    );
    expect(outcome.effectiveQuality).toBe(2);
    expect(outcome.hitRolls).toEqual([true, false]);
    expect(outcome.wounds).toBe(1);
  });

  it('Rending: grants AP(4) on unmodified 6 to hit and ignores Regeneration', () => {
    // D3+ defender with Regeneration: hit from roll 4 has AP 0 (blocked by 3), hit from roll 6 gets AP(4) (5 - 4 = 1 < 3 -> fails!) and bypasses Regeneration.
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['rending'] },
      { defense: 3, specialRules: ['regeneration'] },
      2,
      { toHit: [4, 6], defense: [3, 5], regeneration: [6] }
    );
    expect(outcome.blockedRolls).toEqual([true, false]);
    expect(outcome.regenerationSavedCount).toBe(0);
    expect(outcome.wounds).toBe(1);
  });

  it('Rupture (Crack): grants AP(+2) on unmodified 6 to hit', () => {
    // Base AP(1) + Rupture (+2 on 6) = AP(3) on a 6. Defender D3+ rolls 5: 5 - 3 = 2 < 3 -> fails!
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['ap(1)', 'rupture'] },
      { defense: 3 },
      1,
      { toHit: [6], defense: [5] }
    );
    expect(outcome.blockedCount).toBe(0);
    expect(outcome.wounds).toBe(1);
  });

  it('Relentless, Furious, and Surge: generate +1 bonus hit on natural 6', () => {
    const relentless = resolveAttack(
      { quality: 5, specialRules: ['relentless'], distance: 18 },
      { defense: 6 },
      1,
      { toHit: [6], defense: [1, 1] }
    );
    expect(relentless.bonusHits).toBe(1);
    expect(relentless.hitCount).toBe(2);

    const furious = resolveAttack(
      { quality: 5, specialRules: ['furious'], isMelee: true, isCharging: true },
      { defense: 6 },
      1,
      { toHit: [6], defense: [1, 1] }
    );
    expect(furious.bonusHits).toBe(1);
    expect(furious.hitCount).toBe(2);

    const surge = resolveAttack(
      { quality: 5, weaponRules: ['surge'] },
      { defense: 6 },
      1,
      { toHit: [6], defense: [1, 1] }
    );
    expect(surge.bonusHits).toBe(1);
    expect(surge.hitCount).toBe(2);
  });

  it('Thrust charge (+1), Stealth (-1 >9"), and Unstoppable (ignores negative mods)', () => {
    // Q5+ with Thrust's charge bonus (+1) hits on 4+.
    const marksman = resolveAttack(
      { quality: 5, specialRules: ['thrust'], isMelee: true, isCharging: true, distance: 12 },
      { defense: 6 },
      1,
      { toHit: [4], defense: [1] }
    );
    expect(marksman.hitCount).toBe(1);

    // Q4+ vs Stealth at 15" needs 5+ (4 misses).
    const camo = resolveAttack(
      { quality: 4, distance: 15 },
      { defense: 6, specialRules: ['stealth'] },
      1,
      { toHit: [4], defense: [1] }
    );
    expect(camo.hitCount).toBe(0);

    // Unstoppable ignores the Stealth -1 penalty, so 4 still hits!
    const unstoppable = resolveAttack(
      { quality: 4, distance: 15, weaponRules: ['unstoppable'] },
      { defense: 6, specialRules: ['stealth', 'regeneration'] },
      1,
      { toHit: [4], defense: [1], regeneration: [6] }
    );
    expect(unstoppable.hitCount).toBe(1);
    expect(unstoppable.wounds).toBe(1); // Also ignores Regeneration!
  });

  it('Thrust: grants +1 to hit and AP(+1) when charging in melee', () => {
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['ap(1)', 'thrust'], isMelee: true, isCharging: true },
      { defense: 4 },
      1,
      { toHit: [3], defense: [5] } // 3 + 1 >= 4 hits; AP(1+1=2) makes defense 5 - 2 = 3 < 4 fail!
    );
    expect(outcome.hitCount).toBe(1);
    expect(outcome.wounds).toBe(1);
  });

  it('Bane: forces defender to re-roll unmodified defense 6s and ignores Regeneration', () => {
    const outcome = resolveAttack(
      { quality: 4, specialRules: ['bane'] },
      { defense: 5, specialRules: ['regeneration'] },
      1,
      { toHit: [5], defense: [6, 3], regeneration: [6] } // First defense roll is 6 -> forced re-roll into 3 -> fails!
    );
    expect(outcome.rerolledDefenseRolls).toEqual([6]);
    expect(outcome.blockedCount).toBe(0);
    expect(outcome.wounds).toBe(1);
  });

  it('Regeneration: ignores wounds on 5+ when not bypassed', () => {
    const outcome = resolveAttack(
      { quality: 4 },
      { defense: 5, specialRules: ['regeneration'] },
      2,
      { toHit: [5, 5], defense: [2, 2], regeneration: [5, 4] } // 5 saves, 4 fails
    );
    expect(outcome.regenerationSavedCount).toBe(1);
    expect(outcome.wounds).toBe(1);
  });

  it('Fatigued in melee: only hits on unmodified 6s', () => {
    const outcome = resolveAttack(
      { quality: 3, isMelee: true, isFatigued: true },
      { defense: 6 },
      2,
      { toHit: [5, 6], defense: [1, 1] }
    );
    expect(outcome.hitRolls).toEqual([false, true]);
    expect(outcome.hitCount).toBe(1);
  });
});

describe('combat: Morale resolution', () => {
  it('a Quality test: passes on a roll that meets Quality, 1 always fails, 6 always passes', () => {
    expect(resolveMoraleTest({ quality: 4, roll: 4 })).toMatchObject({ passed: true, outcome: 'passed' });
    expect(resolveMoraleTest({ quality: 4, roll: 3 })).toMatchObject({ passed: false, outcome: 'shaken' });
    expect(resolveMoraleTest({ quality: 2, roll: 1 }).passed).toBe(false);
    expect(resolveMoraleTest({ quality: 6, roll: 6 }).passed).toBe(true);
  });

  it('a Shaken unit always fails, even on a 6, and a failure is Shaken (not routed)', () => {
    const out = resolveMoraleTest({ quality: 4, roll: 6, alreadyShaken: true });
    expect(out).toMatchObject({ passed: false, outcome: 'shaken' });
    expect(resolveMoraleTest({ quality: 4, alreadyShaken: true }).passed).toBe(false); // no roll needed
  });

  it('a Hero lends a better Quality, never a worse one', () => {
    expect(resolveMoraleTest({ quality: 6, roll: 4, heroQuality: 4 }).outcome).toBe('passed');
    expect(resolveMoraleTest({ quality: 3, roll: 3, heroQuality: 5 })).toMatchObject({ effectiveQuality: 3, passed: true });
  });

  it('Fearless: 4+ on the extra die saves a failure, including the automatic one while Shaken', () => {
    const saved = resolveMoraleTest({ quality: 4, roll: 2, specialRules: ['fearless'], fearlessRoll: 4 });
    expect(saved.outcome).toBe('passed');
    expect(saved.fearlessSaved).toBe(true);
    expect(resolveMoraleTest({ quality: 4, roll: 2, specialRules: ['fearless'], fearlessRoll: 3 }).outcome).toBe('shaken');
    const shaken = resolveMoraleTest({ quality: 4, alreadyShaken: true, specialRules: ['fearless'], fearlessRoll: 4 });
    expect(shaken).toMatchObject({ passed: true, fearlessSaved: true });
    expect(
      resolveMoraleTest({ quality: 4, alreadyShaken: true, specialRules: ['fearless'], fearlessRoll: 3 }).outcome
    ).toBe('shaken');
  });
});
