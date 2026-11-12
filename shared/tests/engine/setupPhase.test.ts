import { describe, it, expect } from 'vitest';
import { createAction, createInitialGameState } from '../../src/gameState';
import { GameAction, GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { applyAction, getDiceSpecs, validateAction } from '../../src/engine/actions';
import { evaluateObjectives, getActivatableUnits, getDeployableUnits } from '../../src/engine/activation';
import {
  objectiveCountFromRoll,
  objectivePlacementProblem,
  resolveRollOff,
} from '../../src/engine/setup';
import { applyDefaultScenario } from '../../src/data/scenario';
import { summarizeMatch } from '../../src/engine/matchSummary';
import { createStandardBattlefieldMap } from '../../src/data/builtinMaps';
import { getWalkableSurfaces } from '../../src/engine/spatial';
import { d6, playObjectivesPhase, rollOffDice } from '../fixtures/setupFlow';

const HOST = 'host1';
const GUEST = 'guest1';

function unit(id: string, ownerId: string, overrides: Partial<Unit> = {}): Unit {
  return {
    id,
    ownerId,
    armyId: 'army-a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 6,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
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

/** A 48x48 game in the given phase with the given units (and terrain), host to act. */
function gameWith(phase: GameState['turnState']['phase'], units: Unit[], terrain: TerrainPiece[] = []): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.status = 'in-progress';
  state.turnState.phase = phase;
  state.turnState.currentPlayerId = HOST;
  state.turnState.startingPlayerId = HOST;
  // A side with no units at all would lose on the spot, so give each side a far-away placeholder
  state.units =
    units.length > 0
      ? units
      : [unit('h-default', HOST, { isDeployed: false }), unit('g-default', GUEST, { isDeployed: false })];
  state.terrain = terrain;
  return state;
}

function act(state: GameState, actorId: string, type: GameAction['type'], payload: GameAction['payload'], dice?: any[]): GameState {
  const out = applyAction(state, createAction(actorId, type, payload), dice);
  if (!out.ok) throw new Error(`${type} rejected: ${out.reason}`);
  return out.state;
}

const check = (state: GameState, actorId: string, type: GameAction['type'], payload: GameAction['payload']) =>
  validateAction(state, createAction(actorId, type, payload));

const place = (position: Vector3): GameAction['payload'] => ({ type: 'place-objective', position });
const deploy = (unitId: string, position: Vector3): GameAction['payload'] => ({ type: 'deploy-unit', unitId, position });

describe('objective count and roll-offs', () => {
  it('maps one d6 to 3, 4 or 5 objectives (1-2, 3-4, 5-6)', () => {
    expect([1, 2, 3, 4, 5, 6].map(objectiveCountFromRoll)).toEqual([3, 3, 4, 4, 5, 5]);
  });

  it('decides a roll-off by the first unequal pair, higher die winning', () => {
    // pairs (host, guest): (3,3) (2,5) (6,1) -> the second pair decides, for the guest
    const rolls = [3, 3, 2, 5, 6, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const result = resolveRollOff('mission', rolls, HOST, GUEST);
    expect(result.winnerId).toBe(GUEST);
    expect(result.decidingPair).toBe(1);
    expect(result.hostRolls.slice(0, 3)).toEqual([3, 2, 6]);
    expect(result.guestRolls.slice(0, 3)).toEqual([3, 5, 1]);
    expect(resolveRollOff('mission', [4, 2, ...rolls.slice(2)], HOST, GUEST).winnerId).toBe(HOST);
  });

  it('gives the host the win when all ten pairs tie', () => {
    const result = resolveRollOff('deployment', new Array(20).fill(4), HOST, GUEST);
    expect(result.winnerId).toBe(HOST);
    expect(result.decidingPair).toBeNull();
    expect(result.hostRolls).toHaveLength(10);
  });

  it('asks the server for the count die and the mission roll-off (10 pairs) in one roll', () => {
    const state = gameWith('objectives', []);
    const specs = getDiceSpecs(state, createAction(HOST, 'roll-objectives', { type: 'roll-objectives' }))!;
    expect(specs).toEqual([
      { count: 1, sides: 6, purpose: 'objective-count' },
      { count: 20, sides: 6, purpose: 'mission-roll-off' },
    ]);
  });

  it('records the count and the roll-off, and hands the first placement to the mission winner', () => {
    for (const winner of ['host', 'guest'] as const) {
      const state = gameWith('objectives', []);
      const next = act(state, HOST, 'roll-objectives', { type: 'roll-objectives' }, [
        d6(6, 'objective-count'),
        rollOffDice(winner, 'mission-roll-off'),
      ]);
      expect(next.setupRolls!.objectiveCount).toBe(5);
      expect(next.setupRolls!.objectiveRoll).toBe(6);
      expect(next.setupRolls!.missionRollOff!.winnerId).toBe(winner === 'host' ? HOST : GUEST);
      expect(next.turnState.currentPlayerId).toBe(winner === 'host' ? HOST : GUEST);
      // Both peers render the rolls from the log entry
      const logged = next.actionLog[next.actionLog.length - 1].dice!;
      expect(logged.outcome.objectiveCount).toEqual({ roll: 6, count: 5 });
      expect(logged.outcome.rollOff!.kind).toBe('mission');
      expect(logged.results).toHaveLength(2);
    }
  });

  it('rolls only once, and not without dice', () => {
    const state = gameWith('objectives', []);
    expect(applyAction(state, createAction(HOST, 'roll-objectives', { type: 'roll-objectives' })).ok).toBe(false);
    const rolled = act(state, HOST, 'roll-objectives', { type: 'roll-objectives' }, [d6(1, 'objective-count'), rollOffDice('host', 'mission-roll-off')]);
    expect(check(rolled, HOST, 'roll-objectives', { type: 'roll-objectives' }).valid).toBe(false);
  });

  it('applyDefaultScenario starts a deployment game in the objectives phase with nothing placed', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { useDeploymentPhase: true });
    expect(state.turnState.phase).toBe('objectives');
    expect(state.objectives).toEqual([]);
    expect(state.setupRolls).toBeUndefined();
    // Nothing but the roll is valid yet
    expect(check(state, HOST, 'place-objective', place({ x: 0, y: 0, z: 0 })).valid).toBe(false);
    const unitId = state.units[0].id;
    expect(check(state, HOST, 'deploy-unit', deploy(unitId, { x: 0, y: 0, z: -20 })).valid).toBe(false);
    expect(check(state, HOST, 'roll-objectives', { type: 'roll-objectives' }).valid).toBe(true);
  });

  it('ignores the objectives an old map carries', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, {
      useDeploymentPhase: true,
      customMap: {
        id: 'old',
        name: 'Old',
        version: 1,
        terrain: [],
        objectives: [{ id: 'o', name: 'Old marker', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: null, isContested: false }],
      },
    });
    expect(state.objectives).toEqual([]);
  });
});

