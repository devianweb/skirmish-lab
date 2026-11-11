import { describe, it, expect } from 'vitest';
import { GameState, RollOffRecord, createInitialGameState } from '@skirmish-lab/shared';
import { currentPlacementKind, rollOffPairsText, setupAnnouncements } from '../../src/ui/setupPlacement';

const off = (over: Partial<RollOffRecord>): RollOffRecord => ({
  kind: 'mission',
  hostRolls: [3, 3, 5, 1, 1, 1, 1, 1, 1, 1],
  guestRolls: [3, 3, 2, 1, 1, 1, 1, 1, 1, 1],
  winnerId: 'host',
  decidingPair: 2,
  ...over,
});

describe('rollOffPairsText', () => {
  it('lists the pairs up to the deciding one, host die first', () => {
    expect(rollOffPairsText(off({}))).toBe('3–3, 3–3, 5–2');
  });

  it('lists all ten pairs when every pair tied', () => {
    const tied = off({ hostRolls: Array(10).fill(4), guestRolls: Array(10).fill(4), decidingPair: null });
    expect(rollOffPairsText(tied).split(', ')).toHaveLength(10);
  });
});

describe('setupAnnouncements', () => {
  const name = (id: string) => (id === 'host' ? 'Alice' : 'Bob');

  it('has nothing before any roll is made', () => {
    expect(setupAnnouncements(createInitialGameState('host', 'guest'), name)).toEqual([]);
  });

  it('turns the rolls into the count, mission and deployment announcements in that order', () => {
    const state = createInitialGameState('host', 'guest');
    state.setupRolls = {
      objectiveRoll: 6,
      objectiveCount: 5,
      missionRollOff: off({ winnerId: 'guest', decidingPair: 2, hostRolls: [3, 3, 1, 1, 1, 1, 1, 1, 1, 1], guestRolls: [3, 3, 6, 1, 1, 1, 1, 1, 1, 1] }),
      deploymentRollOff: off({ kind: 'deployment', winnerId: 'host' }),
    };
    const lines = setupAnnouncements(state, name);
    expect(lines.map((l) => l.id)).toEqual(['objective-count', 'mission', 'deployment']);
    expect(lines[0].title).toBe('Objective roll: 6 — 5 objectives');
    expect(lines[1].title).toBe('Mission roll-off: Bob wins and places the first objective');
    expect(lines[1].detail).toContain('pair 3 decided it: 1 against 6');
    expect(lines[2].title).toBe('Deployment roll-off: Alice deploys first');
    expect(lines[2].detail).toContain('Alice also activates first in round 1');
  });
});

describe('currentPlacementKind', () => {
  const at = (phase: GameState['turnState']['phase'], extra: Partial<GameState['turnState']> = {}): GameState => {
    const s = createInitialGameState('host', 'guest');
    s.turnState = { ...s.turnState, phase, ...extra };
    return s;
  };

  it('maps each setup step, and nothing during ordinary activations', () => {
    expect(currentPlacementKind(at('objectives'))).toBe('objective');
    expect(currentPlacementKind(at('deployment'))).toBe('deploy');
    expect(currentPlacementKind(at('deployment', { scoutStage: true }))).toBe('scout');
    expect(currentPlacementKind(at('activation', { roundNumber: 2, ambushStep: { skippedPlayerIds: [] } }))).toBe('ambush');
    expect(currentPlacementKind(at('activation'))).toBeNull();
  });

  it('is off once the game is over', () => {
    const s = at('objectives');
    s.status = 'game-over';
    expect(currentPlacementKind(s)).toBeNull();
  });
});
