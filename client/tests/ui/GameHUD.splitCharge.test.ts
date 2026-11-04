// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  TerrainPiece,
  Vector3,
  applyAction,
  applyDefaultScenario,
  createBlankMap,
  createDefaultScenarioTerrain,
  createInitialGameState,
  validateAction,
  TERRAIN_PALETTE_CATALOG,
} from '@skirmish-lab/shared';
import { GameHUD } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function piece(id: string, terrainType: string, pos: Vector3): TerrainPiece {
  const meta = TERRAIN_PALETTE_CATALOG[terrainType];
  return {
    id,
    terrainType,
    position: pos,
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...meta.defaultScale },
    blocksLineOfSight: meta.blocksLineOfSight,
    providesCover: meta.providesCover,
    isObstacle: meta.isObstacle,
    isWalkable: true,
  } as TerrainPiece;
}

// Deck A spans x -4..0 and deck B x 1.5..5.5, both 3" high: a 1.5" gap, and platforms cannot be climbed.
const decks = [piece('deck-a', 'platform-small', P(-2, 0, 0)), piece('deck-b', 'platform-small', P(3.5, 0, 0))];

function clickByText(root: HTMLElement, text: string): HTMLElement | null {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return (found as HTMLElement) ?? null;
}

/** The host's first unit is active at `position`; the first enemy stands at `enemyAt`, the others far away. */
function setup(position: Vector3, enemyAt: Vector3, terrain: TerrainPiece[] = decks) {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, {
    customMap: { ...createBlankMap(), id: 'fixture', terrain: createDefaultScenarioTerrain() },
  });
  state.terrain = terrain.map((t) => ({ ...t }));
  const unit = state.units.find((u) => u.ownerId === HOST)!;
  unit.models = [];
  unit.position = { ...position };
  unit.isActivated = true;
  unit.status = [];
  unit.specialRules = unit.specialRules.filter((r) => r !== 'stationary');
  if (!unit.weapons.some((w) => w.isEquipped && w.profile.type === 'melee')) {
    throw new Error('fixture unit needs a melee weapon');
  }
  state.turnState.activeUnitId = unit.id;
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
  const enemies = state.units.filter((u) => u.ownerId !== HOST);
  enemies.forEach((u, i) => {
    u.models = [];
    u.position = i === 0 ? { ...enemyAt } : P(-20 + i * 3, 0, 18);
  });
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state, unit, enemy: enemies[0], other: enemies[1] };
}

const chip = (container: HTMLElement) => container.querySelector('.sl-hud-move-warning') as HTMLElement;

describe('GameHUD split charges (batch 1D PR 16)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a target one safe path reaches is still a one-click charge', () => {
    const { hud, container, controller, state, enemy } = setup(P(0, 0, -10), P(0, 0, -3), []);
    clickByText(container, 'Charge');
    hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('charge');
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('a target no single safe path reaches offers to declare the charge, and the host accepts it', () => {
    const { hud, container, controller, state, enemy } = setup(P(-0.5, 3, 0), P(4.5, 3, 0), decks);
    clickByText(container, 'Charge');
    hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });
    expect(container.textContent).toContain('Declare a charge');
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('begin-charge');
    expect(action.payload).toMatchObject({ attackerId: state.turnState.activeUnitId, targetId: enemy.id });
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('after declaring, the HUD stays in the charge flow with the budget and an End (no melee) button, and no Cancel', () => {
    const { hud, container, controller, state, enemy } = setup(P(-0.5, 3, 0), P(4.5, 3, 0), decks);
    clickByText(container, 'Charge');
    hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });
    clickByText(container, 'Confirm');
    const declared = applyAction(state, controller.submitAction.mock.calls[0][0]);
    if (!declared.ok) throw new Error(declared.reason);
    hud.syncFromState(declared.state!);
    expect(container.textContent).toContain('Charge declared');
    expect(container.textContent).toContain('12.0" left');
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'End (no melee)')).toBe(true);
    expect(Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Cancel')).toBe(false);

    // from the ledge edge, hovering across the gap offers the jump chip like a move
    hud.handleBoardHover({ kind: 'position', position: P(2.6, 3, 0) });
    expect(chip(container).style.display).toBe('block');
    expect(chip(container).textContent).toMatch(/^Jump gap/);
  });

  it('a leg across the gap is sent as a charge-leg with its declared jump, and the host accepts it', () => {
    const { hud, container, controller, state, enemy } = setup(P(-0.5, 3, 0), P(4.5, 3, 0), decks);
    clickByText(container, 'Charge');
    hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });
    clickByText(container, 'Confirm');
    const declared = applyAction(state, controller.submitAction.mock.calls[0][0]);
    if (!declared.ok) throw new Error(declared.reason);
    hud.syncFromState(declared.state!);

    controller.submitAction.mockClear();
    hud.handleBoardPick({ kind: 'position', position: P(2.6, 3, 0) });
    clickByText(container, 'Confirm');
    const leg = controller.submitAction.mock.calls[0][0];
    expect(leg.type).toBe('charge-leg');
    expect(leg.payload.traversal).toMatchObject({ kind: 'jump-gap' });
    expect(leg.payload.path).toHaveLength(2);
    expect(validateAction(declared.state!, leg).valid).toBe(true);
  });

  it('a declared charge refuses another target', () => {
    const { hud, container, controller, state, enemy, other } = setup(P(-0.5, 3, 0), P(4.5, 3, 0), decks);
    clickByText(container, 'Charge');
    hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });
    clickByText(container, 'Confirm');
    const declared = applyAction(state, controller.submitAction.mock.calls[0][0]);
    if (!declared.ok) throw new Error(declared.reason);
    hud.syncFromState(declared.state!);
    controller.submitAction.mockClear();
    hud.handleBoardPick({ kind: 'unit', unitId: other.id });
    expect(container.textContent).toContain('locked');
    expect(container.textContent).not.toContain('Confirm');
    expect(controller.submitAction).not.toHaveBeenCalled();
  });

  it('End (no melee) abandons the charge through end-activation', () => {
    const { hud, container, controller, state, enemy } = setup(P(-0.5, 3, 0), P(4.5, 3, 0), decks);
    clickByText(container, 'Charge');
    hud.handleBoardPick({ kind: 'unit', unitId: enemy.id });
    clickByText(container, 'Confirm');
    const declared = applyAction(state, controller.submitAction.mock.calls[0][0]);
    if (!declared.ok) throw new Error(declared.reason);
    hud.syncFromState(declared.state!);
    controller.submitAction.mockClear();
    clickByText(container, 'End (no melee)');
    expect(container.textContent).toContain('Abandon the charge');
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('end-activation');
    expect(validateAction(declared.state!, action).valid).toBe(true);
  });
});
