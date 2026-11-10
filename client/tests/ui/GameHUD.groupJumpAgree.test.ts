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

const CLUSTER = [P(-0.55, 3, 0), P(-1.55, 3, 0.9), P(-1.55, 3, -0.9), P(-2.55, 3, 0)];

/** A 4-model squad (unit 0 jumpers, 1 striders) on a deck at x -4..0; a second deck starts 4.1" east of it. */
function setup(opts: { unit?: number; friendAt?: Vector3 | null; deckB?: number } = {}) {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.status = 'in-progress';
  state.terrain = [deck('a', -2), deck('b', opts.deckB ?? 6.1)];
  const army = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST);
  const squad = army[opts.unit ?? 0];
  squad.models.forEach((m, i) => (m.position = { ...CLUSTER[i] }));
  squad.position = { ...CLUSTER[0] };
  squad.isDeployed = true;
  const friend = army[opts.unit === 1 ? 0 : 1];
  friend.models = friend.models.slice(0, 1);
  friend.models[0].position = opts.friendAt ?? P(20, 0, 20);
  friend.position = { ...friend.models[0].position! };
  friend.isDeployed = true;
  const foe = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], GUEST)[0];
  foe.models.forEach((m, i) => (m.position = P(-20 + i * 2, 0, 20)));
  foe.position = P(-20, 0, 20);
  state.units = [squad, friend, foe];
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
  return { hud, internals, state, squad, friend, container };
}

/** The advance action the HUD would send for what is staged. */
function stagedAction(internals: any, squad: any) {
  const positions = internals.stagedSquadModelPositions as Map<string, Vector3>;
  const traversals = internals.stagedSquadModelTraversals as Map<string, any>;
  return createAction(HOST, 'advance', {
    type: 'advance',
    unitId: squad.id,
    path: [squad.position, positions.get(squad.models[0].id)],
    finalPosition: positions.get(squad.models[0].id),
    modelPositions: squad.models.map((m: any) => positions.get(m.id) ?? m.position),
    modelPaths: squad.models.map((m: any) => internals.stagedSquadModelPaths.get(m.id) ?? [m.position]),
    modelTraversals: squad.models.map((m: any) => {
      const t = traversals.get(m.id);
      return t ? { kind: t.kind, takeoff: t.takeoff, landing: t.landing } : null;
    }),
    ...internals.jumpLeaderPayload(squad.models),
  });
}

