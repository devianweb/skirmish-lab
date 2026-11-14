import { Unit, Weapon } from '../gameTypes';
import { modelCarries } from './unitGeometry';
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

/** True when some living model of the unit carries the weapon (a unit without a model list carries all its weapons). */
export function isCarried(unit: Pick<Unit, 'models'>, weapon: Weapon): boolean {
  const models = unit.models ?? [];
  if (models.length === 0) return true;
  return models.some((m) => !m.isDestroyed && modelCarries(m, weapon.id));
}

/**
 * Every equipped melee weapon (Assault included) in equipment order. Whatever model carries it, the order is
 * fixed: the index in this list is the weapon's slot in a melee exchange (dice purposes, results). Casualties
 * do not change it; a slot whose carriers are all gone simply does not strike.
 */
export function meleeWeaponSlots(unit: Pick<Unit, 'weapons'>): Weapon[] {
  return unit.weapons.filter((w) => w.isEquipped && isMeleeWeapon(w));
}

/** The melee weapons a unit strikes with: every equipped melee weapon that a living model carries, in equipment order. */
export function findMeleeWeapons(unit: Pick<Unit, 'weapons' | 'models'>): Weapon[] {
  return meleeWeaponSlots(unit).filter((w) => isCarried(unit, w));
}

/**
 * The first melee weapon a unit strikes with (its first equipped true melee weapon, otherwise its first Assault
 * weapon). The host strikes with all of them (`findMeleeWeapons`); this is only a label / compatibility default.
 */
export function findMeleeWeapon(unit: Pick<Unit, 'weapons' | 'models'>): Weapon | undefined {
  const carried = findMeleeWeapons(unit);
  return carried.find((w) => w.profile.type === 'melee') ?? carried[0];
}

/** True when the unit has an equipped weapon that a living model carries and that can strike in melee. */
export function hasMeleeWeapon(unit: Pick<Unit, 'weapons' | 'models'>): boolean {
  return findMeleeWeapons(unit).length > 0;
}

/** Every equipped melee weapon with Counter carried by at least one living model, in equipment order. */
export function findCounterWeapons(unit: Pick<Unit, 'weapons' | 'models'>): Weapon[] {
  return unit.weapons.filter(
    (w) => w.isEquipped && isCarried(unit, w) && isMeleeWeapon(w) && hasTrait(w.profile.specialRules, 'counter')
  );
}

/** The equipped melee weapons without Counter (Assault counts) that a living model carries: what a charged unit strikes back with after its Counter strikes. */
export function findNonCounterMeleeWeapons(unit: Pick<Unit, 'weapons' | 'models'>): Weapon[] {
  return findMeleeWeapons(unit).filter((w) => !hasTrait(w.profile.specialRules, 'counter'));
}

/** The first of `findNonCounterMeleeWeapons`, true melee weapons before Assault ones. */
export function findNonCounterMeleeWeapon(unit: Pick<Unit, 'weapons' | 'models'>): Weapon | undefined {
  const plain = findNonCounterMeleeWeapons(unit);
  return plain.find((w) => w.profile.type === 'melee') ?? plain[0];
}

/**
 * Impact dice a charging unit rolls: X per striking model, where X is the Impact(X) of the unit plus that of
 * the weapon it strikes with (Impact is a per-model rule, as in OPR). None while the unit is Fatigued.
 */
export function impactDiceCount(unit: Unit, weapon?: Weapon, strikingModels: number = 1): number {
  if (unit.status.includes('fatigued')) return 0;
  const perModel = sumTraitValue(unit.specialRules, 'impact') + (weapon ? sumTraitValue(weapon.profile.specialRules, 'impact') : 0);
  return perModel * Math.max(0, strikingModels);
}
