export interface HeapEntry<T> {
  f: number;
  seq: number;
  node: T;
}

function lessThan<T>(a: HeapEntry<T>, b: HeapEntry<T>): boolean {
  return a.f !== b.f ? a.f < b.f : a.seq < b.seq;
}

/**
 * Binary min-heap ordered by `f`, breaking ties by insertion sequence (`seq`).
 * Supports lazy-deletion A* where improved nodes are pushed again rather than updated in place.
 */
export class MinHeap<T> {
  private readonly data: HeapEntry<T>[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.data.length;
  }

  push(f: number, node: T): void {
    const entry: HeapEntry<T> = { f, seq: this.nextSeq++, node };
    const data = this.data;
    let idx = data.length;
    data.push(entry);
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = data[parentIdx];
      if (!lessThan(entry, parent)) break;
      data[idx] = parent;
      idx = parentIdx;
    }
    data[idx] = entry;
  }

  pop(): HeapEntry<T> | undefined {
    const data = this.data;
    const len = data.length;
    if (len === 0) return undefined;
    const top = data[0];
    const last = data.pop()!;
    if (len > 1) {
      const half = (len - 1) >> 1;
      let idx = 0;
      while (idx < half) {
        let bestChildIdx = (idx << 1) + 1;
        const rightIdx = bestChildIdx + 1;
        if (rightIdx < data.length && lessThan(data[rightIdx], data[bestChildIdx])) {
          bestChildIdx = rightIdx;
        }
        const bestChild = data[bestChildIdx];
        if (!lessThan(bestChild, last)) break;
        data[idx] = bestChild;
        idx = bestChildIdx;
      }
      data[idx] = last;
    }
    return top;
  }
}
