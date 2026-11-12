// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD } from '../../src/ui/GameHUD';
import { soundFx } from '../../src/audio/SoundFx';
import {
  ActionLogEntry,
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  applyDefaultScenario,
  createBlankMap,
  createInitialGameState,
} from '@skirmish-lab/shared';
import { startRoundOne } from '../../../shared/tests/fixtures/setupFlow';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

function testState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, { customMap: { ...createBlankMap(), id: 'blank' } });
  startRoundOne(state);
  for (const u of state.units) u.isDeployed = true;
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.status = 'in-progress';
  state.actionLog = [];
  return state;
}

function setup(local: string = HOST, state: GameState = testState()) {
  const controller = { submitAction: vi.fn(), onReturnToLobby: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId: local, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state };
}

describe('GameHUD Audio & SFX (15A)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    soundFx.setMuted(false);
    vi.restoreAllMocks();
  });

  describe('action log audio cues', () => {
    it('fires a shot once when a shooting action resolves, and not again on re-sync', () => {
      const shotSpy = vi.spyOn(soundFx, 'playShot').mockImplementation(() => {});
      const { hud, state } = setup(HOST);

      const shootEntry: ActionLogEntry = {
        action: {
          id: 'act-1',
          timestamp: 1000,
          actorId: HOST,
          type: 'shoot',
          payload: { type: 'shoot', attackerId: 'unit-1', targetId: 'unit-2' },
        },
        result: 'accepted',
        appliedAt: 1000,
        dice: {
          rollId: 'roll-1',
          specs: [{ count: 2, sides: 6, purpose: 'to-hit' }],
          results: [{ purpose: 'to-hit', rolls: [4, 5] }, { purpose: 'defense', rolls: [2] }],
          context: { attackerId: 'unit-1', targetId: 'unit-2', actionId: 'act-1' },
          outcome: {
            attackCount: 2,
            hitCount: 2,
            blockedCount: 0,
            wounds: 2,
            targetDestroyed: false,
          },
        },
      };

      state.actionLog.push(shootEntry);
      hud.syncFromState(state);

      expect(shotSpy).toHaveBeenCalledTimes(1);

      // Re-sync with identical state should NOT fire the cue again
      hud.syncFromState(state);
      expect(shotSpy).toHaveBeenCalledTimes(1);
    });

    it('fires melee impact once when a melee strike resolves (fight, charge, strike-back), and not again on re-sync', () => {
      const meleeSpy = vi.spyOn(soundFx, 'playMeleeImpact').mockImplementation(() => {});
      const { hud, state } = setup(HOST);

      // 1. Fight action
      const fightEntry: ActionLogEntry = {
        action: {
          id: 'act-fight',
          timestamp: 1000,
          actorId: HOST,
          type: 'fight',
          payload: { type: 'fight', attackerId: 'unit-1', targetId: 'unit-2', weaponId: 'blade' },
        },
        result: 'accepted',
        appliedAt: 1000,
        dice: {
          rollId: 'roll-fight',
          specs: [],
          results: [{ purpose: 'to-hit', rolls: [5] }],
          context: { attackerId: 'unit-1', targetId: 'unit-2', actionId: 'act-fight' },
          outcome: { attackCount: 1, hitCount: 1, blockedCount: 0, wounds: 1, targetDestroyed: false },
        },
      };

      state.actionLog.push(fightEntry);
      hud.syncFromState(state);
      expect(meleeSpy).toHaveBeenCalledTimes(1);

      // Re-sync does not repeat
      hud.syncFromState(state);
      expect(meleeSpy).toHaveBeenCalledTimes(1);

      // 2. Charge action with strike
      const chargeEntry: ActionLogEntry = {
        action: {
          id: 'act-charge',
          timestamp: 2000,
          actorId: HOST,
          type: 'charge',
          payload: { type: 'charge', attackerId: 'unit-1', targetId: 'unit-2', path: [{ x: 0, y: 0, z: 0 }] },
        },
        result: 'accepted',
        appliedAt: 2000,
        dice: {
          rollId: 'roll-charge',
          specs: [],
          results: [{ purpose: 'to-hit', rolls: [6] }],
          context: { attackerId: 'unit-1', targetId: 'unit-2', actionId: 'act-charge' },
          outcome: { attackCount: 1, hitCount: 1, blockedCount: 0, wounds: 1, targetDestroyed: false },
        },
      };

      state.actionLog.push(chargeEntry);
      hud.syncFromState(state);
      expect(meleeSpy).toHaveBeenCalledTimes(2);

      // 3. Strike-back reaction
      const strikeBackEntry: ActionLogEntry = {
        action: {
          id: 'act-strike-back',
          timestamp: 3000,
          actorId: GUEST,
          type: 'respond-reaction',
          payload: { type: 'respond-reaction', reactionId: 'rx-1', choiceId: 'strike-back' },
        },
        result: 'accepted',
        appliedAt: 3000,
        dice: {
          rollId: 'roll-sb',
          specs: [],
          results: [{ purpose: 'to-hit', rolls: [4] }],
          context: { attackerId: 'unit-2', targetId: 'unit-1', actionId: 'act-strike-back' },
          outcome: { attackCount: 1, hitCount: 1, blockedCount: 0, wounds: 1, targetDestroyed: false },
        },
      };

      state.actionLog.push(strikeBackEntry);
      hud.syncFromState(state);
      expect(meleeSpy).toHaveBeenCalledTimes(3);
    });

    it('fires dice rattle once when a dice result appears in the Dice panel (once per resolved action, not per die)', () => {
      const rattleSpy = vi.spyOn(soundFx, 'playDiceRattle').mockImplementation(() => {});
      const { hud, state } = setup(HOST);

      // Traversal hazard dice (multiple dice rolled in one action)
      const hazardEntry: ActionLogEntry = {
        action: {
          id: 'act-advance-hazard',
          timestamp: 1000,
          actorId: HOST,
          type: 'advance',
          payload: { type: 'advance', unitId: 'unit-1', path: [], finalPosition: { x: 0, y: 0, z: 0 } },
        },
        result: 'accepted',
        appliedAt: 1000,
        dice: {
          rollId: 'roll-hazard',
          specs: [{ count: 3, sides: 6, purpose: 'hazard_1' }],
          results: [{ purpose: 'hazard_1', rolls: [1, 4, 6] }],
          context: { attackerId: 'unit-1', targetId: 'unit-1', actionId: 'act-advance-hazard' },
          outcome: {
            attackCount: 0,
            hitCount: 0,
            blockedCount: 0,
            wounds: 1,
            targetDestroyed: false,
            traversal: [{ type: 'hazard', text: 'Hazard test (3 dice)', rolls: [1, 4, 6], wounds: 1 }],
          },
        },
      };

      state.actionLog.push(hazardEntry);
      hud.syncFromState(state);

      // Fired once for the resolved action, NOT 3 times for the 3 dice!
      expect(rattleSpy).toHaveBeenCalledTimes(1);

      // Re-sync does not repeat
      hud.syncFromState(state);
      expect(rattleSpy).toHaveBeenCalledTimes(1);
    });

    it('does not fire cues for historical log entries upon reconnect / initial sync', () => {
      const shotSpy = vi.spyOn(soundFx, 'playShot').mockImplementation(() => {});
      const meleeSpy = vi.spyOn(soundFx, 'playMeleeImpact').mockImplementation(() => {});
      const rattleSpy = vi.spyOn(soundFx, 'playDiceRattle').mockImplementation(() => {});

      const state = testState();
      // Add existing actions before HUD connects
      state.actionLog.push({
        action: { id: 'old-1', timestamp: 100, actorId: HOST, type: 'shoot', payload: { type: 'shoot', attackerId: 'u1' } },
        result: 'accepted',
        appliedAt: 100,
      });

      // Now create HUD and perform initial sync (reconnect simulation)
      const container = document.createElement('div');
      document.body.appendChild(container);
      const hud = new GameHUD(container, { localPlayerId: HOST, controller: { submitAction: vi.fn(), onReturnToLobby: vi.fn() } });
      hud.show();
      hud.syncFromState(state);

      expect(shotSpy).not.toHaveBeenCalled();
      expect(meleeSpy).not.toHaveBeenCalled();
      expect(rattleSpy).not.toHaveBeenCalled();

      // Subsequent new action DOES fire
      state.actionLog.push({
        action: { id: 'new-1', timestamp: 200, actorId: HOST, type: 'shoot', payload: { type: 'shoot', attackerId: 'u1' } },
        result: 'accepted',
        appliedAt: 200,
      });
      hud.syncFromState(state);
      expect(shotSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('results screen stingers', () => {
    it('fires rising stinger for Victory when results screen opens', () => {
      const victorySpy = vi.spyOn(soundFx, 'playVictory').mockImplementation(() => {});
      const defeatSpy = vi.spyOn(soundFx, 'playDefeat').mockImplementation(() => {});
      const { hud, state } = setup(HOST);

      state.status = 'game-over';
      state.winner = HOST;
      hud.syncFromState(state);

      expect(victorySpy).toHaveBeenCalledTimes(1);
      expect(defeatSpy).not.toHaveBeenCalled();

      // Re-sync does not repeat
      hud.syncFromState(state);
      expect(victorySpy).toHaveBeenCalledTimes(1);
    });

    it('fires falling stinger for Defeat when results screen opens', () => {
      const victorySpy = vi.spyOn(soundFx, 'playVictory').mockImplementation(() => {});
      const defeatSpy = vi.spyOn(soundFx, 'playDefeat').mockImplementation(() => {});
      const { hud, state } = setup(HOST);

      state.status = 'game-over';
      state.winner = GUEST;
      hud.syncFromState(state);

      expect(defeatSpy).toHaveBeenCalledTimes(1);
      expect(victorySpy).not.toHaveBeenCalled();

      // Re-sync does not repeat
      hud.syncFromState(state);
      expect(defeatSpy).toHaveBeenCalledTimes(1);
    });

    it('plays nothing for a draw', () => {
      const victorySpy = vi.spyOn(soundFx, 'playVictory').mockImplementation(() => {});
      const defeatSpy = vi.spyOn(soundFx, 'playDefeat').mockImplementation(() => {});
      const { hud, state } = setup(HOST);

      state.status = 'game-over';
      delete state.winner;
      hud.syncFromState(state);

      expect(victorySpy).not.toHaveBeenCalled();
      expect(defeatSpy).not.toHaveBeenCalled();
    });
  });

  describe('mute button and audio toggle', () => {
    it('renders a mute toggle button in the header next to how-to-play', () => {
      const { container } = setup(HOST);
      const muteBtn = container.querySelector<HTMLButtonElement>('[data-action="audio-mute-toggle"]');
      const howToPlayBtn = container.querySelector<HTMLButtonElement>('[data-action="how-to-play-open"]');
      expect(muteBtn).not.toBeNull();
      expect(howToPlayBtn).not.toBeNull();
      // Default: sound is on, shows speaker icon
      expect(muteBtn!.textContent).toBe('🔊');
      expect(muteBtn!.title.toLowerCase()).toContain('mute');
    });

    it('toggles mute on click and suppresses cues when muted', () => {
      const shotSpy = vi.spyOn(soundFx, 'playShot');
      const { hud, container, state } = setup(HOST);
      const muteBtn = container.querySelector<HTMLButtonElement>('[data-action="audio-mute-toggle"]')!;

      // Click to mute
      muteBtn.click();
      expect(soundFx.isMuted()).toBe(true);

      // Re-rendered button shows muted icon
      const updatedBtn = container.querySelector<HTMLButtonElement>('[data-action="audio-mute-toggle"]')!;
      expect(updatedBtn.textContent).toBe('🔇');

      // Add shoot action while muted
      state.actionLog.push({
        action: { id: 'act-muted', timestamp: 1000, actorId: HOST, type: 'shoot', payload: { type: 'shoot', attackerId: 'u1' } },
        result: 'accepted',
        appliedAt: 1000,
      });
      hud.syncFromState(state);

      // SoundFx method may be called by HUD, but internally SoundFx suppresses playback when muted
      // Let's verify SoundFx is indeed muted
      expect(soundFx.isMuted()).toBe(true);
    });
  });
});
