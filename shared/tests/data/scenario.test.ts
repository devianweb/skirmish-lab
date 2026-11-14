import { describe, it, expect } from 'vitest';
import { createInitialGameState, HOST_PLAYER_ID, GUEST_PLAYER_ID } from '../../src/gameState';
import {
  applyDefaultScenario,
  createBlankMap,
  DEFAULT_HOST_ARMY_ID,
  DEFAULT_GUEST_ARMY_ID,
} from '../../src/data/scenario';
import {
  STARTER_ARMIES,
  createUnitsFromStarterArmy,
  isKnownArmyId,
} from '../../src/data/armies';
import { createRematchState } from '../../src/engine/rematch';
import {
  CustomMapDefinition,
  TERRAIN_PALETTE_CATALOG,
  validateMapDefinition,
} from '../../src/index';
import { WEAPONS } from '../../src/data/weapons';
import { getBlastParticipants } from '../../src/engine/blast';
import { deploymentFootprintProblem } from '../../src/engine/activation';
import { findEndOverlap } from '../../src/engine/spatial';
import { hasTrait } from '../../src/rules/traits';
import { BUILTIN_MAPS } from '../../src/data/builtinMaps';
import { legacyScenarioTerrain } from '../fixtures/legacyScenarioTerrain';
import { getActivatableUnits, isRoundComplete, getDeploymentZoneBounds } from '../../src/engine/activation';

const HOST = 'host-player';
const GUEST = 'guest-player';

