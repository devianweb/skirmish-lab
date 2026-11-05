// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  createInitialGameState,
  applyDefaultScenario,
  createBlankMap,
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

type Spot = { x: number; z: number };

function toSquad(unit: GameState['units'][number], spots: Spot[]): void {
  unit.models = spots.map((p, i) => ({
    id: `${unit.id}-m${i}`,
    name: `M${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: false,
    position: { x: p.x, y: 0, z: p.z },
    rotation: { x: 0, y: 0, z: 0 },
  }));
  unit.wounds = spots.length;
  unit.maxWounds = spots.length;
  unit.position = { x: spots[0].x, y: 0, z: spots[0].z };
}

/** Open field: a 3-model host squad with rifles facing a 2-model guest squad. */
function squadState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, { customMap: { ...createBlankMap(), id: 'open', terrain: [] } });
  const attacker = state.units.find((u) => u.ownerId === HOST && u.weapons.some((w) => w.id === 'rifle'))!;
  const target = state.units.find((u) => u.ownerId === GUEST)!;
  toSquad(attacker, [{ x: -2, z: 0 }, { x: 0, z: 0 }, { x: 2, z: 0 }]);
  toSquad(target, [{ x: -2, z: 10 }, { x: 2, z: 10 }]);
  attacker.isActivated = true;
  attacker.status = attacker.status.filter((s) => s !== 'stunned');
  state.turnState.activeUnitId = attacker.id;
  state.turnState.unitsActivatedThisRound.push(attacker.id);
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
  return state;
}

function setup(state: GameState) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller: { submitAction: vi.fn() } });
  hud.show();
  hud.syncFromState(state);
  const snapshots: MarkerSnapshot[] = [];
  hud.onMarkers((m) => snapshots.push(m));
  return { hud, container, snapshots };
}

function clickShoot(container: HTMLElement): void {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Shoot'));
  (btn as HTMLElement).click();
}

describe('GameHUD: shooting preview for squads', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('emits one aim line per firing model, each to its nearest target model', () => {
    const state = squadState();
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    const { hud, container, snapshots } = setup(state);
    clickShoot(container);
    hud.handleBoardHover({ kind: 'unit', unitId: target.id });

    const lines = snapshots[snapshots.length - 1].aimLines!.lines;
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.fires)).toBe(true);
    // Left shooter aims at the left target model, right shooter at the right one.
    expect(lines[0].to.x).toBe(-2);
    expect(lines[2].to.x).toBe(2);
  });

  it('highlights the hovered target model when a firing model can see it', () => {
    const state = squadState();
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    const { hud, container, snapshots } = setup(state);
    clickShoot(container);
    hud.handleBoardHover({ kind: 'unit', unitId: target.id, modelId: `${target.id}-m1` });

    const aimed = snapshots[snapshots.length - 1].aimLines!.aimedModel;
    expect(aimed).toEqual({ x: 2, y: 0, z: 10 });
  });

  it('shows "N of M models can fire" when only some shooters have range', () => {
    const state = squadState();
    const attacker = state.units.find((u) => u.ownerId === HOST && u.id === state.turnState.activeUnitId)!;
    // Rifle range 24": move the right-hand shooter well out of reach (centre gap 40").
    attacker.models![2].position = { x: 2, y: 0, z: -40 };
    attacker.hasMoved = true; // the stray is out of coherency, so the squad must have moved to shoot
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    const { hud, container } = setup(state);
    clickShoot(container);
    hud.handleBoardHover({ kind: 'unit', unitId: target.id });

    const chip = container.querySelector('.sl-hud-aim-chip') as HTMLElement;
    expect(chip.style.display).not.toBe('none');
    expect(chip.textContent).toContain('2 of 3 models can fire');
  });

  it('hides the chip with no hovered target, and for a lone shooter', () => {
    const state = squadState();
    const { hud, container } = setup(state);
    clickShoot(container);
    const chip = container.querySelector('.sl-hud-aim-chip') as HTMLElement;
    expect(chip.style.display).toBe('none');

    const solo = squadState();
    const attacker = solo.units.find((u) => u.id === solo.turnState.activeUnitId)!;
    toSquad(attacker, [{ x: 0, z: 0 }]);
    const target = solo.units.find((u) => u.ownerId === GUEST)!;
    document.body.innerHTML = '';
    const second = setup(solo);
    clickShoot(second.container);
    second.hud.handleBoardHover({ kind: 'unit', unitId: target.id });
    const soloChip = second.container.querySelector('.sl-hud-aim-chip') as HTMLElement;
    expect(soloChip.style.display).toBe('none');
  });

  it('F9 debug for a squad carries one ray per attacker model', () => {
    const state = squadState();
    const target = state.units.find((u) => u.ownerId === GUEST)!;
    const { hud, container, snapshots } = setup(state);
    (hud as any).terrainDebugEnabled = true;
    clickShoot(container);
    hud.handleBoardHover({ kind: 'unit', unitId: target.id });

    const ray = snapshots[snapshots.length - 1].shootingDebugRay!;
    expect(ray.modelRays).toHaveLength(3);
    expect(ray.firingCount).toBe(3);
    expect(ray.targetModelCount).toBe(2);
  });
});