describe('objective placement', () => {
  const rolled = (count = 5, mission: 'host' | 'guest' = 'host', terrain: TerrainPiece[] = []) => {
    const state = gameWith('objectives', [], terrain);
    return act(state, HOST, 'roll-objectives', { type: 'roll-objectives' }, [
      d6(count * 2 - 5, 'objective-count'),
      rollOffDice(mission, 'mission-roll-off'),
    ]);
  };

  it('alternates from the mission roll-off winner until the rolled count is placed', () => {
    let s = rolled(4, 'guest');
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    expect(check(s, HOST, 'place-objective', place({ x: 0, y: 0, z: 0 })).valid).toBe(false); // not host's turn
    const spots = [{ x: -15, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 15, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }];
    const order: string[] = [];
    for (const [i, p] of spots.entries()) {
      order.push(s.turnState.currentPlayerId);
      const action = createAction(s.turnState.currentPlayerId, 'place-objective', place(p));
      const specs = getDiceSpecs(s, action);
      // Only the last marker brings the deployment roll-off
      expect(specs === null).toBe(i < spots.length - 1);
      s = act(s, s.turnState.currentPlayerId, 'place-objective', place(p), specs ? [rollOffDice('guest', 'deployment-roll-off')] : undefined);
    }
    expect(order).toEqual([GUEST, HOST, GUEST, HOST]);
    expect(s.objectives).toHaveLength(4);
    expect(s.objectives!.every((o) => o.controllingPlayerId === null && o.isContested === false)).toBe(true);
    expect(new Set(s.objectives!.map((o) => o.id)).size).toBe(4);
  });

  it('moves to deployment after the last marker, with the deployment roll-off winner first', () => {
    const s = playObjectivesPhase(gameWith('objectives', [unit('h', HOST, { isDeployed: false }), unit('g', GUEST, { isDeployed: false })]), {
      countRoll: 1,
      deploymentWinner: 'guest',
    });
    expect(s.objectives).toHaveLength(3);
    expect(s.turnState.phase).toBe('deployment');
    expect(s.setupRolls!.deploymentRollOff!.winnerId).toBe(GUEST);
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    expect(s.turnState.startingPlayerId).toBe(GUEST);
    const last = s.actionLog[s.actionLog.length - 1].dice!;
    expect(last.outcome.rollOff!.kind).toBe('deployment');
  });

  it('rejects a marker once the count is placed', () => {
    const s = playObjectivesPhase(gameWith('objectives', []), { countRoll: 1 });
    expect(check(s, s.turnState.currentPlayerId, 'place-objective', place({ x: 0, y: 0, z: 0 })).valid).toBe(false);
  });

  it('keeps markers out of both deployment zones (the zone edge counts as inside)', () => {
    const s = rolled();
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: -11.99 })).toBeNull();
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: -12 })).toMatch(/deployment zone/);
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: -20 })).toMatch(/deployment zone/);
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: 12 })).toMatch(/deployment zone/);
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: 11.99 })).toBeNull();
  });

  it('uses the real zone depth of a shallower board', () => {
    const s = rolled();
    s.board.width = 44;
    s.board.height = 30; // 3" zones: -15..-12
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: -12.5 })).toMatch(/deployment zone/);
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: -11.9 })).toBeNull();
  });

  it('must be on the board', () => {
    const s = rolled();
    expect(objectivePlacementProblem(s, { x: 24.5, y: 0, z: 0 })).toMatch(/on the board/);
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: 30 })).toMatch(/on the board/);
    expect(objectivePlacementProblem(s, { x: 24, y: 0, z: 0 })).toBeNull();
  });

  it('must be more than 9" (horizontally) from every placed marker', () => {
    let s = rolled();
    s = act(s, HOST, 'place-objective', place({ x: 0, y: 0, z: 0 }));
    expect(objectivePlacementProblem(s, { x: 9, y: 0, z: 0 })).toMatch(/9"/); // exactly 9" is not enough
    expect(objectivePlacementProblem(s, { x: 9.01, y: 0, z: 0 })).toBeNull();
    expect(objectivePlacementProblem(s, { x: 6, y: 0, z: 6.5 })).toMatch(/9"/); // 8.85" diagonal
    expect(objectivePlacementProblem(s, { x: 6.5, y: 0, z: 6.5 })).toBeNull(); // 9.19"
    // Height doesn't count: the rule is horizontal
    expect(objectivePlacementProblem(s, { x: 0, y: 3, z: 2 })).not.toBeNull();
  });

  it('rejects a marker inside a terrain obstacle but allows open ground beside it', () => {
    const wall: TerrainPiece = {
      id: 'wall', terrainType: 'wall', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 2, z: 1 }, blocksLineOfSight: true, providesCover: true, isObstacle: true,
    };
    const s = rolled(5, 'host', [wall]);
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: 0 })).toMatch(/inside terrain/);
    expect(objectivePlacementProblem(s, { x: 0, y: 0, z: 3 })).toBeNull();
  });

  describe('on terrain with a walkable surface', () => {
    const terrain = createStandardBattlefieldMap().terrain;
    const deckPiece = terrain.find((p) => p.terrainType === 'platform-small')!;
    const surface = getWalkableSurfaces(deckPiece).find((sf) => sf.topY > 0)!;
    // Pick the middle of the deck in world space (the piece is axis aligned or a quarter turn)
    const centre = { x: deckPiece.position.x, z: deckPiece.position.z };

    it('accepts the deck top at the deck height', () => {
      const s = rolled(5, 'host', terrain);
      expect(objectivePlacementProblem(s, { x: centre.x, y: surface.topY, z: centre.z })).toBeNull();
    });

    it('rejects a marker hanging in the air above the deck', () => {
      const s = rolled(5, 'host', terrain);
      expect(objectivePlacementProblem(s, { x: centre.x, y: surface.topY + 1.5, z: centre.z })).toMatch(/ground or on a walkable/);
    });

    it('rejects a raised height where there is no surface', () => {
      const s = rolled(5, 'host', terrain);
      expect(objectivePlacementProblem(s, { x: 0, y: 3, z: 8 })).toMatch(/ground or on a walkable/);
    });
  });
});

