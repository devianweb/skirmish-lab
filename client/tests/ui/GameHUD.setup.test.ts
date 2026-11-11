// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  Unit,
  applyAction,
  applyDefaultScenario,
  beginAmbushStep,
  createAction,
  createBlankMap,
  createInitialGameState,
  createSquadPositions,
  hasTrait,
} from '@skirmish-lab/shared';
import { d6, playObjectivesPhase, rollOffDice } from '../../../shared/tests/fixtures/setupFlow';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

/** A 48x48 open board with both players on the Scout & Ambush check army, in the objectives phase (no roll yet). */
function freshSetup(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, {
    customMap: { ...createBlankMap(), id: 'open', terrain: [] },
    hostArmyId: 'test-scout-ambush-army',
    guestArmyId: 'test-scout-ambush-army',
    useDeploymentPhase: true,
  });
  return state;
}

/** The objectives phase after the host's roll: 4 objectives (d6 = 3), Host wins the mission roll-off. */
function afterRoll(missionWinner: 'host' | 'guest' = 'host'): GameState {
  const s = freshSetup();
  const out = applyAction(s, createAction(HOST, 'roll-objectives', { type: 'roll-objectives' }), [
    d6(3, 'objective-count'),
    rollOffDice(missionWinner, 'mission-roll-off'),
  ]);
  if (!out.ok) throw new Error(out.reason);
  return out.state;
}

function setup(localPlayerId: string, state: GameState) {
  const controller = { submitAction: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId, controller });
  hud.show();
  const markers: MarkerSnapshot[] = [];
  hud.onMarkers((m) => markers.push(m));
  hud.syncFromState(state);
  return { hud, controller, container, markers, last: () => markers[markers.length - 1] };
}

/** Put every living model of the unit on the table around `x`, `z`. */
function placeUnit(unit: Unit, x: number, z: number): void {
  unit.isDeployed = true;
  unit.position = { x, y: 0, z };
  const spots = createSquadPositions(unit.position, unit.models.length);
  unit.models.forEach((m, i) => {
    m.position = spots[i];
  });
}

const unitsOf = (state: GameState, playerId: string) => state.units.filter((u) => u.ownerId === playerId);
const byName = (state: GameState, playerId: string, name: string) =>
  unitsOf(state, playerId).find((u) => u.name.startsWith(name))!;

describe('GameHUD setup: objective roll and roll-off announcements', () => {
  it('shows the objective count roll and the mission roll-off pairs with who won', () => {
    const { container } = setup(GUEST, afterRoll('host'));
    const panel = container.querySelector('[data-setup-rolls]')!;
    expect(panel).toBeTruthy();
    expect(panel.querySelector('[data-setup-roll="objective-count"]')!.textContent).toContain('Objective roll: 3 — 4 objectives');
    const mission = panel.querySelector('[data-setup-roll="mission"]')!.textContent!;
    expect(mission).toContain('Alice (Host) wins and places the first objective');
    expect(mission).toContain('6–1'); // the deciding pair, host die first
    expect(mission).toContain('pair 1 decided it: 6 against 1');
  });

  it('announces a tied roll-off as a Host win', () => {
    const s = freshSetup();
    const out = applyAction(s, createAction(HOST, 'roll-objectives', { type: 'roll-objectives' }), [
      d6(1, 'objective-count'),
      rollOffDice('tie', 'mission-roll-off'),
    ]);
    if (!out.ok) throw new Error(out.reason);
    const { container } = setup(HOST, out.state);
    const mission = container.querySelector('[data-setup-roll="mission"]')!.textContent!;
    expect(mission).toContain('all ten pairs tied, so the Host wins');
    expect(container.querySelector('[data-setup-roll="objective-count"]')!.textContent).toContain('3 objectives');
  });

  it('announces who deploys first once the last objective is placed, with a toast', () => {
    const state = playObjectivesPhase(freshSetup(), { deploymentWinner: 'guest' });
    expect(state.turnState.phase).toBe('deployment');
    const { container } = setup(HOST, state);
    const text = container.querySelector('[data-setup-roll="deployment"]')!.textContent!;
    expect(text).toContain('Bob (Guest) deploys first');
    expect(container.querySelector('.sl-hud-toast')?.textContent).toContain('Bob (Guest) deploys first');
    expect(container.querySelector('.sl-hud-turn')?.textContent).toContain("Bob's turn to deploy");
  });

  it('hides the panel once the first round starts', () => {
    const state = playObjectivesPhase(freshSetup());
    state.turnState.phase = 'activation';
    state.turnState.roundNumber = 1;
    const { container } = setup(HOST, state);
    expect(container.querySelector('[data-setup-rolls]')).toBeNull();
  });
});

