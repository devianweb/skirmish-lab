import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { rushStopReason, rushStopText } from '../../src/ui/rushStop';

describe('rush stop messaging', () => {
  it('unreachable height with budget to spare points at stairs/ladders', () => {
    const r = rushStopReason({ heightShort: true, pathCost: 3, budget: 12 });
    expect(r).toBe('height');
    expect(rushStopText(r)).toMatch(/stairs or a ladder/);
  });
  it('path that used the whole budget reports out of movement', () => {
    expect(rushStopReason({ heightShort: true, pathCost: 12, budget: 12 })).toBe('budget');
    expect(rushStopReason({ heightShort: true, pathCost: 11.96, budget: 12 })).toBe('budget');
    expect(rushStopText('budget')).toBe('Out of movement');
  });
  it('a route another unit closes off is called blocked, not a height problem', () => {
    const r = rushStopReason({ heightShort: true, pathCost: 0, budget: 12, blockedByUnits: true });
    expect(r).toBe('blocked');
    expect(rushStopText(r)).toMatch(/another unit/);
    expect(rushStopReason({ heightShort: true, pathCost: 12, budget: 12, blockedByUnits: true })).toBe('budget');
  });
  it('flat stop before difficult terrain keeps the difficult-terrain message', () => {
    const r = rushStopReason({ heightShort: false, pathCost: 4, budget: 12 });
    expect(r).toBe('difficult');
    expect(rushStopText(r)).toMatch(/difficult terrain/);
  });
  it('no message ever promises a later turn or a sheer climb', () => {
    for (const r of ['height', 'budget', 'difficult', 'blocked'] as const) {
      expect(rushStopText(r)).not.toMatch(/next turn|sheer/i);
    }
    const hud = readFileSync(resolve(__dirname, '../../src/ui/GameHUD.ts'), 'utf8');
    expect(hud).not.toMatch(/sheer climb|next turn/i);
  });
});
