// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  TerrainPiece,
  Vector3,
  createBlankMap,
  createDefaultScenarioTerrain,
  createInitialGameState,
  applyDefaultScenario,
  validateAction,
} from '@skirmish-lab/shared';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../shared/tests/fixtures/testy-mctestface.json'), 'utf8')
)[0];
const fixtureTerrain: TerrainPiece[] = fixture.terrain;

function clickByText(root: HTMLElement, text: string): HTMLElement | null {
  const found = Array.from(root.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (found) (found as HTMLElement).click();
  return (found as HTMLElement) ?? null;
}

/** The fixture map with the host's first unit made the active, single-model unit at `position`. */
function setup(position: Vector3, action: 'Move' | 'Rush' = 'Move', rules: string[] = []) {
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, {
    customMap: { ...createBlankMap(), id: 'fixture', terrain: createDefaultScenarioTerrain() },
  });
  state.terrain = fixtureTerrain.map((t) => ({ ...t }));
  const unit = state.units.find((u) => u.ownerId === HOST)!;
  unit.models = [];
  unit.position = { ...position };
  unit.specialRules = [...unit.specialRules, ...rules];
  unit.isActivated = true;
  unit.status = [];
  state.turnState.activeUnitId = unit.id;
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.currentPlayerId = HOST;
  state.turnState.phase = 'activation';
  // keep the enemies out of the way
  state.units.filter((u) => u.ownerId !== HOST).forEach((u, i) => (u.position = P(-20 + i * 3, 0, 18)));

  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: HOST, controller });
  hud.show();
  hud.syncFromState(state);
  const markers: MarkerSnapshot[] = [];
  hud.onMarkers((m) => markers.push(m));
  clickByText(container, action);
  return { hud, controller, container, state, unit, markers };
}

const chip = (container: HTMLElement) => container.querySelector('.sl-hud-move-warning') as HTMLElement;

