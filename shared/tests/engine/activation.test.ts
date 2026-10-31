import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { Unit, Vector3 } from '../../src/gameTypes';
import {
  advanceActivation,
  advanceDeployment,
  endRound,
  evaluateObjectives,
  getActivatableUnits,
  getDeployableUnits,
  getDeploymentZoneBounds,
  getOpponentId,
  hasActivatableUnits,
  hasDeployableUnits,
  isDeploymentComplete,
  isRoundComplete,
  validateDeploymentPosition,
} from '../../src/engine/activation';
import { Objective, Unit, Vector3 } from '../../src/gameTypes';

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

  describe('objectives & 4-round mission engine', () => {
    it('captures an objective if a friendly non-shaken unit is within 3" and 0 enemy units are in 3"', () => {
      const state = makeState([
        makeUnit('h1', HOST, { position: { x: 2, y: 0, z: 0 } }),
        makeUnit('g1', GUEST, { position: { x: 10, y: 0, z: 0 } }),
      ]);
      state.objectives = [
        { id: 'obj1', name: 'Alpha', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: null, isContested: false },
      ];

      evaluateObjectives(state);
      expect(state.objectives[0].controllingPlayerId).toBe(HOST);
      expect(state.objectives[0].isContested).toBe(false);
    });

    it('retains persistent control when capturing unit moves away', () => {
      const state = makeState([
        makeUnit('h1', HOST, { position: { x: 10, y: 0, z: 0 } }),
        makeUnit('g1', GUEST, { position: { x: 15, y: 0, z: 0 } }),
      ]);
      // Objective was previously captured by HOST
      state.objectives = [
        { id: 'obj1', name: 'Alpha', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
      ];

      // No units of either side within 3"
      evaluateObjectives(state);
      expect(state.objectives[0].controllingPlayerId).toBe(HOST);
      expect(state.objectives[0].isContested).toBe(false);
    });

    it('contests an objective and reverts to neutral when opposing units are simultaneously within 3"', () => {
      const state = makeState([
        makeUnit('h1', HOST, { position: { x: 2, y: 0, z: 0 } }),
        makeUnit('g1', GUEST, { position: { x: -2, y: 0, z: 0 } }),
      ]);
      state.objectives = [
        { id: 'obj1', name: 'Alpha', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
      ];

      evaluateObjectives(state);
      expect(state.objectives[0].controllingPlayerId).toBeNull();
      expect(state.objectives[0].isContested).toBe(true);
    });

    it('ignores shaken, routed, or destroyed units for seizing or contesting objectives', () => {
      const state = makeState([
        makeUnit('h1', HOST, { position: { x: 2, y: 0, z: 0 } }),
        makeUnit('g-shaken', GUEST, { position: { x: -2, y: 0, z: 0 }, status: ['shaken'] as any }),
        makeUnit('g-routed', GUEST, { position: { x: 1, y: 0, z: 1 }, status: ['routed'] as any }),
        makeUnit('g-dead', GUEST, { position: { x: 0, y: 0, z: 2 }, isDestroyed: true }),
      ]);
      state.objectives = [
        { id: 'obj1', name: 'Alpha', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: null, isContested: false },
      ];

      evaluateObjectives(state);
      // All guest units are shaken/routed/dead, so only host unit counts
      expect(state.objectives[0].controllingPlayerId).toBe(HOST);
      expect(state.objectives[0].isContested).toBe(false);
    });

    it('terminates the match after round 4 and crowns the winner based on objective control', () => {
      // Place units far from any objective so existing control is preserved
      const state = makeState([
        makeUnit('h1', HOST, { position: { x: 50, y: 0, z: 50 } }),
        makeUnit('g1', GUEST, { position: { x: -50, y: 0, z: -50 } }),
      ]);
      state.turnState.roundNumber = 4;
      state.objectives = [
        { id: 'o1', name: 'Alpha', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o2', name: 'Bravo', position: { x: 10, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o3', name: 'Charlie', position: { x: -10, y: 0, z: 0 }, controllingPlayerId: GUEST, isContested: false },
        { id: 'o4', name: 'Delta', position: { x: 0, y: 0, z: 10 }, controllingPlayerId: null, isContested: true },
      ];

      endRound(state);

      expect(state.status).toBe('game-over');
      expect(state.turnState.phase).toBe('game-over');
      expect(state.turnState.roundNumber).toBe(4); // Did not advance to 5
      expect(state.winner).toBe(HOST);
      expect(state.endReason).toBe('Objective victory (2 to 1)');
    });

    it('declares a draw if players control an equal number of objectives after round 4', () => {
      // Place units far from any objective so existing control is preserved
      const state = makeState([
        makeUnit('h1', HOST, { position: { x: 50, y: 0, z: 50 } }),
        makeUnit('g1', GUEST, { position: { x: -50, y: 0, z: -50 } }),
      ]);
      state.turnState.roundNumber = 4;
      state.objectives = [
        { id: 'o1', name: 'Alpha', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: HOST, isContested: false },
        { id: 'o2', name: 'Bravo', position: { x: 10, y: 0, z: 0 }, controllingPlayerId: GUEST, isContested: false },
      ];

      endRound(state);

      expect(state.status).toBe('game-over');
      expect(state.winner).toBeUndefined();
      expect(state.endReason).toBe('Match drawn (1 to 1 objectives)');
    });
  });

  describe('Phase 10B: Pre-Match Deployment Engine', () => {
    it('calculates 12" standard and vanguard deployment zone boundaries', () => {
      const state = makeState([]);
      // Board 36x36 (halfW = 18, halfH = 18)
      const hostStandard = getDeploymentZoneBounds(state, HOST, false);
      expect(hostStandard.minZ).toBe(-18);
      expect(hostStandard.maxZ).toBe(-6);

      const hostVanguard = getDeploymentZoneBounds(state, HOST, true);
      expect(hostVanguard.minZ).toBe(-18);
      expect(hostVanguard.maxZ).toBe(0);

      const guestStandard = getDeploymentZoneBounds(state, GUEST, false);
      expect(guestStandard.minZ).toBe(6);
      expect(guestStandard.maxZ).toBe(18);

      const guestVanguard = getDeploymentZoneBounds(state, GUEST, true);
      expect(guestVanguard.minZ).toBe(0);
      expect(guestVanguard.maxZ).toBe(18);
    });

    it('enforces deployment sequencing: standard units before vanguard, drop-reserves held', () => {
      const state = makeState([
        makeUnit('h-std', HOST, { isDeployed: false }),
        makeUnit('h-van', HOST, { isDeployed: false, specialRules: ['vanguard'] }),
        makeUnit('h-drop', HOST, { isDeployed: false, specialRules: ['drop-reserve'] }),
      ]);

      // Standard unit must be deployed first
      const eligible1 = getDeployableUnits(state, HOST);
      expect(eligible1.map((u) => u.id)).toEqual(['h-std']);

      // Once standard is deployed, vanguard becomes eligible
      state.units[0].isDeployed = true;
      const eligible2 = getDeployableUnits(state, HOST);
      expect(eligible2.map((u) => u.id)).toEqual(['h-van']);

      // Once vanguard is deployed, no units remain for pre-match deployment (drop-reserve is held)
      state.units[1].isDeployed = true;
      const eligible3 = getDeployableUnits(state, HOST);
      expect(eligible3).toHaveLength(0);
      expect(hasDeployableUnits(state, HOST)).toBe(false);
    });

    it('validates legal deployment positions within zone and rejects obstacles/enemies', () => {
      const state = makeState([
        makeUnit('h1', HOST, { isDeployed: false }),
        makeUnit('g1', GUEST, { isDeployed: true, position: { x: 0, y: 0, z: 8 } }),
      ]);
      state.terrain = [
        {
          id: 'wall-1',
          terrainType: 'wall',
          position: { x: 0, y: 0, z: -10 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 1, z: 1 },
          blocksLineOfSight: true,
          providesCover: true,
          isObstacle: true,
        },
      ];

      const unit = state.units[0];

      // Legal position in Host 12" zone (-18 to -6)
      expect(validateDeploymentPosition(state, unit, { x: 0, y: 0, z: -14 }).valid).toBe(true);

      // Outside zone (too far forward at z = -4)
      const outOfZone = validateDeploymentPosition(state, unit, { x: 0, y: 0, z: -4 });
      expect(outOfZone.valid).toBe(false);
      expect(outOfZone.reason).toContain('outside friendly 12" deployment zone');

      // Inside terrain obstacle
      const insideObstacle = validateDeploymentPosition(state, unit, { x: 0, y: 0, z: -10 });
      expect(insideObstacle.valid).toBe(false);
      expect(insideObstacle.reason).toContain('obstacle');
    });

    it('advances deployment turns and transitions to activation once all units are placed', () => {
      const state = makeState([
        makeUnit('h1', HOST, { isDeployed: false }),
        makeUnit('g1', GUEST, { isDeployed: false }),
      ]);
      state.turnState.phase = 'deployment';
      state.turnState.currentPlayerId = HOST;
      state.turnState.startingPlayerId = HOST;

      // Host deploys
      state.units[0].isDeployed = true;
      advanceDeployment(state);
      expect(state.turnState.currentPlayerId).toBe(GUEST);
      expect(state.turnState.phase).toBe('deployment');

      // Guest deploys
      state.units[1].isDeployed = true;
      advanceDeployment(state);
      // All units deployed -> Round 1 begins
      expect(state.turnState.phase).toBe('activation');
      expect(state.turnState.roundNumber).toBe(1);
      expect(state.turnState.currentPlayerId).toBe(HOST);
    });
  });
});