describe('deployment order and Scouts', () => {
  const squad = (id: string, ownerId: string, rules: string[] = []) =>
    unit(id, ownerId, { isDeployed: false, specialRules: rules });

  /** A deployment-phase game (objectives already done) in which `first` deploys first. */
  const deployment = (units: Unit[], first: string = HOST) => {
    const s = gameWith('deployment', units);
    s.turnState.currentPlayerId = first;
    s.turnState.startingPlayerId = first;
    s.turnState.roundNumber = 0;
    return s;
  };
  const hostZone = (i: number): Vector3 => ({ x: -10 + i * 4, y: 0, z: -20 });
  const guestZone = (i: number): Vector3 => ({ x: -10 + i * 4, y: 0, z: 20 });

  it('alternates one unit at a time starting with the deployment roll-off winner, who also opens round 1', () => {
    let s = deployment([squad('h1', HOST), squad('h2', HOST), squad('g1', GUEST), squad('g2', GUEST)], GUEST);
    const order: string[] = [];
    const next = ['g1', 'h1', 'g2', 'h2'];
    for (const [i, id] of next.entries()) {
      order.push(s.turnState.currentPlayerId);
      const p = id.startsWith('h') ? hostZone(i) : guestZone(i);
      s = act(s, s.turnState.currentPlayerId, 'deploy-unit', deploy(id, p));
    }
    expect(order).toEqual([GUEST, HOST, GUEST, HOST]);
    expect(s.turnState.phase).toBe('activation');
    expect(s.turnState.roundNumber).toBe(1);
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    expect(s.turnState.startingPlayerId).toBe(GUEST);
  });

  it('lets the other player keep deploying once one side has nothing left', () => {
    let s = deployment([squad('h1', HOST), squad('g1', GUEST), squad('g2', GUEST)], HOST);
    s = act(s, HOST, 'deploy-unit', deploy('h1', hostZone(0)));
    s = act(s, GUEST, 'deploy-unit', deploy('g1', guestZone(0)));
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    s = act(s, GUEST, 'deploy-unit', deploy('g2', guestZone(1)));
    expect(s.turnState.phase).toBe('activation');
  });

  it('after the last activation of round 1 the later rounds keep the old rule (the player who ended it hands first move over)', () => {
    let s = deployment([squad('h1', HOST), squad('g1', GUEST)], GUEST);
    s = act(s, GUEST, 'deploy-unit', deploy('g1', guestZone(0)));
    s = act(s, HOST, 'deploy-unit', deploy('h1', hostZone(0)));
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    s = act(s, GUEST, 'hold', { type: 'hold', unitId: 'g1' });
    s = act(s, HOST, 'hold', { type: 'hold', unitId: 'h1' });
    expect(s.turnState.roundNumber).toBe(2);
    // The host made the last activation, so the guest starts round 2
    expect(s.turnState.startingPlayerId).toBe(GUEST);
    expect(s.turnState.currentPlayerId).toBe(GUEST);
  });

  it('refuses any other action while units are being deployed', () => {
    const s = deployment([squad('h1', HOST), squad('g1', GUEST)]);
    expect(check(s, HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' }).valid).toBe(false);
    expect(check(s, HOST, 'hold', { type: 'hold', unitId: 'h1' }).valid).toBe(false);
  });

  describe('Scout', () => {
    it('may be deployed like any other unit', () => {
      let s = deployment([squad('h1', HOST, ['scout']), squad('g1', GUEST)]);
      expect(getDeployableUnits(s, HOST).map((u) => u.id)).toEqual(['h1']);
      // Inside the normal zone: fine. 9" past it: not as a normal deployment.
      expect(check(s, HOST, 'deploy-unit', deploy('h1', { x: 0, y: 0, z: -13 })).valid).toBe(true);
      expect(check(s, HOST, 'deploy-unit', deploy('h1', { x: 0, y: 0, z: -5 })).valid).toBe(false);
      s = act(s, HOST, 'deploy-unit', deploy('h1', { x: 0, y: 0, z: -13 }));
      expect(s.units.find((u) => u.id === 'h1')!.isDeployed).toBe(true);
    });

    it('can be held back, and is then placed after every other unit, starting with the round-1 first player', () => {
      let s = deployment([squad('h-scout', HOST, ['scout']), squad('h1', HOST), squad('g-scout', GUEST, ['scout']), squad('g1', GUEST)], GUEST);
      expect(check(s, HOST, 'hold-scout', { type: 'hold-scout', unitId: 'h-scout' }).valid).toBe(false); // guest's turn
      s = act(s, GUEST, 'hold-scout', { type: 'hold-scout', unitId: 'g-scout' });
      expect(s.turnState.currentPlayerId).toBe(GUEST); // holding doesn't use the turn
      // A held Scout cannot be deployed yet
      expect(check(s, GUEST, 'deploy-unit', deploy('g-scout', { x: 0, y: 0, z: 15 })).valid).toBe(false);
      s = act(s, GUEST, 'deploy-unit', deploy('g1', guestZone(0)));
      s = act(s, HOST, 'hold-scout', { type: 'hold-scout', unitId: 'h-scout' });
      s = act(s, HOST, 'deploy-unit', deploy('h1', hostZone(0)));
      // Everything normal is down: Scouts next, the roll-off winner (guest) first
      expect(s.turnState.phase).toBe('deployment');
      expect(s.turnState.scoutStage).toBe(true);
      expect(s.turnState.currentPlayerId).toBe(GUEST);
      expect(getDeployableUnits(s, HOST).map((u) => u.id)).toEqual(['h-scout']);
      // Guest scouts up to 9" past their zone (z from 12 down to 3)
      expect(check(s, GUEST, 'deploy-unit', deploy('g-scout', { x: 12, y: 0, z: 2.5 })).valid).toBe(false);
      s = act(s, GUEST, 'deploy-unit', deploy('g-scout', { x: 12, y: 0, z: 3 }));
      expect(s.turnState.currentPlayerId).toBe(HOST);
      s = act(s, HOST, 'deploy-unit', deploy('h-scout', { x: -12, y: 0, z: -3 }));
      expect(s.turnState.phase).toBe('activation');
      expect(s.turnState.roundNumber).toBe(1);
      expect(s.turnState.currentPlayerId).toBe(GUEST);
    });

    it('must keep more than 9" from enemy units that are not Scouts (Scouts do not count)', () => {
      const base = () => deployment([squad('h-scout', HOST, ['scout']), squad('g1', GUEST), squad('g-scout', GUEST, ['scout'])]);
      let s = base();
      s.units[0].heldAsScout = true;
      s.turnState.scoutStage = true;
      s.units[1].isDeployed = true;
      s.units[1].position = { x: 0, y: 0, z: 5 };
      s.units[2].isDeployed = true;
      s.units[2].position = { x: 14, y: 0, z: -4 };
      // Host zone reaches z = -3. Bases are 1" wide, so the base-edge gap is the centre distance minus 1
      expect(check(s, HOST, 'deploy-unit', deploy('h-scout', { x: 0, y: 0, z: -3 })).valid).toBe(false); // enemy at z = 5
      // Exactly 9" of base-edge gap is still too close, anything more is fine
      s.units[1].position = { x: 0, y: 0, z: 7 }; // centre distance 10 -> gap 9
      expect(check(s, HOST, 'deploy-unit', deploy('h-scout', { x: 0, y: 0, z: -3 })).valid).toBe(false);
      s.units[1].position = { x: 0, y: 0, z: 7.01 };
      expect(check(s, HOST, 'deploy-unit', deploy('h-scout', { x: 0, y: 0, z: -3 })).valid).toBe(true);
      // An enemy Scout right next to the spot doesn't matter
      s = base();
      s.units[0].heldAsScout = true;
      s.turnState.scoutStage = true;
      s.units[1].isDeployed = true;
      s.units[1].position = { x: 0, y: 0, z: 20 };
      s.units[2].isDeployed = true;
      s.units[2].position = { x: 0, y: 0, z: -6 };
      expect(check(s, HOST, 'deploy-unit', deploy('h-scout', { x: 6, y: 0, z: -6 })).valid).toBe(true);
    });

    it('only Scout units can be held back, once', () => {
      let s = deployment([squad('h-plain', HOST), squad('h-scout', HOST, ['scout']), squad('g1', GUEST)]);
      expect(check(s, HOST, 'hold-scout', { type: 'hold-scout', unitId: 'h-plain' }).valid).toBe(false);
      s = act(s, HOST, 'hold-scout', { type: 'hold-scout', unitId: 'h-scout' });
      expect(check(s, HOST, 'hold-scout', { type: 'hold-scout', unitId: 'h-scout' }).valid).toBe(false);
    });

    it('passes the turn when holding leaves the player with nothing else to deploy', () => {
      let s = deployment([squad('h-scout', HOST, ['scout']), squad('g1', GUEST)]);
      s = act(s, HOST, 'hold-scout', { type: 'hold-scout', unitId: 'h-scout' });
      expect(s.turnState.currentPlayerId).toBe(GUEST);
    });
  });

  it('sets Ambush units aside: they are never deployable before round 2', () => {
    const s = deployment([squad('h1', HOST), squad('h-amb', HOST, ['ambush']), squad('g1', GUEST)]);
    expect(getDeployableUnits(s, HOST).map((u) => u.id)).toEqual(['h1']);
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', hostZone(0))).valid).toBe(false);
    let t = act(s, HOST, 'deploy-unit', deploy('h1', hostZone(0)));
    t = act(t, GUEST, 'deploy-unit', deploy('g1', guestZone(0)));
    expect(t.turnState.phase).toBe('activation'); // the Ambush unit doesn't hold deployment up
    expect(t.turnState.ambushStep).toBeFalsy(); // and nothing arrives in round 1
  });
});

describe('Ambush', () => {
  /** Round 1 is over except for the last activation: guest holds its last unit, starting round 2 for the host. */
  function endOfRoundOne(extra: Unit[], tweak?: (s: GameState) => void): GameState {
    const host = unit('h1', HOST, { isDeployed: true, isActivated: true, position: { x: 0, y: 0, z: -20 } });
    const guest = unit('g1', GUEST, { isDeployed: true, position: { x: 0, y: 0, z: 20 } });
    const s = gameWith('activation', [host, guest, ...extra]);
    s.turnState.roundNumber = 1;
    s.turnState.currentPlayerId = GUEST;
    s.turnState.startingPlayerId = HOST;
    tweak?.(s);
    return act(s, GUEST, 'hold', { type: 'hold', unitId: 'g1' });
  }
  const reserve = (id: string, ownerId: string, rules: string[] = ['ambush']) =>
    unit(id, ownerId, { isDeployed: false, specialRules: rules, position: { x: 0, y: 0, z: ownerId === HOST ? -20 : 20 } });

  it('opens an Ambush step at the start of round 2, the first player to activate placing first', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST), reserve('g-amb', GUEST)]);
    expect(s.turnState.roundNumber).toBe(2);
    // The guest made the last activation, so the host starts the round
    expect(s.turnState.startingPlayerId).toBe(HOST);
    expect(s.turnState.ambushStep).toEqual({ skippedPlayerIds: [] });
    expect(s.turnState.currentPlayerId).toBe(HOST);
  });

  it('has no step when nobody has Ambush units waiting', () => {
    const s = endOfRoundOne([]);
    expect(s.turnState.roundNumber).toBe(2);
    expect(s.turnState.ambushStep).toBeFalsy();
    expect(s.turnState.currentPlayerId).toBe(HOST);
  });

  it('blocks every other action until the step is over', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST)]);
    expect(check(s, HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' }).valid).toBe(false);
    expect(check(s, HOST, 'hold', { type: 'hold', unitId: 'h1' }).valid).toBe(false);
  });

  it('alternates placements and then hands the round to the player who activates first', () => {
    let s = endOfRoundOne([reserve('h-amb', HOST), reserve('h-amb2', HOST), reserve('g-amb', GUEST)]);
    s = act(s, HOST, 'deploy-unit', deploy('h-amb', { x: -10, y: 0, z: 0 }));
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    expect(s.units.find((u) => u.id === 'h-amb')!.ambushArrivedRound).toBe(2);
    s = act(s, GUEST, 'deploy-unit', deploy('g-amb', { x: 10, y: 0, z: 0 }));
    expect(s.turnState.currentPlayerId).toBe(HOST); // guest has none left; the host places the second
    s = act(s, HOST, 'deploy-unit', deploy('h-amb2', { x: -10, y: 0, z: 8 }));
    expect(s.turnState.ambushStep).toBeNull();
    expect(s.turnState.currentPlayerId).toBe(HOST); // the first activator of round 2
    expect(s.units.filter((u) => u.id.endsWith('amb') || u.id === 'h-amb2').every((u) => u.isDeployed)).toBe(true);
  });

  it('lets a player decline; their units wait for a later round', () => {
    let s = endOfRoundOne([reserve('h-amb', HOST), reserve('g-amb', GUEST)]);
    s = act(s, HOST, 'skip-ambush', { type: 'skip-ambush' });
    expect(s.turnState.ambushStep!.skippedPlayerIds).toEqual([HOST]);
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    s = act(s, GUEST, 'deploy-unit', deploy('g-amb', { x: 10, y: 0, z: 0 }));
    // The host declined, so the step is over and the host activates first
    expect(s.turnState.ambushStep).toBeNull();
    expect(s.turnState.currentPlayerId).toBe(HOST);
    const waiting = s.units.find((u) => u.id === 'h-amb')!;
    expect(waiting.isDeployed).toBe(false);
    expect(waiting.isDestroyed).toBe(false);
    // The unit that never arrived can't be activated, targeted or counted as a round blocker
    expect(getActivatableUnits(s, HOST).map((u) => u.id)).toEqual(['h1']);
  });

  it('opens again the next round for units that kept waiting', () => {
    let s = endOfRoundOne([reserve('h-amb', HOST)]);
    s = act(s, HOST, 'skip-ambush', { type: 'skip-ambush' });
    expect(s.turnState.ambushStep).toBeNull();
    // Round 2: host holds h1, guest holds g1
    s = act(s, HOST, 'hold', { type: 'hold', unitId: 'h1' });
    s = act(s, GUEST, 'hold', { type: 'hold', unitId: 'g1' });
    expect(s.turnState.roundNumber).toBe(3);
    expect(s.turnState.ambushStep).toEqual({ skippedPlayerIds: [] });
    expect(s.turnState.currentPlayerId).toBe(s.turnState.startingPlayerId);
  });

  it('can not be skipped outside the step, and only by the player whose turn it is', () => {
    const plain = endOfRoundOne([]);
    expect(check(plain, HOST, 'skip-ambush', { type: 'skip-ambush' }).valid).toBe(false);
    const s = endOfRoundOne([reserve('h-amb', HOST), reserve('g-amb', GUEST)]);
    expect(check(s, GUEST, 'skip-ambush', { type: 'skip-ambush' }).valid).toBe(false);
  });

  it('measures the 9" from the enemy base edge: exactly 9" is too close, a hair more is fine', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST)]);
    const guestZ = s.units.find((u) => u.id === 'g1')!.position.z; // 20
    // 1" bases: edge gap = centre distance - 1
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: guestZ - 10 })).valid).toBe(false); // gap 9.0
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: guestZ - 10.01 })).valid).toBe(true);
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: guestZ - 10 })).reason).toMatch(/more than 9"/);
  });

  it('keeps 12" from enemy units with Repel Ambushers', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST)], (st) => {
      st.units.find((u) => u.id === 'g1')!.specialRules = ['repel-ambushers'];
    });
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: 20 - 11 })).valid).toBe(false); // gap 10
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: 20 - 13 })).valid).toBe(false); // gap 12.0
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: 20 - 13.01 })).valid).toBe(true);
  });

  it('may land anywhere on the table, including the enemy half and outside the zones, but not off the board or in terrain', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST)], (st) => {
      st.units.find((u) => u.id === 'g1')!.position = { x: 20, y: 0, z: 20 };
      st.terrain = [
        {
          id: 'wall', terrainType: 'wall', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 2, z: 1 }, blocksLineOfSight: true, providesCover: true, isObstacle: true,
        },
      ];
    });
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: -10, y: 0, z: 14 })).valid).toBe(true);
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: -30, y: 0, z: 0 })).valid).toBe(false);
    expect(check(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: 0 })).valid).toBe(false);
  });

  it('does not let normal units, or enemy units, use the step', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST), reserve('g-amb', GUEST), unit('h-plain', HOST, { isDeployed: false })]);
    expect(check(s, HOST, 'deploy-unit', deploy('h-plain', { x: 0, y: 0, z: 0 })).valid).toBe(false);
    expect(check(s, HOST, 'deploy-unit', deploy('g-amb', { x: 0, y: 0, z: 0 })).valid).toBe(false);
  });

  it('keeps a waiting Ambush unit off the table: it cannot be targeted', () => {
    let s = endOfRoundOne([reserve('g-amb', GUEST)]);
    expect(s.turnState.currentPlayerId).toBe(GUEST); // only the guest has a unit to place
    s = act(s, GUEST, 'skip-ambush', { type: 'skip-ambush' });
    s = act(s, HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' });
    const charge = createAction(HOST, 'begin-charge', { type: 'begin-charge', attackerId: 'h1', targetId: 'g-amb' });
    const result = validateAction(s, charge);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not on the table/);
  });

  it('a waiting Ambush unit does not block a move through where it was set down', () => {
    let s = endOfRoundOne([reserve('g-amb', GUEST)], (st) => {
      st.units.find((u) => u.id === 'g-amb')!.position = { x: 0, y: 0, z: -14 };
    });
    s = act(s, GUEST, 'skip-ambush', { type: 'skip-ambush' });
    s = act(s, HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' });
    const h1 = s.units.find((u) => u.id === 'h1')!;
    h1.position = { x: 0, y: 0, z: -20 };
    const move = createAction(HOST, 'advance', {
      type: 'advance', unitId: 'h1', path: [{ x: 0, y: 0, z: -20 }, { x: 0, y: 0, z: -14.5 }], finalPosition: { x: 0, y: 0, z: -14.5 },
    });
    expect(validateAction(s, move)).toEqual({ valid: true });
  });

  it('cannot seize or contest an objective in the round it arrives', () => {
    let s = endOfRoundOne([reserve('h-amb', HOST)], (st) => {
      st.objectives = [
        { id: 'o1', name: 'O1', position: { x: 0, y: 0, z: 0 }, controllingPlayerId: null, isContested: false },
      ];
      st.units.find((u) => u.id === 'h1')!.position = { x: 0, y: 0, z: -30 };
    });
    s = act(s, HOST, 'deploy-unit', deploy('h-amb', { x: 0, y: 0, z: 0.5 }));
    s.units.find((u) => u.id === 'g1')!.position = { x: 0, y: 0, z: 30 };
    evaluateObjectives(s);
    expect(s.objectives![0].controllingPlayerId).toBeNull(); // arrived this round: no control
    // The next round it counts
    s.turnState.roundNumber = 3;
    evaluateObjectives(s);
    expect(s.objectives![0].controllingPlayerId).toBe(HOST);
  });

  it('a unit that never arrived does not seize anything from its reserve position', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST)], (st) => {
      st.objectives = [
        { id: 'o1', name: 'O1', position: { x: 0, y: 0, z: -20 }, controllingPlayerId: null, isContested: false },
      ];
      st.units.find((u) => u.id === 'h1')!.position = { x: 0, y: 0, z: 30 };
    });
    evaluateObjectives(s);
    expect(s.objectives![0].controllingPlayerId).toBeNull();
  });

  it('keeps the match going while a side has only reserves left (waiting units are alive)', () => {
    const s = endOfRoundOne([reserve('h-amb', HOST)]);
    expect(s.status).toBe('in-progress');
  });
});

