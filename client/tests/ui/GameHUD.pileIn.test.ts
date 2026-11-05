// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  Unit,
  Vector3,
  WEAPONS,
  applyAction,
  createAction,
  createInitialGameState,
  validateAction,
} from '@skirmish-lab/shared';
import { GameHUD } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, z: number, y = 0): Vector3 => ({ x, y, z });

function mkUnit(id: string, ownerId: string, spots: Array<[number, number]>): Unit {
  const models = spots.map(([x, z], i) => ({
    id: `${id}-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: P(x, z),
    rotation: { x: 0, y: 0, z: 0 },
  }));
  return {
    id,
    ownerId,
    armyId: 'a',
    unitType: 'trooper',
    name: id,
    quality: 4,
    defense: 5,
    speed: 4,
    position: P(spots.reduce((a, s) => a + s[0], 0) / spots.length, spots.reduce((a, s) => a + s[1], 0) / spots.length),
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: spots.length,
    maxWounds: spots.length,
    isActivated: ownerId === HOST,
    isDestroyed: false,
    models,
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 4,
  };
}

/** A 4-model host line charges a 3-model guest squad: after the charge, g1's third model must pile in. */
function afterCharge(thirdSpot: [number, number] = [0.5, 10]): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.units = [
    mkUnit('h1', HOST, [[0, 0], [1, 0], [2, 0], [3, 0]]),
    mkUnit('g1', GUEST, [[0, 9], [1, 9], thirdSpot]),
  ];
  state.terrain = [];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = 'h1';
  const ends = [P(0, 8), P(1, 8), P(2, 8), P(3, 8)];
  const out = applyAction(
    state,
    createAction(HOST, 'charge', {
      type: 'charge',
      attackerId: 'h1',
      targetId: 'g1',
      weaponId: 'blade',
      path: [P(0, 0), ends[0]],
      modelPositions: ends,
      modelPaths: state.units[0].models!.map((m, i) => [m.position, ends[i]]),
    } as any)
  );
  if (!out.ok) throw new Error(out.reason);
  return out.state!;
}

function setup(local: string, thirdSpot?: [number, number]) {
  const state = afterCharge(thirdSpot);
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: local, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state };
}

function click(root: HTMLElement, text: string): boolean {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return !!found;
}

describe('GameHUD defender pile-in prompt (batch 1I PR 34)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('the defender sees the Pile in prompt with a countdown and only the listed model to pick', () => {
    const { container, state } = setup(GUEST);
    expect(state.turnState.pendingReaction?.type).toBe('pile-in');
    expect(container.textContent).toContain('Pile in');
    expect(container.querySelector('.sl-hud-reaction-timer')?.textContent).toMatch(/\d+s/);
    const chips = Array.from(container.querySelectorAll('[data-action="select-pile-in-model"]'));
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('Model 3');
  });

  it('the charging player only sees a waiting message and no controls', () => {
    const { container } = setup(HOST);
    expect(container.textContent).toContain('Waiting for Bob to pile in');
    expect(container.querySelector('[data-action="confirm-pile-in"]')).toBeNull();
    expect(container.querySelector('[data-action="select-pile-in-model"]')).toBeNull();
  });

  it('Auto place fills the model and Confirm sends a payload the host accepts, in living-model order', () => {
    const { container, controller, state } = setup(GUEST);
    expect(click(container, 'Auto place')).toBe(true);
    expect(controller.submitAction).not.toHaveBeenCalled();
    expect(click(container, 'Confirm')).toBe(true);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('pile-in-move');
    expect(action.actorId).toBe(GUEST);
    expect(action.payload.modelPositions).toHaveLength(3);
    // Models already in contact keep their spots
    expect(action.payload.modelPositions[0]).toMatchObject({ x: 0, z: 9 });
    expect(action.payload.modelPositions[1]).toMatchObject({ x: 1, z: 9 });
    expect(action.payload.modelPaths).toHaveLength(3);
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('a hand-placed spot is used instead of the suggestion', () => {
    const { container, controller, hud, state } = setup(GUEST);
    click(container, 'Model 3');
    hud.handleBoardPick({ kind: 'position', position: P(2, 9) });
    click(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.payload.modelPositions[2].x).toBeCloseTo(2, 1);
    expect(action.payload.modelPositions[2].z).toBeCloseTo(9, 1);
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('a model left well short of its best spot is refused with the host reason and nothing is sent', () => {
    const { container, controller, hud } = setup(GUEST);
    click(container, 'Model 3');
    hud.handleBoardPick({ kind: 'position', position: P(0.5, 10.5) });
    click(container, 'Confirm');
    expect(controller.submitAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain('could get closer');
  });

  it('models already in contact cannot be selected or moved', () => {
    const { container, hud, controller } = setup(GUEST);
    hud.handleBoardPick({ kind: 'unit', unitId: 'g1', modelId: 'g1-m0' });
    expect(container.textContent).toContain('already in contact');
    click(container, 'Auto place');
    click(container, 'Confirm');
    const sent = controller.submitAction.mock.calls[0]?.[0];
    expect(sent?.payload.modelPositions[0]).toMatchObject({ x: 0, z: 9 });
  });

  it('the host-places-for-me reaction option still submits the auto-pile-in choice', () => {
    const { container, controller } = setup(GUEST);
    expect(click(container, 'Let the host place them')).toBe(true);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('respond-reaction');
    expect(action.payload.choiceId).toBe('auto-pile-in');
  });

  it('Reset clears the staged spots', () => {
    const { container, controller, hud } = setup(GUEST);
    click(container, 'Model 3');
    hud.handleBoardPick({ kind: 'position', position: P(2, 9) });
    click(container, 'Reset');
    click(container, 'Auto place');
    click(container, 'Confirm');
    const pos = controller.submitAction.mock.calls[0][0].payload.modelPositions[2];
    expect(pos.x === 2 && pos.z === 9).toBe(false);
  });

  it('clicking a charging model walks the selected model into base contact with it', () => {
    const { container, controller, hud, state } = setup(GUEST, [2.5, 10.2]);
    hud.handleBoardPick({ kind: 'unit', unitId: 'h1', modelId: 'h1-m3' });
    click(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    const p = action.payload.modelPositions[2];
    expect(Math.hypot(p.x - 3, p.z - 8)).toBeLessThan(1.1);
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('clicking the charging unit without a model also goes to contact', () => {
    const { container, controller, hud, state } = setup(GUEST, [2.5, 10.2]);
    hud.handleBoardPick({ kind: 'unit', unitId: 'h1' });
    click(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(validateAction(state, action).valid).toBe(true);
    expect(action.payload.modelPositions[2].z).toBeLessThan(10.2);
  });

  it('a contact spot beyond 3 inches toasts and leaves the model where it was', () => {
    const { container, hud } = setup(GUEST, [8, 14]);
    hud.handleBoardPick({ kind: 'unit', unitId: 'h1', modelId: 'h1-m0' });
    expect(container.textContent).toContain('Cannot reach base contact');
    expect(container.textContent).not.toContain('✓ Model 3');
  });
});
