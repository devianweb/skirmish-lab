import { describe, it } from 'vitest';
import { validateAction } from '../../src/engine/actions';
import { closestApproach } from '../../src/engine/closestApproach';
import { findNavPath } from '../../src/engine/spatial';
import {
  ALL_NAV_CASES,
  CLOSEST_APPROACH_CASES,
  SQUAD_CHARGE_CASES,
  buildClosestApproachCaseState,
  buildNavCaseState,
  buildSquadChargeAction,
} from '../fixtures/navGoldenCases';

const runBench = process.env.NAV_BENCH === '1';

function stats(samples: number[]): { count: number; mean: number; p95: number; max: number; total: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((s, v) => s + v, 0);
  const mean = sorted.length > 0 ? total / sorted.length : 0;
  const p95Idx = sorted.length > 0 ? Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1) : 0;
  return {
    count: sorted.length,
    mean,
    p95: sorted[p95Idx] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    total,
  };
}

describe.skipIf(!runBench)('navBench: pathfinder, closestApproach and squad charge benchmark', () => {
  it('measures findNavPath, closestApproach and squad charge validation across the golden suite', () => {
    const navInputs = ALL_NAV_CASES.map((c) => ({ c, ...buildNavCaseState(c) }));
    const caInputs = CLOSEST_APPROACH_CASES.map((c) => ({ c, ...buildClosestApproachCaseState(c) }));
    const chargeInputs = SQUAD_CHARGE_CASES.map((c) => ({ c, ...buildSquadChargeAction(c) }));

    // One short warmup call per category to avoid counting initial JIT compile in p95
    if (navInputs[0]) {
      const { c, state, unit } = navInputs[0];
      findNavPath(state, unit, c.destination, c.maxDistance, c.options);
    }

    const navTimes: number[] = [];
    const navByMap = new Map<string, number[]>();
    for (const { c, state, unit } of navInputs) {
      const t0 = performance.now();
      findNavPath(state, unit, c.destination, c.maxDistance, c.options);
      const dt = performance.now() - t0;
      navTimes.push(dt);
      const list = navByMap.get(c.map) ?? [];
      list.push(dt);
      navByMap.set(c.map, list);
    }

    const caTimes: number[] = [];
    for (const { c, state, unit, target } of caInputs) {
      const t0 = performance.now();
      closestApproach(state, unit, c.modelIndex, c.start, c.budget, target, c.otherFinalPositions, c.options);
      caTimes.push(performance.now() - t0);
    }

    const chargeResults: Array<{ id: string; category: string; ms: number; valid: boolean }> = [];
    for (const { c, state, action } of chargeInputs) {
      const t0 = performance.now();
      const res = validateAction(state, action);
      chargeResults.push({ id: c.id, category: c.category, ms: performance.now() - t0, valid: res.valid });
    }

    const navAll = stats(navTimes);
    const caAll = stats(caTimes);

    const lines: string[] = [
      '',
      '=== NAV_BENCH baseline ===',
      `findNavPath (${navAll.count} calls): mean=${navAll.mean.toFixed(2)}ms  p95=${navAll.p95.toFixed(2)}ms  max=${navAll.max.toFixed(2)}ms  total=${navAll.total.toFixed(1)}ms`,
    ];
    for (const [mapId, times] of navByMap) {
      const s = stats(times);
      lines.push(
        `  [${mapId}] (${s.count}): mean=${s.mean.toFixed(2)}ms  p95=${s.p95.toFixed(2)}ms  max=${s.max.toFixed(2)}ms`
      );
    }
    lines.push(
      `closestApproach (${caAll.count} calls): mean=${caAll.mean.toFixed(2)}ms  p95=${caAll.p95.toFixed(2)}ms  max=${caAll.max.toFixed(2)}ms  total=${caAll.total.toFixed(1)}ms`
    );
    lines.push('squad charge validateAction:');
    for (const r of chargeResults) {
      lines.push(`  [${r.id}] (${r.category}, valid=${r.valid}): ${r.ms.toFixed(2)}ms`);
    }
    lines.push('==========================');
    console.log(lines.join('\n'));
  }, 300_000);
});
