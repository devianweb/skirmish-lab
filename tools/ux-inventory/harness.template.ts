// Screenshot harness (written into client/src/uxHarness.ts by make-harness.js; never committed there).
// Runs the real GameView, GameHUD and a host GameManager on one page with a stub data channel and scripted
// dice, and exposes `window.ux` so the Playwright scenes can set up states and drive the HUD.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  computeLosVisibilityPolygon,
  GameState,
  DiceSpec,
  DiceResult,
  Vector3,
  HOST_PLAYER_ID,
  GUEST_PLAYER_ID,
  createAction,
  BUILTIN_MAPS,
  STARTER_ARMIES,
  getDiceSpecs,
} from '@skirmish-lab/shared';
import * as shared from '@skirmish-lab/shared';
import { GameManager } from './core/GameManager';
import { GameView, PickTarget } from './renderer/GameView';
import { ModelLoader } from './renderer/ModelLoader';
import { registerAssetManifest } from './renderer/assetManifest';
import { MarkerUnit } from './renderer/MarkerRenderer';
import { GameHUD, MarkerSnapshot } from './ui/GameHUD';

const gameContainer = document.createElement('div');
gameContainer.id = 'game-container';
Object.assign(gameContainer.style, { position: 'fixed', inset: '0', zIndex: '0' });
document.body.appendChild(gameContainer);
const modelLoader = new ModelLoader();
registerAssetManifest(modelLoader);
const gameView = new GameView({ container: gameContainer, modelLoader });
gameView.start();
const app = document.getElementById('app')!;
app.style.position = 'relative';
app.style.zIndex = '1';
let latestState: GameState | null = null;

/*__MARKERS__*/

/** Scripted dice: per purpose a fixed list or value, otherwise a random d6. */
let forced: Record<string, number | number[]> = {};
const dice = {
  async requestRoll(_id: string, specs: DiceSpec[]): Promise<DiceResult[]> {
    return specs.map((s) => {
      const f = forced[s.purpose];
      const rolls = Array.from({ length: s.count }, (_, i) =>
        Array.isArray(f) ? f[i] ?? 1 + Math.floor(Math.random() * s.sides) : typeof f === 'number' ? f : 1 + Math.floor(Math.random() * s.sides)
      );
      const total = rolls.reduce((a, b) => a + b, 0);
      return { rolls, total, finalTotal: total, purpose: s.purpose } as DiceResult;
    });
  },
};
const stubRtc: any = { send() {}, on() {}, onConnectionState() {}, onMessage() {} };
const gm = new GameManager(stubRtc, true, { diceProvider: dice, roomCode: 'UXH-001' });
let hud: GameHUD | null = null;
function mountHud(localPlayerId: string) {
  hud?.dispose();
  hud = new GameHUD(app, {
    localPlayerId,
    roomCode: 'UXH-001',
    controller: { submitAction: (a) => gm.sendAction(a), onReturnToLobby: () => {} },
  });
  hud.onMarkers(applyMarkers);
  hud.show();
  if (latestState) hud.syncFromState(latestState);
}
gm.onStateUpdate((s) => {
  latestState = s;
  gameView.syncFromState(s);
  hud?.syncFromState(s);
});
gm.onActionRejected(({ reason }) => hud?.notifyRejected(reason));
gameView.onPick((t: PickTarget) => hud?.handleBoardPick(t));
gameView.onHover((t: PickTarget | null) => hud?.handleBoardHover(t));

(window as any).ux = {
  shared, gm, gameView, createAction, BUILTIN_MAPS, STARTER_ARMIES, getDiceSpecs,
  HOST: HOST_PLAYER_ID,
  GUEST: GUEST_PLAYER_ID,
  get hud() { return hud; },
  get state() { return latestState; },
  start(opts: any) { gm.startGame('Host', 'Guest', opts); },
  setState(s: GameState) { gm.restoreFromSnapshot(JSON.parse(JSON.stringify(s))); (gm as any).emitStateUpdate(); },
  mountHud,
  force(f: Record<string, number | number[]>) { forced = f; },
  act(actorId: string, type: string, payload: any) { gm.sendAction(createAction(actorId, type as any, { type, ...payload })); },
  setCamera(role: 'host' | 'guest') { gameView.setupCameraForRole(role); },
  focus(x: number, z: number, dist = 16, side: 'host' | 'guest' = 'host') {
    const cc: any = (gameView as any).cameraController;
    const cam = cc.camera;
    const s = side === 'host' ? 1 : -1;
    cam.position.set(x + s * dist * 0.45, dist * 0.8, z - s * dist * 0.6);
    cc.setTarget(x, 0, z);
  },
  /** Screen position of a world point (for real mouse hover/clicks). */
  project(x: number, y: number, z: number) {
    const cam: any = (gameView as any).cameraController.camera;
    const v = new cam.position.constructor(x, y, z).project(cam);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  },
};
(window as any).uxReady = true;
