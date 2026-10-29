import { describe, it, expect } from 'vitest';
import {
  extractAttackRolls,
  getAttackDiceSpecs,
  resolveAttack,
  resolveMoraleTest,
  resolveTraumaRoll,
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
    // Q2+ with Marksman (+1) still misses on natural 1.
    const nat1 = resolveAttack(
      { quality: 2, specialRules: ['marksman'] },
      { defense: 2, weaponRules: ['pierce(4)'] } as any,
      1,
      { toHit: [1], defense: [6] }
    );
    expect(nat1.hitCount).toBe(0);

    // Q6+ against Camouflaged (-1 at >9") still hits on natural 6; D6+ against Pierce(4) still blocks on natural 6.
    const nat6 = resolveAttack(
      { quality: 6, weaponRules: ['pierce(4)'], distance: 18 },
      { defense: 6, specialRules: ['camouflaged'] },
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

  it('extracts to-hit, defense, ward, and trauma rolls from server results by purpose', () => {
    const rolls = extractAttackRolls([
      { rolls: [3, 5], total: 8, finalTotal: 8, purpose: 'to-hit' },
      { rolls: [6, 2], total: 8, finalTotal: 8, purpose: 'defense' },
      { rolls: [5], total: 5, finalTotal: 5, purpose: 'ward' },
      { rolls: [4], total: 4, finalTotal: 4, purpose: 'trauma' },
    ]);
    expect(rolls).toEqual({ toHit: [3, 5], defense: [6, 2], ward: [5], trauma: [4] });
  });

  it('throws when results are missing a required purpose', () => {
    expect(() =>
      extractAttackRolls([{ rolls: [3], total: 3, finalTotal: 3, purpose: 'to-hit' }])
    ).toThrow(/to-hit.*defense/);
  });
});

