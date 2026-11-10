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
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

/** An 8"-deep 3.0" deck; "a" spans x -4..0 and "b" x 1.5..5.5 (a 1.5" gap), like the Jump Range decks. */
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

function setup() {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.status = 'in-progress';
  state.terrain = [deck('a', -2), deck('b', 3.5)];
  const army = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST);
  const flyers = army[2];
  const striders = army[1];
  flyers.models.forEach((m, i) => (m.position = { ...STARTS[i] }));
  flyers.position = { ...STARTS[0] };
  flyers.isDeployed = true;
  // a friendly squad close by on the same deck
  striders.models.forEach((m, i) => (m.position = P(-3 + (i % 2) * 1.2, 3, 2.6 + Math.floor(i / 2) * 1.2)));
  striders.position = { ...striders.models[0].position! };
  striders.isDeployed = true;
  const foe = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], GUEST)[0];
  foe.models.forEach((m, i) => (m.position = P(-20 + i * 2, 0, 20)));
  foe.position = P(-20, 0, 20);
  state.units = [flyers, striders, foe];
  flyers.isActivated = true;
  state.turnState.activeUnitId = flyers.id;
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';

  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller: { submitAction: vi.fn() } });
  hud.show();
  hud.syncFromState(state);
  const internals = hud as any;
  internals.flow = { mode: 'targeting', action: 'move' };
  internals.selectedSquadModelId = flyers.models[0].id;
  const toasts: string[] = [];
  internals.showToast = (msg: string) => toasts.push(msg);
  return { internals, flyers, toasts };
}

describe('GameHUD Flying squad models across a gap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('places each model on the far deck within its move, with no jump and no refusal', () => {
    const { internals, flyers, toasts } = setup();
    const spots = [P(2.5, 3, 0.9), P(3.5, 3, 0), P(3.4, 3, -0.9)];
    flyers.models.slice(0, 3).forEach((m, i) => {
      internals.selectedSquadModelId = m.id;
      internals.handleSquadModelPick(spots[i], 'move');
      expect(toasts).toEqual([]);
      expect(internals.stagedSquadModelPositions.get(m.id)).toMatchObject({ x: spots[i].x, z: spots[i].z });
    });
    expect(internals.stagedSquadModelTraversals.size).toBe(0);
  });

  it('a spot about 5" away over the gap is accepted for the third model after earlier legs', () => {
    const { internals, flyers, toasts } = setup();
    // earlier legs of this activation: models have moved different amounts, 1.2" is the least
    flyers.remainingMovement = 4.8;
    flyers.modelMovementSpent = Object.fromEntries(flyers.models.map((m, i) => [m.id, [1.2, 1.2, 1.5, 1.2][i]]));
    internals.selectedSquadModelId = flyers.models[2].id;
    internals.handleSquadModelPick(P(3.4, 3, -0.9), 'move');
    expect(toasts).toEqual([]);
    expect(internals.stagedSquadModelPositions.has(flyers.models[2].id)).toBe(true);
  });

  it('the hover preview and the click agree on a Flying path across the gap', () => {
    const { internals, flyers } = setup();
    internals.selectedSquadModelId = flyers.models[2].id;
    internals.handleBoardHover({ kind: 'position', position: P(3.4, 3, -0.9) });
    const preview = internals.movePathPreview as Vector3[];
    internals.handleSquadModelPick(P(3.4, 3, -0.9), 'move');
    const staged = internals.stagedSquadModelPaths.get(flyers.models[2].id) as Vector3[];
    expect(staged).toEqual(preview);
  });

  it('a refused spot names the real reason', () => {
    const { internals, flyers, toasts } = setup();
    // model 3 has used all of its move
    flyers.modelMovementSpent = Object.fromEntries(flyers.models.map((m, i) => [m.id, i === 2 ? 6 : 0]));
    internals.selectedSquadModelId = flyers.models[2].id;
    internals.handleSquadModelPick(P(3.4, 3, -0.9), 'move');
    expect(toasts[toasts.length - 1]).toMatch(/no move left/i);
    // a spot on top of the model itself
    internals.selectedSquadModelId = flyers.models[1].id;
    internals.handleSquadModelPick(P(-1.55, 3, 0.9), 'move');
    expect(toasts[toasts.length - 1]).toMatch(/away from the model/i);
  });
});
