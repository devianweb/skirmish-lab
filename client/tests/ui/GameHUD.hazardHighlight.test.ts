// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  createAction,
  createInitialGameState,
  createHazardRangeMap,
  createUnitsFromStarterArmy,
  STARTER_ARMIES,
  Unit,
  Vector3,
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function hazardRangeState(): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.terrain = createHazardRangeMap().terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  const hostUnits = createUnitsFromStarterArmy(STARTER_ARMIES['test-hazard-army'], HOST);
  const guestUnits = createUnitsFromStarterArmy(STARTER_ARMIES['test-hazard-army'], GUEST);
  state.units = [...hostUnits, ...guestUnits];
  return state;
}

function activateUnit(state: GameState, unitId: string): void {
  const unit = state.units.find((u) => u.id === unitId)!;
  unit.isActivated = true;
  state.turnState.activeUnitId = unitId;
  state.turnState.unitsActivatedThisRound.push(unitId);
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
}

function setup(state = hazardRangeState()) {
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  let latestMarkers: MarkerSnapshot | null = null;
  hud.onMarkers((m) => {
    latestMarkers = m;
  });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state, getMarkers: () => latestMarkers };
}

describe('GameHUD dangerous terrain highlights', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a planned path across a hazard pool highlights exactly that piece and matches hazard dice count', () => {
    const state = hazardRangeState();
    const hero = state.units.find((u) => u.ownerId === HOST && u.name.includes('Test Hazard Hero'))!;
    // Place hero just south of Pool A (x: -9, z: -11)
    hero.position = P(-9, 0, -11);
    hero.models.forEach((m) => (m.position = P(-9, 0, -11)));
    activateUnit(state, hero.id);

    const { hud, container, getMarkers } = setup(state);

    const poolA = state.terrain.find((t) => t.position.x === -9 && t.position.z === -8)!;
    expect(poolA).toBeDefined();

    // Begin Advance targeting
    const advanceBtn = container.querySelector<HTMLButtonElement>('[data-action="move"]')!;
    advanceBtn.click();

    // Hover north of Pool A so the path crosses it (destination x: -9, z: -5)
    hud.handleBoardHover({ kind: 'position', position: P(-9, 0, -5) });

    const markers = getMarkers();
    expect(markers?.hazardHighlights?.pieceIds).toContain(poolA.id);
    expect(markers?.hazardHighlights?.pieceIds).toHaveLength(1);

    // Click to confirm the move
    hud.handleBoardPick({ kind: 'position', position: P(-9, 0, -5) });
    expect(container.textContent).toContain('Dangerous terrain: 3 dice, each 1 is a wound');

    const confirmMarkers = getMarkers();
    expect(confirmMarkers?.hazardHighlights?.pieceIds).toContain(poolA.id);
  });

  it('a path that avoids dangerous terrain highlights nothing', () => {
    const state = hazardRangeState();
    const waders = state.units.find((u) => u.ownerId === HOST && u.name.includes('Test Waders'))!;
    // Place waders in the clear 2" strip between pool A and B (x: -6, z: -14)
    waders.position = P(-6, 0, -14);
    waders.models.forEach((m, i) => (m.position = P(-6, 0, -14 - i * 1.1)));
    activateUnit(state, waders.id);

    const { hud, container, getMarkers } = setup(state);

    const advanceBtn = container.querySelector<HTMLButtonElement>('[data-action="move"]')!;
    advanceBtn.click();

    // Move straight up the clear strip (x: -6, z: -4)
    hud.handleBoardHover({ kind: 'position', position: P(-6, 0, -4) });

    const markers = getMarkers();
    const pieceIds = markers?.hazardHighlights?.pieceIds ?? [];
    expect(pieceIds).toHaveLength(0);

    hud.handleBoardPick({ kind: 'position', position: P(-6, 0, -4) });
    expect(container.textContent).not.toContain('Dangerous terrain');
    const confirmMarkers = getMarkers();
    expect(confirmMarkers?.hazardHighlights?.pieceIds ?? []).toHaveLength(0);
  });

  it('hovering highlights and labels a dangerous piece, and clears when moving away', () => {
    const state = hazardRangeState();
    const poolA = state.terrain.find((t) => t.position.x === -9 && t.position.z === -8)!;

    const { hud, getMarkers } = setup(state);

    // Hover pool A outside of F9 debug and with no move planned
    hud.handleBoardHover({ kind: 'position', position: P(-9, 0, -8), terrainId: poolA.id });

    const markers = getMarkers();
    expect(markers?.hazardHighlights?.pieceIds).toEqual([poolA.id]);
    expect(markers?.hazardHighlights?.hoveredPieceId).toBe(poolA.id);

    // Move hover away to clear ground
    hud.handleBoardHover({ kind: 'position', position: P(-6, 0, -8) });
    const cleared = getMarkers();
    expect(cleared?.hazardHighlights?.pieceIds ?? []).toHaveLength(0);
    expect(cleared?.hazardHighlights?.hoveredPieceId ?? null).toBeNull();
  });

  it('Flying units highlight nothing while planning', () => {
    const state = hazardRangeState();
    const flyers = state.units.find((u) => u.ownerId === HOST && u.id.includes('flyers'))!;
    flyers.position = P(-9, 0, -14);
    flyers.models.forEach((m, i) => (m.position = P(-9, 0, -14 - i * 1.1)));
    activateUnit(state, flyers.id);

    const { hud, container, getMarkers } = setup(state);

    const advanceBtn = container.querySelector<HTMLButtonElement>('[data-action="move"]')!;
    advanceBtn.click();

    // Fly across Pool A
    hud.handleBoardHover({ kind: 'position', position: P(-9, 0, -3) });
    const markers = getMarkers();
    expect(markers?.hazardHighlights?.pieceIds ?? []).toHaveLength(0);

    hud.handleBoardPick({ kind: 'position', position: P(-9, 0, -3) });
    expect(container.textContent).not.toContain('Dangerous terrain');
    const confirmMarkers = getMarkers();
    expect(confirmMarkers?.hazardHighlights?.pieceIds ?? []).toHaveLength(0);
  });

  it('the highlight clears on Cancel and on Confirm', () => {
    const state = hazardRangeState();
    const hero = state.units.find((u) => u.ownerId === HOST && u.name.includes('Test Hazard Hero'))!;
    hero.position = P(-9, 0, -11);
    hero.models.forEach((m) => (m.position = P(-9, 0, -11)));
    activateUnit(state, hero.id);

    const { hud, container, controller, getMarkers } = setup(state);

    const advanceBtn = container.querySelector<HTMLButtonElement>('[data-action="move"]')!;
    advanceBtn.click();

    hud.handleBoardPick({ kind: 'position', position: P(-9, 0, -5) });
    expect(getMarkers()?.hazardHighlights?.pieceIds?.length).toBeGreaterThan(0);

    // Cancel
    const cancelBtn = container.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancelBtn.click();
    expect(getMarkers()?.hazardHighlights?.pieceIds ?? []).toHaveLength(0);

    // Re-pick and Confirm
    advanceBtn.click();
    hud.handleBoardPick({ kind: 'position', position: P(-9, 0, -5) });
    expect(getMarkers()?.hazardHighlights?.pieceIds?.length).toBeGreaterThan(0);

    const confirmBtn = container.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;
    confirmBtn.click();
    expect(controller.submitAction).toHaveBeenCalled();
    expect(getMarkers()?.hazardHighlights?.pieceIds ?? []).toHaveLength(0);
  });
});
