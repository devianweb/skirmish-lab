import type { AttackDistanceRules, AttackGateEntry } from '@skirmish-lab/shared';

/** One run of text on a target badge; the tone tells the renderer how bright to draw it. */
export interface BadgeSegment {
  text: string;
  tone: 'distance' | 'on' | 'off' | 'negated';
}

/**
 * The distance as shown on a badge: one decimal, or two when the one-decimal value would read as one of the
 * gate thresholds on the badge (so 8.96" never looks like it is exactly 9.0"). The switch itself is decided
 * elsewhere from the exact distance, never from this text.
 */
export function formatGateDistance(distance: number, thresholds: readonly number[]): string {
  const oneDecimal = distance.toFixed(1);
  const collides = thresholds.some((t) => Number(oneDecimal) === t);
  return `${collides ? distance.toFixed(2) : oneDecimal}"`;
}

/** Typographic minus for the effect text ('-1 to hit' reads as '−1 to hit'). */
const typographic = (text: string): string => text.replace(/^-/, '−');

function entrySegment(entry: AttackGateEntry): BadgeSegment {
  const { gate, displayName } = entry;
  const threshold = `${gate.comparison} ${gate.distance}"`;
  if (!entry.applies) return { text: `${displayName} ✗ (needs ${threshold})`, tone: 'off' };
  // The attacker's own rules read as a tick; the target's rules say what they do to the attack.
  const body = gate.holder === 'attacker' ? `${displayName} ✓` : `${displayName} ${typographic(gate.effect)}`;
  if (entry.negatedBy === 'unstoppable') {
    return { text: `${body} (${threshold}), negated by Unstoppable`, tone: 'negated' };
  }
  return { text: `${body} (${threshold})`, tone: 'on' };
}

/** Badge content for one attack: the distance, then one segment per gate the attack involves (attacker's first). */
export function badgeSegments(rules: AttackDistanceRules): BadgeSegment[] {
  const thresholds = rules.entries.map((e) => e.gate.distance);
  return [
    { text: formatGateDistance(rules.distance, thresholds), tone: 'distance' },
    ...rules.entries.map(entrySegment),
  ];
}
