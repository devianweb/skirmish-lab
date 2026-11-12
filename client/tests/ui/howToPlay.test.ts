// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Lobby, LOBBY_DISCLAIMER } from '../../src/ui/Lobby';
import { GameHUD } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  applyDefaultScenario,
  createBlankMap,
  createInitialGameState,
} from '@skirmish-lab/shared';
import { startRoundOne } from '../../../shared/tests/fixtures/setupFlow';
import {
  HOW_TO_PLAY_RULES_URL,
  HOW_TO_PLAY_DISCLAIMER,
  HOW_TO_PLAY_TURN_FLOW,
  CAMERA_CONTROLS,
  GENERAL_CONTROLS,
  MAP_BUILDER_CONTROLS,
  ALL_CONTROLS,
  renderHowToPlayModalHtml,
} from '../../src/ui/howToPlay';

const HOST = HOST_PLAYER_ID;
const GUEST = GUEST_PLAYER_ID;

function createTestGameState(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, { customMap: { ...createBlankMap(), id: 'blank' } });
  startRoundOne(state);
  for (const u of state.units) u.isDeployed = true;
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;
  state.status = 'in-progress';
  return state;
}

function setupHUD(localPlayerId: string, state: GameState = createTestGameState()) {
  const controller = { submitAction: vi.fn(), onReturnToLobby: vi.fn() };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId, controller });
  hud.show();
  hud.syncFromState(state);
  return { hud, controller, container, state };
}

