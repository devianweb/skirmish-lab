import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { Unit, Vector3 } from '../../src/gameTypes';
import {
  advanceActivation,
  endRound,
  getActivatableUnits,
  getOpponentId,
  hasActivatableUnits,
  isRoundComplete,
} from '../../src/engine/activation';

const HOST = 'host1';
const GUEST = 'guest1';

function makeUnit(id: string, ownerId: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    ownerId,
    armyId: 'army-a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { x: 0, y: 0, z: 0 } as Vector3,
    rotation: { x: 0, y: 0, z: 0 } as Vector3,
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
    ...overrides,
  };
}

function makeState(units: Unit[]) {
  const state = createInitialGameState(HOST, GUEST);
  state.units = units;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  return state;
}

describe('activation', () => {
  it('lists only the player\'s alive, unactivated, non-routed units as activatable', () => {
    const state = makeState([
      makeUnit('h-ok', HOST),
      makeUnit('h-activated', HOST, { isActivated: true }),
      makeUnit('h-destroyed', HOST, { isDestroyed: true }),
      makeUnit('h-routed', HOST, { status: ['routed'] as any }),
      makeUnit('h-stunned', HOST, { status: ['stunned'] as any }),
      makeUnit('g-ok', GUEST),
    ]);

    const activatable = getActivatableUnits(state, HOST).map((u) => u.id);
    // Stunned units may still activate (the activation clears the stun).
    expect(activatable).toEqual(['h-ok', 'h-stunned']);
  });

  it('detects players with and without units left', () => {
    const state = makeState([
      makeUnit('h-done', HOST, { isActivated: true }),
      makeUnit('g-ok', GUEST),
    ]);
    expect(hasActivatableUnits(state, HOST)).toBe(false);
    expect(hasActivatableUnits(state, GUEST)).toBe(true);
  });

  it('returns the opposing player id', () => {
    const state = makeState([]);
    expect(getOpponentId(state, HOST)).toBe(GUEST);
    expect(getOpponentId(state, GUEST)).toBe(HOST);
  });

  it('passes the right to activate to the opponent', () => {
    const state = makeState([makeUnit('h1', HOST), makeUnit('g1', GUEST)]);
    advanceActivation(state);
    expect(state.turnState.currentPlayerId).toBe(GUEST);
    expect(state.turnState.roundNumber).toBe(1);
  });

  it('lets the current player keep activating when the opponent runs out', () => {
    const state = makeState([
      makeUnit('h1', HOST),
      makeUnit('h2', HOST),
      makeUnit('g1', GUEST, { isActivated: true }),
    ]);
    state.turnState.currentPlayerId = HOST;
    advanceActivation(state);
    // Guest has nothing left, host still has h2 — host keeps the initiative.
    expect(state.turnState.currentPlayerId).toBe(HOST);
  });

  it('ends the round when all units on both sides have activated', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isActivated: true, hasMoved: true, remainingMovement: 2 }),
      makeUnit('g1', GUEST, { isActivated: true }),
    ]);
    expect(isRoundComplete(state)).toBe(true);

    advanceActivation(state);

    expect(state.turnState.roundNumber).toBe(2);
    // The starting player alternates each round.
    expect(state.turnState.startingPlayerId).toBe(GUEST);
    expect(state.turnState.currentPlayerId).toBe(GUEST);
    expect(state.turnState.unitsActivatedThisRound).toEqual([]);
    expect(state.turnState.activeUnitId).toBeNull();

    const h1 = state.units.find((u) => u.id === 'h1')!;
    expect(h1.isActivated).toBe(false);
    expect(h1.hasMoved).toBe(false);
    expect(h1.remainingMovement).toBe(h1.speed);
  });

  it('keeps engagements across the round reset but resets per-round flags only', () => {
    const state = makeState([
      makeUnit('h1', HOST, { isActivated: true, status: ['engaged'] as any }),
      makeUnit('g1', GUEST, { isActivated: true, status: ['engaged', 'stunned'] as any }),
    ]);
    endRound(state);
    expect(state.units.find((u) => u.id === 'h1')!.status).toContain('engaged');
    // Stun persists until the unit's own activation clears it.
    expect(state.units.find((u) => u.id === 'g1')!.status).toContain('stunned');
  });

  it('does not reset destroyed units on round end', () => {
    const state = makeState([makeUnit('h1', HOST, { isDestroyed: true, isActivated: true })]);
    endRound(state);
    expect(state.units.find((u) => u.id === 'h1')!.isActivated).toBe(true);
  });
});
