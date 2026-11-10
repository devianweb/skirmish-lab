// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
import type { MarkerSnapshot } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  STARTER_ARMIES,
  Unit,
  Vector3,
  createInitialGameState,
  createJumpRangeMap,
  createUnitsFromStarterArmy,
} from '@skirmish-lab/shared';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

const place = (u: Unit, pts: Vector3[]) => {
  u.models.forEach((m, i) => (m.position = { ...pts[i % pts.length] }));
  u.position = { ...pts[0] };
  u.isDeployed = true;
};

type Role = 'jumpers' | 'striders' | 'flyers';
const ROLE_INDEX: Record<Role, number> = { jumpers: 0, striders: 1, flyers: 2 };

/**
 * The Jump Range from the guest's side (stairs at x 9 / 3 / -5, z 12 leading onto 3" decks at z 2..10), with the
 * local player's `mover` in the given flow and optional bystander units (friend or foe).
 */
function setup(
  mover: Role,
  moverAt: Vector3[],
  flowAction: 'move' | 'rush' | 'charge',
  others: Array<{ role: Role; owner: 'me' | 'foe'; at: Vector3[] }> = []
) {
  const me = GUEST;
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.status = 'in-progress';
  state.terrain = createJumpRangeMap().terrain;
  const army = (owner: string) => createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], owner);
  const unit = army(me)[ROLE_INDEX[mover]];
  place(unit, moverAt);
  unit.isActivated = true;
  const units: Unit[] = [unit];
  others.forEach((o, i) => {
    const u = army(o.owner === 'me' ? me : HOST)[ROLE_INDEX[o.role]];
    u.id = `${u.id}-other${i}`;
    place(u, o.at);
    units.push(u);
  });
  state.units = units;
  state.turnState.activeUnitId = unit.id;
  state.turnState.currentPlayerId = me;
  state.turnState.phase = 'activation';

  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: me, controller: { submitAction: vi.fn() } });
  hud.show();
  hud.syncFromState(state);
  const internals = hud as any;
  internals.flow = { mode: 'targeting', action: flowAction };
  internals.selectedSquadModelId = unit.models[0].id;
  internals.render();
  const emitted: MarkerSnapshot[] = [];
  hud.onMarkers((m) => emitted.push(m));
  return { hud, internals, unit, state, emitted };
}

function warningText(internals: any): string {
  const el = internals.root.querySelector('.sl-hud-move-warning') as HTMLElement | null;
  return el && el.style.display !== 'none' ? (el.textContent ?? '') : '';
}

const lastPath = (emitted: MarkerSnapshot[]) => emitted[emitted.length - 1]?.movePath;
const STRIDER_START = [P(9, 0, 15), P(10, 0, 16), P(8, 0, 16), P(9, 0, 17)];
const FRIEND_NEAR_HEAD = [P(10.8, 3, 9), P(12, 3, 9), P(13, 3, 9), P(14, 3, 9)];
const HEAD = P(9, 3, 9.8);
const FLYER_START = [P(9, 0, 15), P(10, 0, 16), P(8, 0, 16), P(9, 0, 17)];

const rubble = (x: number, z: number, w: number, d: number) =>
  ({
    id: 'rubble',
    terrainType: 'rubble-field',
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: w, y: 0.25, z: d },
    blocksLineOfSight: false,
    providesCover: true,
    isObstacle: false,
    isWalkable: false,
    isDifficult: true,
  }) as any;

describe('flying indicator on the move preview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it.each(['move', 'rush'] as const)('a Flying unit planning an %s gets a Flying chip and a flying path line', (action) => {
    const { internals, emitted } = setup('flyers', FLYER_START, action);
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, 11) });
    expect(warningText(internals)).toMatch(/^Flying · \d+\.\d" · over terrain/);
    expect(lastPath(emitted)?.flying).toBe(true);
  });

  it('the chip reports the engine movement cost of the previewed path', () => {
    const { internals } = setup('flyers', FLYER_START, 'move');
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, 12) });
    expect(warningText(internals)).toContain('Flying · 3.0"');
  });

  it('a unit that walks gets no Flying chip and an ordinary line', () => {
    const { internals, emitted } = setup('striders', STRIDER_START, 'move');
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, 12) });
    expect(warningText(internals)).not.toMatch(/Flying/);
    expect(lastPath(emitted)?.flying).toBeUndefined();
  });

  it('Flying squad charge legs are drawn as flying too', () => {
    const { internals, emitted, state, unit } = setup('flyers', FLYER_START, 'charge', [
      { role: 'jumpers', owner: 'foe', at: [P(9, 0, 2), P(10, 0, 2), P(11, 0, 2), P(12, 0, 2)] },
    ]);
    state.turnState.charge = { unitId: unit.id, targetId: state.units[1].id, legs: 0 };
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, 11) });
    expect(lastPath(emitted)?.flying).toBe(true);
    expect(warningText(internals)).toMatch(/^Flying · /);
  });
});

