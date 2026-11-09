import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';

const HOST = 'host1';
const GUEST = 'guest1';

function makeUnit(id: string, ownerId: string): Unit {
  return {
    id, ownerId, armyId: 'army-x', unitType: 'trooper', name: id, quality: 4, defense: 5, speed: 6,
    position: { x: 0, y: 0, z: 0 } as Vector3, rotation: { x: 0, y: 0, z: 0 } as Vector3,
    status: [], wounds: 1, maxWounds: 1, isActivated: false, isDestroyed: false, models: [],
    weapons: [], specialRules: [], hasMoved: false, remainingMovement: 6,
  };
}

function makeState(hostName?: string, guestName?: string): GameState {
  const state = createInitialGameState(HOST, GUEST, hostName, guestName);
  state.units = [makeUnit('h1', HOST), makeUnit('g1', GUEST)];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  return state;
}

const concede = (actorId: string) => createAction(actorId, 'concede', { type: 'concede' });

const pileIn = (): GameState['turnState']['pendingReaction'] =>
  ({
    id: 'r1', type: 'pile-in', promptingPlayerId: GUEST, expiresAt: Date.now() + 60000,
  }) as unknown as GameState['turnState']['pendingReaction'];

describe('concede validation', () => {
  it("is valid on your own turn and on the opponent's turn", () => {
    const s = makeState();
    expect(s.turnState.currentPlayerId).toBe(HOST);
    expect(validateAction(s, concede(HOST)).valid).toBe(true);
    expect(validateAction(s, concede(GUEST)).valid).toBe(true);
  });

  it('is valid during deployment', () => {
    const s = makeState();
    s.status = 'setting-up';
    s.turnState.phase = 'deployment';
    expect(validateAction(s, concede(GUEST)).valid).toBe(true);
    expect(validateAction(s, concede(HOST)).valid).toBe(true);
  });

  it('is valid for either player during a pending reaction', () => {
    const s = makeState();
    s.turnState.pendingReaction = pileIn();
    expect(validateAction(s, concede(GUEST)).valid).toBe(true);
    expect(validateAction(s, concede(HOST)).valid).toBe(true);
  });

  it('is valid during a declared charge', () => {
    const s = makeState();
    s.turnState.activeUnitId = 'h1';
    s.turnState.charge = { unitId: 'h1', targetId: 'g1', legs: 1 };
    expect(validateAction(s, concede(HOST)).valid).toBe(true);
    expect(validateAction(s, concede(GUEST)).valid).toBe(true);
  });

  it('is invalid once the game is over', () => {
    const s = makeState();
    s.status = 'game-over';
    const r = validateAction(s, concede(HOST));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('Game is over');
  });

  it('is rejected from someone who is not a player in the match', () => {
    expect(validateAction(makeState(), concede('stranger')).valid).toBe(false);
  });
});

describe('concede application', () => {
  it('ends the game with the host as winner when the guest concedes', () => {
    const out = applyAction(makeState('Alice', 'Bob'), concede(GUEST));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.status).toBe('game-over');
    expect(out.state.turnState.phase).toBe('game-over');
    expect(out.state.winner).toBe(HOST);
    expect(out.state.endReason).toBe('Bob conceded');
  });

  it('ends the game with the guest as winner when the host concedes', () => {
    const out = applyAction(makeState('Alice', 'Bob'), concede(HOST));
    if (!out.ok) throw new Error('expected ok');
    expect(out.state.winner).toBe(GUEST);
    expect(out.state.endReason).toBe('Alice conceded');
  });

  it('falls back to Host / Guest when the player has no name', () => {
    const s = makeState();
    s.players.forEach((p) => { p.name = ''; });
    const a = applyAction(s, concede(HOST));
    const b = applyAction(s, concede(GUEST));
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.state.endReason).toBe('Host conceded');
    expect(b.state.endReason).toBe('Guest conceded');
  });

  it('clears the active unit, pending reaction and charge', () => {
    const s = makeState();
    s.turnState.activeUnitId = 'h1';
    s.turnState.charge = { unitId: 'h1', targetId: 'g1', legs: 2 };
    s.turnState.pendingReaction = pileIn();
    const out = applyAction(s, concede(HOST));
    if (!out.ok) throw new Error('expected ok');
    expect(out.state.turnState.activeUnitId).toBeNull();
    expect(out.state.turnState.pendingReaction).toBeNull();
    expect(out.state.turnState.charge).toBeNull();
  });

  it('logs exactly one accepted entry, needs no dice and does not mutate the input', () => {
    const s = makeState();
    const before = JSON.stringify(s);
    const action = concede(GUEST);
    expect(getDiceSpecs(s, action)).toBeNull();
    const out = applyAction(s, action);
    if (!out.ok) throw new Error('expected ok');
    expect(out.state.actionLog).toHaveLength(1);
    expect(out.state.actionLog[0].result).toBe('accepted');
    expect(out.state.actionLog[0].action.type).toBe('concede');
    expect(out.state.lastActionId).toBe(action.id);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('cannot be applied twice', () => {
    const out = applyAction(makeState(), concede(HOST));
    if (!out.ok) throw new Error('expected ok');
    expect(applyAction(out.state, concede(GUEST)).ok).toBe(false);
  });
});