describe('GameHUD setup: objective placement', () => {
  it('prompts the roll-off winner and tells the other player to wait', () => {
    const placer = setup(HOST, afterRoll('host')).container;
    expect(placer.querySelector('.sl-hud-deploy-prompt')!.textContent).toContain('Place objective 1 of 4');
    const waiting = setup(GUEST, afterRoll('host')).container;
    expect(waiting.querySelector('.sl-hud-deploy-prompt')!.textContent).toContain('Waiting for Alice to place objective 1 of 4');
  });

  it('says it is still rolling before the host\'s roll arrives', () => {
    const { container } = setup(HOST, freshSetup());
    expect(container.querySelector('.sl-hud-deploy-prompt')!.textContent).toContain('Rolling for the number of objectives');
  });

  it('previews the spot under the cursor: green where legal, red with the reason inside a deployment zone', () => {
    const { hud, container, last } = setup(HOST, afterRoll());

    hud.handleBoardHover({ kind: 'position', position: { x: 0, y: 0, z: 0 } });
    expect(last().placement!.cursor).toMatchObject({ valid: true, radius: 0.5 });
    expect(container.querySelector('.sl-hud-placement-hint')!.textContent).toBe('');

    hud.handleBoardHover({ kind: 'position', position: { x: 0, y: 0, z: -18 } });
    expect(last().placement!.cursor!.valid).toBe(false);
    const hint = container.querySelector('.sl-hud-placement-hint')!;
    expect(hint.textContent).toContain('deployment zone');
    expect(hint.classList.contains('bad')).toBe(true);
  });

  it('shades both deployment zones while objectives are placed', () => {
    const { last } = setup(HOST, afterRoll());
    const zones = last().deploymentZones!;
    expect(zones.hostZone.maxZ).toBe(-12);
    expect(zones.guestZone.minZ).toBe(12);
  });

  it('draws a 9" circle around each placed objective and rejects a spot inside one', () => {
    let state = afterRoll();
    const placed = applyAction(state, createAction(HOST, 'place-objective', { type: 'place-objective', position: { x: 0, y: 0, z: 0 } }));
    if (!placed.ok) throw new Error(placed.reason);
    state = placed.state;
    const { hud, last } = setup(GUEST, state);

    expect(last().placement!.circles).toEqual([{ x: 0, y: 0, z: 0, radius: 9, kind: 'spacing' }]);
    hud.handleBoardHover({ kind: 'position', position: { x: 5, y: 0, z: 0 } });
    expect(last().placement!.cursor!.valid).toBe(false);
    hud.handleBoardHover({ kind: 'position', position: { x: 10, y: 0, z: 0 } });
    expect(last().placement!.cursor!.valid).toBe(true);
  });

  it('refuses an illegal click with the reason and sends nothing', () => {
    const { hud, controller, container } = setup(HOST, afterRoll());
    hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 18 } });
    expect(container.querySelector('.sl-hud-toast')!.textContent).toContain('deployment zone');
    expect(container.querySelector('.sl-hud-confirm')).toBeNull();
    expect(controller.submitAction).not.toHaveBeenCalled();
  });

  it('a legal click stages "objective n of N", and Confirm sends place-objective', () => {
    const { hud, controller, container } = setup(HOST, afterRoll());
    hud.handleBoardPick({ kind: 'position', position: { x: 3, y: 0, z: 2 } });
    expect(container.querySelector('.sl-hud-confirm')!.textContent).toContain('Place objective 1 of 4');
    (container.querySelector('button[data-action="confirm"]') as HTMLButtonElement).click();
    expect(controller.submitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'place-objective', actorId: HOST, payload: expect.objectContaining({ position: { x: 3, y: 0, z: 2 } }) })
    );
  });

  it('the staged spot keeps a green ring on the board until confirmed', () => {
    const { hud, last } = setup(HOST, afterRoll());
    hud.handleBoardPick({ kind: 'position', position: { x: 3, y: 0, z: 2 } });
    expect(last().placement!.cursor).toMatchObject({ position: { x: 3, y: 0, z: 2 }, valid: true });
  });

  it('the player who is waiting cannot place and sees no preview ring', () => {
    const { hud, controller, container, last } = setup(GUEST, afterRoll('host'));
    hud.handleBoardHover({ kind: 'position', position: { x: 0, y: 0, z: 0 } });
    expect(last().placement!.cursor ?? null).toBeNull();
    hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 0 } });
    expect(container.querySelector('.sl-hud-toast')!.textContent).toContain('Wait for opponent to place an objective');
    expect(controller.submitAction).not.toHaveBeenCalled();
  });
});

