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

// Deck A x -4..0, deck B x 4.1..8.1 (a 4.1" gap). The leader stands on the edge, the others are further back.
const CLUSTER = [P(-0.55, 3, 0), P(-1.55, 3, 0.9), P(-1.55, 3, -0.9), P(-3.0, 3, 0)];
const LINE = [P(-0.55, 3, 0), P(-0.55, 3, 1.0), P(-0.55, 3, 2.0), P(-0.55, 3, -1.0)];
const LANDING = P(4.65, 3, 0);

function setup(opts: { starts?: Vector3[]; rules?: string[]; foeAt?: Vector3 } = {}) {
  const starts = opts.starts ?? CLUSTER;
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.status = 'in-progress';
  state.terrain = [deck('a', -2), deck('b', 6.1)];
  const squad = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST)[0];
  squad.specialRules = opts.rules ?? squad.specialRules;
  squad.models.forEach((m, i) => (m.position = { ...starts[i] }));
  squad.position = { ...starts[0] };
  squad.isDeployed = true;
  squad.isActivated = true;
  const foe = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], GUEST)[0];
  foe.models.forEach((m, i) => (m.position = i === 0 && opts.foeAt ? { ...opts.foeAt } : P(-20 + i * 2, 0, 20)));
  foe.position = { ...foe.models[0].position! };
  foe.isDeployed = true;
  state.units = [squad, foe];
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

/** The advance action the HUD would build from what is staged (the same fields `finishSquadMove` sends). */
function stagedAction(internals: any, squad: any) {
  const positions = internals.stagedSquadModelPositions as Map<string, Vector3>;
  const traversals = internals.stagedSquadModelTraversals as Map<string, any>;
  const crossers = squad.models.map((m: any, i: number) => (internals.squadCrossers.has(m.id) ? i : -1)).filter((i: number) => i >= 0);
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
    ...(crossers.length > 0 ? { crossers } : {}),
  });
}

