import {
  computeLosVisibilityPolygon,
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  Vector3,
} from '@skirmish-lab/shared';
import { GameManager } from './core/GameManager';
import { SignalingDiceProvider } from './network/SignalingDiceProvider';
import { GameView, PickTarget } from './renderer/GameView';
import { ModelLoader } from './renderer/ModelLoader';
import { registerAssetManifest } from './renderer/assetManifest';
import { MarkerUnit } from './renderer/MarkerRenderer';
import { GameHUD, MarkerSnapshot } from './ui/GameHUD';
import { Lobby } from './ui/Lobby';

// 3D battlefield canvas, mounted behind the UI overlay.
const gameContainer = document.createElement('div');
gameContainer.id = 'game-container';
gameContainer.style.position = 'fixed';
gameContainer.style.inset = '0';
gameContainer.style.zIndex = '0';
document.body.appendChild(gameContainer);

// Curated CC0 assets (Kenney prototype kit) registered up front; every
// registered type swaps its procedural placeholder for the GLB once loaded.
const modelLoader = new ModelLoader();
registerAssetManifest(modelLoader);

const gameView = new GameView({ container: gameContainer, modelLoader });
gameView.start();

const app = document.getElementById('app');
if (!app) throw new Error('#app container missing from index.html');
app.style.position = 'relative';
app.style.zIndex = '1';

/** Latest confirmed state, for marker lookups (units by id). */
let latestState: GameState | null = null;

function unitForMarkers(unitId: string | null): MarkerUnit | null {
  if (!latestState || !unitId) return null;
  const unit = latestState.units.find((u) => u.id === unitId && !u.isDestroyed);
  return unit ? { id: unit.id, position: { ...unit.position }, remainingMovement: unit.remainingMovement } : null;
}

function applyMarkers(markers: MarkerSnapshot): void {
  gameView.setSelectionMarker(unitForMarkers(markers.selectedUnitId));
  gameView.setTargetMarker(unitForMarkers(markers.targetUnitId));
  const reachable = (markers.reachableTargetIds ?? [])
    .map((id) => unitForMarkers(id))
    .filter((u): u is MarkerUnit => u !== null);
  gameView.setReachableTargetsMarker(reachable);
  gameView.setMovementRangeMarker(unitForMarkers(markers.movementRangeUnitId));
  const attackRangeUnit = markers.attackRange
    ? unitForMarkers(markers.attackRange.unitId)
    : null;
  gameView.setAttackRangeMarker(
    attackRangeUnit && markers.attackRange && latestState
      ? {
          position: attackRangeUnit.position,
          range: markers.attackRange.range,
          losPolygon: computeLosVisibilityPolygon(
            latestState,
            attackRangeUnit.position,
            markers.attackRange.range,
            markers.attackRange.unitId
          ),
        }
      : null
  );
  gameView.setMovePathMarker(markers.movePath ?? null);
  const hoveredTerrain =
    latestState && markers.hoveredTerrainId
      ? latestState.terrain.find((t) => t.id === markers.hoveredTerrainId) ?? null
      : null;
  if (markers.debugActive && latestState) {
    gameView.setTerrainDebugMarker(latestState.terrain, {
      hoveredPieceId: markers.hoveredTerrainId ?? undefined,
      activeCoverPieceId: markers.shootingDebugRay?.coverPieceId,
    });
  } else {
    gameView.setTerrainDebugMarker(hoveredTerrain);
  }
  gameView.setShootingDebugRayMarker(markers.shootingDebugRay ?? null);
  gameView.setUnitsDebugMarker(markers.debugActive && latestState ? latestState.units : null);
  if (markers.outcome) {
    gameView.showOutcomeToken(markers.outcome.position as Vector3, markers.outcome.wounds);
  }
}

// Separate containers for Lobby and HUD so hiding the lobby never hides the HUD.
const lobbyContainer = document.createElement('div');
lobbyContainer.id = 'lobby-container';
app.appendChild(lobbyContainer);

let hud: GameHUD | null = null;
let gameManager: GameManager | null = null;
let stopKeepAlive: (() => void) | null = null;
let viewWired = false;

// UI overlay (lobby) on top of the battlefield. Once the peer connection is
// live, the lobby hands over to the full game wiring below.
const lobby = new Lobby(lobbyContainer, {
  onRoleAssigned: (role) => {
    gameView.setupCameraForRole(role);
  },
  onPeerReady: ({ webrtcClient, signalingClient, role, roomCode, initialState }) => {
    gameView.setupCameraForRole(role);
    const isHost = role === 'host';
    const localPlayerId = isHost ? HOST_PLAYER_ID : GUEST_PLAYER_ID;

    // If the host already has a game in progress and the guest rejoined the
    // room over a fresh WebRTC data channel, re-bind the existing GameManager
    // to the new WebRTCClient and re-broadcast the current confirmed state.
    if (isHost && gameManager && gameManager.getGameState()) {
      gameManager.rebindWebRTCClient(webrtcClient);
      lobby.hide();
      hud?.show();
      return;
    }

    // Host rolls dice through the signaling server (never client-side).
    gameManager = new GameManager(webrtcClient, isHost, {
      diceProvider: new SignalingDiceProvider(signalingClient),
    });

    hud?.dispose();
    hud = new GameHUD(app, {
      localPlayerId,
      roomCode,
      controller: {
        submitAction: (action) => gameManager?.sendAction(action),
        onReturnToLobby: () => {
          stopKeepAlive?.();
          stopKeepAlive = null;
          hud?.dispose();
          hud = null;
          gameManager = null;
          latestState = null;
          gameView.clear();
          lobby.reset();
        },
      },
    });
    hud.show();

    webrtcClient.onConnectionState((state) => {
      hud?.setNetworkStatus({ peer: state });
    });
    signalingClient.onConnectionState((state) => {
      hud?.setNetworkStatus({ signaling: state });
    });

    gameManager.onStateUpdate((state) => {
      latestState = state;
      gameView.syncFromState(state);
      hud?.syncFromState(state);
    });
    gameManager.onActionRejected(({ reason }) => hud?.notifyRejected(reason));

    if (!viewWired) {
      viewWired = true;
      gameView.onPick((target: PickTarget) => hud?.handleBoardPick(target));
      gameView.onHover((target: PickTarget | null) => hud?.handleBoardHover(target));
    }
    hud.onMarkers(applyMarkers);

    // Keep the signaling room alive while the game runs over WebRTC so
    // mid-game dice requests still reach the server.
    stopKeepAlive?.();
    stopKeepAlive = signalingClient.startKeepAlive();

    if (isHost) {
      gameManager.startGame('Host', 'Guest');
    } else if (initialState) {
      // If state-update was the first message that triggered onPeerReady,
      // feed it to the newly created guest GameManager.
      gameManager.applyStateUpdate(initialState);
    }
    // The guest receives the starting state through the data channel.

    lobby.hide();
  },
});

lobby.init().catch(console.error);