describe('GameHUD setup: Scouts in deployment', () => {
  function deployment(): GameState {
    return playObjectivesPhase(freshSetup(), { deploymentWinner: 'host' });
  }

  it('a Scout unit offers Deploy now and Hold as Scout; an ordinary unit does not', () => {
    const state = deployment();
    const scouts = byName(state, HOST, 'Test Scouts');
    const { hud, container } = setup(HOST, state);

    // The first waiting unit is an ordinary one: no choice
    expect(container.querySelector('[data-action="hold-scout"]')).toBeNull();

    (container.querySelector(`.sl-hud-unit[data-unit-id="${scouts.id}"]`) as HTMLElement).click();
    expect(container.querySelector('[data-action="scout-deploy-now"]')!.textContent).toBe('Deploy now');
    expect(container.querySelector('[data-action="hold-scout"]')!.textContent).toBe('Hold as Scout');
    hud.dispose();
  });

  it('Hold as Scout asks for confirmation and then sends hold-scout', () => {
    const state = deployment();
    const scouts = byName(state, HOST, 'Test Scouts');
    const { controller, container } = setup(HOST, state);
    (container.querySelector(`.sl-hud-unit[data-unit-id="${scouts.id}"]`) as HTMLElement).click();
    (container.querySelector('[data-action="hold-scout"]') as HTMLButtonElement).click();
    expect(container.querySelector('.sl-hud-confirm')!.textContent).toContain('Hold Test Scouts 3 back as a Scout');
    (container.querySelector('button[data-action="confirm"]') as HTMLButtonElement).click();
    expect(controller.submitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hold-scout', actorId: HOST, payload: { type: 'hold-scout', unitId: scouts.id } })
    );
  });

  it('Deploy now just deploys the Scout like any other unit inside the zone', () => {
    const state = deployment();
    const scouts = byName(state, HOST, 'Test Scouts');
    const { hud, controller, container } = setup(HOST, state);
    (container.querySelector(`.sl-hud-unit[data-unit-id="${scouts.id}"]`) as HTMLElement).click();
    hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -16 } });
    (container.querySelector('button[data-action="confirm"]') as HTMLButtonElement).click();
    expect(controller.submitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'deploy-unit', payload: expect.objectContaining({ unitId: scouts.id }) })
    );
    // ... but not past the zone, where only a held Scout may go
    hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: -8 } });
    expect(container.querySelector('.sl-hud-toast')!.textContent).toContain('outside');
  });

  it('a held Scout is tagged in the roster and is placed in the Scout stage with the wider zone and the 9" circles', () => {
    const state = deployment();
    // Everything but the held Scouts is down: the enemy's ordinary unit stands at z = 14, a Scout of theirs at z = 10
    for (const u of state.units) {
      if (hasTrait(u.specialRules, 'ambush')) continue;
      if (u.ownerId === HOST && u.name.startsWith('Test Scouts')) {
        u.heldAsScout = true;
        continue;
      }
      if (u.ownerId === HOST && u.name.startsWith('Test Outriders')) {
        placeUnit(u, -6, -16);
        continue;
      }
      if (u.ownerId === HOST) placeUnit(u, u.name.startsWith('Test Line Troops') ? 6 : -12, -20);
      else if (u.name.startsWith('Test Outriders')) placeUnit(u, 14, 10);
      else placeUnit(u, u.name.startsWith('Test Guard') ? 0 : -14, 16);
    }
    for (const u of unitsOf(state, GUEST)) {
      if (u.name.startsWith('Test Scouts')) u.heldAsScout = false;
    }
    byName(state, GUEST, 'Test Scouts').isDeployed = true;
    placeUnit(byName(state, GUEST, 'Test Scouts'), 14, 14);
    state.turnState.scoutStage = true;
    state.turnState.currentPlayerId = HOST;

    const { hud, container, last } = setup(HOST, state);
    const row = container.querySelector(`.sl-hud-unit[data-unit-id="${byName(state, HOST, 'Test Scouts').id}"]`)!;
    expect(row.textContent).toContain('HELD AS SCOUT');
    expect(container.querySelector('.sl-hud-deploy-prompt')!.textContent).toContain('Placing Scout');
    expect(container.querySelector('[data-action="hold-scout"]')).toBeNull(); // already held

    // The Scout zone preview reaches 9" past the host zone (z = -12 + 9 = -3)
    expect(last().deploymentZones!.previewUnitZone!.maxZ).toBe(-3);
    // The circles: only enemy models that aren't Scouts (Test Line Troops/Guard/Lurkers... the deployed ones) are 9" no-go
    const ordinaryEnemyModels = state.units
      .filter((u) => u.ownerId === GUEST && u.isDeployed && !hasTrait(u.specialRules, 'scout'))
      .reduce((n, u) => n + u.models.length, 0);
    const circles = last().placement!.circles;
    expect(circles).toHaveLength(ordinaryEnemyModels);
    expect(circles.every((c) => c.kind === 'exclusion' && c.radius === 10)).toBe(true); // 9 + two base radii of 0.5

    // Hovering shows the legality: well inside the Scout zone is fine, near an ordinary enemy unit is not
    hud.handleBoardHover({ kind: 'position', position: { x: -20, y: 0, z: -6 } });
    expect(last().placement!.cursor!.valid).toBe(true);
    hud.handleBoardHover({ kind: 'position', position: { x: 0, y: 0, z: -6 } });
    expect(last().placement!.cursor!.valid).toBe(true);
    hud.handleBoardHover({ kind: 'position', position: { x: 0, y: 0, z: 9 } });
    expect(last().placement!.cursor!.valid).toBe(false);
  });
});

