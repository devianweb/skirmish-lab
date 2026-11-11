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
    profile: { type: 'ranged', range: 18, attacks: 2, specialRules: ['rending'] },
    isEquipped: true,
  },
  scattergun: {
    id: 'scattergun',
    weaponType: 'scattergun',
    name: 'Scattergun',
    profile: { type: 'ranged', range: 12, attacks: 3, specialRules: ['ap(1)'] },
    isEquipped: true,
  },
  handcannon: {
    id: 'handcannon',
    weaponType: 'handcannon',
    name: 'Hand Cannon',
    profile: { type: 'ranged', range: 12, attacks: 1, specialRules: ['ap(1)'] },
    isEquipped: true,
  },
  sidearm: {
    id: 'sidearm',
    weaponType: 'sidearm',
    name: 'Sidearm',
    profile: { type: 'ranged', range: 12, attacks: 1, specialRules: [] },
    isEquipped: true,
  },
  cannon: {
    id: 'cannon',
    weaponType: 'cannon',
    name: 'Cannon',
    profile: { type: 'ranged', range: 30, attacks: 3, specialRules: ['ap(1)', 'rupture'] },
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
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: ['ap(1)', 'rending'] },
    isEquipped: true,
  },
  fists: {
    id: 'fists',
    weaponType: 'fists',
    name: 'Fists',
    profile: { type: 'melee', range: 1, attacks: 1, specialRules: [] },
    isEquipped: true,
  },
  /**
   * TEST-only twin of `rifle`: a different id with the same name, so a unit can carry two weapons
   * named "Rifle" (checks that same-name weapons always share a target).
   */
  'rifle-twin': {
    id: 'rifle-twin',
    weaponType: 'rifle',
    name: 'Rifle',
    profile: { type: 'ranged', range: 24, attacks: 1, specialRules: [] },
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
      specialRules: ['ap(1)', 'reliable'],
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
    profile: { type: 'ranged', range: 30, attacks: 1, specialRules: ['blast(3)', 'indirect'] },
    isEquipped: true,
  },
  'plasma-rifle': {
    id: 'plasma-rifle',
    weaponType: 'plasma-rifle',
    name: 'Plasma Rifle',
    profile: { type: 'ranged', range: 24, attacks: 4, specialRules: ['ap(2)'] },
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
      specialRules: ['ap(4)', 'deadly(3)'],
    },
    isEquipped: true,
  },
  /** TEST-only: a blade with Counter, for checking the charged unit's first strike. */
  'counter-blade': {
    id: 'counter-blade',
    weaponType: 'counter-blade',
    name: 'Counter Blade',
    profile: { type: 'melee', range: 1, attacks: 3, specialRules: ['counter'] },
    isEquipped: true,
  },
  /** TEST-only: a second Counter weapon, so a unit can strike first with two weapons. */
  'counter-spear': {
    id: 'counter-spear',
    weaponType: 'counter-spear',
    name: 'Counter Spear',
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: ['counter'] },
    isEquipped: true,
  },
  /** TEST-only: a ranged weapon with Assault, usable in melee as well. */
  'assault-rifle': {
    id: 'assault-rifle',
    weaponType: 'assault-rifle',
    name: 'Assault Rifle',
    profile: { type: 'ranged', range: 18, attacks: 2, specialRules: ['assault'] },
    isEquipped: true,
  },
  /** TEST-only: a blade with Shred, for watching extra wounds on Defense 1s. */
  'shred-blade': {
    id: 'shred-blade',
    weaponType: 'shred-blade',
    name: 'Shred Blade',
    profile: { type: 'melee', range: 1, attacks: 4, specialRules: ['shred'] },
    isEquipped: true,
  },
  flamer: {
    id: 'flamer',
    weaponType: 'flamer',
    name: 'Flamer',
    profile: {
      type: 'ranged',
      range: 12,
      attacks: 2,
      specialRules: ['blast(3)', 'reliable'],
    },
    isEquipped: true,
  },
  // --- Human Defense Force (14C-3 PR 1D) ---
  strike: {
    id: 'strike',
    weaponType: 'strike',
    name: 'Strike',
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: [] },
    isEquipped: true,
  },
  'hand-weapon': {
    id: 'hand-weapon',
    weaponType: 'hand-weapon',
    name: 'Hand Weapon',
    profile: { type: 'melee', range: 1, attacks: 6, specialRules: [] },
    isEquipped: true,
  },
  'sgt-hand-weapon': {
    id: 'sgt-hand-weapon',
    weaponType: 'sgt-hand-weapon',
    name: 'Sgt. Hand Weapon',
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: [] },
    isEquipped: true,
  },
  pistol: {
    id: 'pistol',
    weaponType: 'pistol',
    name: 'Pistol',
    profile: { type: 'ranged', range: 12, attacks: 2, specialRules: ['assault'] },
    isEquipped: true,
  },
  'plasma-pistol': {
    id: 'plasma-pistol',
    weaponType: 'plasma-pistol',
    name: 'Plasma Pistol',
    profile: { type: 'ranged', range: 12, attacks: 2, specialRules: ['ap(2)', 'assault'] },
    isEquipped: true,
  },
  'battle-rifle': {
    id: 'battle-rifle',
    weaponType: 'battle-rifle',
    name: 'Battle Rifle',
    profile: { type: 'ranged', range: 24, attacks: 2, specialRules: [] },
    isEquipped: true,
  },
  'grenade-launcher': {
    id: 'grenade-launcher',
    weaponType: 'grenade-launcher',
    name: 'Grenade Launcher',
    profile: { type: 'ranged', range: 24, attacks: 2, specialRules: ['blast(3)'] },
    isEquipped: true,
  },
  'sniper-rifle': {
    id: 'sniper-rifle',
    weaponType: 'sniper-rifle',
    name: 'Sniper Rifle',
    profile: { type: 'ranged', range: 30, attacks: 1, specialRules: ['ap(1)', 'deadly(2)', 'reliable'] },
    isEquipped: true,
  },
  // --- Orc Marauders (14C-3 PR 2) ---
  'orc-hand-weapon': {
    id: 'orc-hand-weapon',
    weaponType: 'orc-hand-weapon',
    name: 'Hand Weapon',
    profile: { type: 'melee', range: 1, attacks: 2, specialRules: [] },
    isEquipped: true,
  },
  'heavy-flamer-mod': {
    id: 'heavy-flamer-mod',
    weaponType: 'heavy-flamer-mod',
    name: 'Heavy Flamer-Mod',
    profile: { type: 'ranged', range: 12, attacks: 2, specialRules: ['ap(1)', 'blast(3)', 'limited'] },
    isEquipped: true,
  },
  'orc-carbine': {
    id: 'orc-carbine',
    weaponType: 'orc-carbine',
    name: 'Carbine',
    profile: { type: 'ranged', range: 18, attacks: 4, specialRules: [] },
    isEquipped: true,
  },
  'bike-gun': {
    id: 'bike-gun',
    weaponType: 'bike-gun',
    name: 'Bike-Gun',
    profile: { type: 'ranged', range: 24, attacks: 4, specialRules: [] },
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