describe('GameHUD move preview: declared jumps (batch 1E E3)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the gap-jump chip when hovering the far deck from the ledge edge', () => {
    const { hud, container } = setup(P(-0.2, 3, 0));
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    expect(chip(container).style.display).toBe('block');
    expect(chip(container).textContent).toMatch(/^Jump gap \d\.\d" · 2 dice \(3\+\)$/);
    // the preview is the single hop
    const path = (hud as any).movePathPreview as Vector3[];
    expect(path).toHaveLength(2);
    expect(path[0]).toMatchObject({ x: -0.2, y: 3 });
    expect(path[1]).toMatchObject({ x: 5.6, y: 3, z: -1 });
  });

  it('shows no chip from mid-ledge: the safe path is previewed instead and never crosses the gap', () => {
    const { hud, container } = setup(P(-1.5, 3, 0));
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    expect(chip(container).textContent).not.toContain('Jump');
    const path = (hud as any).movePathPreview as Vector3[];
    expect(path.length).toBeGreaterThanOrEqual(2);
    // only ordinary legs (the engine plans no jump); the end is never suspended over the gap
    const kinds = ((hud as any).moveSegments as Array<{ kind: string }>).map((s) => s.kind);
    expect(kinds.some((k) => k === 'jump-gap' || k === 'jump-drop' || k === 'fall' || k === 'blocked')).toBe(false);
  });

  it('shows no chip for a safe-only target (an ordinary drop of 3" onto the ground)', () => {
    const { hud, container } = setup(P(-0.2, 3, 0));
    hud.handleBoardHover({ kind: 'position', position: P(1.2, 0, 0) });
    expect(chip(container).textContent).not.toContain('Jump');
    expect(chip(container).textContent).not.toContain('Drop');
  });

  it('confirming a declared jump sends the traversal and the single-hop path (and no legacy gapJump field)', () => {
    const { hud, container, controller, state, unit } = setup(P(-0.2, 3, 0));
    hud.handleBoardPick({ kind: 'position', position: P(5.6, 3, -1) });
    expect(container.textContent).toContain('Jump gap');
    clickByText(container, 'Confirm');
    expect(controller.submitAction).toHaveBeenCalledTimes(1);
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('move-unit');
    expect(action.payload.traversal).toMatchObject({
      kind: 'jump-gap',
      takeoff: { x: -0.2, y: 3, z: 0 },
      landing: { x: 5.6, y: 3, z: -1 },
    });
    expect(action.payload.path).toHaveLength(2);
    expect(action.payload.finalPosition).toMatchObject({ x: 5.6, y: 3, z: -1 });
    expect('gapJump' in action.payload).toBe(false);
    // the host accepts exactly what the HUD sent
    expect(validateAction(state, action).valid).toBe(true);
    expect(unit.position.y).toBe(3);
  });

  it('a safe move carries no traversal', () => {
    const { hud, container, controller } = setup(P(-1.5, 3, 0));
    hud.handleBoardPick({ kind: 'position', position: P(-3, 3, 0) });
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.payload.traversal).toBeUndefined();
    expect('gapJump' in action.payload).toBe(false);
  });

  it('a cursor within 0.5" of the far deck edge snaps to the spot a base inside the edge before the jump is computed', () => {
    const { hud } = setup(P(-0.2, 3, 0));
    hud.handleBoardHover({ kind: 'position', position: P(5.4, 3, -1) });
    const path = (hud as any).movePathPreview as Vector3[];
    expect(path[path.length - 1].x).toBeCloseTo(5.5, 5);
  });

  it('a cursor 0.6" from the edge is not snapped', () => {
    const { hud } = setup(P(-0.2, 3, 0));
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    const path = (hud as any).movePathPreview as Vector3[];
    expect(path[path.length - 1].x).toBeCloseTo(5.6, 5);
  });

  it('offers a pathfinder the 2+ target', () => {
    const { hud, container } = setup(P(-0.2, 3, 0), 'Move', ['pathfinder']);
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    expect(chip(container).textContent).toContain('(2+)');
  });

  it('rush offers the same jump and confirms with a traversal', () => {
    const { hud, container, controller } = setup(P(-0.2, 3, 0), 'Rush');
    hud.handleBoardPick({ kind: 'position', position: P(5.6, 3, -1) });
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.type).toBe('rush');
    expect(action.payload.traversal.kind).toBe('jump-gap');
  });

  it('a drop over 6" from an edge shows the red fall warning and confirms as a declared fall', () => {
    const { hud, container, controller, state } = setup(P(1.8, 7, 0));
    state.terrain = [
      {
        id: 'tall',
        terrainType: 'platform',
        position: { x: 0, y: 7, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 4, y: 0.3, z: 4 },
        elevation: 7,
        isWalkable: true,
        blocksLineOfSight: false,
        providesCover: false,
        isObstacle: false,
      },
    ];
    hud.syncFromState(state);
    clickByText(container, 'Move');
    hud.handleBoardHover({ kind: 'position', position: P(3, 0, 0) });
    expect(chip(container).textContent).toContain('Drop 7.0"');
    expect(chip(container).textContent).toContain('too high to jump');
    expect(chip(container).style.color).toBe('rgb(255, 138, 128)');
    hud.handleBoardPick({ kind: 'position', position: P(3, 0, 0) });
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.payload.traversal.kind).toBe('fall');
  });

  const deckPiece = (id: string, x: number, topY: number): TerrainPiece =>
    ({
      id,
      terrainType: 'platform',
      position: { x, y: topY, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 4, y: 0.3, z: 4 },
      elevation: topY,
      isWalkable: true,
      blocksLineOfSight: false,
      providesCover: false,
      isObstacle: false,
    }) as TerrainPiece;
  const confirmSummary = (container: HTMLElement) =>
    (container.querySelector('.sl-hud-confirm-summary') as HTMLElement).textContent ?? '';
  const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

  it('a pure 4" drop from an edge shows exactly one jump line: "Jump down 4.2" · 2 dice" (the tape reading)', () => {
    const { hud, container, state } = setup(P(1.8, 4, 0));
    state.terrain = [deckPiece('tall', 0, 4)];
    hud.syncFromState(state);
    clickByText(container, 'Move');
    hud.handleBoardHover({ kind: 'position', position: P(3, 0, 0) });
    expect(chip(container).textContent).toBe('Jump down 4.2" · 2 dice (3+)');
    hud.handleBoardPick({ kind: 'position', position: P(3, 0, 0) });
    const summary = confirmSummary(container);
    expect(occurrences(summary, 'Jump down 4.2" · 2 dice')).toBe(1);
    expect(summary).not.toMatch(/JUMP DOWN/);
  });

  it('a gap hop that also drops shows one jump line with the engine dice, and no separate drop warning', () => {
    const { hud, container, state } = setup(P(1.6, 8, 0));
    state.terrain = [deckPiece('up', 0, 8), deckPiece('lo', 5.2, 3.5)]; // 1.2" gap, 4.5" drop
    hud.syncFromState(state);
    clickByText(container, 'Move');
    hud.handleBoardHover({ kind: 'position', position: P(4.1, 3.5, 0) });
    const text = chip(container).textContent!;
    expect(text).toMatch(/^Jump gap 5\.1" · 2 dice \(3\+\)$/);
    hud.handleBoardPick({ kind: 'position', position: P(4.1, 3.5, 0) });
    const summary = confirmSummary(container);
    expect(occurrences(summary, 'Jump gap 5.1" · 2 dice')).toBe(1);
    expect(summary).not.toMatch(/JUMP DOWN/);
    expect(summary).not.toMatch(/dice, all|roll \d dice/);
  });

  describe('split-level squad coherency staging', () => {
    function squadOnDeck() {
      const ctx = setup(P(1.0, 3, 0));
      const { hud, container, state } = ctx;
      state.terrain = [deckPiece('d', 0, 3)];
      const unit = state.units.find((u) => u.ownerId === HOST)!;
      unit.speed = 6;
      unit.remainingMovement = 6;
      unit.models = [
        { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: P(1.0, 3, 0), rotation: P(0, 0, 0) },
        { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: P(1.5, 3, 0.8), rotation: P(0, 0, 0) },
      ] as any;
      hud.syncFromState(state);
      clickByText(container, 'Move');
      hud.handleBoardPick({ kind: 'position', position: P(0.5, 3, 0) });
      return ctx;
    }

    it('allows a ground model 3.4" from a deck model and the host agrees', () => {
      const { hud, container, controller, state } = squadOnDeck();
      expect(container.textContent).toContain('Place Model 2 of 2');
      hud.handleBoardPick({ kind: 'position', position: P(3.9, 0, 0) });
      expect(container.textContent).toContain('Confirm');
      clickByText(container, 'Confirm');
      const action = controller.submitAction.mock.calls[0][0];
      expect(action.payload.modelPositions).toHaveLength(2);
      expect(action.payload.modelPositions[1].y).toBeCloseTo(0, 1);
      const res = validateAction(state, { ...action, actorId: HOST });
      expect(res.reason ?? '').not.toMatch(/coherency|from nearest squad member/);
    });

    it('the toast explains the allowance when 3" across levels is exceeded', () => {
      const { hud, container, controller } = squadOnDeck();
      hud.handleBoardPick({ kind: 'position', position: P(5.2, 0, 0) });
      const toast = container.querySelector('.sl-hud-toast')?.textContent ?? '';
      expect(toast).toContain('different levels: 3"');
      expect(controller.submitAction).not.toHaveBeenCalled();
    });
  });

  function squadAtLedge(action: 'Move' | 'Rush' = 'Move') {
    const base = setup(P(-0.2, 3, 0), action);
    base.unit.models = [
      { id: 'm1', position: P(-0.2, 3, 0), isDestroyed: false, wounds: 0, maxWounds: 1 } as any,
      { id: 'm2', position: P(-0.9, 3, 0), isDestroyed: false, wounds: 0, maxWounds: 1 } as any,
    ];
    base.hud.syncFromState(base.state);
    clickByText(base.container, action);
    return base;
  }

  it('a squad model at the edge previews the same jump as a single model (path, segments, chip)', () => {
    const { hud, container, markers } = squadAtLedge();
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    expect(chip(container).style.display).toBe('block');
    expect(chip(container).textContent).toMatch(/^Jump gap \d\.\d" · 2 dice \(3\+\)$/);
    const path = (hud as any).movePathPreview as Vector3[];
    expect(path).toHaveLength(2);
    expect(path[0]).toMatchObject({ x: -0.2, y: 3 });
    expect(path[1]).toMatchObject({ x: 5.6, y: 3, z: -1 });
    const segs = markers[markers.length - 1].movePath!.segments!;
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('jump-gap');
  });

  it('a squad model hovering a normal spot is previewed as before (no jump chip)', () => {
    const { hud, container } = squadAtLedge();
    hud.handleBoardHover({ kind: 'position', position: P(-1.7, 3, 0) });
    expect(chip(container).textContent ?? '').not.toContain('Jump');
    expect((hud as any).moveJump).toBeNull();
  });

  describe('too-wide gap hint', () => {
    const far = P(6.7, 3, -1); // ~7" from the ledge edge, on platform A

    it('a single model hovering across a gap over 6" reads the hint and is offered no jump', () => {
      const { hud, container } = setup(P(-0.2, 3, 0));
      hud.handleBoardHover({ kind: 'position', position: far });
      expect(chip(container).style.display).toBe('block');
      expect(chip(container).textContent).toMatch(/^Too far to jump \(7\.0", max 6"\)$/);
      expect((hud as any).moveJump).toBeNull();
    });

    it('a squad model gets the same hint', () => {
      const squad = squadAtLedge();
      squad.hud.handleBoardHover({ kind: 'position', position: far });
      expect(chip(squad.container).textContent).toMatch(/^Too far to jump \(7\.0", max 6"\)$/);
      expect((squad.hud as any).moveJump).toBeNull();
    });

    it('a jumpable gap shows the normal jump chip instead', () => {
      const { hud, container } = setup(P(-0.2, 3, 0));
      hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
      expect(chip(container).textContent).toMatch(/^Jump gap/);
      expect(chip(container).textContent).not.toContain('Too far');
    });

    it('no hint when the cursor is not across a gap, and it clears when the cursor moves off', () => {
      const { hud, container } = setup(P(-0.2, 3, 0));
      hud.handleBoardHover({ kind: 'position', position: far });
      expect(chip(container).textContent).toContain('Too far');
      hud.handleBoardHover({ kind: 'position', position: P(-1.7, 3, 0) });
      expect(chip(container).textContent ?? '').not.toContain('Too far');
      expect((hud as any).moveTooWide).toBeNull();
    });
  });
});