describe('GameHUD group crossing (option C)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("the leader's jump carries every other model across at once: one jump staged, the rest placed within 1", () => {
    const { internals, squad } = setup();
    internals.handleSquadModelPick(LANDING, 'move');
    const positions = internals.stagedSquadModelPositions as Map<string, Vector3>;
    expect(positions.size).toBe(4);
    expect(internals.stagedSquadModelTraversals.size).toBe(1); // only the leader declares a jump
    expect([...internals.squadCrossers]).toEqual(squad.models.slice(1).map((m: any) => m.id));
    expect(internals.squadBlockedModels.size).toBe(0);
    for (const m of squad.models.slice(1)) expect(positions.get(m.id)!.x).toBeGreaterThan(4.1);
    expect(validateAction(internals.state, stagedAction(internals, squad))).toEqual({ valid: true });
  });

  it('works from far back with no move left: nothing is checked against the carried models\' budgets', () => {
    const { internals, squad } = setup();
    squad.modelMovementSpent = { [squad.models[0].id]: 0, [squad.models[1].id]: 6, [squad.models[2].id]: 6, [squad.models[3].id]: 6 };
    internals.handleSquadModelPick(LANDING, 'move');
    expect(internals.squadCrossers.size).toBe(3);
    expect(internals.squadBlockedModels.size).toBe(0);
    expect(validateAction(internals.state, stagedAction(internals, squad))).toEqual({ valid: true });
  });

  it('keeps the formation when the leader\'s displacement puts every model on the far deck', () => {
    const { internals, squad } = setup({ starts: LINE });
    internals.handleSquadModelPick(LANDING, 'move');
    const positions = internals.stagedSquadModelPositions as Map<string, Vector3>;
    LINE.slice(1).forEach((p, i) => {
      const got = positions.get(squad.models[i + 1].id)!;
      expect(got.x).toBeCloseTo(p.x + (LANDING.x - LINE[0].x), 2);
      expect(got.z).toBeCloseTo(p.z, 2);
    });
  });

  it('does not finish by itself: the player confirms, and the confirmation carries the crossers', () => {
    const { internals, squad, container } = setup();
    internals.handleSquadModelPick(LANDING, 'move');
    expect(internals.flow.mode).toBe('targeting');
    const confirm = container.querySelector('[data-action="confirm-squad-move"]') as HTMLElement;
    expect(confirm).toBeTruthy();
    confirm.click();
    expect(internals.flow.mode).toBe('confirming');
    const payload = internals.flow.action.payload;
    expect(payload.crossers).toEqual([1, 2, 3]);
    expect(payload.jumpLeader).toBe(0);
    expect(payload.modelTraversals.filter(Boolean)).toHaveLength(1);
    expect(validateAction(internals.state, internals.flow.action)).toEqual({ valid: true });
    expect(squad.models).toHaveLength(4);
  });

  it('chips mark carried models and never show a cannot-reach cross', () => {
    const { internals, squad, container } = setup();
    internals.handleSquadModelPick(LANDING, 'move');
    for (const m of squad.models.slice(1)) {
      const chip = container.querySelector(`[data-model-id="${m.id}"]`) as HTMLElement;
      expect(chip.textContent).toContain('↷');
      expect(chip.textContent).not.toContain('✗');
    }
  });

  describe('placing a carried model by hand', () => {
    it('a legal spot across replaces its Auto spot', () => {
      const { internals, squad } = setup();
      internals.handleSquadModelPick(LANDING, 'move');
      const m2 = squad.models[2];
      internals.selectedSquadModelId = m2.id;
      internals.handleSquadModelPick(P(4.65, 3, -1.9), 'move'); // 1.9" from the leader: 0.9" between edges
      expect(internals.stagedSquadModelPositions.get(m2.id)).toMatchObject({ x: 4.65, z: -1.9 });
      expect(internals.squadCrossers.has(m2.id)).toBe(true);
      expect(validateAction(internals.state, stagedAction(internals, squad))).toEqual({ valid: true });
    });

    it('more than 1" from every model across is refused with the reason, and the Auto spot stays', () => {
      const { internals, squad } = setup();
      internals.handleSquadModelPick(LANDING, 'move');
      const m2 = squad.models[2];
      const before = internals.stagedSquadModelPositions.get(m2.id);
      const toast = vi.spyOn(internals, 'showToast');
      internals.selectedSquadModelId = m2.id;
      internals.handleSquadModelPick(P(7.5, 3, 3.0), 'move');
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('within 1"'));
      expect(internals.stagedSquadModelPositions.get(m2.id)).toEqual(before);
    });

    it('a spot within 1" of another unit is refused with the keep-away reason', () => {
      // an enemy on deck B, far enough from the leader's landing, close to a spot beside it
      const { internals, squad } = setup({ foeAt: P(6.65, 3, 1.7) });
      internals.handleSquadModelPick(LANDING, 'move');
      const m2 = squad.models[2];
      const toast = vi.spyOn(internals, 'showToast');
      internals.selectedSquadModelId = m2.id;
      internals.handleSquadModelPick(P(5.6, 3, 0.7), 'move');
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('within 1" of another unit'));
      // and Auto never put anybody there
      for (const [, p] of internals.stagedSquadModelPositions as Map<string, Vector3>) {
        expect(Math.hypot(p.x - 6.65, p.z - 1.7)).toBeGreaterThanOrEqual(2 - 0.02);
      }
    });

    it('hovering shows the same verdict the click will give', () => {
      const { internals, squad, container } = setup();
      internals.render();
      internals.handleSquadModelPick(LANDING, 'move');
      internals.selectedSquadModelId = squad.models[2].id;
      const warning = () => container.querySelector('.sl-hud-move-warning') as HTMLElement;
      internals.handleBoardHover({ kind: 'position', position: P(4.65, 3, -1.9) });
      expect(internals.movePreview).toMatchObject({ x: 4.65, z: -1.9 });
      expect(warning().textContent).toContain('Carried across');
      internals.handleBoardHover({ kind: 'position', position: P(7.5, 3, 3.0) });
      expect(warning().textContent).toContain('within 1"');
    });
  });

  it('if the leader is placed again without a jump, nobody stays carried across', () => {
    const { internals, squad } = setup();
    internals.handleSquadModelPick(LANDING, 'move');
    internals.selectedSquadModelId = squad.models[0].id;
    internals.handleSquadModelPick(P(-1.2, 3, 0), 'move'); // a plain step back along the deck
    expect(internals.squadCrossers.size).toBe(0);
    expect(internals.stagedSquadModelTraversals.size).toBe(0);
    expect(internals.stagedSquadModelPositions.size).toBe(1);
    expect(internals.jumpLeaderPayload(squad.models)).toEqual({});
  });

  it('a Flying squad has no crossing: only the clicked model is placed', () => {
    const { internals } = setup({ rules: ['flying'] });
    internals.handleSquadModelPick(LANDING, 'move');
    expect(internals.squadCrossers.size).toBe(0);
    expect(internals.stagedSquadModelPositions.size).toBeLessThanOrEqual(1);
  });

  it('Reset Placement forgets the leader and the carried models', () => {
    const { internals } = setup();
    internals.handleSquadModelPick(LANDING, 'move');
    (document.querySelector('[data-action="reset-squad-move"]') as HTMLElement).click();
    expect(internals.squadCrossers.size).toBe(0);
    expect(internals.stagedSquadModelPositions.size).toBe(0);
    expect(internals.jumpLeaderPayload(internals.activeAliveSquadModels)).toEqual({});
  });
});
