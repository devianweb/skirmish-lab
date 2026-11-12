import { describe, it, expect } from 'vitest';
import { distanceGatesOf, type AttackDistanceRules, type AttackGateEntry } from '@skirmish-lab/shared';
import { badgeSegments, formatGateDistance } from '../../src/ui/distanceIndicators';

const NAMES: Record<string, string> = {
  'hold-the-line': 'Hold the Line',
  ferocious: 'Ferocious',
  relentless: 'Relentless',
  stealth: 'Stealth',
};

function entry(traitId: string, ctx: 'shooting' | 'charge', applies: boolean, negatedBy?: 'unstoppable'): AttackGateEntry {
  const gate = distanceGatesOf(traitId).find((g) => g.context === ctx)!;
  return {
    traitId,
    displayName: NAMES[traitId],
    holder: gate.holder,
    gate,
    applies,
    ...(negatedBy ? { negatedBy } : {}),
  };
}

describe('formatGateDistance', () => {
  it('shows one decimal normally', () => {
    expect(formatGateDistance(12.04, [9])).toBe('12.0"');
    expect(formatGateDistance(8, [])).toBe('8.0"');
  });
  it('shows two decimals when one decimal would read as a shown threshold', () => {
    expect(formatGateDistance(8.96, [9])).toBe('8.96"');
    expect(formatGateDistance(9.04, [9])).toBe('9.04"');
    expect(formatGateDistance(9, [9])).toBe('9.00"');
    expect(formatGateDistance(6.02, [9, 6])).toBe('6.02"');
  });
  it('keeps one decimal near a threshold that is not shown', () => {
    expect(formatGateDistance(8.96, [6])).toBe('9.0"');
    expect(formatGateDistance(8.96, [])).toBe('9.0"');
  });
});

describe('badgeSegments', () => {
  it('takes the tick and cross from the engine comparison, not from the rounded text', () => {
    const under = badgeSegments({ distance: 8.96, entries: [entry('ferocious', 'shooting', false)] });
    expect(under[0]).toEqual({ text: '8.96"', tone: 'distance' });
    expect(under[1]).toEqual({ text: 'Ferocious ✗ (needs beyond 9")', tone: 'off' });
    const over = badgeSegments({ distance: 9.04, entries: [entry('ferocious', 'shooting', true)] });
    expect(over[0].text).toBe('9.04"');
    expect(over[1]).toEqual({ text: 'Ferocious ✓ (beyond 9")', tone: 'on' });
  });

  it("describes the target's rules by their effect, with a typographic minus", () => {
    const rules: AttackDistanceRules = {
      distance: 12,
      entries: [
        entry('relentless', 'shooting', true),
        entry('stealth', 'shooting', true),
        entry('hold-the-line', 'shooting', true),
      ],
    };
    expect(badgeSegments(rules).map((s) => s.text)).toEqual([
      '12.0"',
      'Relentless ✓ (beyond 9")',
      'Stealth −1 to hit (beyond 9")',
      'Hold the Line +1 morale (beyond 9")',
    ]);
  });

  it('marks a negated penalty and keeps it shown', () => {
    const [, stealth] = badgeSegments({ distance: 12, entries: [entry('stealth', 'shooting', true, 'unstoppable')] });
    expect(stealth.tone).toBe('negated');
    expect(stealth.text).toContain('Stealth −1 to hit (beyond 9")');
    expect(stealth.text).toContain('Unstoppable');
  });

  it('uses the charge threshold and shows only the distance when no gate is involved', () => {
    const [, charge] = badgeSegments({ distance: 5, entries: [entry('ferocious', 'charge', false)] });
    expect(charge.text).toBe('Ferocious ✗ (needs beyond 6")');
    expect(badgeSegments({ distance: 4.26, entries: [] })).toEqual([{ text: '4.3"', tone: 'distance' }]);
  });
});
