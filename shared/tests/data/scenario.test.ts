import { describe, it, expect } from 'vitest';
import { createInitialGameState, HOST_PLAYER_ID, GUEST_PLAYER_ID } from '../../src/gameState';
import {
  applyDefaultScenario,
  createBalancedObjectives,
  createBlankMap,
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
  TERRAIN_PALETTE_CATALOG,
  validateMapDefinition,
} from '../../src/index';
import { WEAPONS } from '../../src/data/weapons';
import { getActivatableUnits, isRoundComplete, getDeploymentZoneBounds } from '../../src/engine/activation';

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
    expect(state.terrain).toHaveLength(0); // no presets: default is an empty battlefield
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
    expect(objectives).toHaveLength(4);
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
    it('falls back to an empty battlefield with standard objectives when no map is given', () => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state);
      expect(state.terrain).toHaveLength(0);
      expect(state.objectives).toHaveLength(4);
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
      expect(keys.length).toBeGreaterThanOrEqual(6);

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
  });
});

describe('custom map board size and the TEST army', () => {
  it('uses the custom map board size (not the 36x36 default)', () => {
    const state = createInitialGameState(HOST, GUEST);
    const map: CustomMapDefinition = {
      id: 'm',
      name: 'Wide',
      version: 1,
      board: { width: 44, height: 30 },
      terrain: [],
      objectives: [],
    };
    applyDefaultScenario(state, { customMap: map });
    expect(state.board.width).toBe(44);
    expect(state.board.height).toBe(30);
  });

  it('the blank map and a fresh game state are 48x48', () => {
    expect(createBlankMap().board).toEqual({ width: 48, height: 48 });
    const state = createInitialGameState(HOST, GUEST);
    expect(state.board.width).toBe(48);
    expect(state.board.height).toBe(48);
    applyDefaultScenario(state, {});
    expect(state.board.width).toBe(48);
    expect(state.board.height).toBe(48);
  });

  it('an old 44x30 map keeps its size, 3" zones, and its objectives', () => {
    const state = createInitialGameState(HOST, GUEST);
    const map: CustomMapDefinition = { ...createBlankMap(), board: { width: 44, height: 30 } };
    applyDefaultScenario(state, { customMap: map });
    expect(state.board).toMatchObject({ width: 44, height: 30 });
    const zone = getDeploymentZoneBounds(state, state.hostId, false);
    expect(zone.maxZ - zone.minZ).toBe(3);
    expect(validateMapDefinition(map).filter((n) => n.severity === 'error')).toEqual([]);
  });

  it('the TEST army spawns one very fast single-model fighter per side', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { hostArmyId: 'test-army', guestArmyId: 'test-army' });
    const host = state.units.filter((u) => u.ownerId === HOST);
    const guest = state.units.filter((u) => u.ownerId === GUEST);
    expect(host).toHaveLength(1);
    expect(guest).toHaveLength(1);
    expect(host[0].speed).toBeGreaterThanOrEqual(24);
    expect(host[0].models.filter((m) => !m.isDestroyed)).toHaveLength(1);
    expect(STARTER_ARMIES['test-army'].name).toMatch(/TEST/);
  });
});

describe('deployment zones keep armies 24" apart', () => {
  const zones = (width: number, height: number) => {
    const state = createInitialGameState(HOST, GUEST);
    state.board.width = width;
    state.board.height = height;
    return {
      host: getDeploymentZoneBounds(state, state.hostId),
      guest: getDeploymentZoneBounds(state, state.guestId),
      vanguard: getDeploymentZoneBounds(state, state.hostId, true),
    };
  };
  it('48" deep: the usual 12" zones', () => {
    const z = zones(48, 48);
    expect(z.host.maxZ).toBe(-12);
    expect(z.guest.minZ).toBe(12);
    expect(z.host.minZ).toBe(-24);
  });
  it('30" deep: zones shrink to 3" so they stay 24" apart', () => {
    const z = zones(44, 30);
    expect(z.host.minZ).toBe(-15);
    expect(z.host.maxZ).toBe(-12);
    expect(z.guest.minZ - z.host.maxZ).toBe(24);
    expect(z.vanguard.maxZ).toBe(0);
  });
  it('60" deep: still 12" zones (36" apart)', () => {
    const z = zones(48, 60);
    expect(z.host.maxZ).toBe(-18);
  });
});

