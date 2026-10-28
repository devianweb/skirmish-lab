import { GameState, GameAction, createInitialGameState, validateActionBasic } from '@skirmish-lab/shared';
import { WebRTCClient } from '../network/WebRTCClient';

export class GameManager {
  private gameState: GameState | null = null;
  private webrtcClient: WebRTCClient;
  private isHost: boolean;
  private snapshots: GameState[] = [];
  private maxSnapshots: number = 50;
  private stateUpdateHandlers: Array<(state: GameState) => void> = [];

  constructor(webrtcClient: WebRTCClient, isHost: boolean) {
    this.webrtcClient = webrtcClient;
    this.isHost = isHost;
    this.setupHandlers();
  }

  /**
   * Subscribe to confirmed game state changes (host: after applying actions;
   * guest: on state updates). Handlers receive a deep copy. Returns an
   * unsubscribe function. This is the hook the renderer (GameView) attaches to.
   */
  onStateUpdate(handler: (state: GameState) => void): () => void {
    this.stateUpdateHandlers.push(handler);
    return () => {
      this.stateUpdateHandlers = this.stateUpdateHandlers.filter((h) => h !== handler);
    };
  }

  private emitStateUpdate(): void {
    if (!this.gameState) return;
    const copy = JSON.parse(JSON.stringify(this.gameState)) as GameState;
    for (const handler of this.stateUpdateHandlers) {
      handler(copy);
    }
  }

  private setupHandlers(): void {
    this.webrtcClient.on('state-update', (msg: any) => {
      if (!this.isHost) {
        this.gameState = msg.state;
        this.saveSnapshot(msg.state);
        this.emitStateUpdate();
        console.log('Received state update from host');
      }
    });

    this.webrtcClient.on('action-rejected', (msg: any) => {
      if (!this.isHost) {
        console.log('Action rejected:', msg.reason);
      }
    });
  }

  initializeGame(hostId: string, guestId: string): void {
    if (this.isHost) {
      this.gameState = createInitialGameState(hostId, guestId);
      this.saveSnapshot(this.gameState);
      this.broadcastState('init');
      this.emitStateUpdate();
    }
  }

  sendAction(action: GameAction): void {
    if (this.isHost) {
      // Host validates and applies directly
      this.processAction(action);
    } else {
      // Guest sends action request to host
      this.webrtcClient.send({ type: 'action-request', action } as any);
    }
  }

  private processAction(action: GameAction): void {
    if (!this.gameState || !this.isHost) return;
    
    const validation = validateActionBasic(action, this.gameState);
    if (!validation.valid) {
      this.webrtcClient.send({ 
        type: 'action-rejected', 
        actionId: action.id, 
        reason: validation.reason 
      } as any);
      return;
    }

    // Apply action (simplified for now)
    // In full implementation, this would use GameEngine
    this.gameState.lastActionId = action.id;
    this.gameState.actionLog.push({
      action,
      result: 'accepted',
      appliedAt: Date.now(),
    });

    this.saveSnapshot(this.gameState);
    this.broadcastState(action.id);
    this.emitStateUpdate();
  }

  private broadcastState(actionId: string): void {
    if (!this.gameState || !this.isHost) return;
    this.webrtcClient.send({ 
      type: 'state-update', 
      state: this.gameState, 
      actionId 
    } as any);
  }

  private saveSnapshot(state: GameState): void {
    this.snapshots.push(JSON.parse(JSON.stringify(state)));
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  getLatestSnapshot(): GameState | null {
    if (this.snapshots.length === 0) return null;
    return JSON.parse(JSON.stringify(this.snapshots[this.snapshots.length - 1]));
  }

  getGameState(): GameState | null {
    return this.gameState ? JSON.parse(JSON.stringify(this.gameState)) : null;
  }

  getSnapshots(): GameState[] {
    return this.snapshots.map(s => JSON.parse(JSON.stringify(s)));
  }
}