describe('GameHUD setup: Ambush step', () => {
  /** Round 2 with every non-Ambush unit down; the Ambush step open for the host (first player). */
  function ambushRound(): GameState {
    const state = playObjectivesPhase(freshSetup(), { deploymentWinner: 'host' });
    for (const u of state.units) {
      if (hasTrait(u.specialRules, 'ambush')) continue;
      if (u.ownerId === HOST) placeUnit(u, u.name.startsWith('Test Line Troops') ? 6 : -6, -18);
      else placeUnit(u, u.name.startsWith('Test Line Troops') ? 6 : -6, 18);
    }
    state.turnState.phase = 'activation';
    state.turnState.roundNumber = 2;
    state.turnState.startingPlayerId = HOST;
    state.turnState.currentPlayerId = HOST;
    beginAmbushStep(state);
    return state;
  }

  it('the placer sees the prompt, the Skip button and the reserve tag; the other player waits', () => {
    const state = ambushRound();
    expect(state.turnState.ambushStep).toBeTruthy();
    const mine = setup(HOST, state).container;
    expect(mine.querySelector('.sl-hud-deploy-prompt')!.textContent).toContain('Ambush');
    expect(mine.querySelector('.sl-hud-turn')!.textContent).toContain('place Ambush units');
    expect(mine.querySelector('[data-action="skip-ambush"]')!.textContent).toBe('Skip (wait for a later round)');
    const reserveRows = Array.from(mine.querySelectorAll('.sl-hud-unit.team-blue')).filter((r) =>
      r.textContent!.includes('IN RESERVE (AMBUSH)')
    );
    expect(reserveRows).toHaveLength(2);
    expect(reserveRows.every((r) => r.classList.contains('deployable'))).toBe(true);

    const theirs = setup(GUEST, ambushRound()).container;
    expect(theirs.querySelector('.sl-hud-deploy-prompt')!.textContent).toContain('Waiting for Alice to place Ambush units');
    expect(theirs.querySelector('[data-action="skip-ambush"]')).toBeNull();
    // The enemy's reserve is listed too
    expect(Array.from(theirs.querySelectorAll('.sl-hud-unit.enemy')).filter((r) => r.textContent!.includes('IN RESERVE (AMBUSH)'))).toHaveLength(2);
  });

  it('Skip asks for confirmation (it is a real choice) and sends skip-ambush', () => {
    const { controller, container } = setup(HOST, ambushRound());
    (container.querySelector('[data-action="skip-ambush"]') as HTMLButtonElement).click();
    expect(container.querySelector('.sl-hud-confirm')!.textContent).toContain('Skip placing Ambush units');
    expect(container.querySelector('[data-action="cancel"]')).toBeTruthy();
    (container.querySelector('button[data-action="confirm"]') as HTMLButtonElement).click();
    expect(controller.submitAction).toHaveBeenCalledWith(expect.objectContaining({ type: 'skip-ambush', actorId: HOST }));
  });

  it('draws an exclusion circle around every enemy model and judges spots by the 9" rule', () => {
    const state = ambushRound();
    const { hud, last } = setup(HOST, state);
    const enemyModels = state.units.filter((u) => u.ownerId === GUEST && u.isDeployed).reduce((n, u) => n + u.models.length, 0);
    const circles = last().placement!.circles;
    expect(circles).toHaveLength(enemyModels);
    expect(circles.every((c) => c.kind === 'exclusion' && c.radius === 10)).toBe(true);
    // The Ambush step has no shaded deployment zones
    expect(last().deploymentZones ?? null).toBeNull();

    hud.handleBoardHover({ kind: 'position', position: { x: -20, y: 0, z: 0 } });
    expect(last().placement!.cursor!.valid).toBe(true);
    hud.handleBoardHover({ kind: 'position', position: { x: 0, y: 0, z: 12 } });
    expect(last().placement!.cursor!.valid).toBe(false);
  });

  it('a legal click stages the arrival and Confirm sends deploy-unit; an illegal one is refused with the reason', () => {
    const { hud, controller, container } = setup(HOST, ambushRound());
    hud.handleBoardPick({ kind: 'position', position: { x: 0, y: 0, z: 14 } });
    expect(container.querySelector('.sl-hud-toast')!.textContent).toContain('more than 9"');
    expect(controller.submitAction).not.toHaveBeenCalled();

    hud.handleBoardPick({ kind: 'position', position: { x: -20, y: 0, z: 0 } });
    expect(container.querySelector('.sl-hud-confirm')!.textContent).toContain('Bring in');
    (container.querySelector('button[data-action="confirm"]') as HTMLButtonElement).click();
    expect(controller.submitAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'deploy-unit', payload: expect.objectContaining({ position: { x: -20, y: 0, z: 0 } }) })
    );
  });
});
