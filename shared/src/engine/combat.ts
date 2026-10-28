import { DiceSpec, DiceResult } from '../types';

/**
 * Quality/Defense d6 combat resolution (first principles, no rulebook text).
 *
 *   attack roll d6 >= attacker Quality -> hit
 *   defense roll d6 >= defender Defense -> hit blocked
 *   each unblocked hit                -> one wound
 *
 * Dice are always rolled by the signaling server (never client-side), in two
 * matched sets: `count` to-hit dice and `count` defense dice. Defense dice
 * pair with hits in order (the 1st hit uses the 1st defense die, etc.);
 * defense dice beyond the number of hits are unused.
 *
 * Cover: if the defender is in cover, to-hit rolls need a higher result
 * (effective Quality + 1) — cover makes the target harder to hit.
 */

export interface AttackRolls {
  toHit: number[];
  defense: number[];
}

export interface CombatOutcome {
  attackCount: number;
  toHitRolls: number[];
  /** hitRolls[i] is true when toHitRolls[i] scored a hit. */
  hitRolls: boolean[];
  hitCount: number;
  defenseRolls: number[];
  /** blockedRolls[i] is true when defenseRolls[i] blocked the i-th hit. */
  blockedRolls: boolean[];
  blockedCount: number;
  wounds: number;
}

export interface CombatStats {
  quality: number;
}

export interface DefenseStats {
  defense: number;
  inCover?: boolean;
}

/** Dice specs for one attack: `count` to-hit dice plus `count` defense dice. */
export function getAttackDiceSpecs(attackCount: number): DiceSpec[] {
  return [
    { count: attackCount, sides: 6, purpose: 'to-hit' },
    { count: attackCount, sides: 6, purpose: 'defense' },
  ];
}

/**
 * Resolve one attack deterministically from pre-rolled dice. Throws if the
 * dice arrays are shorter than the attack count — callers must request
 * enough dice (see getAttackDiceSpecs).
 */
export function resolveAttack(
  attacker: CombatStats,
  defender: DefenseStats,
  attackCount: number,
  rolls: AttackRolls
): CombatOutcome {
  if (rolls.toHit.length < attackCount || rolls.defense.length < attackCount) {
    throw new Error(
      `Incomplete dice results: need ${attackCount} to-hit and ${attackCount} defense rolls`
    );
  }

  const toHitRolls = rolls.toHit.slice(0, attackCount);
  const defenseRolls = rolls.defense.slice(0, attackCount);

  const effectiveQuality = attacker.quality + (defender.inCover ? 1 : 0);
  const hitRolls = toHitRolls.map((roll) => roll >= effectiveQuality);
  const hitCount = hitRolls.filter(Boolean).length;

  // Pair each hit (in order) with a defense die.
  const blockedRolls: boolean[] = [];
  let hitIndex = 0;
  for (const hit of hitRolls) {
    if (!hit) continue;
    blockedRolls.push(defenseRolls[hitIndex] >= defender.defense);
    hitIndex++;
  }
  const blockedCount = blockedRolls.filter(Boolean).length;

  return {
    attackCount,
    toHitRolls,
    hitRolls,
    hitCount,
    defenseRolls,
    blockedRolls,
    blockedCount,
    wounds: hitCount - blockedCount,
  };
}

/** Extract the to-hit and defense roll values from server-rolled results. */
export function extractAttackRolls(results: DiceResult[]): AttackRolls {
  const toHit = results.find((r) => r.purpose === 'to-hit');
  const defense = results.find((r) => r.purpose === 'defense');
  if (!toHit || !defense) {
    throw new Error("Dice results must include 'to-hit' and 'defense' purposes");
  }
  return { toHit: toHit.rolls, defense: defense.rolls };
}
