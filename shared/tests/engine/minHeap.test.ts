import { describe, expect, it } from 'vitest';
import { MinHeap } from '../../src/engine/minHeap';

describe('MinHeap', () => {
  it('returns undefined when popping from an empty heap', () => {
    const heap = new MinHeap<string>();
    expect(heap.size).toBe(0);
    expect(heap.pop()).toBeUndefined();
    heap.push(1, 'a');
    expect(heap.size).toBe(1);
    expect(heap.pop()).toEqual({ f: 1, seq: 0, node: 'a' });
    expect(heap.size).toBe(0);
    expect(heap.pop()).toBeUndefined();
  });

  it('pops ties on f in strict seq (insertion) order', () => {
    const heap = new MinHeap<string>();
    heap.push(5, 'first');
    heap.push(5, 'second');
    heap.push(5, 'third');
    heap.push(3, 'early');
    heap.push(5, 'fourth');
    heap.push(3, 'early-two');

    const popped: Array<{ f: number; seq: number; node: string }> = [];
    while (heap.size > 0) {
      popped.push(heap.pop()!);
    }

    expect(popped.map((e) => e.node)).toEqual([
      'early',
      'early-two',
      'first',
      'second',
      'third',
      'fourth',
    ]);
    expect(popped.map((e) => e.seq)).toEqual([3, 5, 0, 1, 2, 4]);
  });

  it('pops deterministic random inputs in exact (f, seq) sorted order, including interleaved pushes and pops', () => {
    // Simple deterministic LCG PRNG
    let seed = 0x12345678;
    const nextRand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const heap = new MinHeap<number>();
    const expected: Array<{ f: number; seq: number; node: number }> = [];
    let expectedSeq = 0;

    for (let i = 0; i < 300; i++) {
      // Quantize some f values so ties also occur among random inputs
      const f = Math.floor(nextRand() * 50) * 0.25;
      heap.push(f, i);
      expected.push({ f, seq: expectedSeq++, node: i });

      // Occasionally pop an element mid-stream to exercise interleaved push/pop
      if (i % 7 === 0 && heap.size > 0) {
        expected.sort((a, b) => (a.f !== b.f ? a.f - b.f : a.seq - b.seq));
        const want = expected.shift()!;
        const got = heap.pop()!;
        expect(got).toEqual(want);
      }
    }

    expected.sort((a, b) => (a.f !== b.f ? a.f - b.f : a.seq - b.seq));
    const actual: Array<{ f: number; seq: number; node: number }> = [];
    while (heap.size > 0) {
      actual.push(heap.pop()!);
    }
    expect(actual).toEqual(expected);
  });
});