describe('stop note on the move preview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it.each(['rush', 'move'] as const)(
    'a Strider squad model heading up a stair whose head is within 1" of a friendly unit stops and names it (%s)',
    (action) => {
      const { internals, emitted, state, unit } = setup('striders', STRIDER_START, action, [
        { role: 'jumpers', owner: 'me', at: FRIEND_NEAR_HEAD },
      ]);
      const friend = state.units[1];
      unit.speed = 12; // the stair climb alone costs more than an Advance of 6"
      unit.remainingMovement = 12;
      internals.handleBoardHover({ kind: 'position', position: HEAD });
      const text = warningText(internals);
      expect(text).toContain(`Stopped: within 1" of ${friend.name} (keep-away)`);
      expect(text).not.toMatch(/Can't climb|stairs or a ladder/);
      const stop = lastPath(emitted)?.stop;
      expect(stop?.text).toContain(friend.name);
      const path = internals.movePathPreview as Vector3[];
      expect(stop?.at).toMatchObject({ x: path[path.length - 1].x, z: path[path.length - 1].z });
    }
  );

  it('with the friend clear of the stair head there is no stop note and no stop marker', () => {
    const { internals, emitted } = setup('striders', STRIDER_START, 'rush', [
      { role: 'jumpers', owner: 'me', at: [P(14, 3, 3), P(15, 3, 3), P(16, 3, 3), P(17, 3, 3)] },
    ]);
    internals.handleBoardHover({ kind: 'position', position: HEAD });
    expect(warningText(internals)).not.toMatch(/Stopped/);
    expect(lastPath(emitted)?.stop).toBeUndefined();
  });

  it('an enemy unit works the same way: the note names it', () => {
    const { internals, state, unit } = setup('striders', STRIDER_START, 'move', [
      { role: 'jumpers', owner: 'foe', at: [P(10.8, 3, 9), P(12, 3, 3), P(13, 3, 3), P(14, 3, 3)] },
    ]);
    unit.speed = 12;
    unit.remainingMovement = 12;
    internals.handleBoardHover({ kind: 'position', position: HEAD });
    expect(warningText(internals)).toContain(`within 1" of ${state.units[1].name}`);
  });

  it('a move that uses the whole allowance says out of movement', () => {
    const { internals, emitted } = setup('striders', STRIDER_START, 'move');
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, -10) });
    expect(warningText(internals)).toBe('Stopped: out of movement');
    expect(lastPath(emitted)?.stop?.text).toBe('Stopped: out of movement');
  });

  it('a path that reaches the cursor has no stop note', () => {
    const { internals, emitted } = setup('striders', STRIDER_START, 'move');
    internals.handleBoardHover({ kind: 'position', position: P(5, 0, 15) });
    expect(warningText(internals)).not.toMatch(/Stopped/);
    expect(lastPath(emitted)?.stop).toBeUndefined();
  });

  it('moving out of difficult ground names the 6" cap when it, not the allowance, ended the move', () => {
    const { internals, state, unit } = setup('jumpers', [P(-14, 0, 14), P(-15, 0, 14), P(-16, 0, 14), P(-17, 0, 14)], 'rush');
    state.terrain = [rubble(-15, 14, 8, 8)];
    unit.speed = 6;
    internals.handleBoardHover({ kind: 'position', position: P(5, 0, 14) });
    expect(warningText(internals)).toMatch(/Stopped: difficult terrain caps the move at 6"/);
  });

  it('a Rush that halts at the edge of difficult ground says so once', () => {
    const { internals, state } = setup('jumpers', FLYER_START, 'rush');
    state.terrain = [rubble(9, 8, 8, 4)];
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, 2) });
    const text = warningText(internals);
    expect(text).toMatch(/edge of difficult terrain/i);
    expect((text.match(/edge of difficult terrain/gi) ?? []).length).toBe(1);
  });

  it('a unit aiming at a deck it cannot climb to says to use stairs or a ladder', () => {
    const { internals, state } = setup('jumpers', [P(13, 0, 6), P(13, 0, 7), P(13, 0, 5), P(14, 0, 6)], 'move');
    state.terrain = state.terrain.filter((t) => t.id === 'jr-platform-small-2'); // a bare deck: no stairs or ladder
    internals.handleBoardHover({ kind: 'position', position: P(10, 3, 6) });
    expect(warningText(internals)).toContain("Stopped: can't climb there (use stairs or a ladder)");
  });

  it('a squad charge leg that runs out of movement says so, with a marker', () => {
    const { internals, emitted, state, unit } = setup('striders', STRIDER_START, 'charge', [
      { role: 'jumpers', owner: 'foe', at: [P(9, 0, -12), P(10, 0, -12), P(11, 0, -12), P(12, 0, -12)] },
    ]);
    state.turnState.charge = { unitId: unit.id, targetId: state.units[1].id, legs: 0 };
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, -9) });
    expect(warningText(internals)).toMatch(/Stopped: out of movement/);
    expect(lastPath(emitted)?.stop?.text).toBe('Stopped: out of movement');
  });

  it('a single-model unit planning a charge leg gets the same note', () => {
    const { internals, state, unit } = setup('striders', [P(9, 0, 15)], 'charge', [
      { role: 'jumpers', owner: 'foe', at: [P(9, 0, -12), P(10, 0, -12)] },
    ]);
    unit.models = [];
    state.turnState.charge = { unitId: unit.id, targetId: state.units[1].id, legs: 0 };
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, -9) });
    expect(warningText(internals)).toMatch(/Stopped: out of movement/);
  });

  it('the note disappears when the cursor leaves the board', () => {
    const { internals, emitted } = setup('striders', STRIDER_START, 'move');
    internals.handleBoardHover({ kind: 'position', position: P(9, 0, -10) });
    internals.handleBoardHover(null);
    expect(warningText(internals)).toBe('');
    expect(lastPath(emitted)?.stop).toBeUndefined();
  });
});
