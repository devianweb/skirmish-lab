// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
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
  u.models.forEach((m, i) => (m.position = { ...pts[i] }));
  u.position = { ...pts[0] };
  u.isDeployed = true;
};

/**
 * The Jump Range as one side sees it. The guest's stairs are the host's mirrored (x and z flipped, yaw + pi):
 * stairs at x 9 / 3 / -5, z 12, leading onto 3" decks at z 2..10. `side` picks which player is local and moves.
 */
function setup(side: 'host' | 'guest', friendAt: Vector3[] | null, moverAt?: Vector3[]) {
  const sign = side === 'guest' ? 1 : -1;
  const me = side === 'guest' ? GUEST : HOST;
  const foeId = side === 'guest' ? HOST : GUEST;
  const state: GameState = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  state.status = 'in-progress';
  state.terrain = createJumpRangeMap().terrain;
  const army = (owner: string) => createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], owner);
  const striders = army(me)[1];
  place(striders, moverAt ?? [P(9, 0, sign * 15), P(10, 0, sign * 16), P(8, 0, sign * 16), P(9, 0, sign * 17)].map((p) => (side === 'host' ? P(-p.x, 0, p.z) : p)));
  striders.isActivated = true;
  const units = [striders];
  if (friendAt) {
    const friends = army(me)[0];
    friends.id = `${friends.id}-friend`;
    place(friends, friendAt);
    units.push(friends);
  }
  const foe = army(foeId)[0];
  foe.models.forEach((m, i) => (m.position = P(-20 + i * 2, 0, side === 'guest' ? -22 : 22)));
  foe.position = { ...foe.models[0].position! };
  foe.isDeployed = true;
  units.push(foe);
  state.units = units;
  state.turnState.activeUnitId = striders.id;
  state.turnState.currentPlayerId = me;
  state.turnState.phase = 'activation';

  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: me, controller: { submitAction: vi.fn() } });
  hud.show();
  hud.syncFromState(state);
  const internals = hud as any;
  internals.flow = { mode: 'targeting', action: 'rush' };
  internals.selectedSquadModelId = striders.models[0].id;
  internals.render();
  const toasts: string[] = [];
  internals.showToast = (msg: string) => toasts.push(msg);
  return { internals, striders, toasts };
}

function warningText(internals: any): string {
  const el = internals.root.querySelector('.sl-hud-move-warning') as HTMLElement | null;
  return el && el.style.display !== 'none' ? (el.textContent ?? '') : '';
}

const guestDeckTop =P(9, 3, 6);
const hostDeckTop = P(-9, 3, -6);

describe('GameHUD rush up mirrored stairs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('guest squad model climbs its stairs to the deck top (path ends on the deck)', () => {
    const { internals } = setup('guest', null);
    internals.handleBoardHover({ kind: 'position', position: guestDeckTop });
    const path = internals.movePathPreview as Vector3[];
    expect(path[path.length - 1]).toMatchObject({ x: 9, y: 3, z: 6 });
  });

  it('host squad model climbs the host stairs the same way', () => {
    const { internals } = setup('host', null);
    internals.handleBoardHover({ kind: 'position', position: hostDeckTop });
    const path = internals.movePathPreview as Vector3[];
    expect(path[path.length - 1]).toMatchObject({ x: -9, y: 3, z: -6 });
  });

  it('a friendly unit standing at the foot of the stairs blocks the entry: the message says so, not "height"', () => {
    const friend = [P(9, 0, 14.2), P(10.5, 0, 14.2), P(7.5, 0, 14.2), P(9, 0, 13.5)];
    const { internals } = setup('guest', friend);
    internals.handleBoardHover({ kind: 'position', position: guestDeckTop });
    const warning = warningText(internals);
    expect(warning).toMatch(/another unit|1"/i);
    expect(warning).not.toMatch(/Can't reach that height/);
  });

  it('the same layout on the host side says the same', () => {
    const friend = [P(-9, 0, -14.2), P(-10.5, 0, -14.2), P(-7.5, 0, -14.2), P(-9, 0, -13.5)];
    const { internals } = setup('host', friend);
    internals.handleBoardHover({ kind: 'position', position: hostDeckTop });
    const warning = warningText(internals);
    expect(warning).toMatch(/another unit|1"/i);
    expect(warning).not.toMatch(/Can't reach that height/);
  });

  it('clicking the blocked spot names the blocker too', () => {
    const friend = [P(9, 0, 14.2), P(10.5, 0, 14.2), P(7.5, 0, 14.2), P(9, 0, 13.5)];
    const { internals, toasts } = setup('guest', friend);
    internals.handleSquadModelPick(guestDeckTop, 'rush');
    expect(toasts[toasts.length - 1] ?? "").toMatch(/another unit/i);
    expect(internals.stagedSquadModelPositions.size).toBe(0);
  });

  it('with the friend clear of the stairs the same click stages the deck top', () => {
    const friend = [P(14, 0, 14.2), P(15, 0, 14.2), P(16, 0, 14.2), P(17, 0, 14.2)];
    const { internals, striders } = setup('guest', friend);
    internals.handleSquadModelPick(guestDeckTop, 'rush');
    expect(internals.stagedSquadModelPositions.get(striders.models[0].id)).toMatchObject({ y: 3 });
  });

  it('a Flying squad model goes straight from the ground to the deck top, in two points', () => {
    const { internals, striders } = setup('guest', null);
    striders.specialRules = ['flying'];
    internals.handleBoardHover({ kind: 'position', position: P(4, 3, 8) });
    const path = internals.movePathPreview as Vector3[];
    expect(path).toHaveLength(2);
    expect(path[1]).toMatchObject({ x: 4, y: 3, z: 8 });
  });
});
