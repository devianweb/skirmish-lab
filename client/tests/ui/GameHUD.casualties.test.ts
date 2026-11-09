// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  PendingReaction,
  Unit,
  Vector3,
  WEAPONS,
  autoPickCasualties,
  createInitialGameState,
  createPickCasualtiesReaction,
  validateAction,
} from '@skirmish-lab/shared';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';

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
    isActivated: false,
    isDestroyed: false,
    models,
    weapons: [{ ...WEAPONS.blade, profile: { ...WEAPONS.blade.profile } }],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 4,
  };
}

function pendingFor(unit: Unit, source: Unit, count: number, index = 0): PendingReaction {
  return createPickCasualtiesReaction('act1', index, unit, source, {
    entry: { unitId: unit.id, count, remainingWounds: 0, applications: [] },
    rest: [],
    after: { kind: 'shoot', attackerId: source.id },
  });
}

/** Guest line of 5 (1.5" apart: a chain), 2 to remove. */
function pickState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.units = [
    mkUnit('h1', HOST, [[0, 0]]),
    mkUnit('g1', GUEST, [[0, 9], [1.5, 9], [3, 9], [4.5, 9], [6, 9]]),
  ];
  state.terrain = [];
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.turnState.activeUnitId = 'h1';
  state.turnState.pendingReaction = pendingFor(state.units[1], state.units[0], 2);
  return state;
}

function setup(local: string, state: GameState = pickState()) {
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const markers: MarkerSnapshot[] = [];
  const hud = new GameHUD(container, { localPlayerId: local, controller });
  hud.onMarkers((m) => markers.push(m));
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state, markers };
}

function click(root: HTMLElement, text: string): boolean {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return !!found;
}
function chip(root: HTMLElement, i: number): HTMLElement {
  return root.querySelectorAll('[data-action="toggle-casualty-model"]')[i] as HTMLElement;
}
const confirmBtn = (root: HTMLElement) => root.querySelector('[data-action="confirm-casualties"]') as HTMLButtonElement;

describe('GameHUD casualty pick prompt (batch 1I PR 36)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('the owner sees "Remove 2 models from g1" with the countdown and a chip per living model', () => {
    const { container } = setup(GUEST);
    expect(container.textContent).toContain('Remove 2 models from g1');
    expect(container.querySelector('.sl-hud-reaction-timer')?.textContent).toMatch(/\d+s/);
    expect(container.querySelectorAll('[data-action="toggle-casualty-model"]')).toHaveLength(5);
  });

  it('the other player only sees a waiting message', () => {
    const { container } = setup(HOST);
    expect(container.textContent).toContain('Waiting for Bob to remove casualties');
    expect(container.querySelector('[data-action="confirm-casualties"]')).toBeNull();
    expect(container.querySelector('[data-action="toggle-casualty-model"]')).toBeNull();
  });

  it('Confirm is disabled until exactly N are chosen, then sends the picked ids the host accepts', () => {
    const { container, controller, state } = setup(GUEST);
    expect(confirmBtn(container).disabled).toBe(true);
    chip(container, 4).click();
    expect(confirmBtn(container).disabled).toBe(true);
    chip(container, 1).click();
    expect(confirmBtn(container).disabled).toBe(false);
    confirmBtn(container).click();
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('pick-casualties');
    expect(action.actorId).toBe(GUEST);
    expect(action.payload.unitId).toBe('g1');
    expect([...action.payload.modelIds].sort()).toEqual(['g1-m1', 'g1-m4']);
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('clicking a chosen model again unpicks it, and a pick over the limit is refused', () => {
    const { container, hud } = setup(GUEST);
    chip(container, 0).click();
    chip(container, 0).click();
    expect(confirmBtn(container).disabled).toBe(true);
    hud.handleBoardPick({ kind: 'unit', unitId: 'g1', modelId: 'g1-m0' });
    hud.handleBoardPick({ kind: 'unit', unitId: 'g1', modelId: 'g1-m1' });
    hud.handleBoardPick({ kind: 'unit', unitId: 'g1', modelId: 'g1-m2' });
    expect(container.textContent).toContain('Already 2 chosen');
    expect(confirmBtn(container).disabled).toBe(false);
  });

  it('board picks of another unit are ignored', () => {
    const { container, hud } = setup(GUEST);
    hud.handleBoardPick({ kind: 'unit', unitId: 'h1', modelId: 'h1-m0' });
    chip(container, 0).click();
    expect(confirmBtn(container).disabled).toBe(true);
    chip(container, 1).click();
    expect(confirmBtn(container).disabled).toBe(false);
  });

  it('Auto pick selects what the timeout would, Confirm then sends it', () => {
    const { container, controller, state } = setup(GUEST);
    const expected = autoPickCasualties(state.units[1], 2);
    expect(click(container, 'Auto pick')).toBe(true);
    expect(controller.submitAction).not.toHaveBeenCalled();
    expect(confirmBtn(container).disabled).toBe(false);
    confirmBtn(container).click();
    expect([...controller.submitAction.mock.calls[0][0].payload.modelIds].sort()).toEqual([...expected].sort());
  });

  it('has no "Let the host pick" button (owner, 2026-11-09): Auto pick then Confirm covers it', () => {
    const { container } = setup(GUEST);
    expect(click(container, 'Let the host pick')).toBe(false);
    expect(container.querySelector('[data-reaction-choice="auto-pick-casualties"]')).toBeNull();
  });

  it('a model whose removal splits the chain is noted but can still be picked', () => {
    const { container } = setup(GUEST);
    const chips = container.querySelectorAll('[data-action="toggle-casualty-model"]');
    expect(chips[2].textContent).toContain('splits the squad');
    expect(chips[0].textContent).not.toContain('splits the squad');
    expect(chips[4].textContent).not.toContain('splits the squad');
    chip(container, 2).click();
    chip(container, 0).click();
    expect(confirmBtn(container).disabled).toBe(false);
  });

  it('highlights the picked models through the marker snapshot and clears it when unpicked', () => {
    const { container, markers } = setup(GUEST);
    chip(container, 3).click();
    const last = markers[markers.length - 1];
    expect(last.casualtyPicks).toHaveLength(1);
    expect(last.casualtyPicks![0]).toMatchObject({ x: 4.5, z: 9 });
    chip(container, 3).click();
    expect(markers[markers.length - 1].casualtyPicks ?? []).toHaveLength(0);
  });

  it('queued prompts: the next unit starts with a fresh selection', () => {
    const state = pickState();
    state.units.push(mkUnit('g2', GUEST, [[10, 9], [11, 9], [12, 9]]));
    const { hud, container } = setup(GUEST, state);
    chip(container, 0).click();
    chip(container, 1).click();
    const next: GameState = JSON.parse(JSON.stringify(state));
    next.turnState.pendingReaction = pendingFor(next.units[2], next.units[0], 1, 1);
    hud.syncFromState(next);
    expect(container.textContent).toContain('Remove 1 model from g2');
    expect(confirmBtn(container).disabled).toBe(true);
    chip(container, 2).click();
    expect(confirmBtn(container).disabled).toBe(false);
  });
});
