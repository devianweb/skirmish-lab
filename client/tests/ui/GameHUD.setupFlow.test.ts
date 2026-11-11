// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
import {
  GameAction,
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  Vector3,
  applyAction,
  applyDefaultScenario,
  createAction,
  createBlankMap,
  createInitialGameState,
  endRound,
  getDiceSpecs,
  hasTrait,
  validateAction,
} from '@skirmish-lab/shared';
import { d6, rollOffDice } from '../../../shared/tests/fixtures/setupFlow';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

/**
 * Two real HUDs wired to one engine: whatever a HUD submits is applied (with fixed dice) and both HUDs re-sync, like
 * the host/guest round trip. Proves the whole setup flow can be driven from the HUD alone.
 */
function twoPlayerTable() {
  let state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, {
    customMap: { ...createBlankMap(), id: 'open', terrain: [] },
    hostArmyId: 'test-scout-ambush-army',
    guestArmyId: 'test-scout-ambush-army',
    useDeploymentPhase: true,
  });
  const log: string[] = [];
  const huds: Record<string, GameHUD> = {};
  const syncAll = () => Object.values(huds).forEach((h) => h.syncFromState(state));

  const submit = (action: GameAction): void => {
    const check = validateAction(state, action);
    if (!check.valid) throw new Error(`host rejects ${action.type}: ${check.reason}`);
    const specs = getDiceSpecs(state, action);
    let dice;
    if (specs) {
      dice = specs.map((spec) =>
        spec.purpose === 'objective-count'
          ? d6(5, spec.purpose)
          : rollOffDice(spec.purpose === 'deployment-roll-off' ? 'guest' : 'host', spec.purpose ?? '')
      );
    }
    const out = applyAction(state, action, dice);
    if (!out.ok) throw new Error(`${action.type} failed: ${out.reason}`);
    log.push(action.type);
    state = out.state;
    syncAll();
  };

  for (const id of [HOST, GUEST]) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hud = new GameHUD(container, { localPlayerId: id, controller: { submitAction: submit } });
    hud.show();
    huds[id] = hud;
  }
  syncAll();
  return { huds, log, get state() { return state; }, set state(s: GameState) { state = s; syncAll(); }, submit, syncAll };
}

const root = (hud: GameHUD): HTMLElement => (hud as any).root as HTMLElement;
const click = (hud: GameHUD, selector: string): void => (root(hud).querySelector(selector) as HTMLElement).click();

/** The first spot of a coarse grid where the HUD's own toast stays quiet (the HUD accepts it). */
function pickAndConfirm(hud: GameHUD, spots: Vector3[]): void {
  for (const position of spots) {
    hud.handleBoardPick({ kind: 'position', position });
    if (root(hud).querySelector('.sl-hud-confirm')) {
      click(hud, 'button[data-action="confirm"]');
      return;
    }
  }
  throw new Error('no spot accepted by the HUD');
}

function grid(zFrom: number, zTo: number): Vector3[] {
  const spots: Vector3[] = [];
  for (let z = zFrom; z !== zTo; z += zFrom < zTo ? 1 : -1) {
    for (let x = -22; x <= 22; x += 3) spots.push({ x, y: 0, z });
  }
  return spots;
}

