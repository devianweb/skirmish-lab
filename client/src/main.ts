import { Lobby } from './ui/Lobby';

const app = document.getElementById('app');
if (app) {
  const lobby = new Lobby(app);
  lobby.init().catch(console.error);
}
