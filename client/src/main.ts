import { createInitialGameState } from '@skirmish-lab/shared';
import { GameView } from './renderer/GameView';
import { Lobby } from './ui/Lobby';

// 3D battlefield canvas, mounted behind the UI overlay.
const gameContainer = document.createElement('div');
gameContainer.id = 'game-container';
gameContainer.style.position = 'fixed';
gameContainer.style.inset = '0';
gameContainer.style.zIndex = '0';
document.body.appendChild(gameContainer);

const gameView = new GameView({ container: gameContainer });
// Show the board immediately (empty initial state: board + grid, no units).
// Once a game starts (Phase 5), GameManager.onStateUpdate feeds this view
// with real confirmed state instead.
gameView.syncFromState(createInitialGameState('host', 'guest'));
gameView.start();

// UI overlay (lobby) on top of the battlefield.
const app = document.getElementById('app');
if (app) {
  app.style.position = 'relative';
  app.style.zIndex = '1';
  const lobby = new Lobby(app);
  lobby.init().catch(console.error);
}
