import { describe, it, expect } from 'vitest';
import { labelLayout, LabelBox, boxesOverlap } from '../../src/renderer/labelLayout';

describe('labelLayout (pure overlap maths)', () => {
  it('leaves non-overlapping boxes untouched (zero offsets)', () => {
    // Horizontally separated
    const boxA: LabelBox = { x: 0, y: 100, width: 50, height: 20 };
    const boxB: LabelBox = { x: 60, y: 100, width: 50, height: 20 };
    expect(boxesOverlap(boxA, boxB)).toBe(false);
    expect(labelLayout([boxA, boxB])).toEqual([0, 0]);

    // Vertically separated
    const boxC: LabelBox = { x: 0, y: 50, width: 50, height: 20 };
    const boxD: LabelBox = { x: 0, y: 80, width: 50, height: 20 };
    expect(boxesOverlap(boxC, boxD)).toBe(false);
    expect(labelLayout([boxC, boxD])).toEqual([0, 0]);
  });

  it('separates two overlapping boxes by shifting the second upward to clear the first', () => {
    // Box 1 at y: 100..120
    const box1: LabelBox = { x: 10, y: 100, width: 60, height: 20 };
    // Box 2 at y: 105..125 (overlaps Box 1)
    const box2: LabelBox = { x: 20, y: 105, width: 60, height: 20 };

    expect(boxesOverlap(box1, box2)).toBe(true);

    const offsets = labelLayout([box1, box2]);
    expect(offsets[0]).toBe(0);
    // Box 2 must shift upward so its bottom (y - offset + height) clears Box 1's top (100)
    // 105 - offset + 20 <= 100 => 125 - offset <= 100 => offset >= 25. Exactly 25 to clear.
    expect(offsets[1]).toBe(25);

    // Verify placed boxes no longer overlap
    const placed1: LabelBox = { ...box1, y: box1.y - offsets[0] };
    const placed2: LabelBox = { ...box2, y: box2.y - offsets[1] };
    expect(boxesOverlap(placed1, placed2)).toBe(false);
    expect(placed2.y + placed2.height).toBe(placed1.y);
  });

  it('separates three overlapping boxes into a clean vertical stack', () => {
    // Three boxes centered around the same location
    const box1: LabelBox = { x: 0, y: 100, width: 50, height: 20 };
    const box2: LabelBox = { x: 0, y: 100, width: 50, height: 20 };
    const box3: LabelBox = { x: 0, y: 100, width: 50, height: 20 };

    const offsets = labelLayout([box1, box2, box3]);
    expect(offsets).toEqual([0, 20, 40]);

    const placed1: LabelBox = { ...box1, y: box1.y - offsets[0] };
    const placed2: LabelBox = { ...box2, y: box2.y - offsets[1] };
    const placed3: LabelBox = { ...box3, y: box3.y - offsets[2] };

    expect(boxesOverlap(placed1, placed2)).toBe(false);
    expect(boxesOverlap(placed1, placed3)).toBe(false);
    expect(boxesOverlap(placed2, placed3)).toBe(false);

    expect(placed1.y).toBe(100);
    expect(placed2.y).toBe(80);
    expect(placed3.y).toBe(60);
  });

  it('handles empty and single-box inputs', () => {
    expect(labelLayout([])).toEqual([]);
    expect(labelLayout([{ x: 10, y: 20, width: 30, height: 40 }])).toEqual([0]);
  });

  it('shifts upward past multiple stacked boxes when a later box overlaps an earlier one', () => {
    // Box 1 at y: 100..120
    const box1: LabelBox = { x: 0, y: 100, width: 50, height: 20 };
    // Box 2 at y: 80..100 (already placed above Box 1)
    const box2: LabelBox = { x: 0, y: 80, width: 50, height: 20 };
    // Box 3 at y: 105..125 (overlaps Box 1 at 100, then upon shifting to 80 overlaps Box 2)
    const box3: LabelBox = { x: 0, y: 105, width: 50, height: 20 };

    const offsets = labelLayout([box1, box2, box3]);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(0);
    // Box 3 clears Box 1 (y -> 80), then clears Box 2 (y -> 60): offset = 105 - 60 = 45
    expect(offsets[2]).toBe(45);

    const placed3: LabelBox = { ...box3, y: box3.y - offsets[2] };
    expect(placed3.y).toBe(60);
    expect(boxesOverlap(box1, placed3)).toBe(false);
    expect(boxesOverlap(box2, placed3)).toBe(false);
  });
});
