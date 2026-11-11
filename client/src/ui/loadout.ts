import { Unit, Weapon, modelCarries, findMeleeWeapons } from '@skirmish-lab/shared';

/**
 * Per-model loadout helpers for the HUD (14C-3 PR 1C). The engine decides what really fires or strikes
 * (`firingModels`, `strikingModelCount`); these only read the same model data to label panels.
 */

/** How many living models carry the weapon (a unit without a model list is one model carrying everything). */
export function carrierCount(unit: Pick<Unit, 'models'>, weapon: Pick<Weapon, 'id'>): number {
  const models = unit.models ?? [];
  if (models.length === 0) return 1;
  return models.filter((m) => !m.isDestroyed && modelCarries(m, weapon.id)).length;
}

/** The unit's equipped weapons that at least one living model still carries. Lost weapons are not listed. */
export function carriedWeapons(unit: Pick<Unit, 'weapons' | 'models'>): Weapon[] {
  return unit.weapons.filter((w) => w.isEquipped && carrierCount(unit, w) > 0);
}

/** Carried ranged weapons: the ones the shoot panel offers. */
export function rangedWeaponsOf(unit: Pick<Unit, 'weapons' | 'models'>): Weapon[] {
  return carriedWeapons(unit).filter((w) => w.profile.type === 'ranged');
}

/** "2× " when the unit has several living models, so a lone carrier reads "1× Frag Launcher"; empty for a single model. */
export function carrierPrefix(unit: Pick<Unit, 'weapons' | 'models'>, weapon: Pick<Weapon, 'id'>): string {
  const living = (unit.models ?? []).filter((m) => !m.isDestroyed).length;
  return living > 1 ? `${carrierCount(unit, weapon)}× ` : '';
}

/** "Hand Weapon + Pistol": every melee weapon the unit strikes with (Assault weapons included). */
export function meleeWeaponNames(unit: Pick<Unit, 'weapons' | 'models'>): string {
  return findMeleeWeapons(unit)
    .map((w) => w.name)
    .join(' + ');
}

/** One line per melee weapon with the attacks it throws against `strikers` models in reach, e.g. "Blade A2 x3 = 6". */
export function meleeAttackBreakdown(
  unit: Pick<Unit, 'weapons' | 'models'>,
  strikersFor: (weapon: Weapon) => number
): { text: string; totalAttacks: number } {
  const parts = findMeleeWeapons(unit).map((w) => {
    const n = strikersFor(w);
    const a = (w.profile.attacks as number) * n;
    return { text: `${w.name} ${a}`, a };
  });
  return { text: parts.map((p) => p.text).join(' + '), totalAttacks: parts.reduce((s, p) => s + p.a, 0) };
}
