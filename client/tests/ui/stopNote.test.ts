import { describe, it, expect } from 'vitest';
import {
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  STARTER_ARMIES,
  Vector3,
  createInitialGameState,
  createUnitsFromStarterArmy,
} from '@skirmish-lab/shared';
import { explainStop } from '../../src/ui/stopNote';

const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function setup() {
  const state = createInitialGameState(HOST_PLAYER_ID, GUEST_PLAYER_ID, 'A', 'B');
  const [mover] = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST_PLAYER_ID);
  mover.models.forEach((m, i) => (m.position = P(i * 1.2, 0, 0)));
  mover.position = P(0, 0, 0);
  state.units = [mover];
  return { state, mover };
}

const none = (): Vector3[] => [];

describe('explainStop', () => {
  it('says nothing when the path reaches the cursor (within a quarter inch)', () => {
    const { state, mover } = setup();
    expect(
      explainStop({ state, unit: mover, start: P(0, 0, 0), cursor: P(0.2, 0, 4), path: [P(0, 0, 0), P(0, 0, 4)], budget: 6, unconstrainedPath: none })
    ).toBeNull();
  });

  it('does not report a stop for a cursor past the board edge that the path reaches', () => {
    const { state, mover } = setup();
    const edge = (state.board.width * state.board.gridSize) / 2 - 0.25;
    expect(
      explainStop({
        state,
        unit: mover,
        start: P(edge - 2, 0, 0),
        cursor: P(edge + 5, 0, 0),
        path: [P(edge - 2, 0, 0), P(edge, 0, 0)],
        budget: 6,
        unconstrainedPath: none,
      })
    ).toBeNull();
  });

  it('the whole allowance spent (within 0.05") is out of movement; just under is not', () => {
    const { state, mover } = setup();
    const spent = explainStop({ state, unit: mover, start: P(0, 0, 0), cursor: P(0, 0, 10), path: [P(0, 0, 0), P(0, 0, 5.96)], budget: 6, unconstrainedPath: none });
    expect(spent?.cause).toBe('budget');
    const left = explainStop({ state, unit: mover, start: P(0, 0, 0), cursor: P(0, 0, 10), path: [P(0, 0, 0), P(0, 0, 5.9)], budget: 6, unconstrainedPath: none });
    expect(left?.cause).toBe('terrain');
  });

  it('names the difficult terrain cap when it set the budget', () => {
    const { state, mover } = setup();
    const note = explainStop({ state, unit: mover, start: P(0, 0, 0), cursor: P(0, 0, 10), path: [P(0, 0, 0), P(0, 0, 6)], budget: 6, difficultCap: 6, unconstrainedPath: none });
    expect(note?.text).toBe('Stopped: difficult terrain caps the move at 6"');
  });

  it('stopping with allowance left, no unit in the way and a higher cursor is a climb problem; level is terrain', () => {
    const { state, mover } = setup();
    const up = explainStop({ state, unit: mover, start: P(0, 0, 0), cursor: P(0, 3, 3), path: [P(0, 0, 0), P(0, 0, 2)], budget: 6, unconstrainedPath: () => [P(0, 0, 0), P(0, 0, 2)] });
    expect(up?.text).toBe("Stopped: can't climb there (use stairs or a ladder)");
    const level = explainStop({ state, unit: mover, start: P(0, 0, 0), cursor: P(0, 0, 3), path: [P(0, 0, 0), P(0, 0, 1)], budget: 6, unconstrainedPath: () => [P(0, 0, 0), P(0, 0, 1)] });
    expect(level?.text).toBe('Stopped: blocked by terrain');
    expect(level?.at).toMatchObject({ x: 0, z: 1 });
  });

  it('names the unit whose 1" zone the unconstrained route would enter, and not one that is far away', () => {
    const { state, mover } = setup();
    const [other, far] = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], GUEST_PLAYER_ID);
    other.models.forEach((m, i) => (m.position = P(0.3 + i * 1.2, 0, 4)));
    other.position = P(0.3, 0, 4);
    far.models.forEach((m, i) => (m.position = P(20 + i * 1.2, 0, 20)));
    far.position = P(20, 0, 20);
    state.units = [mover, other, far];
    const note = explainStop({
      state,
      unit: mover,
      start: P(0, 0, 0),
      cursor: P(0, 0, 8),
      path: [P(0, 0, 0), P(0, 0, 2)],
      budget: 6,
      unconstrainedPath: () => [P(0, 0, 0), P(0, 0, 8)],
    });
    expect(note).toMatchObject({ cause: 'keep-away', unitId: other.id, unitName: other.name });
    expect(note?.text).toBe(`Stopped: within 1" of ${other.name} (keep-away)`);
  });

  it('a Rush halted at difficult ground says so, ahead of the keep-away probe', () => {
    const { state, mover } = setup();
    const note = explainStop({ state, unit: mover, start: P(0, 0, 0), cursor: P(0, 0, 9), path: [P(0, 0, 0), P(0, 0, 3)], budget: 12, stoppedBeforeDifficult: true, unconstrainedPath: none });
    expect(note?.cause).toBe('difficult-edge');
  });
});