describe('match summary with waiting units', () => {
  it('counts the rounds played even when an Ambush unit never arrived', () => {
    const s = gameWith('game-over', [
      unit('h1', HOST, { isDeployed: true }),
      unit('g1', GUEST, { isDeployed: true }),
      unit('h-amb', HOST, { isDeployed: false, specialRules: ['ambush'] }),
    ]);
    s.status = 'game-over';
    s.turnState.roundNumber = 4;
    expect(summarizeMatch(s).roundsPlayed).toBe(4);
  });

  it('counts no rounds when the match ended during the objectives phase', () => {
    const s = gameWith('objectives', []);
    expect(summarizeMatch(s).roundsPlayed).toBe(0);
  });
});

describe('units that are not on the table cannot activate', () => {
  const inReserve = unit('h-amb', HOST, { isDeployed: false, specialRules: ['ambush'], position: { x: 0, y: 0, z: -20 } });
  const onTable = unit('h1', HOST, { isDeployed: true, position: { x: 0, y: 0, z: -20 } });
  const enemy = unit('g1', GUEST, { isDeployed: true, position: { x: 0, y: 0, z: 20 } });

  function round2(): GameState {
    const s = gameWith('activation', [onTable, inReserve, enemy].map((u) => ({ ...u })));
    s.turnState.roundNumber = 2;
    s.turnState.ambushStep = null; // both players skipped the Ambush step
    return s;
  }

  it('rejects activate-unit and hold for an Ambush unit still in reserve', () => {
    const s = round2();
    expect(check(s, HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h-amb' })).toEqual({
      valid: false,
      reason: 'Unit is not on the table yet',
    });
    expect(check(s, HOST, 'hold', { type: 'hold', unitId: 'h-amb' }).valid).toBe(false);
  });

  it('rejects activating a held-back Scout that has not been placed yet', () => {
    const s = round2();
    s.units[1] = { ...s.units[1], specialRules: ['scout'], heldAsScout: true };
    expect(check(s, HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h-amb' }).valid).toBe(false);
    expect(check(s, HOST, 'hold', { type: 'hold', unitId: 'h-amb' }).valid).toBe(false);
  });

  it('still lets a unit that is on the table activate and hold', () => {
    const s = round2();
    expect(check(s, HOST, 'activate-unit', { type: 'activate-unit', unitId: 'h1' }).valid).toBe(true);
    expect(check(s, HOST, 'hold', { type: 'hold', unitId: 'h1' }).valid).toBe(true);
  });
});

describe('objectives in a game without the deployment phase', () => {
  const STARTERS = { hostArmyId: 'hdf', guestArmyId: 'orc-marauders' };
  const fresh = () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { ...STARTERS, useDeploymentPhase: false });
    return state;
  };

  it('starts in the objectives phase with every unit already on the table', () => {
    const s = fresh();
    expect(s.turnState.phase).toBe('objectives');
    expect(s.turnState.roundNumber).toBe(0);
    expect(s.objectives).toEqual([]);
    expect(s.units.every((u) => u.isDeployed !== false)).toBe(true);
    expect(check(s, HOST, 'hold', { type: 'hold', unitId: s.units[0].id }).valid).toBe(false);
  });

  it('runs the roll, alternating placement and the deployment roll-off, then starts round 1 with the winner first', () => {
    const start = fresh();
    const positions = start.units.map((u) => ({ id: u.id, p: JSON.stringify(u.position) }));
    let s = act(start, HOST, 'roll-objectives', { type: 'roll-objectives' }, [
      d6(3, 'objective-count'),
      rollOffDice('guest', 'mission-roll-off'),
    ]);
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    const spots: Vector3[] = [
      { x: -16, y: 0, z: 0 },
      { x: 16, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
    ];
    const expectedPlacers = [GUEST, HOST, GUEST, HOST];
    spots.forEach((p, i) => {
      expect(s.turnState.currentPlayerId).toBe(expectedPlacers[i]);
      const last = i === spots.length - 1;
      s = act(s, expectedPlacers[i], 'place-objective', place(p), last ? [rollOffDice('guest', 'deployment-roll-off')] : undefined);
    });
    expect(s.objectives).toHaveLength(4);
    expect(s.setupRolls!.deploymentRollOff!.winnerId).toBe(GUEST);
    expect(s.turnState.phase).toBe('activation');
    expect(s.turnState.roundNumber).toBe(1);
    expect(s.turnState.startingPlayerId).toBe(GUEST);
    expect(s.turnState.currentPlayerId).toBe(GUEST);
    // Units keep their automatic positions
    expect(s.units.map((u) => ({ id: u.id, p: JSON.stringify(u.position) }))).toEqual(positions);
    // and play can begin
    expect(check(s, GUEST, 'hold', { type: 'hold', unitId: s.units.find((u) => u.ownerId === GUEST)!.id }).valid).toBe(true);
  });

  it('does the same for the default armies (no army ids)', () => {
    const state = createInitialGameState(HOST, GUEST);
    applyDefaultScenario(state, { useDeploymentPhase: false });
    expect(state.turnState.phase).toBe('objectives');
    const s = playObjectivesPhase(state, { deploymentWinner: 'host' });
    expect(s.turnState.phase).toBe('activation');
    expect(s.turnState.roundNumber).toBe(1);
  });
});
