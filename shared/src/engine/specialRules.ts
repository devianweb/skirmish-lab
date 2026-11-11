import { Unit, Weapon } from '../gameTypes';
import { hasTrait, sumTraitValue } from '../rules/traits';

/**
 * Small, pure helpers for the special rules that change what a unit can do (14C-2 PR 7): Fast / Slow speed,
 * Assault weapons in melee, Counter and Impact. They live here so the host and the HUD read them the same way.
 */

/** Advance speed change from Fast / Slow (the Rush and Charge allowance is twice the resulting speed). */
export function speedModifier(unit: Pick<Unit, 'specialRules'>): number {
  const rules = unit.specialRules ?? [];
  return (hasTrait(rules, 'fast') ? 2 : 0) - (hasTrait(rules, 'slow') ? 2 : 0);
}

/**
 * The unit's Advance distance: its Speed stat, +2" with Fast and -2" with Slow. Rush and Charge allow twice
 * this (so Fast adds 4" and Slow takes 4" off). Always use this, never `unit.speed`, for a distance.
 */
export function getEffectiveSpeed(unit: Pick<Unit, 'speed' | 'specialRules'>): number {
  return Math.max(0, unit.speed + speedModifier(unit));
}

/** True when the weapon can strike in melee: a melee weapon, or a ranged weapon with Assault. */
export function isMeleeWeapon(weapon: Weapon): boolean {
  return weapon.profile.type === 'melee' || hasTrait(weapon.profile.specialRules, 'assault');
}

/**
 * The melee weapon a unit strikes with by default: its first equipped true melee weapon, otherwise its first
 * equipped Assault weapon. Undefined when it has nothing to strike with.
 */
export function findMeleeWeapon(unit: Pick<Unit, 'weapons'>): Weapon | undefined {
  return (
    unit.weapons.find((w) => w.isEquipped && w.profile.type === 'melee') ??
    unit.weapons.find((w) => w.isEquipped && isMeleeWeapon(w))
  );
}

/** True when the unit has an equipped weapon that can strike in melee. */
export function hasMeleeWeapon(unit: Pick<Unit, 'weapons'>): boolean {
  return unit.weapons.some((w) => w.isEquipped && isMeleeWeapon(w));
}

/** The equipped weapon with Counter that strikes first when this unit is charged (the first one found). */
export function findCounterWeapon(unit: Pick<Unit, 'weapons'>): Weapon | undefined {
  return unit.weapons.find((w) => w.isEquipped && isMeleeWeapon(w) && hasTrait(w.profile.specialRules, 'counter'));
}

/**
 * Impact dice a charging unit rolls: the Impact(X) of the unit plus that of the weapon it strikes with.
 * None while the unit is Fatigued.
 */
export function impactDiceCount(unit: Unit, weapon?: Weapon): number {
  if (unit.status.includes('fatigued')) return 0;
  return sumTraitValue(unit.specialRules, 'impact') + (weapon ? sumTraitValue(weapon.profile.specialRules, 'impact') : 0);
}
