import {
  GameState,
  GameAction,
  createInitialGameState,
  HOST_PLAYER_ID,
  GUEST_PLAYER_ID,
  DiceResult,
  DiceSpec,
  applyAction,
  getDiceSpecs,
  validateAction,
  applyDefaultScenario,
} from '@skirmish-lab/shared';
import { WebRTCClient, GameMessage } from '../network/WebRTCClient';

/** Source of server-rolled dice for the host's confirmed attack actions. */
export interface DiceProvider {
  requestRoll(rollId: string, specs: DiceSpec[]): Promise<DiceResult[]>;
}

export interface GameManagerOptions {
  /** Dice provider (host needs one to resolve shoot/fight actions). */
  diceProvider?: DiceProvider;
}

export interface ActionRejection {
  actionId: string;
  reason: string;
}

export class GameManager {
  private gameState: GameState | null = null;
  private webrtcClient: WebRTCClient;
  private isHost: boolean;
  private snapshots: GameState[] = [];
  private maxSnapshots: number = 50;
  private stateUpdateHandlers: Array<(state: GameState) => void> = [];
  private rejectionHandlers: Array<(rejection: ActionRejection) => void> = [];
  private diceProvider: DiceProvider | undefined;
  /** Action currently being processed (guards concurrent host processing). */
  private pendingActionId: string | null = null;

  constructor(webrtcClient: WebRTCClient, isHost: boolean, options: GameManagerOptions = {}) {
    this.webrtcClient = webrtcClient;
    this.isHost = isHost;
    this.diceProvider = options.diceProvider;
    this.setupHandlers();
  }

  /**
   * Subscribe to confirmed game state changes (host: after applying actions;
   * guest: on state updates). Handlers receive a deep copy. Returns an
   * unsubscribe function. This is the hook the renderer (GameView) and HUD
   * attach to.
   */
  onStateUpdate(handler: (state: GameState) => void): () => void {
    this.stateUpdateHandlers.push(handler);
    return () => {
      this.stateUpdateHandlers = this.stateUpdateHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Subscribe to action rejections (host: local rejections; guest: rejections
   * of actions this client requested). The HUD uses this to surface reasons.
   */
  onActionRejected(handler: (rejection: ActionRejection) => void): () => void {
    this.rejectionHandlers.push(handler);
    return () => {
      this.rejectionHandlers = this.rejectionHandlers.filter((h) => h !== handler);
    };
  }

  private emitStateUpdate(): void {
    if (!this.gameState) return;
    const copy = JSON.parse(JSON.stringify(this.gameState)) as GameState;
    for (const handler of this.stateUpdateHandlers) {
      handler(copy);
    }
  }

  private emitRejection(actionId: string, reason: string): void {
    const rejection = { actionId, reason };
    for (const handler of this.rejectionHandlers) {
      handler(rejection);
    }
  }

  private setupHandlers(): void {
    this.webrtcClient.on('state-update', (msg: GameMessage) => {
      if (!this.isHost && msg.type === 'state-update') {
        this.gameState = msg.state;
        this.saveSnapshot(msg.state);
        this.emitStateUpdate();
      }
    });

    this.webrtcClient.on('action-rejected', (msg: GameMessage) => {
      if (msg.type !== 'action-rejected') return;
      if (!this.isHost) {
        this.emitRejection(msg.actionId, msg.reason);
      }
    });

    this.webrtcClient.on('action-request', (msg: GameMessage) => {
      if (this.isHost && msg.type === 'action-request') {
        // Host is authoritative: guest actions are validated and applied here.
        void this.processAction(msg.action);
      }
    });
  }

  /**
   * Start the game: create the initial state with the default scenario
   * (host only) and broadcast the confirmed starting state. The guest
   * receives everything through state updates.
   */
  startGame(hostName = 'Host', guestName = 'Guest'): void {
    if (!this.isHost) return;
    this.gameState = createInitialGameState(HOST_PLAYER_ID, GUEST_PLAYER_ID, hostName, guestName);
    applyDefaultScenario(this.gameState);
    this.saveSnapshot(this.gameState);
    this.broadcastState('game-start');
    this.emitStateUpdate();
  }

  initializeGame(
    hostId: string,
    guestId: string,
    hostName: string = 'Host',
    guestName: string = 'Guest'
  ): void {
    if (this.isHost) {
      this.gameState = createInitialGameState(hostId, guestId, hostName, guestName);
      this.saveSnapshot(this.gameState);
      this.broadcastState('init');
      this.emitStateUpdate();
    }
  }

  /**
   * Submit a confirmed action. The host validates and applies it locally;
   * the guest sends it to the host and waits for the resulting state update.
   */
  sendAction(action: GameAction): void {
    if (this.isHost) {
      void this.processAction(action);
    } else {
      this.webrtcClient.send({ type: 'action-request', action } as GameMessage);
    }
  }

  private async processAction(action: GameAction): Promise<void> {
    if (!this.gameState || !this.isHost) return;

    if (this.pendingActionId) {
      // One action at a time — a dice request is in flight; the next action
      // must wait for the confirmed state update it produces.
      this.rejectAction(action.id, 'Another action is being processed');
      return;
    }
    this.pendingActionId = action.id;

    try {
      // 1. Validate before spending a server dice roll on the action.
      const validation = validateAction(this.gameState, action);
      if (!validation.valid) {
        this.rejectAction(action.id, validation.reason ?? 'Invalid action');
        return;
      }

      // 2. Server-rolled dice for attacks (never client-side rolls).
      const diceSpecs = getDiceSpecs(this.gameState, action);
      let dice: DiceResult[] | undefined;
      if (diceSpecs) {
        if (!this.diceProvider) {
          this.rejectAction(action.id, 'No dice provider available');
          return;
        }
        try {
          dice = await this.diceProvider.requestRoll(action.id, diceSpecs);
        } catch {
          this.rejectAction(action.id, 'Dice roll failed or timed out');
          return;
        }
      }

      // 3. Apply deterministically and broadcast the confirmed state.
      const outcome = applyAction(this.gameState, action, dice);
      if (!outcome.ok) {
        this.rejectAction(action.id, outcome.reason ?? 'Invalid action');
        return;
      }

      this.gameState = outcome.state ?? null;
      if (!this.gameState) {
        this.rejectAction(action.id, 'Action could not be applied');
        return;
      }
      this.saveSnapshot(this.gameState);
      this.broadcastState(action.id);
      this.emitStateUpdate();
    } finally {
      this.pendingActionId = null;
    }
  }

  private rejectAction(actionId: string, reason: string): void {
    // Surface locally (the acting player may be the host) and to the guest.
    this.emitRejection(actionId, reason);
    this.webrtcClient.send({ type: 'action-rejected', actionId, reason } as GameMessage);
  }

  private broadcastState(actionId: string): void {
    if (!this.gameState || !this.isHost) return;
    this.webrtcClient.send({
      type: 'state-update',
      state: this.gameState,
      actionId,
    } as GameMessage);
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
    return this.snapshots.map((s) => JSON.parse(JSON.stringify(s)));
  }
}
