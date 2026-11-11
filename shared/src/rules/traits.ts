/**
 * Data-driven trait & special rules registry for SkirmishLab.
 *
 * Trait strings in fighter and weapon definitions use the format:
 *   - `'steadfast'`, `'rending'`, `'reliable'` (boolean traits)
 *   - `'ap(2)'`, `'blast(3)'`, `'tough(3)'` (parameterized traits)
 */

export type CoreTraitId =
  | 'ambush'
  | 'ap'
  | 'assault'
  | 'bane'
  | 'blast'
  | 'caster'
  | 'counter'
  | 'deadly'
  | 'fast'
  | 'fear'
  | 'fearless'
  | 'flying'
  | 'furious'
  | 'hero'
  | 'immobile'
  | 'impact'
  | 'indirect'
  | 'limited'
  | 'regeneration'
  | 'relentless'
  | 'reliable'
  | 'rending'
  | 'scout'
  | 'shred'
  | 'slow'
  | 'stealth'
  | 'strider'
  | 'surge'
  | 'thrust'
  | 'tough'
  | 'unstoppable';

export type FactionTraitId =
  | 'steadfast'
  | 'steadfast-boost'
  | 'dauntless'
  | 'rupture'
  | 'marksman'
  | 'iron-will'
  | 'double-time'
  | 'repel-ambushers'
  | 'hold-the-line'
  | 'riot-shield'
  | 'signal-relay'
  | 'entrenched'
  | 'morale-debuff'
  | 'order-hex-blade'
  | 'order-coordinate'
  | 'order-entrench'
  | 'order-suppress-morale'
  | 'order-iron-will'
  | 'order-precision'
  | 'order-double-time'
  | 'aura-steadfast-boost'
  | 'aura-ward';

export type TraitId = CoreTraitId | FactionTraitId;

export interface ParsedTrait {
  id: string;
  value?: number;
}

export interface TraitMetadata {
  displayName: string;
  description: string;
}