describe('a full setup played through the HUD', () => {
  it('objectives, deployment with a held Scout, the Scout stage, then the Ambush step in round 2', () => {
    const table = twoPlayerTable();
    const { huds } = table;

    // The host's auto roll (GameManager does this on the host)
    table.submit(createAction(HOST, 'roll-objectives', { type: 'roll-objectives' }));
    expect(table.state.setupRolls!.objectiveCount).toBe(5); // d6 of 5: ceil(5 / 2) + 2
    expect(root(huds[GUEST]).textContent).toContain('Objective roll: 5 — 5 objectives');

    // Objectives: the Host won the roll-off and the two players alternate until five markers are down
    for (let i = 0; i < 5; i++) {
      const placer = table.state.turnState.currentPlayerId;
      expect(root(huds[placer]).querySelector('.sl-hud-deploy-prompt')!.textContent).toContain(`Place objective ${i + 1} of 5`);
      const other = placer === HOST ? GUEST : HOST;
      expect(root(huds[other]).querySelector('.sl-hud-deploy-prompt')!.textContent).toContain(`to place objective ${i + 1} of 5`);
      pickAndConfirm(huds[placer], [...grid(-8, 9)]);
    }
    expect(table.state.objectives).toHaveLength(5);
    expect(table.state.turnState.phase).toBe('deployment');
    // The Guest won the deployment roll-off and deploys first
    expect(table.state.turnState.currentPlayerId).toBe(GUEST);
    expect(root(huds[HOST]).textContent).toContain('Bob (Guest) deploys first');

    // Deployment: each player deploys the ordinary and Scout units; the Host holds its Test Scouts back
    let heldHostScouts = false;
    for (let guard = 0; guard < 20 && table.state.turnState.phase === 'deployment' && !table.state.turnState.scoutStage; guard++) {
      const current = table.state.turnState.currentPlayerId;
      const hud = huds[current];
      const zone = current === HOST ? grid(-24, -11) : grid(24, 11);
      const waiting = table.state.units.filter(
        (u) => u.ownerId === current && u.isDeployed === false && !u.heldAsScout && !hasTrait(u.specialRules, 'ambush')
      );
      const scouts = waiting.find((u) => u.name.startsWith('Test Scouts'));
      if (current === HOST && scouts && !heldHostScouts) {
        click(hud, `.sl-hud-unit[data-unit-id="${scouts.id}"]`);
        click(hud, '[data-action="hold-scout"]');
        click(hud, 'button[data-action="confirm"]');
        heldHostScouts = true;
        continue;
      }
      pickAndConfirm(hud, zone);
    }
    expect(heldHostScouts).toBe(true);

    // Scout stage: only the held Scouts are left, placed up to 9" past the zone, the round-1 first player starting
    expect(table.state.turnState.scoutStage).toBe(true);
    // The Guest (round-1 first player) has nothing held back, so the Host places its Scouts
    expect(table.state.turnState.currentPlayerId).toBe(HOST);
    const heldScouts = table.state.units.find((u) => u.ownerId === HOST && u.heldAsScout)!;
    expect(root(huds[HOST]).querySelector(`.sl-hud-unit[data-unit-id="${heldScouts.id}"]`)!.textContent).toContain('HELD AS SCOUT');
    for (let guard = 0; guard < 6 && table.state.turnState.scoutStage; guard++) {
      const current = table.state.turnState.currentPlayerId;
      expect(root(huds[current]).querySelector('.sl-hud-deploy-prompt')!.textContent).toContain('Placing Scout');
      pickAndConfirm(huds[current], current === HOST ? grid(-12, -2) : grid(12, 2));
    }
    expect(table.state.turnState.phase).toBe('activation');
    expect(table.state.turnState.roundNumber).toBe(1);
    expect(table.state.units.filter((u) => !hasTrait(u.specialRules, 'ambush')).every((u) => u.isDeployed)).toBe(true);
    expect(table.state.units.filter((u) => hasTrait(u.specialRules, 'ambush')).every((u) => u.isDeployed === false)).toBe(true);

    // End of round 1 -> round 2 opens the Ambush step for the new first player
    const s = structuredClone(table.state);
    s.turnState.currentPlayerId = HOST; // the Host made the last activation, so the Guest activates first
    endRound(s);
    table.state = s;
    expect(s.turnState.roundNumber).toBe(2);
    expect(s.turnState.ambushStep).toBeTruthy();
    const first = s.turnState.currentPlayerId;
    const second = first === HOST ? GUEST : HOST;
    expect(root(huds[first]).querySelector('[data-action="skip-ambush"]')).toBeTruthy();
    expect(root(huds[second]).querySelector('[data-action="skip-ambush"]')).toBeNull();

    // First player brings a unit in far from the enemy (a spot the HUD accepts); the other skips
    const spots: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: -20, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 0, y: 0, z: 6 }, { x: 0, y: 0, z: -6 }];
    pickAndConfirm(huds[first], spots);
    expect(table.state.units.filter((u) => u.ownerId === first && u.ambushArrivedRound === 2)).toHaveLength(1);
    expect(table.state.turnState.currentPlayerId).toBe(second);
    click(huds[second], '[data-action="skip-ambush"]');
    click(huds[second], 'button[data-action="confirm"]');
    expect(table.log.at(-1)).toBe('skip-ambush');
    // The first player still has one Ambush unit and may place it or skip; skipping ends the step
    expect(table.state.turnState.currentPlayerId).toBe(first);
    click(huds[first], '[data-action="skip-ambush"]');
    click(huds[first], 'button[data-action="confirm"]');
    expect(table.state.turnState.ambushStep).toBeFalsy();
    expect(table.state.turnState.phase).toBe('activation');
    expect(table.state.turnState.currentPlayerId).toBe(first);
    // The unit still waiting is listed as in reserve
    expect(root(huds[first]).textContent).toContain('IN RESERVE (AMBUSH)');
  });
});
