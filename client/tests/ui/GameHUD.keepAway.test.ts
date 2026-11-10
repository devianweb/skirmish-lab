// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  applyDefaultScenario,
  createBlankMap,
  createInitialGameState,
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
} from '@skirmish-lab/shared';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

function scenarioState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, { customMap: { ...createBlankMap(), id: 'keep-away-test', terrain: [] } });
  return state;
}

function clickByText(root: HTMLElement, text: string): void {
  const el = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  (el as HTMLElement | undefined)?.click();
}

function setup() {
  const state = scenarioState();
  const unit = state.units.find((u) => u.ownerId === HOST)!;
  unit.isActivated = true;
  state.turnState.activeUnitId = unit.id;
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const controller = { submitAction: vi.fn() };
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  hud.show();
  hud.syncFromState(state);
  const emitted: MarkerSnapshot[] = [];
  hud.onMarkers((m) => emitted.push(m));
  return { hud, container, unit, emitted };
}

describe('GameHUD keep-away zones', () => {
  it('shows zones and the legend while a move is planned, and clears them after Cancel and Confirm', () => {
    const { hud, container, unit, emitted } = setup();
    const start = { ...unit.position };

    expect(container.querySelector('[data-keep-away-legend]')).toBeNull();

    clickByText(container, 'Advance');
    const zones = emitted.at(-1)?.keepAwayZones;
    expect(zones && zones.length).toBeGreaterThan(0);
    expect(zones!.every((z) => z.unitId !== unit.id && !z.exempt)).toBe(true);
    expect(container.querySelector('[data-keep-away-legend]')?.textContent).toContain('1" zone');

    clickByText(container, 'Cancel');
    expect(emitted.at(-1)?.keepAwayZones ?? null).toBeNull();
    expect(container.querySelector('[data-keep-away-legend]')).toBeNull();

    clickByText(container, 'Advance');
    hud.handleBoardPick({ kind: 'position', position: { x: start.x, y: 0, z: start.z + 3 } });
    expect(emitted.at(-1)?.keepAwayZones?.length).toBeGreaterThan(0);
    clickByText(container, 'Confirm');
    expect(emitted.at(-1)?.keepAwayZones ?? null).toBeNull();
  });
});