describe('combat: special rules & weapon traits', () => {
  it('Pierce(X): subtracts X from defense rolls', () => {
    // D4+ with Pierce(2) requires a 6 to block (5 - 2 = 3 < 4).
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['pierce(2)'] },
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

  it('Lethal(X): multiplies each unsaved wound by X', () => {
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['lethal(3)'] },
      { defense: 5 },
      1,
      { toHit: [5], defense: [2] }
    );
    expect(outcome.wounds).toBe(3);
  });

  it('Calibrated (Reliable): always hits on 2+ regardless of unit quality', () => {
    const outcome = resolveAttack(
      { quality: 6, weaponRules: ['calibrated'] },
      { defense: 6 },
      2,
      { toHit: [2, 1], defense: [2, 2] }
    );
    expect(outcome.effectiveQuality).toBe(2);
    expect(outcome.hitRolls).toEqual([true, false]);
    expect(outcome.wounds).toBe(1);
  });

  it('Shred (Rending): grants Pierce(4) on unmodified 6 to hit and ignores Ward', () => {
    // D3+ defender with Ward: hit from roll 4 has AP 0 (blocked by 3), hit from roll 6 gets Pierce(4) (5 - 4 = 1 < 3 -> fails!) and bypasses Ward.
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['shred'] },
      { defense: 3, specialRules: ['ward'] },
      2,
      { toHit: [4, 6], defense: [3, 5], ward: [6] }
    );
    expect(outcome.blockedRolls).toEqual([true, false]);
    expect(outcome.wardSavedCount).toBe(0);
    expect(outcome.wounds).toBe(1);
  });

  it('Rupture (Crack): grants Pierce(+2) on unmodified 6 to hit', () => {
    // Base Pierce(1) + Rupture (+2 on 6) = Pierce(3) on a 6. Defender D3+ rolls 5: 5 - 3 = 2 < 3 -> fails!
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['pierce(1)', 'rupture'] },
      { defense: 3 },
      1,
      { toHit: [6], defense: [5] }
    );
    expect(outcome.blockedCount).toBe(0);
    expect(outcome.wounds).toBe(1);
  });

  it('Sustained (Relentless), Frenzy (Furious), and Overload (Surge): generate +1 bonus hit on natural 6', () => {
    const sustained = resolveAttack(
      { quality: 5, specialRules: ['sustained'], distance: 18 },
      { defense: 6 },
      1,
      { toHit: [6], defense: [1, 1] }
    );
    expect(sustained.bonusHits).toBe(1);
    expect(sustained.hitCount).toBe(2);

    const frenzy = resolveAttack(
      { quality: 5, specialRules: ['frenzy'], isMelee: true, isCharging: true },
      { defense: 6 },
      1,
      { toHit: [6], defense: [1, 1] }
    );
    expect(frenzy.bonusHits).toBe(1);
    expect(frenzy.hitCount).toBe(2);

    const overload = resolveAttack(
      { quality: 5, weaponRules: ['overload'] },
      { defense: 6 },
      1,
      { toHit: [6], defense: [1, 1] }
    );
    expect(overload.bonusHits).toBe(1);
    expect(overload.hitCount).toBe(2);
  });

  it('Marksman (+1), Camouflaged (-1 >9"), Lobbed (-1 if moved), and Unerring (ignores negative mods)', () => {
    // Q5+ with Marksman (+1) hits on 4+.
    const marksman = resolveAttack(
      { quality: 5, specialRules: ['marksman'], distance: 12 },
      { defense: 6 },
      1,
      { toHit: [4], defense: [1] }
    );
    expect(marksman.hitCount).toBe(1);

    // Q4+ vs Camouflaged at 15" needs 5+ (4 misses).
    const camo = resolveAttack(
      { quality: 4, distance: 15 },
      { defense: 6, specialRules: ['camouflaged'] },
      1,
      { toHit: [4], defense: [1] }
    );
    expect(camo.hitCount).toBe(0);

    // Unerring ignores the Camouflaged -1 penalty, so 4 still hits!
    const unerring = resolveAttack(
      { quality: 4, distance: 15, weaponRules: ['unerring'] },
      { defense: 6, specialRules: ['camouflaged', 'ward'] },
      1,
      { toHit: [4], defense: [1], ward: [6] }
    );
    expect(unerring.hitCount).toBe(1);
    expect(unerring.wounds).toBe(1); // Also ignores Ward!
  });

  it('Impale (Thrust): grants +1 to hit and Pierce(+1) when charging in melee', () => {
    const outcome = resolveAttack(
      { quality: 4, weaponRules: ['pierce(1)', 'impale'], isMelee: true, isCharging: true },
      { defense: 4 },
      1,
      { toHit: [3], defense: [5] } // 3 + 1 >= 4 hits; Pierce(1+1=2) makes defense 5 - 2 = 3 < 4 fail!
    );
    expect(outcome.hitCount).toBe(1);
    expect(outcome.wounds).toBe(1);
  });

  it('Hexed (Bane): forces defender to re-roll unmodified defense 6s and ignores Ward', () => {
    const outcome = resolveAttack(
      { quality: 4, specialRules: ['hexed'] },
      { defense: 5, specialRules: ['ward'] },
      1,
      { toHit: [5], defense: [6, 3], ward: [6] } // First defense roll is 6 -> forced re-roll into 3 -> fails!
    );
    expect(outcome.rerolledDefenseRolls).toEqual([6]);
    expect(outcome.blockedCount).toBe(0);
    expect(outcome.wounds).toBe(1);
  });

  it('Ward (Regeneration): ignores wounds on 5+ when not bypassed', () => {
    const outcome = resolveAttack(
      { quality: 4 },
      { defense: 5, specialRules: ['ward'] },
      2,
      { toHit: [5, 5], defense: [2, 2], ward: [5, 4] } // 5 saves, 4 fails
    );
    expect(outcome.wardSavedCount).toBe(1);
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

describe('combat: Trauma Table & Morale resolution', () => {
  it('resolveTraumaRoll: 1-5 results in shaken (natural 1 always shaken), 6+ results in knocked-out', () => {
    expect(resolveTraumaRoll(4, 1).outcome).toBe('shaken');      // 4 + 1 = 5
    expect(resolveTraumaRoll(5, 1).outcome).toBe('knocked-out'); // 5 + 1 = 6
    expect(resolveTraumaRoll(1, 10).outcome).toBe('shaken');     // natural 1 always shaken
    expect(resolveTraumaRoll(3, 1, 2).outcome).toBe('knocked-out'); // 3 + 1 + Dread(2) = 6
  });

  it('resolveMoraleTest: handles Steadfast, Commander quality, Stoic, Iron Will, and already-shaken routing', () => {
    // Already shaken unit auto-fails and routs.
    expect(resolveMoraleTest({ quality: 4, roll: 6, alreadyShaken: true }).outcome).toBe('routed');

    // Steadfast (+1) turns a roll of 3 into 4 >= Q4+ (passed).
    expect(
      resolveMoraleTest({ quality: 4, roll: 3, specialRules: ['steadfast'] }).outcome
    ).toBe('passed');

    // Commander quality (Q4+) lets a Q6+ Conscript pass on a 4.
    expect(
      resolveMoraleTest({ quality: 6, roll: 4, commanderQuality: 4 }).outcome
    ).toBe('passed');

    // Stoic (Fearless) turns a failed morale roll into passed on a 4+ stoicRoll.
    const stoicPass = resolveMoraleTest({
      quality: 4,
      roll: 2,
      specialRules: ['stoic'],
      stoicRoll: 4,
    });
    expect(stoicPass.outcome).toBe('passed');
    expect(stoicPass.stoicSaved).toBe(true);

    // Iron Will (No Retreat) counts failed morale as passed and deals self-wounds on 1-3.
    const ironWill = resolveMoraleTest({
      quality: 4,
      roll: 2,
      specialRules: ['iron-will'],
      ironWillRolls: [1, 3, 5],
    });
    expect(ironWill.outcome).toBe('passed');
    expect(ironWill.ironWillWounds).toBe(2);
  });
});