describe('GameHUD move preview: segment styling (P6)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('the emitted path carries each segment classified by the engine, with labels', () => {
    const { hud, markers } = setup(P(-0.2, 3, 0));
    hud.handleBoardHover({ kind: 'position', position: P(5.6, 3, -1) });
    const marker = markers[markers.length - 1].movePath!;
    expect(marker.segments).toHaveLength(1);
    expect(marker.segments![0].kind).toBe('jump-gap');
    expect(marker.segments![0].label).toMatch(/^jump \d\.\d" · 2 dice$/);
  });

  it('a 3" drop onto the ground is an amber drop segment labelled with its height', () => {
    const { hud, markers, container } = setup(P(-0.2, 3, 0));
    hud.handleBoardHover({ kind: 'position', position: P(1.2, 0, 0) });
    const segs = markers[markers.length - 1].movePath!.segments!;
    const drop = segs.find((s) => s.kind === 'drop')!;
    expect(drop).toBeTruthy();
    expect(drop.label).toBe('drop 3.0"');
    expect(segs.some((s) => s.kind === 'jump-drop' || s.kind === 'jump-gap' || s.kind === 'fall')).toBe(false);
    expect(chip(container).textContent).toContain('drop 3.0"');
  });

  it('a climb is labelled with its rise in the preview and the summary', () => {
    const { hud, markers, container } = setup(P(-5, 0, -3));
    hud.handleBoardHover({ kind: 'position', position: P(-8, 2.25, -3) });
    const segs = markers[markers.length - 1].movePath!.segments!;
    expect(segs.some((s) => s.kind === 'climb' && s.label === 'climb 2.3"')).toBe(true);
    hud.handleBoardPick({ kind: 'position', position: P(-8, 2.25, -3) });
    expect(container.textContent).toContain('climb 2.3"');
  });
});

