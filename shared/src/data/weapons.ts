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
    profile: { type: 'ranged', range: 18, attacks: 2, specialRules: ['shred'] },
    isEquipped: true,
  },
  scattergun: {
    id: 'scattergun',
    weaponType: 'scattergun',
    name: 'Scattergun',
    profile: { type: 'ranged', range: 12, attacks: 3, specialRules: ['pierce(1)'] },
    isEquipped: true,
  },
  handcannon: {
    id: 'handcannon',
    weaponType: 'handcannon',
    name: 'Hand Cannon',
    profile: { type: 'ranged', range: 12, attacks: 1, specialRules: ['pierce(1)'] },
    isEquipped: true,
  },
  cannon: {
    id: 'cannon',
    weaponType: 'cannon',
    name: 'Cannon',
    profile: { type: 'ranged', range: 30, attacks: 3, specialRules: ['pierce(1)', 'rupture'] },
    isEquipped: true,
  },
  blade: {
    id: 'blade',
    weaponType: 'blade',
    name: 'Blade',
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: [] },
    isEquipped: true,
  },
  'power-sword': {
    id: 'power-sword',
    weaponType: 'power-sword',
    name: 'Power Sword',
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: ['pierce(1)', 'shred'] },
    isEquipped: true,
  },
  fists: {
    id: 'fists',
    weaponType: 'fists',
    name: 'Fists',
    profile: { type: 'melee', range: 1, attacks: 1, specialRules: [] },
    isEquipped: true,
  },
  'long-rifle': {
    id: 'long-rifle',
    weaponType: 'long-rifle',
    name: 'Long Rifle',
    profile: {
      type: 'ranged',
      range: 30,
      attacks: 1,
      specialRules: ['pierce(1)', 'calibrated'],
    },
    isEquipped: true,
  },
  'frag-launcher': {
    id: 'frag-launcher',
    weaponType: 'frag-launcher',
    name: 'Frag Launcher',
    profile: { type: 'ranged', range: 24, attacks: 1, specialRules: ['blast(3)'] },
    isEquipped: true,
  },
  'trench-mortar': {
    id: 'trench-mortar',
    weaponType: 'trench-mortar',
    name: 'Trench Mortar',
    profile: { type: 'ranged', range: 30, attacks: 1, specialRules: ['blast(3)', 'lobbed'] },
    isEquipped: true,
  },
  'plasma-rifle': {
    id: 'plasma-rifle',
    weaponType: 'plasma-rifle',
    name: 'Plasma Rifle',
    profile: { type: 'ranged', range: 24, attacks: 1, specialRules: ['pierce(4)'] },
    isEquipped: true,
  },
  'fusion-rifle': {
    id: 'fusion-rifle',
    weaponType: 'fusion-rifle',
    name: 'Fusion Rifle',
    profile: {
      type: 'ranged',
      range: 12,
      attacks: 1,
      specialRules: ['pierce(4)', 'lethal(3)'],
    },
    isEquipped: true,
  },
  flamer: {
    id: 'flamer',
    weaponType: 'flamer',
    name: 'Flamer',
    profile: {
      type: 'ranged',
      range: 12,
      attacks: 1,
      specialRules: ['blast(3)', 'calibrated'],
    },
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