describe('squad leg with jumps: HUD and host agree', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('control: with nobody near the landing, a 4.1" group jump is staged and accepted', () => {
    const { internals, squad } = setup();
    internals.handleSquadModelPick(P(4.7, 3, 0), 'move');
    expect(internals.stagedSquadModelPositions.size).toBe(4);
    expect(validateAction(internals.state, stagedAction(internals, squad))).toEqual({ valid: true });
  });

  it('a leader landing within 1" of another unit is refused up front with the keep-away reason', () => {
    // the friend stands 1.5" from the landing spot: 0.5" between base edges
    const { internals } = setup({ friendAt: P(6.2, 3, 0) });
    const toast = vi.spyOn(internals, 'showToast');
    internals.handleSquadModelPick(P(4.7, 3, 0), 'move');
    expect(internals.stagedSquadModelPositions.size).toBe(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('within 1"'));
  });

  it('hovering a landing within 1" of another unit warns with the keep-away reason instead of offering the jump', () => {
    const { internals, container } = setup({ friendAt: P(6.2, 3, 0) });
    internals.render();
    internals.handleBoardHover({ kind: 'position', position: P(4.7, 3, 0) });
    expect(internals.moveJump).toBeNull();
    const warning = container.querySelector('.sl-hud-move-warning') as HTMLElement;
    expect(warning.style.display).toBe('block');
    expect(warning.textContent).toContain('Cannot jump there');
    expect(warning.textContent).toContain('within 1"');
  });

  it('followers pick landings that keep 1" from another unit, and what is staged is accepted by the host', () => {
    // far from the leader's landing, but close to where a follower shifted sideways would land
    const { internals, squad } = setup({ friendAt: P(5.4, 3, 2.6) });
    internals.handleSquadModelPick(P(4.7, 3, 0), 'move');
    const staged = internals.stagedSquadModelPositions as Map<string, Vector3>;
    expect(staged.size).toBeGreaterThan(0);
    for (const p of staged.values()) {
      expect(Math.hypot(p.x - 5.4, p.z - 2.6)).toBeGreaterThanOrEqual(2 - 0.02);
    }
    if (staged.size === 4) {
      expect(validateAction(internals.state, stagedAction(internals, squad))).toEqual({ valid: true });
    }
  });

  it('a follower marked unreachable and then placed by hand on a free step-down clears its mark and the leg is accepted', () => {
    const { internals, squad, container } = setup({ unit: 1 });
    // model 4 has only 1" of move left, so it cannot walk to the take-off edge for the leader's jump
    squad.modelMovementSpent = { [squad.models[3].id]: 5 };
    internals.handleSquadModelPick(P(4.7, 3, 0), 'move');
    const last = squad.models[3];
    expect(internals.squadBlockedModels.has(last.id)).toBe(true);
    expect(internals.stagedSquadModelPositions.has(last.id)).toBe(false);
    // the player picks it and steps it off the deck edge onto the ground below (gap 0.6", drop 3.0": both free)
    last.position = P(-0.55, 3, -2.2);
    squad.modelMovementSpent = {};
    internals.selectedSquadModelId = last.id;
    internals.handleSquadModelPick(P(3.4, 0, -2.2), 'move');
    expect(internals.stagedSquadModelPositions.has(last.id)).toBe(true);
    expect(internals.squadBlockedModels.has(last.id)).toBe(false);
    const chip = container.querySelector(`[data-model-id="${last.id}"]`) as HTMLElement | null;
    if (chip) expect(chip.textContent).not.toContain('✗');
    // every model is placed now, so the squad move is offered; the host accepts it (free drop: no dice)
    expect(validateAction(internals.state, stagedAction(internals, squad))).toEqual({ valid: true });
  });

  it('a step-down that breaks cross-level coherency is refused with that reason on the chip, and the hover warns first', () => {
    const { internals, squad, container } = setup({ unit: 1 });
    squad.modelMovementSpent = { [squad.models[3].id]: 5 };
    internals.handleSquadModelPick(P(4.7, 3, 0), 'move');
    const last = squad.models[3];
    last.position = P(-0.55, 3, -2.2);
    squad.modelMovementSpent = {};
    internals.selectedSquadModelId = last.id;
    // 0.6" out and 3.0" down is a free step, but the ground just off the deck is too far below the others
    internals.handleBoardHover({ kind: 'position', position: P(0.6, 0, -2.2) });
    const warning = container.querySelector('.sl-hud-move-warning') as HTMLElement;
    expect(warning.style.display).toBe('block');
    expect(warning.textContent).toMatch(/squad member|levels|coherency/);
    internals.handleSquadModelPick(P(0.6, 0, -2.2), 'move');
    expect(internals.stagedSquadModelPositions.has(last.id)).toBe(false);
    const chip = container.querySelector(`[data-model-id="${last.id}"]`) as HTMLElement;
    expect(chip.textContent).toContain('✗');
    expect(chip.getAttribute('title')).toMatch(/Not placed: .*(coherency|squad member|levels)/);
  });

  it('a refused hand placement of a marked follower shows the real reason on its chip', () => {
    const { internals, squad, container } = setup({ unit: 1 });
    squad.modelMovementSpent = { [squad.models[3].id]: 5 };
    internals.handleSquadModelPick(P(4.7, 3, 0), 'move');
    const last = squad.models[3];
    expect(internals.squadBlockedModels.get(last.id)).toMatch(/move left/);
    // the pick is refused (it would end on top of a placed model): the chip names that reason, not the stale one
    squad.modelMovementSpent = {};
    internals.selectedSquadModelId = last.id;
    const onTop = internals.stagedSquadModelPositions.get(squad.models[0].id) as Vector3;
    internals.handleSquadModelPick(P(onTop.x, onTop.y, onTop.z), 'move');
    expect(internals.stagedSquadModelPositions.has(last.id)).toBe(false);
    internals.render();
    const chip = container.querySelector(`[data-model-id="${last.id}"]`) as HTMLElement;
    expect(chip.getAttribute('title')).not.toMatch(/move left/);
    expect(chip.getAttribute('title')).toBeTruthy();
  });
});