describe('GameHUD squad staging: per-model declared jumps (batch 1D PR 15)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** A 3-model squad: model 1 stands at the ledge edge, models 2 and 3 already stand on the far deck. */
  function squadSetup(action: 'Move' | 'Rush' = 'Move') {
    const base = setup(P(-0.2, 3, 0), action);
    const { state, unit, container } = base;
    const mk = (id: string, p: Vector3) => ({
      id, wounds: 1, maxWounds: 1, isDestroyed: false, position: { ...p }, rotation: { x: 0, y: 0, z: 0 },
    });
    unit.models = [mk('m1', P(-0.2, 3, 0)), mk('m2', P(5.6, 3, 0.4)), mk('m3', P(6.6, 3, -0.2))] as any;
    unit.wounds = 3;
    unit.maxWounds = 3;
    base.hud.syncFromState(state);
    clickByText(container, action);
    return base;
  }

  it('the edge model is offered the jump and the confirmed squad move declares it for that model only', () => {
    const { hud, container, controller, state } = squadSetup();
    hud.handleBoardPick({ kind: 'position', position: P(5.6, 3, -1) });
    expect(container.querySelector('.sl-hud-toast')?.textContent).toMatch(/^Model 1: Jump gap/);
    container.querySelector<HTMLButtonElement>('[data-action="confirm-squad-move"]')!.click();
    expect(container.textContent).toContain('Model 1: Jump gap');
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0][0];
    expect(action.payload.modelTraversals).toHaveLength(3);
    expect(action.payload.modelTraversals[0]).toMatchObject({ kind: 'jump-gap', takeoff: { x: -0.2, y: 3, z: 0 } });
    expect(action.payload.modelTraversals[1]).toBeNull();
    expect(action.payload.modelTraversals[2]).toBeNull();
    expect(action.payload.modelPaths[0]).toHaveLength(2);
    // the host accepts exactly what the HUD sent
    expect(validateAction(state, action)).toEqual({ valid: true });
  });

  it('a squad move with no jump carries no modelTraversals', () => {
    const { hud, container, controller } = squadSetup();
    hud.handleBoardPick({ kind: 'position', position: P(-1.7, 3, 0) });
    container.querySelector<HTMLButtonElement>('[data-action="confirm-squad-move"]')?.click();
    clickByText(container, 'Confirm');
    const action = controller.submitAction.mock.calls[0]?.[0];
    if (action) expect(action.payload.modelTraversals).toBeUndefined();
  });
});
