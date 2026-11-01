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
import {
  CustomMapDefinition,
  STANDARD_MAP_PRESETS,
  TERRAIN_PALETTE_CATALOG,
  validateMapDefinition,
} from '../../src/index';
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
      expect(typeof piece.providesCover).toBe('boolean');
      expect(typeof piece.blocksLineOfSight).toBe('boolean');
      expect(piece.scale.x).toBeGreaterThan(0);
    }
    const types = new Set(terrain.map((t) => t.terrainType));
    expect(types).toContain('crate');
    expect(types).toContain('wall');
    expect(types).toContain('platform');
    expect(types).toContain('ladder');
    expect(types).toContain('stairs');
    expect(types).toContain('toxic');
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

        // Contains at least one unit equipped with multiple ranged weapons (for split fire and multi-weapon chips)
        const multiRangedFighter = force.fighters.find((f) => {
          const weapons = f.weapons.map((id) => WEAPONS[id]).filter(Boolean);
          return weapons.filter((w) => w.profile.type === 'ranged').length >= 2;
        });
        expect(multiRangedFighter).toBeDefined();
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
      const patrol = units.find((u) => u.models.length === 4);
      expect(patrol).toBeDefined();
      expect(patrol!.specialRules).toContain('drop-reserve');
    });

    it('applies deployment phase scenario with starter armies in undeployed state', () => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state, {
        hostArmyId: 'frontier-wardens-starter',
        guestArmyId: 'rust-raiders-starter',
        useDeploymentPhase: true,
      });

      expect(state.turnState.phase).toBe('deployment');
      expect(state.turnState.roundNumber).toBe(0);
      expect(state.turnState.currentPlayerId).toBe(HOST);
      expect(state.units).toHaveLength(8); // 4 host units + 4 guest units
      for (const unit of state.units) {
        expect(unit.isDeployed).toBe(false);
      }
    });
  });

  describe('Phase 13A: Map Schema, Presets & Validation', () => {
    it('ships standard map presets (Frontier Outpost, Industrial Refinery, Sector 7 Catwalks)', () => {
      expect(STANDARD_MAP_PRESETS['frontier-outpost']).toBeDefined();
      expect(STANDARD_MAP_PRESETS['industrial-refinery']).toBeDefined();
      expect(STANDARD_MAP_PRESETS['sector-7-catwalks']).toBeDefined();

      for (const [id, preset] of Object.entries(STANDARD_MAP_PRESETS)) {
        expect(preset.id).toBe(id);
        expect(preset.name.length).toBeGreaterThan(0);
        expect(preset.terrain.length).toBeGreaterThanOrEqual(10);
        expect(preset.objectives).toHaveLength(4);
        expect(preset.board?.width).toBe(44);
        expect(preset.board?.height).toBe(30);

        // Every piece has valid scale and position
        for (const piece of preset.terrain) {
          expect(piece.id).toBeDefined();
          expect(piece.position).toBeDefined();
          expect(piece.scale.x).toBeGreaterThan(0);
          expect(piece.scale.y).toBeGreaterThan(0);
          expect(piece.scale.z).toBeGreaterThan(0);
          expect(typeof piece.blocksLineOfSight).toBe('boolean');
          expect(typeof piece.providesCover).toBe('boolean');
        }
      }
    });

    it('applies map presets to game state via mapId', () => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state, { mapId: 'industrial-refinery' });

      expect(state.terrain.some((t) => t.id === 'refinery-main-facility')).toBe(true);
      expect(state.terrain.some((t) => t.terrainType === 'building-c')).toBe(true);
      expect(state.objectives.some((o) => o.name.includes('Refinery Rooftop'))).toBe(true);
    });

    it('applies custom map directly to game state via customMap option', () => {
      const state = createInitialGameState(HOST, GUEST);
      const custom: CustomMapDefinition = {
        id: 'test-custom-arena',
        name: 'Test Custom Arena',
        terrain: [
          {
            id: 'custom-wall-1',
            terrainType: 'wall',
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 5, y: 2, z: 1 },
            blocksLineOfSight: true,
            providesCover: true,
            isObstacle: true,
          },
        ],
        objectives: [
          {
            id: 'obj-custom-1',
            name: 'Central Bunker',
            position: { x: 0, y: 0, z: 5 },
            controllingPlayerId: null,
            isContested: false,
          },
        ],
      };

      applyDefaultScenario(state, { customMap: custom });

      expect(state.terrain).toHaveLength(1);
      expect(state.terrain[0].id).toBe('custom-wall-1');
      expect(state.objectives).toHaveLength(1);
      expect(state.objectives[0].name).toBe('Central Bunker');
    });

    it('catalog defines rich metadata and categories for all terrain types', () => {
      const keys = Object.keys(TERRAIN_PALETTE_CATALOG);
      expect(keys.length).toBeGreaterThanOrEqual(15);

      for (const [key, meta] of Object.entries(TERRAIN_PALETTE_CATALOG)) {
        expect(meta.type).toBe(key);
        expect(meta.displayName.length).toBeGreaterThan(0);
        expect(['structures', 'walls', 'platforms', 'stairs-ladders', 'scatter']).toContain(meta.category);
        expect(meta.defaultScale.x).toBeGreaterThan(0);
        expect(meta.defaultScale.y).toBeGreaterThan(0);
        expect(meta.defaultScale.z).toBeGreaterThan(0);
      }
    });

    it('validates empty map and warns about 0 terrain pieces', () => {
      const emptyMap: CustomMapDefinition = {
        id: 'empty',
        name: 'Empty Map',
        terrain: [],
        objectives: [],
      };
      const notices = validateMapDefinition(emptyMap);
      expect(notices.some((n) => n.message.includes('0 terrain pieces'))).toBe(true);
    });

    it('validates objective placement: warns on deployment zone overlap, small objective count, and tight spacing', () => {
      const invalidMap: CustomMapDefinition = {
        id: 'bad-map',
        name: 'Bad Map',
        terrain: [
          {
            id: 'blocker',
            terrainType: 'wall',
            position: { x: 0, y: 0, z: -14 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 4, y: 2, z: 4 },
            blocksLineOfSight: true,
            providesCover: true,
            isObstacle: true,
          },
        ],
        objectives: [
          // Inside host deployment zone (z <= -12) and inside blocker
          {
            id: 'obj-1',
            name: 'Spawn Objective',
            position: { x: 0, y: 0, z: -14 },
            controllingPlayerId: null,
            isContested: false,
          },
          // Inside guest deployment zone (z >= 12)
          {
            id: 'obj-2',
            name: 'Enemy Spawn Objective',
            position: { x: 0, y: 0, z: 13 },
            controllingPlayerId: null,
            isContested: false,
          },
        ],
      };

      const notices = validateMapDefinition(invalidMap);

      // Warning 1: Fewer than 3 objectives
      expect(notices.some((n) => n.message.includes('Only 2 objective marker(s)'))).toBe(true);

      // Warning 2: Objective inside Host deployment zone
      expect(notices.some((n) => n.message.includes('inside the Host deployment zone'))).toBe(true);

      // Warning 3: Objective inside Guest deployment zone
      expect(notices.some((n) => n.message.includes('inside the Guest deployment zone'))).toBe(true);

      // Warning 4: Objective inside obstacle piece
      expect(notices.some((n) => n.message.includes('appears inside obstacle terrain piece'))).toBe(true);
    });

    it('validates standard map presets have 0 warnings', () => {
      for (const preset of Object.values(STANDARD_MAP_PRESETS)) {
        const notices = validateMapDefinition(preset);
        expect(notices).toHaveLength(0);
      }
    });
  });
});
