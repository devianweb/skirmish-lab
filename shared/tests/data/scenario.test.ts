import { describe, it, expect } from 'vitest';
import { createInitialGameState, HOST_PLAYER_ID, GUEST_PLAYER_ID } from '../../src/gameState';
import {
  applyDefaultScenario,
  createDefaultScenarioObjectives,
  createDefaultScenarioTerrain,
  createDefaultScenarioUnits,
} from '../../src/data/scenario';
import {
  DEFAULT_ARMIES,
  STARTER_ARMIES,
  createUnitsFromStarterArmy,
} from '../../src/data/armies';
import { WEAPONS } from '../../src/data/weapons';
import { getActivatableUnits, isRoundComplete } from '../../src/engine/activation';

const HOST = 'host-player';
const GUEST = 'guest-player';

describe('scenario data pack', () => {
  it('spawns five units per player with resolved weapons', () => {
    const units = createDefaultScenarioUnits(HOST, GUEST);
    const hostUnits = units.filter((u) => u.ownerId === HOST);
    const guestUnits = units.filter((u) => u.ownerId === GUEST);

    expect(hostUnits).toHaveLength(5);
    expect(guestUnits).toHaveLength(5);
    for (const unit of units) {
      expect(unit.weapons.length).toBeGreaterThan(0);
      for (const weapon of unit.weapons) {
        expect(WEAPONS[weapon.id]).toBeDefined();
      }
      expect(unit.models).toHaveLength(1);
      expect(unit.remainingMovement).toBe(unit.speed);
      expect(unit.isActivated).toBe(false);
    }
  });

  it('deploys the armies on opposite edges inside the board', () => {
    const units = createDefaultScenarioUnits(HOST, GUEST);
    const halfW = 18;
    const halfH = 18;
    for (const unit of units) {
      expect(Math.abs(unit.position.x)).toBeLessThanOrEqual(halfW);
      expect(Math.abs(unit.position.z)).toBeLessThanOrEqual(halfH);
    }
    const hostZ = units.filter((u) => u.ownerId === HOST).map((u) => u.position.z);
    const guestZ = units.filter((u) => u.ownerId === GUEST).map((u) => u.position.z);
    expect(Math.max(...hostZ.map(Math.abs))).toBeLessThan(halfH);
    expect(Math.min(...guestZ)).toBeGreaterThan(0);
    // Host and guest face each other.
    expect(Math.max(...hostZ)).toBeLessThan(Math.min(...guestZ));
  });

  it('uses unit types the renderer can map to models', () => {
    const units = createDefaultScenarioUnits(HOST, GUEST);
    const modelTypes = new Set(units.map((u) => u.unitType));
    expect([...modelTypes].sort()).toEqual(['heavy', 'leader', 'specialist', 'trooper']);
  });

  it('spawns terrain with cover and line-of-sight flags', () => {
    const terrain = createDefaultScenarioTerrain();
    expect(terrain.length).toBeGreaterThanOrEqual(6);
    for (const piece of terrain) {
      expect(piece.providesCover).toBe(true);
      expect(typeof piece.blocksLineOfSight).toBe('boolean');
      expect(piece.scale.x).toBeGreaterThan(0);
    }
    const types = new Set(terrain.map((t) => t.terrainType));
    expect(types).toContain('crate');
    expect(types).toContain('wall');
  });

  it('applies the scenario to a fresh state and leaves it playable', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state);

    expect(state.status).toBe('in-progress');
    expect(state.turnState.phase).toBe('activation');
    expect(state.units).toHaveLength(10);
    expect(state.terrain.length).toBeGreaterThan(0);
    expect(state.objectives).toHaveLength(4);

    // Round 1 has not started: both players have all units activatable.
    expect(isRoundComplete(state)).toBe(false);
    expect(getActivatableUnits(state, HOST)).toHaveLength(5);
    expect(getActivatableUnits(state, GUEST)).toHaveLength(5);

    // Fully JSON-serializable for state broadcast.
    expect(() => JSON.stringify(state)).not.toThrow();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('ships exactly two original armies as data', () => {
    expect(DEFAULT_ARMIES).toHaveLength(2);
    for (const army of DEFAULT_ARMIES) {
      expect(army.fighters).toHaveLength(5);
      for (const fighter of army.fighters) {
        expect(fighter.quality).toBeGreaterThanOrEqual(2);
        expect(fighter.defense).toBeGreaterThanOrEqual(2);
        expect(fighter.wounds).toBeGreaterThanOrEqual(1);
        expect(fighter.speed).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('exposes deterministic player ids used by both peers', () => {
    expect(HOST_PLAYER_ID).toBe('player-host');
    expect(GUEST_PLAYER_ID).toBe('player-guest');
  });

  it('spawns 3 to 5 objective markers placed > 9" apart outside deployment zones', () => {
    const objectives = createDefaultScenarioObjectives();
    expect(objectives.length).toBeGreaterThanOrEqual(3);
    expect(objectives.length).toBeLessThanOrEqual(5);

    // All objectives are placed outside deployment zones (deployment is z = ±12)
    for (const obj of objectives) {
      expect(Math.abs(obj.position.z)).toBeLessThan(10);
      expect(obj.controllingPlayerId).toBeNull();
      expect(obj.isContested).toBe(false);
    }

    // Check pairwise distance > 9"
    for (let i = 0; i < objectives.length; i++) {
      for (let j = i + 1; j < objectives.length; j++) {
        const dist = Math.hypot(
          objectives[i].position.x - objectives[j].position.x,
          objectives[i].position.z - objectives[j].position.z
        );
        expect(dist).toBeGreaterThanOrEqual(9.0);
      }
    }
  });

  describe('Phase 10A: Point-Balanced Pre-Canned Starter Forces', () => {
    it('ships balanced 300-point starter armies for Frontier Wardens and Rust Raiders', () => {
      expect(STARTER_ARMIES['frontier-wardens-starter']).toBeDefined();
      expect(STARTER_ARMIES['rust-raiders-starter']).toBeDefined();

      for (const key of ['frontier-wardens-starter', 'rust-raiders-starter'] as const) {
        const force = STARTER_ARMIES[key];
        expect(force.totalPoints).toBe(300);
        const calculatedPoints = force.fighters.reduce((acc, f) => acc + f.points, 0);
        expect(calculatedPoints).toBe(300);

        // Contains vanguard and drop-reserve
        const allRules = force.fighters.flatMap((f) => f.specialRules);
        expect(allRules).toContain('vanguard');
        expect(allRules).toContain('drop-reserve');
      }
    });

    it('creates deployable units from starter forces with support for undeployed state', () => {
      const force = STARTER_ARMIES['frontier-wardens-starter'];
      const units = createUnitsFromStarterArmy(force, HOST, {
        startUndeployed: true,
        defaultZ: -12,
        facing: 0,
      });

      expect(units).toHaveLength(4);
      for (const unit of units) {
        expect(unit.ownerId).toBe(HOST);
        expect(unit.isDeployed).toBe(false);
        expect(unit.weapons.length).toBeGreaterThan(0);
        expect(unit.models.length).toBeGreaterThanOrEqual(1);
      }

      // Check multi-model squad
      const patrol = units.find((u) => u.models.length === 2);
      expect(patrol).toBeDefined();
      expect(patrol!.specialRules).toContain('drop-reserve');
    });
  });
});
