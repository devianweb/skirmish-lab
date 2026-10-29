/**
 * Data-driven trait & special rules registry for SkirmishLab.
 *
 * Trait strings in fighter and weapon definitions use the format:
 *   - `'steadfast'`, `'shred'`, `'calibrated'` (boolean traits)
 *   - `'pierce(2)'`, `'blast(3)'`, `'resilient(3)'` (parameterized traits)
 *
 * All identifiers and descriptions are original, first-principles clean-room
 * definitions.
 */

export type CoreTraitId =
  | 'drop-reserve'
  | 'pierce'
  | 'hexed'
  | 'blast'
  | 'channeler'
  | 'brace'
  | 'lethal'
  | 'swift'
  | 'dread'
  | 'stoic'
  | 'airborne'
  | 'frenzy'
  | 'commander'
  | 'stationary'
  | 'shock'
  | 'lobbed'
  | 'expendable'
  | 'ward'
  | 'sustained'
  | 'calibrated'
  | 'shred'
  | 'vanguard'
  | 'ponderous'
  | 'camouflaged'
  | 'pathfinder'
  | 'overload'
  | 'impale'
  | 'resilient'
  | 'unerring';

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
  'drop-reserve': {
    displayName: 'Drop Reserve',
    description: 'Deploys in Round 2+ anywhere >9" from enemy units.',
  },
  pierce: {
    displayName: 'Pierce',
    description: 'Subtracts X from the defender Defense roll.',
  },
  hexed: {
    displayName: 'Hexed',
    description: 'Ignores Ward; defender must re-roll unmodified Defense rolls of 6.',
  },
  blast: {
    displayName: 'Blast',
    description: 'Ignores Cover and multiplies each hit by up to X models in the target unit.',
  },
  channeler: {
    displayName: 'Channeler',
    description: 'Generates X power tokens per round (max 6) to cast faction powers on 4+.',
  },
  brace: {
    displayName: 'Brace',
    description: 'Strikes first when charged; charger suffers -1 Shock hit per Braced model.',
  },
  lethal: {
    displayName: 'Lethal',
    description: 'Each unsaved wound multiplies into X wounds against a single model.',
  },
  swift: {
    displayName: 'Swift',
    description: 'Moves +2" on Advance (8") and +4" on Rush/Charge (16").',
  },
  dread: {
    displayName: 'Dread',
    description: 'Adds +X to melee trauma rolls when dealing at least 1 wound.',
  },
  stoic: {
    displayName: 'Stoic',
    description: 'When failing a morale test, rolls 1d6: on 4+ the test counts as passed.',
  },
  airborne: {
    displayName: 'Airborne',
    description: 'Ignores terrain and other units while moving.',
  },
  frenzy: {
    displayName: 'Frenzy',
    description: 'When charging, unmodified melee hit rolls of 6 generate +1 bonus hit.',
  },
  commander: {
    displayName: 'Commander',
    description: 'Friendly units within 12" may use this unit Quality for Morale tests.',
  },
  stationary: {
    displayName: 'Stationary',
    description: 'May only execute Hold actions; cannot move or charge.',
  },
  shock: {
    displayName: 'Shock',
    description: 'On Charge, rolls X dice before melee strikes; each 2+ deals 1 immediate hit.',
  },
  lobbed: {
    displayName: 'Lobbed',
    description: 'Fires without Line of Sight and ignores sight-blocker cover (-1 to hit if moved).',
  },
  expendable: {
    displayName: 'Expendable',
    description: 'Weapon or equipment may only be used once per match.',
  },
  ward: {
    displayName: 'Ward',
    description: 'Rolls 1d6 per wound suffered; on 5+ the wound is ignored.',
  },
  sustained: {
    displayName: 'Sustained',
    description: 'When shooting at targets >9" away, unmodified hit rolls of 6 generate +1 bonus hit.',
  },
  calibrated: {
    displayName: 'Calibrated',
    description: 'Always hits on a base Quality roll of 2+.',
  },
  shred: {
    displayName: 'Shred',
    description: 'Ignores Ward; unmodified hit rolls of 6 gain Pierce(4).',
  },
  vanguard: {
    displayName: 'Vanguard',
    description: 'May deploy up to 12" ahead of the friendly deployment zone.',
  },
  ponderous: {
    displayName: 'Ponderous',
    description: 'Moves -2" on Advance (4") and -4" on Rush/Charge (8").',
  },
  camouflaged: {
    displayName: 'Camouflaged',
    description: 'Enemy ranged attacks from >9" away suffer -1 to hit.',
  },
  pathfinder: {
    displayName: 'Pathfinder',
    description: 'Ignores Difficult Terrain movement penalties.',
  },
  overload: {
    displayName: 'Overload',
    description: 'Unmodified hit rolls of 6 generate +1 bonus hit.',
  },
  impale: {
    displayName: 'Impale',
    description: 'When charging, melee attacks gain +1 to hit and Pierce(+1).',
  },
  resilient: {
    displayName: 'Resilient',
    description: 'Accumulates wounds up to X before rolling trauma; eliminated on 5+X.',
  },
  unerring: {
    displayName: 'Unerring',
    description: 'Ignores Ward and ignores all negative hit modifiers.',
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
    description: 'Unmodified hit rolls of 6 gain Pierce(+2).',
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
    description: 'Enemy Drop Reserve units must deploy >12" away.',
  },
  'riot-shield': {
    displayName: 'Riot Shield',
    description: '+1 to Defense rolls against non-power hits.',
  },
  'signal-relay': {
    displayName: 'Signal Relay',
    description: 'Extends friendly Commander order range up to 24" between relays.',
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
    displayName: 'Order: Hexed Strikes',
    description: 'Grants friendly units within 12" Hexed in melee once.',
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
    description: 'Friendly units gain Ward (5+ wound ignore) while bearer lives.',
  },
};

const TRAIT_PATTERN = /^([a-z0-9-]+)(?:\((-?\d+)\))?$/i;

/** Parse a trait string like `'pierce(2)'` or `'steadfast'` into `{ id, value }`. */
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

/** Human-readable display label for a trait string (e.g. `'pierce(2)'` -> `'Pierce(2)'`). */
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