export const TRAIT_REGISTRY: Record<TraitId, TraitMetadata> = {
  ambush: {
    displayName: 'Ambush',
    description: 'Held back at the start of the game. From Round 2 it may be placed anywhere more than 9" from enemy units.',
  },
  ap: {
    displayName: 'AP',
    description: 'Lowers the target defense roll by X.',
  },
  assault: {
    displayName: 'Assault',
    description: 'A ranged weapon that can also be used in melee, with the same attacks and special rules.',
  },
  bane: {
    displayName: 'Bane',
    description: 'Bypasses Regeneration, and the defender re-rolls unmodified defense rolls of 6.',
  },
  blast: {
    displayName: 'Blast',
    description: 'Each hit becomes X hits, shared out between the target and enemy units close to it (no unit takes more hits than it has models). The weapon ignores cover.',
  },
  caster: {
    displayName: 'Caster',
    description: 'Gains X power tokens per round (max 6) to cast faction powers on a 4+.',
  },
  counter: {
    displayName: 'Counter',
    description: 'When charged, the unit strikes first with this weapon, after the charger\'s Impact hits and before the charger\'s own strikes, unless it is Fatigued. This strike replaces its strike back with that weapon.',
  },
  deadly: {
    displayName: 'Deadly',
    description: 'Each unsaved wound counts as X wounds against a single model.',
  },
  fast: {
    displayName: 'Fast',
    description: 'Moves 2" further on an Advance and 4" further on a Rush or Charge.',
  },
  fear: {
    displayName: 'Fear',
    description: 'When melee results are compared, the enemy counts as having taken X extra wounds for each living model with Fear that is within 3" of it.',
  },
  fearless: {
    displayName: 'Fearless',
    description: 'After failing a Morale Test (even an automatic failure while Shaken), rolls 1d6: on a 4+ the test counts as passed.',
  },
  flying: {
    displayName: 'Flying',
    description: 'Ignores terrain and other units while moving.',
  },
  furious: {
    displayName: 'Furious',
    description: 'When charging, unmodified melee hit rolls of 6 add 1 bonus hit.',
  },
  hero: {
    displayName: 'Hero',
    description: 'Friendly units within 6" may use this unit\'s Quality for Morale Tests while it is not Shaken.',
  },
  immobile: {
    displayName: 'Immobile',
    description: 'May only take Hold actions; cannot advance, rush or charge.',
  },
  impact: {
    displayName: 'Impact',
    description: 'When charging, each striking model rolls X dice (none if the charging unit is already Fatigued). Each 2+ is a hit on the target before any melee strikes.',
  },
  indirect: {
    displayName: 'Indirect',
    description: 'Can fire without line of sight when the unit did not move this activation. A unit that moved needs line of sight as usual.',
  },
  limited: {
    displayName: 'Limited',
    description: 'The weapon or equipment can only be used once per match.',
  },
  regeneration: {
    displayName: 'Regeneration',
    description: 'Rolls 1d6 per wound suffered; on a 5+ the wound is ignored.',
  },
  relentless: {
    displayName: 'Relentless',
    description: 'When shooting at targets >9" away, unmodified hit rolls of 6 add 1 bonus hit.',
  },
  reliable: {
    displayName: 'Reliable',
    description: 'Always hits on a base Quality roll of 2+.',
  },
  rending: {
    displayName: 'Rending',
    description: 'Bypasses Regeneration, and unmodified hit rolls of 6 gain AP(4).',
  },
  scout: {
    displayName: 'Scout',
    description: 'May deploy up to 12" ahead of the friendly deployment zone.',
  },
  shred: {
    displayName: 'Shred',
    description: 'Each unmodified Defense roll of 1 against this weapon adds one extra wound.',
  },
  slow: {
    displayName: 'Slow',
    description: 'Moves 2" less on an Advance and 4" less on a Rush or Charge.',
  },
  stealth: {
    displayName: 'Stealth',
    description: 'Enemy ranged attacks from >9" away suffer -1 to hit.',
  },
  strider: {
    displayName: 'Strider',
    description: 'Ignores the speed cap of difficult terrain and rolls only half the dice (rounded up) when jumping.',
  },
  surge: {
    displayName: 'Surge',
    description: 'Unmodified hit rolls of 6 add 1 bonus hit.',
  },
  thrust: {
    displayName: 'Thrust',
    description: 'When charging, melee attacks gain +1 to hit and AP(+1).',
  },
  tough: {
    displayName: 'Tough',
    description: 'A model is removed once it has taken X wounds; hits are dealt to one model until it falls.',
  },
  unstoppable: {
    displayName: 'Unstoppable',
    description: 'Bypasses Regeneration and ignores all negative hit modifiers.',
  },
  steadfast: {
    displayName: 'Steadfast',
    description: '+1 to morale test rolls.',
  },
  'steadfast-boost': {
    displayName: 'Steadfast Boost',
    description: '+2 to morale test rolls from Steadfast.',
  },
  dauntless: {
    displayName: 'Dauntless',
    description: '+1 to morale test rolls.',
  },
  rupture: {
    displayName: 'Rupture',
    description: 'Unmodified hit rolls of 6 gain AP(+2).',
  },
  marksman: {
    displayName: 'Marksman',
    description: '+1 to hit rolls when shooting.',
  },
  'iron-will': {
    displayName: 'Iron Will',
    description: 'Failed morale counts as passed; rolls dice for self-damage on 1-3.',
  },
  'double-time': {
    displayName: 'Double Time',
    description: 'Moves +4" when using Advance actions.',
  },
  'repel-ambushers': {
    displayName: 'Repel Ambushers',
    description: 'Enemy units using Ambush must be placed more than 12" away from this unit (measured per unit).',
  },
  'hold-the-line': {
    displayName: 'Hold the Line',
    description:
      'Gets +1 to Morale Test rolls when it was shot from more than 9" away or charged from more than 6" away. Only counts when most of its models have the rule.',
  },
  'riot-shield': {
    displayName: 'Riot Shield',
    description: '+1 to Defense rolls against non-power hits.',
  },
  'signal-relay': {
    displayName: 'Signal Relay',
    description: 'Extends friendly Hero order range up to 24" between relays.',
  },
  entrenched: {
    displayName: 'Entrenched',
    description: 'Enemy ranged attacks from >9" suffer -1 to hit if this unit has not moved.',
  },
  'morale-debuff': {
    displayName: 'Shaken Resolve',
    description: '-1 to next morale test roll.',
  },
  'order-hex-blade': {
    displayName: 'Order: Bane Strikes',
    description: 'Grants friendly units within 12" Bane in melee once.',
  },
  'order-coordinate': {
    displayName: 'Order: Coordinate',
    description: 'Immediately chain-activates another friendly unit within 12" at end of turn.',
  },
  'order-entrench': {
    displayName: 'Order: Take Cover',
    description: 'Grants friendly units within 12" Entrenched once.',
  },
  'order-suppress-morale': {
    displayName: 'Order: Intimidate',
    description: 'Applies -1 morale penalty to enemy units within 18" in LOS.',
  },
  'order-iron-will': {
    displayName: 'Order: Iron Will',
    description: 'Grants friendly units within 12" Iron Will once.',
  },
  'order-precision': {
    displayName: 'Order: Aimed Fire',
    description: 'Grants friendly units within 12" +1 to hit when shooting once.',
  },
  'order-double-time': {
    displayName: 'Order: Double Time',
    description: 'Grants friendly units within 12" +4" Advance movement once.',
  },
  'aura-steadfast-boost': {
    displayName: 'Banner of Resolve',
    description: 'Friendly units gain Steadfast Boost (+2 Morale) while bearer lives.',
  },
  'aura-ward': {
    displayName: 'Field Medic Rig',
    description: 'Friendly units gain Regeneration (5+ wound ignore) while bearer lives.',
  },
};

