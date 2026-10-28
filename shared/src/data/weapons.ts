import { Weapon } from '../gameTypes';

/**
 * Weapon profiles for the v1 data pack — original, generic names and stats
 * derived from first principles (no proprietary catalogs). Balance is
 * provisional until playtesting.
 */
export const WEAPONS: Record<string, Weapon> = {
  rifle: {
    id: 'rifle',
    weaponType: 'rifle',
    name: 'Rifle',
    profile: { type: 'ranged', range: 24, attacks: 1, specialRules: [] },
    isEquipped: true,
  },
  carbine: {
    id: 'carbine',
    weaponType: 'carbine',
    name: 'Carbine',
    profile: { type: 'ranged', range: 18, attacks: 2, specialRules: [] },
    isEquipped: true,
  },
  scattergun: {
    id: 'scattergun',
    weaponType: 'scattergun',
    name: 'Scattergun',
    profile: { type: 'ranged', range: 12, attacks: 3, specialRules: [] },
    isEquipped: true,
  },
  handcannon: {
    id: 'handcannon',
    weaponType: 'handcannon',
    name: 'Hand Cannon',
    profile: { type: 'ranged', range: 12, attacks: 1, specialRules: [] },
    isEquipped: true,
  },
  cannon: {
    id: 'cannon',
    weaponType: 'cannon',
    name: 'Cannon',
    profile: { type: 'ranged', range: 30, attacks: 3, specialRules: [] },
    isEquipped: true,
  },
  blade: {
    id: 'blade',
    weaponType: 'blade',
    name: 'Blade',
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: [] },
    isEquipped: true,
  },
  fists: {
    id: 'fists',
    weaponType: 'fists',
    name: 'Fists',
    profile: { type: 'melee', range: 1, attacks: 1, specialRules: [] },
    isEquipped: true,
  },
};

/** Resolve weapon profile IDs into equipped Weapon instances for a spawned unit. */
export function resolveWeapons(weaponIds: string[]): Weapon[] {
  return weaponIds.map((id) => {
    const weapon = WEAPONS[id];
    if (!weapon) throw new Error(`Unknown weapon profile: ${id}`);
    return { ...weapon, profile: { ...weapon.profile } };
  });
}
