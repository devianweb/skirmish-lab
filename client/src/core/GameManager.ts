import { GameState, GameAction, createInitialGameState, validateActionBasic } from '@trench-heresy/shared';
import { WebRTCClient } from '../network/WebRTCClient';

export class GameManager {
  private gameState: GameState | null = null;
  private webrtcClient: WebRTCClient;
  private isHost: boolean;
  private snapshots: GameState[] = [];
  private maxSnapshots: number = 50;

  constructor(webrtcClient: WebRTCClient, isHost: boolean) {
    this.webrtcClient = webrtcClient;
    this.isHost = isHost;
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.webrtcClient.on('state-update', (msg: any) => {
      if (!this.isHost) {
        this.gameState = msg.state;
        this.saveSnapshot(msg.state);
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
