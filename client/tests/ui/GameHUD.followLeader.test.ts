// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  STARTER_ARMIES,
  TERRAIN_PALETTE_CATALOG,
  TerrainPiece,
  Vector3,
  createInitialGameState,
  createUnitsFromStarterArmy,
  validateAction,
  createAction,
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function deck(id: string, x: number): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG['platform-small'];
  return {
    id,
    terrainType: 'platform-small',
    position: P(x, 0, 0),
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale, z: 8 },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

const STARTS = [P(-0.55, 3, 0), P(-1.55, 3, 0.9), P(-1.55, 3, -0.9), P(-2.55, 3, 0)];

function setup(rules: string[] = []) {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.status = 'in-progress';
  state.terrain = [deck('a', -2), deck('b', 3.5)];
  const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST);
  const squad = units[0];
  squad.specialRules = rules;
  squad.models.forEach((m, i) => (m.position = { ...STARTS[i] }));
  squad.position = { ...STARTS[0] };
  squad.isDeployed = true;
  const foe = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], GUEST)[0];
  foe.models.forEach((m, i) => (m.position = P(-20 + i * 2, 0, 20)));
  foe.position = P(-20, 0, 20);
  state.units = [squad, foe];
  squad.isActivated = true;
  state.turnState.activeUnitId = squad.id;
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';

  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  hud.show();
  hud.syncFromState(state);
  const internals = hud as any;
  internals.flow = { mode: 'targeting', action: 'move' };
  internals.selectedSquadModelId = squad.models[0].id;
  return { hud, internals, state, squad, container };
}

describe('GameHUD squad follow-the-leader jumps', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('declaring the leader\'s jump routes every other model to the crossing and stages one jump per model', () => {
    const { internals, squad } = setup();
    internals.handleSquadModelPick(P(2.05, 3, 0), 'move');
    const positions = internals.stagedSquadModelPositions as Map<string, Vector3>;
    const traversals = internals.stagedSquadModelTraversals as Map<string, { kind: string }>;
    expect(positions.size).toBe(4);
    expect(internals.jumpLeaderPayload(squad.models)).toEqual({ jumpLeader: 0 });
    for (const m of squad.models) {
      expect(positions.get(m.id)!.x).toBeGreaterThan(1.9);
      expect(traversals.get(m.id)!.kind).toBe('jump-gap');
    }
    // the staged move is the one the host accepts
    const alive = squad.models;
    const orderedPaths = alive.map((m) => internals.stagedSquadModelPaths.get(m.id));
    const action = createAction(HOST, 'advance', {
      type: 'advance',
      unitId: squad.id,
      path: [squad.position, positions.get(alive[0].id)],
      finalPosition: positions.get(alive[0].id),
      modelPositions: alive.map((m) => positions.get(m.id)),
      modelPaths: orderedPaths,
      modelTraversals: alive.map((m) => {
        const t = traversals.get(m.id) as any;
        return { kind: t.kind, takeoff: t.takeoff, landing: t.landing };
      }),
    });
    expect(validateAction(internals.state, action)).toEqual({ valid: true });
  });

  it('marks a model that cannot reach the take-off edge and leaves it unplaced', () => {
    const { internals, squad, container } = setup();
    // model 4 has only 0.5" of move left
    squad.modelMovementSpent = { [squad.models[0].id]: 0, [squad.models[1].id]: 0, [squad.models[2].id]: 0, [squad.models[3].id]: 5.5 };
    squad.speed = 6;
    internals.handleSquadModelPick(P(2.05, 3, 0), 'move');
    const blocked = internals.squadBlockedModels as Map<string, string>;
    expect(blocked.has(squad.models[3].id)).toBe(true);
    expect(blocked.get(squad.models[3].id)).toMatch(/move left/);
    expect(internals.stagedSquadModelPositions.has(squad.models[3].id)).toBe(false);
    expect(internals.stagedSquadModelPositions.size).toBe(3);
    const chip = container.querySelector(`[data-model-id="${squad.models[3].id}"]`) as HTMLElement;
    expect(chip.textContent).toContain('✗');
    expect(chip.getAttribute('title')).toMatch(/take-off edge/);
  });

  it('Flying models are not routed: only the leader\'s own placement is staged', () => {
    const { internals } = setup(['flying']);
    internals.handleSquadModelPick(P(2.05, 3, 0), 'move');
    // a Flying squad has no jump to declare, so the click is plain movement for one model
    expect(internals.stagedSquadModelTraversals.size).toBe(0);
    expect(internals.stagedSquadModelPositions.size).toBeLessThanOrEqual(1);
  });

  it('resetting the squad move clears the blocked marks', () => {
    const { internals, squad } = setup();
    squad.modelMovementSpent = { [squad.models[0].id]: 0, [squad.models[1].id]: 0, [squad.models[2].id]: 0, [squad.models[3].id]: 5.5 };
    internals.handleSquadModelPick(P(2.05, 3, 0), 'move');
    expect(internals.squadBlockedModels.size).toBe(1);
    (document.querySelector('[data-action="reset-squad-move"]') as HTMLElement).click();
    expect(internals.squadBlockedModels.size).toBe(0);
  });
});
