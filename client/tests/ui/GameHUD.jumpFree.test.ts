// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GameState, GUEST_PLAYER_ID, HOST_PLAYER_ID, TerrainPiece, Vector3,
  createBlankMap, createInitialGameState, applyDefaultScenario, validateAction,
} from '@skirmish-lab/shared';
import { legacyScenarioTerrain } from '../../../shared/tests/fixtures/legacyScenarioTerrain';
import { GameHUD } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });
const fixture = JSON.parse(readFileSync(join(__dirname, '../../../shared/tests/fixtures/testy-mctestface.json'), 'utf8'))[0];
const fixtureTerrain: TerrainPiece[] = fixture.terrain;

function clickByText(root: HTMLElement, text: string): void {
  (Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text)) as HTMLElement | undefined)?.click();
}

function setup(position: Vector3, remaining: number) {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, { customMap: { ...createBlankMap(), id: 'fixture', terrain: legacyScenarioTerrain() } });
  state.terrain = fixtureTerrain.map((t) => ({ ...t }));
  const unit = state.units.find((u) => u.ownerId === HOST)!;
  unit.models = [];
  unit.position = { ...position };
  unit.isActivated = true;
  unit.status = [];
  unit.hasMoved = remaining < unit.speed;
  unit.remainingMovement = remaining;
  state.turnState.activeUnitId = unit.id;
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
  state.units.filter((u) => u.ownerId !== HOST).forEach((u, i) => (u.position = P(-20 + i * 3, 0, 18)));
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  hud.show();
  hud.syncFromState(state);
  clickByText(container, 'Advance');
  return { hud, controller, container, state, unit };
}

describe('the jump is free after moving (Decision 41)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('1" of move left at the ledge edge: the hop across the gap is offered and the host accepts it', () => {
    const { hud, container, controller, state } = setup(P(-0.2, 3, 0), 1);
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    expect((hud as any).moveJump).not.toBeNull();
    hud.handleBoardPick({ kind: 'position', position: P(5.6, 3, -1) });
    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.payload.finalPosition).toMatchObject({ x: 5.6, y: 3, z: -1 });
    expect(validateAction(state, action).valid).toBe(true);
  });

  it('at the ledge edge with 0.5" of move left the hop is still offered', () => {
    const { hud, unit } = setup(P(-0.2, 3, 0), 0.5);
    expect(unit.remainingMovement).toBe(0.5);
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    expect((hud as any).moveJump).not.toBeNull();
  });
});

describe('hover preview planning is memoised (frame rate when jumping and charging)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hovering the same 0.1" cell again reuses the planned path instead of replanning', () => {
    const { hud } = setup(P(-1.5, 3, 0), 6);
    hud.handleBoardHover({ kind: 'position', position: P(-3, 3, 0.5) });
    const first = (hud as any).movePathPreview;
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect((hud as any).hoverNavMemo.size).toBe(1);
    hud.handleBoardHover({ kind: 'position', position: P(-3.02, 3, 0.51) });
    expect((hud as any).movePathPreview).toBe(first);
    expect((hud as any).hoverNavMemo.size).toBe(1);
    hud.handleBoardHover({ kind: 'position', position: P(-2.5, 3, 0.5) });
    expect((hud as any).hoverNavMemo.size).toBe(2);
  });

  it('a new game state drops the memo (units may have moved)', () => {
    const { hud, state } = setup(P(-1.5, 3, 0), 6);
    hud.handleBoardHover({ kind: 'position', position: P(-3, 3, 0.5) });
    expect((hud as any).hoverNavMemo.size).toBe(1);
    hud.syncFromState(JSON.parse(JSON.stringify(state)));
    hud.handleBoardHover({ kind: 'position', position: P(-3, 3, 0.5) });
    expect((hud as any).hoverNavMemo.size).toBe(1);
  });
});