/**
 * Faction rules that add +1 to Morale Test rolls when the unit was shot from over 9" or charged from over 6"
 * (the attacker's distance when the shot or charge started). Rules are unit-level here, so "most models have
 * the rule" is true exactly when the unit carries it. Alien Hives' Hive Bond joins this list.
 */
export const DISTANT_ATTACK_MORALE_TRAITS: readonly string[] = ['hold-the-line'];

const TRAIT_PATTERN = /^([a-z0-9-]+)(?:\((-?\d+)\))?$/i;

/** Parse a trait string like `'ap(2)'` or `'steadfast'` into `{ id, value }`. */
export function parseTrait(raw: string): ParsedTrait {
  const trimmed = raw.trim().toLowerCase();
  const match = TRAIT_PATTERN.exec(trimmed);
  if (!match) {
    return { id: trimmed };
  }
  const id = match[1];
  const value = match[2] !== undefined ? Number(match[2]) : undefined;
  return value !== undefined ? { id, value } : { id };
}

/** True when `rules` contains a trait matching `traitId` (with or without parameter). */
export function hasTrait(rules: readonly string[], traitId: TraitId | string): boolean {
  const target = traitId.toLowerCase();
  return rules.some((r) => parseTrait(r).id === target);
}

/**
 * Return the numeric parameter `X` of the first matching `traitId(X)` in `rules`,
 * or `defaultValue` when not present. If the trait is present without `(X)`, returns `1`.
 */
export function getTraitValue(
  rules: readonly string[],
  traitId: TraitId | string,
  defaultValue?: number
): number | undefined {
  const target = traitId.toLowerCase();
  for (const raw of rules) {
    const parsed = parseTrait(raw);
    if (parsed.id === target) {
      return parsed.value ?? 1;
    }
  }
  return defaultValue;
}

/** Sum the numeric parameters `X` across all occurrences of `traitId(X)` in `rules`. */
export function sumTraitValue(rules: readonly string[], traitId: TraitId | string): number {
  const target = traitId.toLowerCase();
  let total = 0;
  for (const raw of rules) {
    const parsed = parseTrait(raw);
    if (parsed.id === target) {
      total += parsed.value ?? 1;
    }
  }
  return total;
}

/** Human-readable display label for a trait string (e.g. `'ap(2)'` -> `'AP(2)'`). */
export function formatTraitLabel(raw: string): string {
  const { id, value } = parseTrait(raw);
  const meta = TRAIT_REGISTRY[id as TraitId];
  const baseName =
    meta?.displayName ??
    id
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  return value !== undefined ? `${baseName}(${value})` : baseName;
}

/** Concise mechanical description for a trait string. */
export function describeTrait(raw: string): string {
  const { id, value } = parseTrait(raw);
  const meta = TRAIT_REGISTRY[id as TraitId];
  if (!meta) return raw;
  if (value !== undefined) {
    return meta.description.replace(/\bX\b/g, String(value));
  }
  return meta.description;
}