describe('How to Play modal & controls (14G)', () => {
  let lobbyContainer: HTMLElement;
  const keydownHandlers: EventListener[] = [];
  const realAddEventListener = window.addEventListener.bind(window);

  beforeEach(() => {
    document.body.innerHTML = '';
    lobbyContainer = document.createElement('div');
    document.body.appendChild(lobbyContainer);

    vi.spyOn(window, 'addEventListener').mockImplementation((type: any, fn: any, opts?: any) => {
      if (type === 'keydown') keydownHandlers.push(fn);
      realAddEventListener(type, fn, opts);
    });
  });

  afterEach(() => {
    keydownHandlers.splice(0).forEach((fn) => window.removeEventListener('keydown', fn));
    vi.restoreAllMocks();
  });

  describe('Content & Controls data specifications', () => {
    it('has turn flow described in 5-7 lines', () => {
      expect(HOW_TO_PLAY_TURN_FLOW.length).toBeGreaterThanOrEqual(5);
      expect(HOW_TO_PLAY_TURN_FLOW.length).toBeLessThanOrEqual(7);
      // Turn flow covers alternating activations, actions, confirm, reactions, dice, rounds
      const joined = HOW_TO_PLAY_TURN_FLOW.join(' ');
      expect(joined).toContain('alternate');
      expect(joined).toContain('Hold');
      expect(joined).toContain('Advance');
      expect(joined).toContain('Rush');
      expect(joined).toContain('Charge');
      expect(joined).toContain('Confirm');
      expect(joined).toContain('reaction');
      expect(joined).toContain('dice');
      expect(joined).toContain('4 rounds');
      expect(joined).toContain('objectives');
    });

    it('contains the free rules link to onepagerules.com and the fan disclaimer', () => {
      expect(HOW_TO_PLAY_RULES_URL).toBe('https://onepagerules.com');
      expect(HOW_TO_PLAY_DISCLAIMER).toBe(LOBBY_DISCLAIMER);

      const html = renderHowToPlayModalHtml();
      expect(html).toContain('https://onepagerules.com');
      expect(html).toContain(LOBBY_DISCLAIMER);
    });

    it('verifies each listed key or control exists in the code it names', () => {
      const srcDir = path.resolve(__dirname, '../../src');

      // 1. Camera controls -> CameraController.ts
      const cameraSource = fs.readFileSync(path.join(srcDir, 'renderer/CameraController.ts'), 'utf-8');
      expect(cameraSource).toContain('OrbitControls');
      for (const ctrl of CAMERA_CONTROLS) {
        expect(ctrl.sourceFile).toBe('client/src/renderer/CameraController.ts');
      }

      // 2. Map Builder keys -> MapEditor.ts
      const mapEditorSource = fs.readFileSync(path.join(srcDir, 'editor/MapEditor.ts'), 'utf-8');
      expect(mapEditorSource).toContain("key === 'r'");
      expect(mapEditorSource).toContain("key === 'e'");
      expect(mapEditorSource).toContain("key === 'q'");
      expect(mapEditorSource).toContain("e.key === 'Delete' || e.key === 'Backspace'");
      expect(mapEditorSource).toContain("key === 'd' && (e.ctrlKey || e.metaKey)");
      expect(mapEditorSource).toContain("key === 'escape'");

      for (const ctrl of MAP_BUILDER_CONTROLS) {
        expect(ctrl.sourceFile).toBe('client/src/editor/MapEditor.ts');
      }

      // 3. F9 debugger in game and dev mode in lobby
      const hudSource = fs.readFileSync(path.join(srcDir, 'ui/GameHUD.ts'), 'utf-8');
      const lobbySource = fs.readFileSync(path.join(srcDir, 'ui/Lobby.ts'), 'utf-8');
      expect(hudSource).toContain("event.key === 'F9'");
      expect(hudSource).toContain('toggleTerrainDebug');
      expect(lobbySource).toContain("event.key !== 'F9'");
      expect(lobbySource).toContain('toggleDevMode');

      // 4. Clicking units, targets, positions, Confirm and Cancel in GameHUD
      expect(hudSource).toContain('.sl-hud-unit');
      expect(hudSource).toContain("case 'confirm'");
      expect(hudSource).toContain("case 'cancel'");

      // Verify all controls have names and descriptions
      for (const ctrl of ALL_CONTROLS) {
        expect(ctrl.name.length).toBeGreaterThan(0);
        expect(ctrl.keysOrInput.length).toBeGreaterThan(0);
        expect(ctrl.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Lobby modal behavior', () => {
    it('renders a "?" button in the lobby card near Map Builder', () => {
      const lobby = new Lobby(lobbyContainer);
      (lobby as any).render();

      const mapBuilderBtn = lobbyContainer.querySelector('#openMapEditorBtn');
      const howToPlayBtn = lobbyContainer.querySelector('#howToPlayBtn') as HTMLButtonElement | null;

      expect(mapBuilderBtn).toBeTruthy();
      expect(howToPlayBtn).toBeTruthy();
      expect(howToPlayBtn?.textContent?.trim()).toBe('?');
    });

    it('opens and closes modal via Close button in the lobby', () => {
      const lobby = new Lobby(lobbyContainer);
      (lobby as any).render();

      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).toBeNull();

      const howToPlayBtn = lobbyContainer.querySelector('#howToPlayBtn') as HTMLButtonElement;
      howToPlayBtn.click();

      const overlay = lobbyContainer.querySelector('.sl-how-to-play-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay?.textContent).toContain('How to Play');
      expect(overlay?.textContent).toContain(LOBBY_DISCLAIMER);
      expect(overlay?.querySelector('a[href="https://onepagerules.com"]')).not.toBeNull();

      // Close using header close button
      const closeBtn = lobbyContainer.querySelector('.sl-how-to-play-close-btn') as HTMLButtonElement;
      expect(closeBtn).not.toBeNull();
      closeBtn.click();

      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).toBeNull();

      // Open again and close using footer close button
      (lobbyContainer.querySelector('#howToPlayBtn') as HTMLButtonElement).click();
      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).not.toBeNull();
      const footerCloseBtn = lobbyContainer.querySelector('.sl-how-to-play-footer-close') as HTMLButtonElement;
      expect(footerCloseBtn).not.toBeNull();
      footerCloseBtn.click();
      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).toBeNull();
    });

    it('closes modal when clicking outside (on backdrop) but not inside in the lobby', () => {
      const lobby = new Lobby(lobbyContainer);
      (lobby as any).render();

      const howToPlayBtn = lobbyContainer.querySelector('#howToPlayBtn') as HTMLButtonElement;
      howToPlayBtn.click();

      const overlay = lobbyContainer.querySelector('.sl-how-to-play-overlay') as HTMLElement;
      const card = lobbyContainer.querySelector('.sl-how-to-play-card') as HTMLElement;
      expect(overlay).not.toBeNull();
      expect(card).not.toBeNull();

      // Click inside the card -> should stay open
      card.click();
      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).not.toBeNull();

      // Click on overlay directly (outside the card) -> should close
      overlay.click();
      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).toBeNull();
    });

    it('closes modal when Esc is pressed in the lobby', () => {
      const lobby = new Lobby(lobbyContainer);
      (lobby as any).render();

      const howToPlayBtn = lobbyContainer.querySelector('#howToPlayBtn') as HTMLButtonElement;
      howToPlayBtn.click();
      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).not.toBeNull();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(lobbyContainer.querySelector('.sl-how-to-play-overlay')).toBeNull();
    });
  });

  describe('GameHUD modal behavior', () => {
    it('renders a "?" button in the in-game header next to Concede', () => {
      const { container } = setupHUD(HOST);
      const howToPlayBtn = container.querySelector('.sl-hud-how-to-play') as HTMLButtonElement | null;
      const concedeBtn = container.querySelector('.sl-hud-concede') as HTMLButtonElement | null;

      expect(howToPlayBtn).toBeTruthy();
      expect(howToPlayBtn?.textContent?.trim()).toBe('?');
      expect(concedeBtn).toBeTruthy();

      // Both buttons are in the header
      const header = container.querySelector('.sl-hud-header');
      expect(header?.contains(howToPlayBtn!)).toBe(true);
      expect(header?.contains(concedeBtn!)).toBe(true);
    });

    it('opens on either player turn without mutating state or sending actions', () => {
      // Host's turn
      const hostHUD = setupHUD(HOST);
      const hostBtn = hostHUD.container.querySelector('.sl-hud-how-to-play') as HTMLButtonElement;
      hostBtn.click();

      expect(hostHUD.container.querySelector('.sl-how-to-play-overlay')).not.toBeNull();
      expect(hostHUD.controller.submitAction).not.toHaveBeenCalled();

      // Guest's turn (host viewing)
      const stateGuestTurn = createTestGameState();
      stateGuestTurn.turnState.currentPlayerId = GUEST;
      const guestTurnHUD = setupHUD(HOST, stateGuestTurn);
      const guestTurnBtn = guestTurnHUD.container.querySelector('.sl-hud-how-to-play') as HTMLButtonElement;
      guestTurnBtn.click();

      expect(guestTurnHUD.container.querySelector('.sl-how-to-play-overlay')).not.toBeNull();
      expect(guestTurnHUD.controller.submitAction).not.toHaveBeenCalled();

      // Guest player viewing
      const guestHUD = setupHUD(GUEST, stateGuestTurn);
      const guestBtn = guestHUD.container.querySelector('.sl-hud-how-to-play') as HTMLButtonElement;
      guestBtn.click();

      expect(guestHUD.container.querySelector('.sl-how-to-play-overlay')).not.toBeNull();
      expect(guestHUD.controller.submitAction).not.toHaveBeenCalled();
    });

    it('closes modal in-game via Close button, click outside, or Esc', () => {
      const { container, controller } = setupHUD(HOST);
      const howToPlayBtn = container.querySelector('.sl-hud-how-to-play') as HTMLButtonElement;

      // 1. Close button
      howToPlayBtn.click();
      expect(container.querySelector('.sl-how-to-play-overlay')).not.toBeNull();
      const closeBtn = container.querySelector('.sl-how-to-play-close-btn') as HTMLButtonElement;
      closeBtn.click();
      expect(container.querySelector('.sl-how-to-play-overlay')).toBeNull();
      expect(controller.submitAction).not.toHaveBeenCalled();

      // 2. Click outside (overlay backdrop)
      howToPlayBtn.click();
      const overlay = container.querySelector('.sl-how-to-play-overlay') as HTMLElement;
      const card = container.querySelector('.sl-how-to-play-card') as HTMLElement;
      card.click();
      expect(container.querySelector('.sl-how-to-play-overlay')).not.toBeNull();
      overlay.click();
      expect(container.querySelector('.sl-how-to-play-overlay')).toBeNull();
      expect(controller.submitAction).not.toHaveBeenCalled();

      // 3. Escape key
      howToPlayBtn.click();
      expect(container.querySelector('.sl-how-to-play-overlay')).not.toBeNull();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(container.querySelector('.sl-how-to-play-overlay')).toBeNull();
      expect(controller.submitAction).not.toHaveBeenCalled();
    });
  });
});