describe('board size validation', () => {
  const mapOf = (width: number, height: number): CustomMapDefinition => ({
    id: 'm', name: 'M', version: 1, board: { width, height }, terrain: [], objectives: createBalancedObjectives({ width, height }),
  });
  const errors = (m: CustomMapDefinition) => validateMapDefinition(m).filter((n) => n.severity === 'error');

  it('accepts the limits 24 and 72 and rejects outside them or fractions', () => {
    expect(errors(mapOf(24, 36))).toEqual([]);
    expect(errors(mapOf(72, 72))).toEqual([]);
    expect(errors(mapOf(23, 48)).some((n) => n.message.includes('width'))).toBe(true);
    expect(errors(mapOf(73, 48)).some((n) => n.message.includes('width'))).toBe(true);
    expect(errors(mapOf(48, 73)).some((n) => n.message.includes('height'))).toBe(true);
    expect(errors(mapOf(48.5, 48)).some((n) => n.message.includes('width'))).toBe(true);
  });

  it('errors when the board is too shallow for 24" separation, warns under 36"', () => {
    expect(errors(mapOf(44, 25)).some((n) => n.message.includes('too shallow'))).toBe(true);
    expect(errors(mapOf(44, 26)).some((n) => n.message.includes('too shallow'))).toBe(false);
    const warn = (h: number) => validateMapDefinition(mapOf(44, h)).some((n) => n.severity === 'warning' && n.message.includes('under 6"'));
    expect(warn(30)).toBe(true);
    expect(warn(35)).toBe(true);
    expect(warn(36)).toBe(false);
    expect(warn(48)).toBe(false);
  });

  it('checks objectives against the real zone depth of the board', () => {
    // 48-deep: zone inner edge z = -12; 30-deep: inner edge z = -12 too (3" zone); 36-deep: edge -12 (6" zone)
    const obj = (z: number) => ({ id: 'o', name: 'O', position: { x: 0, y: 0, z }, controllingPlayerId: null, isContested: false });
    const m = (h: number, z: number): CustomMapDefinition => ({ ...mapOf(44, h), objectives: [obj(z), { ...obj(0), id: 'p', name: 'P', position: { x: 20, y: 0, z: 0 } }, { ...obj(0), id: 'q', name: 'Q', position: { x: -20, y: 0, z: 0 } }] });
    const inHost = (map: CustomMapDefinition) => validateMapDefinition(map).some((n) => n.message.includes('inside the Host deployment zone'));
    expect(inHost(m(48, -12))).toBe(true);
    expect(inHost(m(48, -11.5))).toBe(false);
    expect(inHost(m(72, -20))).toBe(false); // 72-deep: zone is -36..-24
    expect(inHost(m(72, -25))).toBe(true);
    expect(inHost(m(30, -13))).toBe(true);
    expect(inHost(m(30, -11))).toBe(false);
  });

  it('warns about terrain and objectives outside the board', () => {
    const map: CustomMapDefinition = {
      ...mapOf(24, 36),
      terrain: [{
        id: 'far', terrainType: 'wall', position: { x: 13, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        blocksLineOfSight: true, providesCover: true, isObstacle: true,
      }],
      objectives: [
        { id: 'a', name: 'Out', position: { x: 0, y: 0, z: 19 }, controllingPlayerId: null, isContested: false },
      ],
    };
    const n = validateMapDefinition(map);
    expect(n.some((x) => x.severity === 'warning' && x.message.includes('Terrain piece "far" is outside'))).toBe(true);
    expect(n.some((x) => x.severity === 'warning' && x.message.includes('Objective "Out" is outside'))).toBe(true);
  });
});

describe('createBalancedObjectives', () => {
  it.each([[24, 36], [36, 36], [48, 48], [44, 30], [72, 72], [30, 26]])(
    'on %i x %i: more than 9" apart, outside both zones, inside the board',
    (width, height) => {
      const objectives = createBalancedObjectives({ width, height });
      expect(objectives).toHaveLength(4);
      const state = createInitialGameState(HOST, GUEST);
      state.board.width = width;
      state.board.height = height;
      const host = getDeploymentZoneBounds(state, HOST, false);
      const guest = getDeploymentZoneBounds(state, GUEST, false);
      for (const [i, a] of objectives.entries()) {
        expect(a.position.z).toBeGreaterThan(host.maxZ);
        expect(a.position.z).toBeLessThan(guest.minZ);
        expect(Math.abs(a.position.x)).toBeLessThanOrEqual(width / 2);
        for (const b of objectives.slice(i + 1)) {
          expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(9);
        }
      }
      expect(new Set(objectives.map((o) => o.id)).size).toBe(objectives.length);
      const map: CustomMapDefinition = { id: 'x', name: 'x', board: { width, height }, terrain: [], objectives };
      expect(validateMapDefinition(map).filter((n) => n.message.includes('Objective'))).toEqual([]);
    },
  );

  it('scales positions with the board and falls back to fewer markers when space runs out', () => {
    const big = createBalancedObjectives({ width: 72, height: 72 });
    expect(Math.max(...big.map((o) => Math.abs(o.position.x)))).toBe(18);
    expect(createBalancedObjectives({ width: 24, height: 36 }).length).toBe(4);
    const tiny = createBalancedObjectives({ width: 8, height: 26 });
    expect(tiny.length).toBeGreaterThanOrEqual(1);
    expect(tiny.length).toBeLessThan(4);
  });
});
