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
  | 'perimeter-watch'
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
    description: 'Held back at the start and deployed in Round 2 or later, anywhere >9" from enemy units.',
  },
  ap: {
    displayName: 'AP',
    description: 'Lowers the target defense roll by X.',
  },
  bane: {
    displayName: 'Bane',
    description: 'Bypasses Regeneration, and the defender re-rolls unmodified defense rolls of 6.',
  },
  blast: {
    displayName: 'Blast',
    description: 'Ignores cover and multiplies each hit by up to X models in the target unit.',
  },
  caster: {
    displayName: 'Caster',
    description: 'Gains X power tokens per round (max 6) to cast faction powers on a 4+.',
  },
  counter: {
    displayName: 'Counter',
    description: 'Strikes first when charged, and the charger loses one Impact hit per Counter model.',
  },
  deadly: {
    displayName: 'Deadly',
    description: 'Each unsaved wound counts as X wounds against a single model.',
  },
  fast: {
    displayName: 'Fast',
    description: 'Moves +2" on Advance (8") and +4" on Rush/Charge (16").',
  },
  fear: {
    displayName: 'Fear',
    description: 'Counts as X extra wounds against its enemy when melee results are compared.',
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
    description: 'On a charge, rolls X dice before melee strikes; each 2+ deals 1 immediate hit.',
  },
  indirect: {
    displayName: 'Indirect',
    description: 'Can fire without line of sight and ignores sight blockers (-1 to hit if the unit moved).',
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
  slow: {
    displayName: 'Slow',
    description: 'Moves -2" on Advance (4") and -4" on Rush/Charge (8").',
  },
  stealth: {
    displayName: 'Stealth',
    description: 'Enemy ranged attacks from >9" away suffer -1 to hit.',
  },
  strider: {
    displayName: 'Strider',
    description: 'Ignores difficult terrain movement penalties and jumps gaps on a 2+.',
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
    description: 'A model is removed once it has taken X wounds.',
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
  'perimeter-watch': {
    displayName: 'Perimeter Watch',
    description: 'Enemy Ambush units must deploy >12" away.',
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