describe('scenario data pack', () => {
  const defaultState = () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { useDeploymentPhase: false });
    return state;
  };

  it('defaults to Human Defense Force (host) vs Orc Marauders (guest) with resolved weapons', () => {
    const state = defaultState();
    const hostUnits = state.units.filter((u) => u.ownerId === HOST);
    const guestUnits = state.units.filter((u) => u.ownerId === GUEST);

    expect(hostUnits).toHaveLength(STARTER_ARMIES['hdf'].fighters.length);
    expect(guestUnits).toHaveLength(STARTER_ARMIES['orc-marauders'].fighters.length);
    expect(hostUnits.every((u) => u.armyId === 'hdf')).toBe(true);
    expect(guestUnits.every((u) => u.armyId === 'orc-marauders')).toBe(true);
    for (const unit of state.units) {
      expect(unit.weapons.length).toBeGreaterThan(0);
      for (const weapon of unit.weapons) {
        expect(WEAPONS[weapon.id]).toBeDefined();
      }
      expect(unit.remainingMovement).toBe(unit.speed);
      expect(unit.isActivated).toBe(false);
    }
  });

  it('an unknown or missing army id falls back to the default for that side only', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { hostArmyId: 'orc-marauders', guestArmyId: 'no-such-army', useDeploymentPhase: false });
    expect(state.units.filter((u) => u.ownerId === HOST).every((u) => u.armyId === 'orc-marauders')).toBe(true);
    expect(state.units.filter((u) => u.ownerId === GUEST).every((u) => u.armyId === 'orc-marauders')).toBe(true);
    const state2 = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state2, { guestArmyId: 'hdf', useDeploymentPhase: false });
    expect(state2.units.filter((u) => u.ownerId === HOST).every((u) => u.armyId === 'hdf')).toBe(true);
    expect(state2.units.filter((u) => u.ownerId === GUEST).every((u) => u.armyId === 'hdf')).toBe(true);
  });

  it('deploys the default armies inside their own 12" zones, on opposite sides', () => {
    const state = defaultState();
    for (const owner of [HOST, GUEST]) {
      const bounds = getDeploymentZoneBounds(state, owner);
      for (const u of state.units.filter((x) => x.ownerId === owner)) {
        for (const m of u.models) {
          expect(m.position!.x).toBeGreaterThanOrEqual(bounds.minX);
          expect(m.position!.x).toBeLessThanOrEqual(bounds.maxX);
          expect(m.position!.z).toBeGreaterThanOrEqual(bounds.minZ - 0.01);
          expect(m.position!.z).toBeLessThanOrEqual(bounds.maxZ + 0.01);
        }
      }
    }
    const hostZ = state.units.filter((u) => u.ownerId === HOST).map((u) => u.position.z);
    const guestZ = state.units.filter((u) => u.ownerId === GUEST).map((u) => u.position.z);
    expect(Math.max(...hostZ)).toBeLessThan(Math.min(...guestZ));
  });

  it('the default deployment-phase game starts both armies undeployed and in order', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { useDeploymentPhase: true });
    expect(state.units.filter((u) => u.ownerId === HOST).every((u) => u.armyId === 'hdf' && !u.isDeployed)).toBe(true);
    expect(state.units.filter((u) => u.ownerId === GUEST).every((u) => u.armyId === 'orc-marauders' && !u.isDeployed)).toBe(true);
  });

  it('uses unit types the renderer can map to models', () => {
    const modelTypes = new Set(defaultState().units.map((u) => u.unitType));
    for (const t of modelTypes) expect(['leader', 'trooper', 'specialist', 'heavy']).toContain(t);
    expect(modelTypes.size).toBeGreaterThanOrEqual(2);
  });

  it('spawns terrain with cover and line-of-sight flags', () => {
    const terrain = legacyScenarioTerrain();
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
    // Without the deployment phase the objectives phase still runs first; the units already stand in place
    expect(state.turnState.phase).toBe('objectives');
    expect(state.units).toHaveLength(9); // Human Defense Force 4 + Orc Marauders 5
    expect(state.terrain).toHaveLength(0); // no presets: default is an empty battlefield
    expect(state.objectives).toHaveLength(0); // markers are placed by the players in the objectives phase

    // Round 1 has not started: both players have all units activatable.
    expect(isRoundComplete(state)).toBe(false);
    expect(getActivatableUnits(state, HOST)).toHaveLength(4);
    expect(getActivatableUnits(state, GUEST)).toHaveLength(5);

    // Fully JSON-serializable for state broadcast.
    expect(() => JSON.stringify(state)).not.toThrow();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('ships exactly two ready-made armies (plus dev-only TEST armies); the old ones are gone', () => {
    const ids = Object.keys(STARTER_ARMIES).filter((id) => !id.startsWith('test'));
    expect(ids.sort()).toEqual(['hdf', 'orc-marauders']);
    for (const id of ['frontier-wardens', 'frontier-wardens-starter', 'rust-raiders', 'rust-raiders-starter']) {
      expect(STARTER_ARMIES[id]).toBeUndefined();
    }
    for (const army of Object.values(STARTER_ARMIES)) {
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

  describe('Phase 10A: Point-Balanced Pre-Canned Starter Forces', () => {
    it('ships balanced 400-point ready-made armies for Human Defense Force and Orc Marauders', () => {
      for (const key of ['hdf', 'orc-marauders'] as const) {
        const force = STARTER_ARMIES[key];
        expect(force.totalPoints).toBe(400);
        expect(force.fighters.reduce((acc, f) => acc + f.points, 0)).toBe(400);
      }
    });

    it('creates deployable units from a ready-made force with support for undeployed state', () => {
      const force = STARTER_ARMIES['hdf'];
      const units = createUnitsFromStarterArmy(force, HOST, {
        startUndeployed: true,
        defaultZ: -12,
        facing: 0,
      });

      expect(units).toHaveLength(force.fighters.length);
      for (const unit of units) {
        expect(unit.ownerId).toBe(HOST);
        expect(unit.isDeployed).toBe(false);
        expect(unit.weapons.length).toBeGreaterThan(0);
        expect(unit.models.length).toBeGreaterThanOrEqual(1);
      }

      // Multi-model squads keep one model per soldier
      const squad = units.find((u) => u.name.startsWith('Infantry Squad'));
      expect(squad).toBeDefined();
      expect(squad!.models).toHaveLength(3);
    });

    it('applies deployment phase scenario with starter armies in undeployed state', () => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state, {
        hostArmyId: 'hdf',
        guestArmyId: 'orc-marauders',
        useDeploymentPhase: true,
      });

      // Players roll for and place the objectives before anyone deploys
      expect(state.turnState.phase).toBe('objectives');
      expect(state.turnState.roundNumber).toBe(0);
      expect(state.turnState.currentPlayerId).toBe(HOST);
      expect(state.objectives).toEqual([]);
      expect(state.setupRolls).toBeUndefined();
      expect(state.units).toHaveLength(9); // 4 host units + 5 guest units
      for (const unit of state.units) {
        expect(unit.isDeployed).toBe(false);
      }
    });
  });

  describe('Phase 13A: Map Schema, Presets & Validation', () => {
    it('falls back to an empty battlefield when no map is given', () => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state);
      expect(state.terrain).toHaveLength(0);
      expect(state.objectives).toHaveLength(0);
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
      // Maps no longer define objectives: an old map's markers are ignored
      expect(state.objectives).toHaveLength(0);
    });

    it('catalog defines rich metadata and categories for all terrain types', () => {
      const keys = Object.keys(TERRAIN_PALETTE_CATALOG);
      expect(keys.length).toBeGreaterThanOrEqual(6);

      for (const [key, meta] of Object.entries(TERRAIN_PALETTE_CATALOG)) {
        expect(meta.type).toBe(key);
        expect(meta.displayName.length).toBeGreaterThan(0);
        expect(['structures', 'walls', 'platforms', 'stairs-ladders', 'scatter', 'area']).toContain(meta.category);
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

    it('ignores the objectives of an old save: no warnings about count, zones, spacing or obstacles', () => {
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

      expect(notices.filter((n) => /objective/i.test(n.message))).toEqual([]);
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

  it('an old 44x30 map keeps its size and 3" zones', () => {
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
      scout: getDeploymentZoneBounds(state, state.hostId, true),
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
    expect(z.scout.maxZ).toBe(-3); // 9" beyond the zone
  });
  it('60" deep: still 12" zones (36" apart)', () => {
    const z = zones(48, 60);
    expect(z.host.maxZ).toBe(-18);
  });
});

describe('board size validation', () => {
  const mapOf = (width: number, height: number): CustomMapDefinition => ({
    id: 'm', name: 'M', version: 1, board: { width, height }, terrain: [],
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

  it('warns about terrain outside the board, and ignores a stray objective', () => {
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
    expect(n.some((x) => /objective/i.test(x.message))).toBe(false);
  });
});

describe('TEST squad army', () => {
  it('spawns one 4-model squad per side', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { hostArmyId: 'test-squad-army', guestArmyId: 'test-squad-army' });
    const host = state.units.filter((u) => u.ownerId === HOST);
    const guest = state.units.filter((u) => u.ownerId === GUEST);
    expect(host).toHaveLength(1);
    expect(guest).toHaveLength(1);
    expect(host[0].models.filter((m) => !m.isDestroyed)).toHaveLength(4);
    expect(guest[0].models.filter((m) => !m.isDestroyed)).toHaveLength(4);
    expect(STARTER_ARMIES['test-squad-army'].name).toMatch(/TEST/);
  });
});

describe('TEST rules-check army', () => {
  const setup = () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { hostArmyId: 'test-rules-army', guestArmyId: 'test-rules-army' });
    return state;
  };

  it('starts the two enemy squads within Blast spread of each other', () => {
    const state = setup();
    const gunner = state.units.find((u) => u.ownerId === HOST && u.name.startsWith('Test Heavy Gunner'))!;
    const squadA = state.units.find((u) => u.ownerId === GUEST && u.name.startsWith('Test Squad A'))!;
    const squadB = state.units.find((u) => u.ownerId === GUEST && u.name.startsWith('Test Squad B'))!;
    const ids = getBlastParticipants(state, gunner, squadA).map((p) => p.unit.id);
    expect(ids[0]).toBe(squadA.id);
    expect(ids).toContain(squadB.id);
  });

  it('gives the gunner Blast, Indirect Blast and two distinct weapons named Rifle', () => {
    const state = setup();
    const gunner = state.units.find((u) => u.ownerId === HOST && u.name.startsWith('Test Heavy Gunner'))!;
    const rifles = gunner.weapons.filter((w) => w.name === 'Rifle');
    expect(rifles.map((w) => w.id).sort()).toEqual(['rifle', 'rifle-twin']);
    const rules = (id: string) => gunner.weapons.find((w) => w.id === id)!.profile.specialRules;
    expect(rules('frag-launcher')).toContain('blast(3)');
    expect(rules('trench-mortar')).toEqual(expect.arrayContaining(['blast(3)', 'indirect']));
    const hero = state.units.find((u) => u.ownerId === HOST && u.name.startsWith('Test Hero'))!;
    expect(hero.specialRules).toContain('hero');
    expect(STARTER_ARMIES['test-rules-army'].name).toMatch(/TEST/);
  });
});

describe('spawning without a deployment phase', () => {
  const MAPS = Object.keys(BUILTIN_MAPS);
  const ARMIES = Object.keys(STARTER_ARMIES);

  it.each(MAPS.flatMap((map) => ARMIES.map((army) => [map, army])))(
    'map %s with army %s: no model starts in terrain, on stairs or ladders, or within 1" of another unit',
    (map, army) => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state, { hostArmyId: army, guestArmyId: army, customMap: BUILTIN_MAPS[map]() });
      for (const unit of state.units) {
        if (unit.isDeployed === false) continue;
        expect(deploymentFootprintProblem(state, unit, unit.position)).toBeNull();
        for (const m of unit.models) {
          expect(findEndOverlap(state, unit.id, m.position!)?.kind).not.toBe('terrain');
        }
      }
    }
  );

  it('G-20: dynamically spaces >4-unit starter armies without overlap and keeps Ambush units in reserve', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, {
      hostArmyId: 'orc-marauders',
      guestArmyId: 'test-special-rules-army',
      useDeploymentPhase: false,
    });

    for (const owner of [HOST, GUEST]) {
      const deployed = state.units.filter((u) => u.ownerId === owner && u.isDeployed !== false);
      expect(deployed.length).toBeGreaterThanOrEqual(5);
      for (const u of deployed) {
        expect(deploymentFootprintProblem(state, u, u.position)).toBeNull();
      }
      for (let i = 0; i < deployed.length; i++) {
        for (let j = i + 1; j < deployed.length; j++) {
          const dist = Math.hypot(
            deployed[i].position.x - deployed[j].position.x,
            deployed[i].position.z - deployed[j].position.z
          );
          expect(dist).toBeGreaterThanOrEqual(3.99);
        }
      }
    }

    const ambushState = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(ambushState, {
      hostArmyId: 'test-scout-ambush-army',
      guestArmyId: 'hdf',
      useDeploymentPhase: false,
    });
    const hostUnits = ambushState.units.filter((u) => u.ownerId === HOST);
    const ambushers = hostUnits.filter((u) => hasTrait(u.specialRules, 'ambush'));
    const regulars = hostUnits.filter((u) => !hasTrait(u.specialRules, 'ambush'));
    expect(ambushers.length).toBeGreaterThan(0);
    for (const u of ambushers) {
      expect(u.isDeployed).toBe(false);
    }
    for (const u of regulars) {
      expect(u.isDeployed).toBe(true);
      expect(deploymentFootprintProblem(ambushState, u, u.position)).toBeNull();
    }
  });

  describe('14G: isKnownArmyId and player-picked setup recording', () => {
    it('recognizes all starter and TEST army IDs and rejects unknown or non-string values', () => {
      expect(isKnownArmyId(DEFAULT_HOST_ARMY_ID)).toBe(true);
      expect(isKnownArmyId(DEFAULT_GUEST_ARMY_ID)).toBe(true);
      const keys = Object.keys(STARTER_ARMIES);
      expect(keys.some((k) => k.startsWith('test-'))).toBe(true);
      for (const id of keys) {
        expect(isKnownArmyId(id)).toBe(true);
      }

      for (const bad of ['unknown-army', '__proto__', 'constructor', 'toString', '', null, undefined, 123, {}]) {
        expect(isKnownArmyId(bad)).toBe(false);
      }
    });

    it('records resolved fallback army IDs in GameState.setup when invalid IDs are supplied', () => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state, {
        hostArmyId: 'constructor',
        guestArmyId: 'not-a-real-army',
        useDeploymentPhase: false,
      });

      expect(state.setup?.hostArmyId).toBe(DEFAULT_HOST_ARMY_ID);
      expect(state.setup?.guestArmyId).toBe(DEFAULT_GUEST_ARMY_ID);
      expect(state.units.filter((u) => u.ownerId === HOST).length).toBeGreaterThan(0);
      expect(state.units.filter((u) => u.ownerId === GUEST).length).toBeGreaterThan(0);
    });

    it('accepts known TEST army IDs unconditionally and preserves both players picks across rematch', () => {
      const state = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(state, {
        hostArmyId: 'hdf',
        guestArmyId: 'test-squad-army',
        useDeploymentPhase: false,
      });

      expect(state.setup?.hostArmyId).toBe('hdf');
      expect(state.setup?.guestArmyId).toBe('test-squad-army');

      const guestUnits = state.units.filter((u) => u.ownerId === GUEST);
      expect(guestUnits.map((u) => u.name)).toEqual(['Test Squad 1']);

      const rematch = createRematchState(state);
      expect(rematch.setup?.hostArmyId).toBe('hdf');
      expect(rematch.setup?.guestArmyId).toBe('test-squad-army');
      expect(rematch.units.filter((u) => u.ownerId === GUEST).map((u) => u.name)).toEqual(['Test Squad 1']);

      const mirror = createInitialGameState(HOST, GUEST);
      applyDefaultScenario(mirror, {
        hostArmyId: 'hdf',
        guestArmyId: 'hdf',
        useDeploymentPhase: false,
      });
      expect(mirror.setup?.hostArmyId).toBe('hdf');
      expect(mirror.setup?.guestArmyId).toBe('hdf');
      expect(createRematchState(mirror).setup).toEqual(mirror.setup);
    });
  });
});
