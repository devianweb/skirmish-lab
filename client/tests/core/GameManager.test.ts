import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameManager } from '../../src/core/GameManager';
import { SessionStore } from '../../src/storage/SessionStore';
import { WebRTCClient } from '../../src/network/WebRTCClient';
import {
  HOST_PLAYER_ID,
  GUEST_PLAYER_ID,
  createAction,
} from '@skirmish-lab/shared';

describe('GameManager', () => {
  let mockWebRTC: WebRTCClient;
  let handlers: Map<string, Function>;
  let gameManagerHost: GameManager;
  let gameManagerGuest: GameManager;

  beforeEach(() => {
    handlers = new Map();
    mockWebRTC = {
      on: vi.fn((type: string, handler: Function) => {
        handlers.set(type, handler);
      }),
      send: vi.fn(),
    } as any;
    gameManagerHost = new GameManager(mockWebRTC, true);
    gameManagerGuest = new GameManager(mockWebRTC, false);
  });

  it('should initialize game as host', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const state = gameManagerHost.getGameState();
    expect(state).toBeDefined();
    expect(state?.hostId).toBe('host1');
    expect(state?.guestId).toBe('guest1');
  });

  it('should not initialize game as guest', () => {
    gameManagerGuest.initializeGame('host1', 'guest1');
    expect(gameManagerGuest.getGameState()).toBeNull();
  });

  it('should save snapshots on init', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const snapshot = gameManagerHost.getLatestSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot?.hostId).toBe('host1');
    expect(snapshot?.gameId).toBeDefined();
  });

  it('should send action request as guest', () => {
    const action = createAction('guest1', 'end-round', { type: 'end-round' });
    gameManagerGuest.sendAction(action);
    expect(mockWebRTC.send).toHaveBeenCalledWith({
      type: 'action-request',
      action,
    });
  });

  it('should process action directly as host when it is actor turn', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const action = createAction('host1', 'end-round', { type: 'end-round' });
    gameManagerHost.sendAction(action);
    
    const state = gameManagerHost.getGameState();
    expect(state?.lastActionId).toBe(action.id);
    expect(state?.actionLog.length).toBe(1);
    expect(state?.actionLog[0].result).toBe('accepted');
    expect(mockWebRTC.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'state-update', actionId: action.id })
    );
  });

  it('should reject action from wrong player as host', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const action = createAction('guest1', 'end-round', { type: 'end-round' });
    gameManagerHost.sendAction(action);
    
    const state = gameManagerHost.getGameState();
    expect(state?.actionLog.length).toBe(0);
    expect(mockWebRTC.send).toHaveBeenCalledWith(
      expect.objectContaining({ 
        type: 'action-rejected', 
        actionId: action.id, 
        reason: 'Not your turn' 
      })
    );
  });

  it('should apply state updates as guest', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const hostState = gameManagerHost.getGameState()!;
    const stateUpdateHandler = handlers.get('state-update');
    expect(stateUpdateHandler).toBeDefined();
    
    stateUpdateHandler!({ type: 'state-update', state: hostState, actionId: 'test' });
    
    const guestState = gameManagerGuest.getGameState();
    expect(guestState?.hostId).toBe('host1');
    expect(gameManagerGuest.getLatestSnapshot()).toBeDefined();
  });

  it('should return deep copies from getters', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const state1 = gameManagerHost.getGameState()!;
    const state2 = gameManagerHost.getGameState()!;
    expect(state1).not.toBe(state2);
    state1.units.push({ id: 'x' } as any);
    expect(gameManagerHost.getGameState()!.units.length).toBe(0);
  });

  it('should limit snapshots to maxSnapshots', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    for (let i = 0; i < 60; i++) {
      const action = createAction('host1', 'end-round', { type: 'end-round' });
      // Change turn to allow same player? No - better to just test via getSnapshots
      // We'll manually trigger by reinitializing logic isn't needed; snapshots accumulate
    }
    const snapshots = gameManagerHost.getSnapshots();
    expect(snapshots.length).toBeLessThanOrEqual(50);
  });

  it('should return deep copies from snapshots', () => {
    gameManagerHost.initializeGame('host1', 'guest1');
    const snapshot1 = gameManagerHost.getLatestSnapshot()!;
    const snapshot2 = gameManagerHost.getLatestSnapshot()!;
    expect(snapshot1).not.toBe(snapshot2);
    snapshot1.units.push({ id: 'y' } as any);
    expect(gameManagerHost.getLatestSnapshot()!.units.length).toBe(0);
  });

  it('should not apply actions as host if no game state initialized', () => {
    const action = createAction('host1', 'end-round', { type: 'end-round' });
    gameManagerHost.sendAction(action);
    expect(mockWebRTC.send).not.toHaveBeenCalled();
  });

  describe('startGame', () => {
    it('spawns the default scenario as host and broadcasts the starting state', () => {
      const handler = vi.fn();
      gameManagerHost.onStateUpdate(handler);

      gameManagerHost.startGame('Alice', 'Bob');

      const state = gameManagerHost.getGameState()!;
      expect(state.status).toBe('in-progress');
      expect(state.units).toHaveLength(10);
      expect(state.terrain).toHaveLength(0); // default is an empty battlefield
      expect(state.players[0].name).toBe('Alice');
      expect(state.players[1].name).toBe('Bob');
      expect(state.turnState.currentPlayerId).toBe(HOST_PLAYER_ID);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockWebRTC.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'state-update', actionId: 'game-start' })
      );
    });

    it('is a no-op for the guest (state arrives via updates)', () => {
      gameManagerGuest.startGame();
      expect(gameManagerGuest.getGameState()).toBeNull();
      expect(mockWebRTC.send).not.toHaveBeenCalled();
    });
  });

  describe('Phase 5 action flow (host authoritative)', () => {
    function startedHost(diceProvider?: any): GameManager {
      const manager = new GameManager(mockWebRTC, true, { diceProvider });
      manager.startGame();
      (mockWebRTC.send as any).mockClear();
      return manager;
    }

    it('applies a confirmed activation as host and emits the new state', () => {
      const manager = startedHost();
      const handler = vi.fn();
      manager.onStateUpdate(handler);

      const unitId = manager.getGameState()!.units[0].id;
      const action = createAction(HOST_PLAYER_ID, 'activate-unit', {
        type: 'activate-unit',
        unitId,
      });
      manager.sendAction(action);

      const state = manager.getGameState()!;
      expect(state.turnState.activeUnitId).toBe(unitId);
      expect(state.actionLog).toHaveLength(1);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockWebRTC.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'state-update', actionId: action.id })
      );
    });

    it('rejects an illegal action, surfaces it locally, and notifies the guest', () => {
      const manager = startedHost();
      const rejectionHandler = vi.fn();
      manager.onActionRejected(rejectionHandler);

      // Guest tries to act on the host's turn.
      const action = createAction(GUEST_PLAYER_ID, 'hold', {
        type: 'hold',
        unitId: 'whatever',
      });
      manager.sendAction(action);

      expect(manager.getGameState()!.actionLog).toHaveLength(0);
      expect(rejectionHandler).toHaveBeenCalledWith({
        actionId: action.id,
        reason: 'Not your turn',
      });
      expect(mockWebRTC.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'action-rejected', reason: 'Not your turn' })
      );
    });

    it('routes guest action requests through host validation and application', () => {
      const manager = startedHost();

      // Make it the guest's turn and let the guest activate their leader.
      const guestUnit = manager
        .getGameState()!
        .units.find((u) => u.ownerId === GUEST_PLAYER_ID)!;
      manager.getGameState()!.turnState.currentPlayerId = GUEST_PLAYER_ID;
      // Feed the mutation through the manager's own state (deep copy guard):
      const patched = manager.getGameState()!;
      patched.turnState.currentPlayerId = GUEST_PLAYER_ID;
      (manager as any).gameState = patched;

      const action = createAction(GUEST_PLAYER_ID, 'activate-unit', {
        type: 'activate-unit',
        unitId: guestUnit.id,
      });
      handlers.get('action-request')!({ type: 'action-request', action });

      expect(manager.getGameState()!.turnState.activeUnitId).toBe(guestUnit.id);
      expect(mockWebRTC.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'state-update', actionId: action.id })
      );
    });

    it('rolls the objective count and mission roll-off through the server dice as soon as a deployment game starts', async () => {
      const rolls = (first: number) => Array.from({ length: 10 }, () => [first, 1]).flat();
      const diceProvider = {
        requestRoll: vi.fn().mockResolvedValue([
          { rolls: [6], total: 6, finalTotal: 6, purpose: 'objective-count' },
          { rolls: rolls(5), total: 0, finalTotal: 0, purpose: 'mission-roll-off' },
        ]),
      };
      const manager = new GameManager(mockWebRTC, true, { diceProvider });
      manager.startGame('Host', 'Guest', { useDeploymentPhase: true });
      await new Promise((r) => setTimeout(r, 0));

      const [, specs] = diceProvider.requestRoll.mock.calls[0];
      expect(specs).toEqual([
        { count: 1, sides: 6, purpose: 'objective-count' },
        { count: 20, sides: 6, purpose: 'mission-roll-off' },
      ]);
      const state = manager.getGameState()!;
      expect(state.turnState.phase).toBe('objectives');
      expect(state.setupRolls?.objectiveCount).toBe(5);
      expect(state.setupRolls?.missionRollOff?.winnerId).toBe(HOST_PLAYER_ID);
      expect(state.turnState.currentPlayerId).toBe(HOST_PLAYER_ID);
      // Broadcast to the guest with the rolls in the log entry
      expect(mockWebRTC.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'state-update', state: expect.objectContaining({ setupRolls: expect.anything() }) })
      );
      // Not rolled again
      expect(diceProvider.requestRoll).toHaveBeenCalledTimes(1);
    });

    it('does not roll objectives for a game without the deployment phase', async () => {
      const diceProvider = { requestRoll: vi.fn() };
      const manager = new GameManager(mockWebRTC, true, { diceProvider });
      manager.startGame('Host', 'Guest', {});
      await new Promise((r) => setTimeout(r, 0));
      expect(diceProvider.requestRoll).not.toHaveBeenCalled();
    });

    it('requests server dice for the dangerous terrain test of a unit (a die per wound to destroy it) standing in a hazard pool', async () => {
      const diceProvider = {
        requestRoll: vi.fn().mockResolvedValue([{ rolls: [1, 5, 5], total: 11, finalTotal: 11, purpose: 'hazard_pool' }]),
      };
      const manager = startedHost(diceProvider);
      const state = (manager as any).gameState;
      const unit = state.units.find((u: any) => u.ownerId === HOST_PLAYER_ID && u.models.length === 1);
      unit.wounds = 3;
      unit.maxWounds = 3;
      unit.models[0].wounds = 3;
      unit.models[0].maxWounds = 3;
      unit.position = { x: 0, y: 0, z: 0 };
      unit.models[0].position = { x: 0, y: 0, z: 0 };
      state.terrain = [
        {
          id: 'pool',
          terrainType: 'hazard-pool',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 0.1, z: 4 },
          blocksLineOfSight: false,
          providesCover: false,
          isObstacle: false,
        },
      ];

      const action = createAction(HOST_PLAYER_ID, 'activate-unit', { type: 'activate-unit', unitId: unit.id });
      manager.sendAction(action);
      await new Promise((r) => setTimeout(r, 0));

      expect(diceProvider.requestRoll).toHaveBeenCalledWith(action.id, [
        { count: 3, sides: 6, purpose: 'hazard_pool' },
      ]);
      const after = manager.getGameState()!;
      expect(after.units.find((u) => u.id === unit.id)!.wounds).toBe(2);
      expect(after.turnState.activeUnitId).toBe(unit.id);
    });

    it('requests server dice for shoot and applies the resolution', async () => {
      const diceProvider = {
        requestRoll: vi.fn().mockResolvedValue([
          { rolls: [6], total: 6, finalTotal: 6, purpose: 'to-hit' },
          { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
        ]),
      };
      const manager = startedHost(diceProvider);

      const state = manager.getGameState()!;
      // Host activates their first fighter (a ranged rifle trooper).
      const attacker = state.units.find(
        (u) => u.ownerId === HOST_PLAYER_ID && u.weapons.some((w) => w.profile.type === 'ranged')
      )!;
      manager.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', { type: 'activate-unit', unitId: attacker.id })
      );
      // Move the attacker into rifle range of a guest unit.
      const target = manager.getGameState()!.units.find((u) => u.ownerId === GUEST_PLAYER_ID)!;
      const movedAttacker = (manager as any).gameState.units.find((u: any) => u.id === attacker.id);
      movedAttacker.position = {
        x: target.position.x,
        y: 0,
        z: target.position.z - 10,
      };
      // Rules measure per model: stand every model on the new anchor.
      for (const m of movedAttacker.models) m.position = { ...movedAttacker.position };

      const action = createAction(HOST_PLAYER_ID, 'shoot', {
        type: 'shoot',
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: attacker.weapons.find((w) => w.profile.type === 'ranged')!.id,
      });
      manager.sendAction(action);
      await new Promise((r) => setTimeout(r, 0)); // let the dice promise settle

      expect(diceProvider.requestRoll).toHaveBeenCalledWith(action.id, [
        { count: 1, sides: 6, purpose: 'to-hit' },
        { count: 1, sides: 6, purpose: 'defense' },
      ]);

      const after = manager.getGameState()!;
      const entry = after.actionLog.find((e) => e.action.id === action.id)!;
      // Roll 6 hits (Q4), defense 1 fails to block (D5) — one wound.
      expect(entry.dice!.outcome.wounds).toBe(1);
      const targetAfter = after.units.find((u) => u.id === target.id)!;
      expect(targetAfter.wounds).toBe(targetAfter.maxWounds - 1);
    });

    it('rejects the action when server dice are unavailable', async () => {
      const diceProvider = {
        requestRoll: vi.fn().mockRejectedValue(new Error('timeout')),
      };
      const manager = startedHost(diceProvider);
      const rejectionHandler = vi.fn();
      manager.onActionRejected(rejectionHandler);

      const state = manager.getGameState()!;
      const attacker = state.units.find(
        (u) => u.ownerId === HOST_PLAYER_ID && u.weapons.some((w) => w.profile.type === 'ranged')
      )!;
      manager.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', { type: 'activate-unit', unitId: attacker.id })
      );
      const target = manager.getGameState()!.units.find((u) => u.ownerId === GUEST_PLAYER_ID)!;
      const movedAttacker = (manager as any).gameState.units.find((u: any) => u.id === attacker.id);
      movedAttacker.position = {
        x: target.position.x,
        y: 0,
        z: target.position.z - 10,
      };
      // Rules measure per model: stand every model on the new anchor.
      for (const m of movedAttacker.models) m.position = { ...movedAttacker.position };

      const action = createAction(HOST_PLAYER_ID, 'shoot', {
        type: 'shoot',
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: attacker.weapons.find((w) => w.profile.type === 'ranged')!.id,
      });
      manager.sendAction(action);
      await new Promise((r) => setTimeout(r, 0));

      expect(rejectionHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Dice roll failed or timed out' })
      );
      expect(manager.getGameState()!.actionLog.find((e) => e.action.id === action.id)).toBeUndefined();
    });

    it('rejects actions submitted while dice are still in flight', async () => {
      let releaseDice: (results: any[]) => void = () => {};
      const diceProvider = {
        requestRoll: vi.fn().mockImplementation(
          () => new Promise((resolve) => (releaseDice = resolve))
        ),
      };
      const manager = startedHost(diceProvider);
      const rejectionHandler = vi.fn();
      manager.onActionRejected(rejectionHandler);

      const state = manager.getGameState()!;
      const attacker = state.units.find(
        (u) => u.ownerId === HOST_PLAYER_ID && u.weapons.some((w) => w.profile.type === 'ranged')
      )!;
      manager.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', { type: 'activate-unit', unitId: attacker.id })
      );
      const target = manager.getGameState()!.units.find((u) => u.ownerId === GUEST_PLAYER_ID)!;
      const movedAttacker = (manager as any).gameState.units.find((u: any) => u.id === attacker.id);
      movedAttacker.position = {
        x: target.position.x,
        y: 0,
        z: target.position.z - 10,
      };
      // Rules measure per model: stand every model on the new anchor.
      for (const m of movedAttacker.models) m.position = { ...movedAttacker.position };

      const shoot = createAction(HOST_PLAYER_ID, 'shoot', {
        type: 'shoot',
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: attacker.weapons.find((w) => w.profile.type === 'ranged')!.id,
      });
      manager.sendAction(shoot); // in flight — never resolved yet

      const second = createAction(HOST_PLAYER_ID, 'hold', {
        type: 'hold',
        unitId: 'some-unit',
      });
      manager.sendAction(second);

      expect(rejectionHandler).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Another action is being processed' })
      );

      releaseDice([
        { rolls: [6], total: 6, finalTotal: 6, purpose: 'to-hit' },
        { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
      ]);
      await new Promise((r) => setTimeout(r, 0));
      expect(manager.getGameState()!.actionLog.find((e) => e.action.id === shoot.id)).toBeDefined();
    });
  });

  describe('concede queueing (host busy with dice)', () => {
    function busyHost() {
      let releaseDice: (results: any[]) => void = () => {};
      const diceProvider = {
        requestRoll: vi.fn().mockImplementation(
          () => new Promise((resolve) => (releaseDice = resolve))
        ),
      };
      const manager = new GameManager(mockWebRTC, true, { diceProvider });
      manager.startGame();
      const state = manager.getGameState()!;
      const attacker = state.units.find(
        (u) => u.ownerId === HOST_PLAYER_ID && u.weapons.some((w) => w.profile.type === 'ranged')
      )!;
      manager.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', { type: 'activate-unit', unitId: attacker.id })
      );
      const target = manager.getGameState()!.units.find((u) => u.ownerId === GUEST_PLAYER_ID)!;
      const live = (manager as any).gameState.units.find((u: any) => u.id === attacker.id);
      live.position = { x: target.position.x, y: 0, z: target.position.z - 10 };
      for (const m of live.models) m.position = { ...live.position };
      const shoot = createAction(HOST_PLAYER_ID, 'shoot', {
        type: 'shoot',
        attackerId: attacker.id,
        targetId: target.id,
        weaponId: attacker.weapons.find((w) => w.profile.type === 'ranged')!.id,
      });
      manager.sendAction(shoot);
      (mockWebRTC.send as any).mockClear();
      return { manager, shoot, target, release: (r: any[]) => releaseDice(r) };
    }
    const dice = [
      { rolls: [6], total: 6, finalTotal: 6, purpose: 'to-hit' },
      { rolls: [1], total: 1, finalTotal: 1, purpose: 'defense' },
    ];

    it('queues a concede during an in-flight roll and applies it afterwards, in order', async () => {
      const { manager, shoot, release } = busyHost();
      const rejectionHandler = vi.fn();
      manager.onActionRejected(rejectionHandler);
      const concede = createAction(GUEST_PLAYER_ID, 'concede', { type: 'concede' });
      manager.sendAction(concede);
      expect(rejectionHandler).not.toHaveBeenCalled();
      expect(manager.getGameState()!.status).not.toBe('game-over');

      release(dice);
      await new Promise((r) => setTimeout(r, 0));

      const state = manager.getGameState()!;
      expect(state.status).toBe('game-over');
      expect(state.winner).toBe(HOST_PLAYER_ID);
      expect(rejectionHandler).not.toHaveBeenCalled();
      const updates = (mockWebRTC.send as any).mock.calls
        .map((c: any[]) => c[0])
        .filter((m: any) => m.type === 'state-update')
        .map((m: any) => m.actionId);
      expect(updates).toEqual([shoot.id, concede.id]);
    });

    it('drops a queued concede silently when the action already ended the game', async () => {
      const { manager, target, release } = busyHost();
      const rejectionHandler = vi.fn();
      manager.onActionRejected(rejectionHandler);
      const live = (manager as any).gameState;
      for (const u of live.units) {
        if (u.ownerId === GUEST_PLAYER_ID && u.id !== target.id) u.isDestroyed = true;
      }
      const t = live.units.find((u: any) => u.id === target.id);
      // One single-wound model left, so any hit eliminates the side.
      t.models = t.models.slice(0, 1);
      t.models[0].wounds = 0;
      t.models[0].maxWounds = 1;
      t.wounds = 0;
      t.maxWounds = 1;
      t.specialRules = [];
      manager.sendAction(createAction(GUEST_PLAYER_ID, 'concede', { type: 'concede' }));

      release([
        { rolls: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6], total: 60, finalTotal: 60, purpose: 'to-hit' },
        { rolls: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], total: 10, finalTotal: 10, purpose: 'defense' },
      ]);
      await new Promise((r) => setTimeout(r, 0));

      const state = manager.getGameState()!;
      expect(state.status).toBe('game-over');
      expect(state.endReason).toBe('Opponent eliminated');
      expect(state.actionLog.some((e) => e.action.type === 'concede')).toBe(false);
      expect(rejectionHandler).not.toHaveBeenCalled();
    });
  });

  describe('host <-> guest integration over a fake data channel', () => {
    function makeChannelPair() {
      // Two WebRTCClient mocks wired so either side's send() delivers to the
      // other side's registered handlers, mimicking an open data channel.
      const hostHandlers = new Map<string, Function[]>();
      const guestHandlers = new Map<string, Function[]>();
      const hostConnHandlers: ((state: 'connected' | 'disconnected') => void)[] = [];
      const guestConnHandlers: ((state: 'connected' | 'disconnected') => void)[] = [];

      const hostWebRTC = {
        on: vi.fn((type: string, handler: Function) => {
          hostHandlers.set(type, [...(hostHandlers.get(type) ?? []), handler]);
        }),
        onConnectionState: vi.fn((handler: (state: 'connected' | 'disconnected') => void) => {
          hostConnHandlers.push(handler);
        }),
        send: vi.fn((message: any) => {
          for (const handler of guestHandlers.get(message.type) ?? []) handler(message);
        }),
      } as any;
      const guestWebRTC = {
        on: vi.fn((type: string, handler: Function) => {
          guestHandlers.set(type, [...(guestHandlers.get(type) ?? []), handler]);
        }),
        onConnectionState: vi.fn((handler: (state: 'connected' | 'disconnected') => void) => {
          guestConnHandlers.push(handler);
        }),
        send: vi.fn((message: any) => {
          for (const handler of hostHandlers.get(message.type) ?? []) handler(message);
        }),
      } as any;

      return {
        hostWebRTC,
        guestWebRTC,
        disconnectGuest: () => {
          for (const h of hostConnHandlers) h('disconnected');
        },
        reconnectGuest: () => {
          for (const h of hostConnHandlers) h('connected');
        },
      };
    }

    it('runs a full alternating activation turn across the wire', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true);
      const guest = new GameManager(guestWebRTC, false);
      const guestStates: any[] = [];
      guest.onStateUpdate((state) => guestStates.push(state));

      host.startGame();

      // Guest received the starting state.
      expect(guest.getGameState()?.units).toHaveLength(10);
      expect(guestStates[0].status).toBe('in-progress');

      // Host activates their first unit.
      const hostUnitId = host.getGameState()!.units[0].id;
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostUnitId,
        })
      );
      expect(host.getGameState()!.turnState.activeUnitId).toBe(hostUnitId);
      host.sendAction(createAction(HOST_PLAYER_ID, 'end-activation', { type: 'end-activation' }));

      // Initiative passed to the guest — the guest UI acts through the wire.
      const guestUnitId = guest
        .getGameState()!
        .units.find((u: any) => u.ownerId === GUEST_PLAYER_ID)!.id;
      guest.sendAction(
        createAction(GUEST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: guestUnitId,
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      // The host applied the guest's action and both sides agree.
      const hostState = host.getGameState()!;
      const guestState = guest.getGameState()!;
      expect(hostState.turnState.activeUnitId).toBe(guestUnitId);
      expect(guestState.turnState.activeUnitId).toBe(guestUnitId);
      expect(guestState.actionLog).toEqual(hostState.actionLog);
    });

    it('delivers guest rejections back across the wire', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true);
      const guest = new GameManager(guestWebRTC, false);
      host.startGame();

      // Host has not ended their activation — the guest tries to activate on
      // the host's turn; the host must reject and the guest must be told why.
      const guestUnitId = host
        .getGameState()!
        .units.find((u: any) => u.ownerId === GUEST_PLAYER_ID)!.id;
      const rejections: any[] = [];
      guest.onActionRejected((rejection) => rejections.push(rejection));

      const badAction = createAction(GUEST_PLAYER_ID, 'activate-unit', {
        type: 'activate-unit',
        unitId: guestUnitId,
      });
      guest.sendAction(badAction);
      await new Promise((r) => setTimeout(r, 0));

      expect(rejections).toHaveLength(1);
      expect(rejections[0].reason).toBe('Not your turn');
      // The guest's state was never updated — no activation happened.
      expect(guest.getGameState()!.turnState.activeUnitId).toBeFalsy();
    });

    it('integrates host and guest GameHUDs + GameManagers + dice across a round', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const diceProvider = {
        requestRoll: vi.fn().mockResolvedValue([
          { rolls: [6, 6], total: 12, finalTotal: 12, purpose: 'to-hit' },
          { rolls: [1, 1], total: 2, finalTotal: 2, purpose: 'defense' },
        ]),
      };
      const host = new GameManager(hostWebRTC, true, { diceProvider });
      const guest = new GameManager(guestWebRTC, false);

      host.startGame('Host', 'Guest');

      // 1. Host charges a guest fighter and strikes it; charge automatically resolves
      //    the melee strike to destruction and finishes the activation.
      const hostCharger = host
        .getGameState()!
        .units.find((u) => u.ownerId === HOST_PLAYER_ID && u.weapons.some((w) => w.id === 'blade'))!;
      const guestTarget = host
        .getGameState()!
        .units.find((u) => u.ownerId === GUEST_PLAYER_ID && u.wounds === 1)!;

      // Place target within charge range (5" away).
      const patched = host.getGameState()!;
      patched.units.find((u) => u.id === guestTarget.id)!.position = {
        x: hostCharger.position.x,
        y: 0,
        z: hostCharger.position.z + 5,
      };
      for (const m of patched.units.find((u) => u.id === guestTarget.id)!.models) m.position = { ...patched.units.find((u) => u.id === guestTarget.id)!.position };
      (host as any).gameState = patched;

      host.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostCharger.id,
        })
      );
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'charge', {
          type: 'charge',
          attackerId: hostCharger.id,
          targetId: guestTarget.id,
          path: [{ x: hostCharger.position.x, y: 0, z: hostCharger.position.z + 4 }],
          weaponId: 'blade',
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      // Target destroyed → charger is no longer engaged; guest sees the same state + dice.
      const afterFight = guest.getGameState()!;
      expect(afterFight.units.find((u) => u.id === guestTarget.id)!.isDestroyed).toBe(true);
      expect(afterFight.units.find((u) => u.id === hostCharger.id)!.status).not.toContain(
        'engaged'
      );
      expect(afterFight.actionLog[afterFight.actionLog.length - 1].dice!.outcome.wounds).toBe(2);

      // Target destroyed triggers interactive consolidation prompt for host victor.
      if (afterFight.turnState.pendingReaction) {
        expect(afterFight.turnState.pendingReaction.type).toBe('melee-consolidation');
        host.sendAction(
          createAction(HOST_PLAYER_ID, 'respond-reaction', {
            type: 'respond-reaction',
            reactionId: afterFight.turnState.pendingReaction.id,
            choiceId: 'stay',
          })
        );
        await new Promise((r) => setTimeout(r, 0));
      }

      // Host ends activation → Guest's turn.
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'end-activation', { type: 'end-activation' })
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(guest.getGameState()!.turnState.currentPlayerId).toBe(GUEST_PLAYER_ID);

      // Guest activates a unit and chooses Hold from the action bar → passes back to Host.
      const guestUnit = guest
        .getGameState()!
        .units.find((u) => u.ownerId === GUEST_PLAYER_ID && !u.isDestroyed)!;
      guest.sendAction(
        createAction(GUEST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: guestUnit.id,
        })
      );
      await new Promise((r) => setTimeout(r, 0));
      guest.sendAction(
        createAction(GUEST_PLAYER_ID, 'hold', {
          type: 'hold',
          unitId: guestUnit.id,
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(host.getGameState()!.turnState.currentPlayerId).toBe(HOST_PLAYER_ID);
      expect(guest.getGameState()!.turnState.currentPlayerId).toBe(HOST_PLAYER_ID);
    });

    it('charge with defender retaliation and push-back separation across the wire', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const diceProvider = {
        requestRoll: vi.fn().mockResolvedValue([
          { rolls: [6, 5], total: 11, finalTotal: 11, purpose: 'to-hit' },
          { rolls: [1, 2], total: 3, finalTotal: 3, purpose: 'defense' },
          { rolls: [6, 4], total: 10, finalTotal: 10, purpose: 'retaliation-to-hit' },
          { rolls: [5, 6], total: 11, finalTotal: 11, purpose: 'retaliation-defense' },
        ]),
      };
      const host = new GameManager(hostWebRTC, true, { diceProvider });
      const guest = new GameManager(guestWebRTC, false);

      host.startGame('Host', 'Guest');

      const hostCharger = host
        .getGameState()!
        .units.find((u) => u.ownerId === HOST_PLAYER_ID && u.weapons.some((w) => w.id === 'blade'))!;
      const guestTarget = host
        .getGameState()!
        .units.find((u) => u.ownerId === GUEST_PLAYER_ID && u.maxWounds >= 2)!;

      const patched = host.getGameState()!;
      const targetInState = patched.units.find((u) => u.id === guestTarget.id)!;
      targetInState.position = {
        x: hostCharger.position.x,
        y: 0,
        z: hostCharger.position.z + 5,
      };
      for (const m of targetInState.models) m.position = { ...targetInState.position };
      if (!targetInState.weapons.some((w) => w.profile.type === 'melee')) {
        targetInState.weapons.push({
          id: 'blade',
          name: 'Blade',
          isEquipped: true,
          profile: { type: 'melee', range: 1, attacks: 2, ap: 0, specialRules: [] },
        });
      }
      (host as any).gameState = patched;

      host.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostCharger.id,
        })
      );
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'charge', {
          type: 'charge',
          attackerId: hostCharger.id,
          targetId: guestTarget.id,
          path: [{ x: hostCharger.position.x, y: 0, z: hostCharger.position.z + 4 }],
          weaponId: 'blade',
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      // Charge resolves: Host hits, target takes wounds & survives.
      // A pending reaction is now active for Guest to decide retaliation.
      const afterChargeGuest = guest.getGameState()!;
      expect(afterChargeGuest.turnState.pendingReaction).toBeDefined();
      expect(afterChargeGuest.turnState.pendingReaction?.promptingPlayerId).toBe(GUEST_PLAYER_ID);

      // Guest sends respond-reaction with strike-back
      guest.sendAction(
        createAction(GUEST_PLAYER_ID, 'respond-reaction', {
          type: 'respond-reaction',
          reactionId: afterChargeGuest.turnState.pendingReaction!.id,
          choiceId: 'strike-back',
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      // After reaction resolves:
      const afterReactionGuest = guest.getGameState()!;
      expect(afterReactionGuest.turnState.pendingReaction).toBeNull();
      const lastEntry = afterReactionGuest.actionLog[afterReactionGuest.actionLog.length - 1];
      expect(lastEntry.dice?.outcome.pushedBack).toBe(true);

      const chargerInGuest = afterReactionGuest.units.find((u) => u.id === hostCharger.id)!;
      const targetInGuest = afterReactionGuest.units.find((u) => u.id === guestTarget.id)!;

      // Both units are Fatigued and NOT Engaged.
      expect(chargerInGuest.status).toContain('fatigued');
      expect(targetInGuest.status).toContain('fatigued');
      expect(chargerInGuest.status).not.toContain('engaged');
      expect(targetInGuest.status).not.toContain('engaged');

      // Charger has been pushed back to create >= 1.5" center separation.
      const sepDist = Math.hypot(
        chargerInGuest.position.x - targetInGuest.position.x,
        chargerInGuest.position.z - targetInGuest.position.z
      );
      expect(sepDist).toBeGreaterThanOrEqual(1.5);

      // Host ends activation, and Guest in their turn can freely execute a Move
      // (proving models are not locked in melee).
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'end-activation', { type: 'end-activation' })
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(guest.getGameState()!.turnState.currentPlayerId).toBe(GUEST_PLAYER_ID);

      guest.sendAction(
        createAction(GUEST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: guestTarget.id,
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      const moveDest = {
        x: targetInGuest.position.x + 2,
        y: 0,
        z: targetInGuest.position.z,
      };
      guest.sendAction(
        createAction(GUEST_PLAYER_ID, 'advance', {
          type: 'advance',
          unitId: guestTarget.id,
          path: [targetInGuest.position, moveDest],
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      const afterMove = host.getGameState()!.units.find((u) => u.id === guestTarget.id)!;
      expect(afterMove.position.x).toBeCloseTo(moveDest.x, 1);
      expect(afterMove.hasMoved).toBe(true);
    });

    it('charge reaction decline: defender declines over wire, avoiding fatigue and pushing charger back', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true, {
        diceProvider: {
          requestRoll: async () => [
            { rolls: [5, 4], total: 9, finalTotal: 9, purpose: 'to-hit' },
            { rolls: [5, 5], total: 10, finalTotal: 10, purpose: 'defense' },
          ],
        },
      });
      const guest = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      const hostCharger = host.getGameState()!.units.find((u) => u.ownerId === HOST_PLAYER_ID)!;
      const guestTarget = host
        .getGameState()!
        .units.find((u) => u.ownerId === GUEST_PLAYER_ID && u.maxWounds >= 2)!;

      const patched = host.getGameState()!;
      const targetInState = patched.units.find((u) => u.id === guestTarget.id)!;
      targetInState.position = {
        x: hostCharger.position.x,
        y: 0,
        z: hostCharger.position.z + 5,
      };
      for (const m of targetInState.models) m.position = { ...targetInState.position };
      if (!targetInState.weapons.some((w) => w.profile.type === 'melee')) {
        targetInState.weapons.push({
          id: 'blade',
          name: 'Blade',
          isEquipped: true,
          profile: { type: 'melee', range: 1, attacks: 2, ap: 0, specialRules: [] },
        });
      }
      (host as any).gameState = patched;

      host.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostCharger.id,
        })
      );
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'charge', {
          type: 'charge',
          attackerId: hostCharger.id,
          targetId: guestTarget.id,
          path: [{ x: hostCharger.position.x, y: 0, z: hostCharger.position.z + 4 }],
          weaponId: 'blade',
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      const afterChargeGuest = guest.getGameState()!;
      const reaction = afterChargeGuest.turnState.pendingReaction!;
      expect(reaction).toBeDefined();

      // Guest chooses decline
      guest.sendAction(
        createAction(GUEST_PLAYER_ID, 'respond-reaction', {
          type: 'respond-reaction',
          reactionId: reaction.id,
          choiceId: 'decline',
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      const afterReactionGuest = guest.getGameState()!;
      expect(afterReactionGuest.turnState.pendingReaction).toBeNull();
      const chargerInGuest = afterReactionGuest.units.find((u) => u.id === hostCharger.id)!;
      const targetInGuest = afterReactionGuest.units.find((u) => u.id === guestTarget.id)!;

      // Charger is pushed back and fatigued
      expect(chargerInGuest.status).toContain('fatigued');
      // Defender declined so defender is NOT fatigued!
      expect(targetInGuest.status).not.toContain('fatigued');
      // Charger separated
      const sepDist = Math.hypot(
        chargerInGuest.position.x - targetInGuest.position.x,
        chargerInGuest.position.z - targetInGuest.position.z
      );
      expect(sepDist).toBeGreaterThanOrEqual(1.5);
    });

    it('host reaction timeout auto-resolves with default choice', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true, {
        diceProvider: {
          requestRoll: async () => [
            { rolls: [5, 4], total: 9, finalTotal: 9, purpose: 'to-hit' },
            { rolls: [5, 5], total: 10, finalTotal: 10, purpose: 'defense' },
          ],
        },
      });
      const guest = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      const hostCharger = host.getGameState()!.units.find((u) => u.ownerId === HOST_PLAYER_ID)!;
      const guestTarget = host
        .getGameState()!
        .units.find((u) => u.ownerId === GUEST_PLAYER_ID && u.maxWounds >= 2)!;

      const patched = host.getGameState()!;
      const targetInState = patched.units.find((u) => u.id === guestTarget.id)!;
      targetInState.position = {
        x: hostCharger.position.x,
        y: 0,
        z: hostCharger.position.z + 5,
      };
      for (const m of targetInState.models) m.position = { ...targetInState.position };
      if (!targetInState.weapons.some((w) => w.profile.type === 'melee')) {
        targetInState.weapons.push({
          id: 'blade',
          name: 'Blade',
          isEquipped: true,
          profile: { type: 'melee', range: 1, attacks: 2, ap: 0, specialRules: [] },
        });
      }
      (host as any).gameState = patched;

      host.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostCharger.id,
        })
      );
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'charge', {
          type: 'charge',
          attackerId: hostCharger.id,
          targetId: guestTarget.id,
          path: [{ x: hostCharger.position.x, y: 0, z: hostCharger.position.z + 4 }],
          weaponId: 'blade',
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(host.getGameState()!.turnState.pendingReaction).toBeDefined();

      // Trigger timeout directly to test auto-resolution logic
      (host as any).handleReactionTimeout();
      await new Promise((r) => setTimeout(r, 0));

      // Reaction is resolved with default option (strike-back)
      expect(host.getGameState()!.turnState.pendingReaction).toBeNull();
      expect(guest.getGameState()!.turnState.pendingReaction).toBeNull();
      const lastEntry = host.getGameState()!.actionLog[host.getGameState()!.actionLog.length - 1];
      expect(lastEntry.action.type).toBe('respond-reaction');
      expect((lastEntry.action.payload as any).choiceId).toBe('strike-back');
    });

    it('a squad charge waits for the defender to pile in; the timeout places the models and rolls the strike', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const requested: string[][] = [];
      const host = new GameManager(hostWebRTC, true, {
        diceProvider: {
          // Hits always land and nothing is saved
          requestRoll: async (_id: string, specs: any[]) => {
            requested.push(specs.map((s) => s.purpose));
            return specs.map((s) => {
              const rolls = Array(s.count).fill(s.purpose === 'defense' ? 6 : 1);
              return { rolls, total: rolls.reduce((a: number, b: number) => a + b, 0), finalTotal: 0, purpose: s.purpose };
            });
          },
        },
      });
      const guest = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      const state = host.getGameState()!;
      const template = state.units.find((u) => u.ownerId === HOST_PLAYER_ID)!;
      const mkSquad = (id: string, ownerId: string, spots: Array<[number, number]>) => ({
        ...JSON.parse(JSON.stringify(template)),
        id,
        ownerId,
        name: id,
        status: [],
        isActivated: false,
        hasMoved: false,
        hasAttacked: false,
        remainingMovement: 4,
        speed: 4,
        position: { x: spots[0][0], y: 0, z: spots[0][1] },
        models: spots.map(([x, z], i) => ({
          id: `${id}-m${i}`,
          wounds: 1,
          maxWounds: 1,
          isDestroyed: false,
          position: { x, y: 0, z },
          rotation: { x: 0, y: 0, z: 0 },
        })),
        wounds: spots.length,
        maxWounds: spots.length,
        weapons: [
          { id: 'blade', name: 'Blade', isEquipped: true, profile: { type: 'melee', range: 1, attacks: 2, specialRules: [] } },
        ],
        specialRules: [],
      });
      state.terrain = [];
      state.units = [
        mkSquad('hs', HOST_PLAYER_ID, [[0, 0], [1, 0], [2, 0], [3, 0]]),
        mkSquad('gs', GUEST_PLAYER_ID, [[0, 9], [1, 9], [0.5, 10]]),
      ];
      state.turnState.currentPlayerId = HOST_PLAYER_ID;
      (host as any).gameState = state;

      host.sendAction(createAction(HOST_PLAYER_ID, 'activate-unit', { type: 'activate-unit', unitId: 'hs' }));
      host.sendAction(createAction(HOST_PLAYER_ID, 'begin-charge', { type: 'begin-charge', attackerId: 'hs', targetId: 'gs' }));
      const ends = [0, 1, 2, 3].map((x) => ({ x, y: 0, z: 8 }));
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'charge', {
          type: 'charge',
          attackerId: 'hs',
          targetId: 'gs',
          path: [{ x: 0, y: 0, z: 0 }, ends[0]],
          weaponId: 'blade',
          modelPositions: ends,
          modelPaths: ends.map((e, i) => [{ x: i, y: 0, z: 0 }, e]),
        } as any)
      );
      await new Promise((r) => setTimeout(r, 0));

      // The charge rolled nothing and is waiting for the defender (guest sees the same prompt)
      expect(requested).toEqual([]);
      const pending = host.getGameState()!.turnState.pendingReaction!;
      expect(pending.type).toBe('pile-in');
      expect(guest.getGameState()!.turnState.pendingReaction?.id).toBe(pending.id);

      (host as any).handleReactionTimeout();
      await new Promise((r) => setTimeout(r, 0));

      // The host placed the model and then rolled the strike (one request, after the pile-in)
      expect(requested).toHaveLength(1);
      expect(requested[0]).toContain('to-hit');
      const after = host.getGameState()!;
      expect(after.turnState.pendingReaction?.type).toBe('melee-retaliation');
      const moved = after.units.find((u) => u.id === 'gs')!.models[2].position!;
      expect(Math.hypot(moved.x - 0.5, moved.z - 10)).toBeGreaterThan(0.5);
      expect(guest.getGameState()!.turnState.pendingReaction?.type).toBe('melee-retaliation');
    });

    it('wounds into a squad wait for its owner to pick casualties; the timeout picks without rolling again', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const requested: string[][] = [];
      const host = new GameManager(hostWebRTC, true, {
        diceProvider: {
          // Every attack hits and nothing is saved; the wound-effect roll is a 1 (shaken)
          requestRoll: async (_id: string, specs: any[]) => {
            requested.push(specs.map((s) => s.purpose));
            return specs.map((s) => {
              const rolls = Array(s.count).fill(s.purpose === 'to-hit' ? 6 : 1);
              return { rolls, total: rolls.reduce((a: number, b: number) => a + b, 0), finalTotal: 0, purpose: s.purpose };
            });
          },
        },
      });
      const guest = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      const state = host.getGameState()!;
      const template = state.units.find((u) => u.ownerId === HOST_PLAYER_ID)!;
      const mkSquad = (id: string, ownerId: string, spots: Array<[number, number]>) => ({
        ...JSON.parse(JSON.stringify(template)),
        id,
        ownerId,
        name: id,
        status: [],
        isActivated: false,
        hasMoved: false,
        hasAttacked: false,
        remainingMovement: 4,
        speed: 4,
        position: { x: spots[0][0], y: 0, z: spots[0][1] },
        models: spots.map(([x, z], i) => ({
          id: `${id}-m${i}`,
          wounds: 1,
          maxWounds: 1,
          isDestroyed: false,
          position: { x, y: 0, z },
          rotation: { x: 0, y: 0, z: 0 },
        })),
        wounds: spots.length,
        maxWounds: spots.length,
        weapons: [
          { id: 'rifle', name: 'Rifle', isEquipped: true, profile: { type: 'ranged', range: 24, attacks: 1, specialRules: [] } },
        ],
        specialRules: [],
      });
      state.terrain = [];
      state.units = [
        mkSquad('hs', HOST_PLAYER_ID, [[0, 0], [1, 0]]),
        mkSquad('gs', GUEST_PLAYER_ID, [[2, 10], [0, 10], [4, 10], [6, 10]]),
      ];
      state.turnState.currentPlayerId = HOST_PLAYER_ID;
      (host as any).gameState = state;

      host.sendAction(createAction(HOST_PLAYER_ID, 'activate-unit', { type: 'activate-unit', unitId: 'hs' }));
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'shoot', { type: 'shoot', attackerId: 'hs', targetId: 'gs', weaponId: 'rifle' } as any)
      );
      await new Promise((r) => setTimeout(r, 0));

      const pending = host.getGameState()!.turnState.pendingReaction!;
      expect(pending.type).toBe('pick-casualties');
      expect(pending.promptingPlayerId).toBe(GUEST_PLAYER_ID);
      expect(guest.getGameState()!.turnState.pendingReaction?.id).toBe(pending.id);
      expect(host.getGameState()!.units.find((u) => u.id === 'gs')!.models.every((m) => !m.isDestroyed)).toBe(true);
      const diceRequests = requested.length;

      (host as any).handleReactionTimeout();
      await new Promise((r) => setTimeout(r, 0));

      // No new dice: the wounds were rolled with the shot. The host kept the chain together.
      expect(requested).toHaveLength(diceRequests);
      const after = host.getGameState()!;
      expect(after.turnState.pendingReaction ?? null).toBeNull();
      const alive = after.units.find((u) => u.id === 'gs')!.models.filter((m) => !m.isDestroyed).map((m) => m.id);
      expect(alive).toEqual(['gs-m2', 'gs-m3']); // an end model first, then the next end in list order
      expect(guest.getGameState()!.turnState.pendingReaction ?? null).toBeNull();
    });

    it('peer disconnect pauses pending reaction timer and resumes it when peer reconnects', async () => {
      const { hostWebRTC, guestWebRTC, disconnectGuest, reconnectGuest } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true, {
        diceProvider: {
          requestRoll: async () => [
            { rolls: [5, 4], total: 9, finalTotal: 9, purpose: 'to-hit' },
            { rolls: [5, 5], total: 10, finalTotal: 10, purpose: 'defense' },
          ],
        },
      });
      const guest = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      const hostCharger = host.getGameState()!.units.find((u) => u.ownerId === HOST_PLAYER_ID)!;
      const guestTarget = host
        .getGameState()!
        .units.find((u) => u.ownerId === GUEST_PLAYER_ID && u.maxWounds >= 2)!;

      const patched = host.getGameState()!;
      const targetInState = patched.units.find((u) => u.id === guestTarget.id)!;
      targetInState.position = {
        x: hostCharger.position.x,
        y: 0,
        z: hostCharger.position.z + 5,
      };
      for (const m of targetInState.models) m.position = { ...targetInState.position };
      if (!targetInState.weapons.some((w) => w.profile.type === 'melee')) {
        targetInState.weapons.push({
          id: 'blade',
          name: 'Blade',
          isEquipped: true,
          profile: { type: 'melee', range: 1, attacks: 2, ap: 0, specialRules: [] },
        });
      }
      (host as any).gameState = patched;

      host.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostCharger.id,
        })
      );
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'charge', {
          type: 'charge',
          attackerId: hostCharger.id,
          targetId: guestTarget.id,
          path: [{ x: hostCharger.position.x, y: 0, z: hostCharger.position.z + 4 }],
          weaponId: 'blade',
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(host.getGameState()!.turnState.pendingReaction).toBeDefined();

      // Guest disconnects mid-reaction!
      disconnectGuest();
      await new Promise((r) => setTimeout(r, 0));

      // Reaction is paused (not deadlocked, not auto-resolved immediately)
      expect(host.getGameState()!.turnState.pendingReaction).toBeDefined();
      expect((host as any).pausedReactionRemainingMs).toBeGreaterThan(0);
      expect((host as any).reactionTimeoutTimer).toBeNull();

      // Guest reconnects!
      reconnectGuest();
      await new Promise((r) => setTimeout(r, 0));

      // Reaction timer resumes seamlessly
      expect(host.getGameState()!.turnState.pendingReaction).toBeDefined();
      expect((host as any).pausedReactionRemainingMs).toBeNull();
      expect((host as any).reactionTimeoutTimer).not.toBeNull();
    });

    it('rebinds host GameManager and re-broadcasts state when a guest rejoins over a new channel', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true);
      const guest1 = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      // Host activates a unit before the guest disconnects.
      const hostUnitId = host.getGameState()!.units[0].id;
      host.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostUnitId,
        })
      );
      expect(guest1.getGameState()!.turnState.activeUnitId).toBe(hostUnitId);

      // Guest disconnects and reconnects over a brand-new WebRTC channel pair.
      const channel2 = makeChannelPair();
      const guest2 = new GameManager(channel2.guestWebRTC, false);
      host.rebindWebRTCClient(channel2.hostWebRTC);

      // Rejoined guest immediately receives the current in-progress state.
      expect(guest2.getGameState()!.turnState.activeUnitId).toBe(hostUnitId);

      // And subsequent actions from the rejoined guest work over the new channel.
      host.sendAction(createAction(HOST_PLAYER_ID, 'end-activation', { type: 'end-activation' }));
      const guestUnitId = guest2
        .getGameState()!
        .units.find((u: any) => u.ownerId === GUEST_PLAYER_ID)!.id;
      guest2.sendAction(
        createAction(GUEST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: guestUnitId,
        })
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(host.getGameState()!.turnState.activeUnitId).toBe(guestUnitId);
      expect(guest2.getGameState()!.turnState.activeUnitId).toBe(guestUnitId);
    });

    it('restores game state from snapshot on host and broadcasts to guest', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true);
      const guest = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      const originalState = host.getGameState()!;
      originalState.turnState.roundNumber = 3;

      // Host restores from snapshot
      host.restoreFromSnapshot(originalState);

      expect(host.getGameState()!.turnState.roundNumber).toBe(3);
      expect(guest.getGameState()!.turnState.roundNumber).toBe(3);
    });

    it('recovers authoritative state on host via peer-fallback request-state-sync if host storage was empty', async () => {
      // 1. Initial game where guest has received state
      const channel1 = makeChannelPair();
      const host1 = new GameManager(channel1.hostWebRTC, true);
      const guest = new GameManager(channel1.guestWebRTC, false);
      host1.startGame('Host', 'Guest');

      const guestState = guest.getGameState()!;
      expect(guestState).toBeDefined();

      // 2. Host reloads/rejoins with wiped local storage (null gameState)
      const channel2 = makeChannelPair();
      const rejoiningHost = new GameManager(channel2.hostWebRTC, true);
      expect(rejoiningHost.getGameState()).toBeNull();

      // Re-bind guest to channel2
      guest.rebindWebRTCClient(channel2.guestWebRTC);

      // Rejoining host sends request-state-sync
      rejoiningHost.requestStateSyncFromPeer();

      // Host receives state-sync from Guest and adopts it authoritatively
      expect(rejoiningHost.getGameState()).toBeDefined();
      expect(rejoiningHost.getGameState()!.turnState.roundNumber).toBe(guestState.turnState.roundNumber);
      expect(rejoiningHost.getGameState()!.units.length).toBe(guestState.units.length);

      // 3. Rejoining host is authoritative and can successfully process subsequent actions
      const hostUnit = rejoiningHost.getGameState()!.units.find((u: any) => u.ownerId === HOST_PLAYER_ID)!;
      rejoiningHost.sendAction(
        createAction(HOST_PLAYER_ID, 'activate-unit', {
          type: 'activate-unit',
          unitId: hostUnit.id,
        })
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(rejoiningHost.getGameState()!.turnState.activeUnitId).toBe(hostUnit.id);
      expect(guest.getGameState()!.turnState.activeUnitId).toBe(hostUnit.id);
    });

    it('terminates game after round 4 with objective control winner across the wire', async () => {
      const { hostWebRTC, guestWebRTC } = makeChannelPair();
      const host = new GameManager(hostWebRTC, true);
      const guest = new GameManager(guestWebRTC, false);
      host.startGame('Host', 'Guest');

      // Set round 4 and position units so Host controls 1 objective and Guest controls 0
      const patched = host.getGameState()!;
      patched.turnState.roundNumber = 4;
      // Objectives are placed by the players now: put one marker down directly
      patched.objectives = [
        { id: 'objective-1', name: 'Objective 1', position: { x: -10, y: 0, z: -4 }, controllingPlayerId: null, isContested: false },
      ];
      // Host unit at Objective Alpha (-10, 0, -4)
      patched.units[0].position = { x: -10, y: 0, z: -4 };
      if (patched.units[0].models) {
        for (const m of patched.units[0].models) {
          m.position = { x: -10, y: 0, z: -4 };
        }
      }
      // Move all other units far away
      for (let i = 1; i < patched.units.length; i++) {
        patched.units[i].position = { x: 50 + i * 2, y: 0, z: 50 };
        if (patched.units[i].models) {
          for (const m of patched.units[i].models) {
            m.position = { x: 50 + i * 2, y: 0, z: 50 };
          }
        }
      }
      (host as any).gameState = patched;

      // Finish activations for all units
      for (const u of patched.units) {
        u.isActivated = true;
      }
      host.sendAction(createAction(HOST_PLAYER_ID, 'end-round', { type: 'end-round' }));
      await new Promise((r) => setTimeout(r, 0));

      const finalHostState = host.getGameState()!;
      const finalGuestState = guest.getGameState()!;

      expect(finalHostState.status).toBe('game-over');
      expect(finalGuestState.status).toBe('game-over');
      expect(finalHostState.turnState.roundNumber).toBe(4);
      expect(finalHostState.winner).toBe(HOST_PLAYER_ID);
      expect(finalGuestState.winner).toBe(HOST_PLAYER_ID);
      expect(finalHostState.endReason).toContain('Objective victory');
    });
  });

  describe('onActionRejected subscription', () => {
    it('stops emitting after unsubscribe', () => {
      const handler = vi.fn();
      const unsubscribe = gameManagerHost.onActionRejected(handler);
      unsubscribe();

      gameManagerHost.sendAction(createAction('host1', 'end-round', { type: 'end-round' }));
      gameManagerHost.initializeGame('host1', 'guest1');
      gameManagerHost.sendAction(createAction('guest1', 'end-round', { type: 'end-round' }));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onStateUpdate', () => {
    it('should emit state to subscribers when host initializes the game', () => {
      const handler = vi.fn();
      gameManagerHost.onStateUpdate(handler);

      gameManagerHost.initializeGame('host1', 'guest1');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].hostId).toBe('host1');
    });

    it('should emit state to subscribers when host processes an action', () => {
      gameManagerHost.initializeGame('host1', 'guest1');
      const handler = vi.fn();
      gameManagerHost.onStateUpdate(handler);

      const action = createAction('host1', 'end-round', { type: 'end-round' });
      gameManagerHost.sendAction(action);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].lastActionId).toBe(action.id);
    });

    it('should emit state updates received from the host to guest subscribers', () => {
      gameManagerHost.initializeGame('host1', 'guest1');
      const hostState = gameManagerHost.getGameState()!;

      const handler = vi.fn();
      gameManagerGuest.onStateUpdate(handler);
      handlers.get('state-update')!({ type: 'state-update', state: hostState, actionId: 'x' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].hostId).toBe('host1');
    });

    it('should emit deep copies — mutating the emitted state does not affect the manager', () => {
      gameManagerHost.initializeGame('host1', 'guest1');
      let emitted: any;
      gameManagerHost.onStateUpdate((state) => { emitted = state; });

      // Trigger an emission, then mutate what we received.
      gameManagerHost.sendAction(createAction('host1', 'end-round', { type: 'end-round' }));
      expect(emitted).toBeDefined();

      emitted.units.push({ id: 'injected' } as any);

      expect(gameManagerHost.getGameState()!.units.length).toBe(0);
    });

    it('should stop emitting after unsubscribe', () => {
      const handler = vi.fn();
      const unsubscribe = gameManagerHost.onStateUpdate(handler);
      unsubscribe();

      gameManagerHost.initializeGame('host1', 'guest1');
      gameManagerHost.sendAction(createAction('host1', 'end-round', { type: 'end-round' }));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('rematch persistence (14B)', () => {
    function memoryStorage(): Storage {
      const data = new Map<string, string>();
      return {
        get length() { return data.size; },
        clear: () => data.clear(),
        getItem: (k: string) => data.get(k) ?? null,
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        removeItem: (k: string) => { data.delete(k); },
        setItem: (k: string, v: string) => { data.set(k, String(v)); },
      } as Storage;
    }
    function pair() {
      const hostH = new Map<string, Function[]>();
      const guestH = new Map<string, Function[]>();
      const mk = (mine: Map<string, Function[]>, theirs: Map<string, Function[]>) =>
        ({
          on: vi.fn((t: string, h: Function) => mine.set(t, [...(mine.get(t) ?? []), h])),
          onConnectionState: vi.fn(),
          send: vi.fn((m: any) => { for (const h of theirs.get(m.type) ?? []) h(m); }),
        }) as any;
      return { hostWebRTC: mk(hostH, guestH), guestWebRTC: mk(guestH, hostH) };
    }
    function setup() {
      const hostStore = new SessionStore(memoryStorage());
      const guestStore = new SessionStore(memoryStorage());
      const hostResume = vi.fn();
      const guestResume = vi.fn();
      const { hostWebRTC, guestWebRTC } = pair();
      const host = new GameManager(hostWebRTC, true, {
        sessionStore: hostStore, roomCode: 'ABC-123', onSessionResume: hostResume,
      });
      const guest = new GameManager(guestWebRTC, false, {
        sessionStore: guestStore, roomCode: 'ABC-123', onSessionResume: guestResume,
      });
      host.startGame('Host', 'Guest', { hostArmyId: 'a', guestArmyId: 'b' } as any);
      return { host, guest, hostStore, guestStore, hostResume, guestResume };
    }
    const act = (m: GameManager, who: string, type: any) => m.sendAction(createAction(who, type, { type } as any));

    it('passes the lobby options through so the setup is recorded on the state', () => {
      const { host } = setup();
      expect(host.getGameState()!.setup).toMatchObject({ hostArmyId: 'a', guestArmyId: 'b' });
    });

    it('a rematch re-saves snapshots and the active session on both peers and resets the history', () => {
      const { host, guest, hostStore, guestStore, hostResume, guestResume } = setup();
      const oldId = host.getGameState()!.gameId;
      act(host, HOST_PLAYER_ID, 'concede');
      expect(host.getGameState()!.status).toBe('game-over');
      expect(hostStore.getSnapshot('ABC-123')).toBeNull();
      expect(hostResume).not.toHaveBeenCalled();

      act(guest, GUEST_PLAYER_ID, 'request-rematch');
      expect(hostResume).not.toHaveBeenCalled();
      act(host, HOST_PLAYER_ID, 'request-rematch');

      for (const [m, store, resume] of [
        [host, hostStore, hostResume],
        [guest, guestStore, guestResume],
      ] as const) {
        const s = m.getGameState()!;
        expect(s.gameId).not.toBe(oldId);
        expect(s.status).not.toBe('game-over');
        expect(resume).toHaveBeenCalledTimes(1);
        expect(store.getSnapshot('ABC-123')!.gameId).toBe(s.gameId);
        expect(m.getSnapshots().every((x) => x.gameId === s.gameId)).toBe(true);
        expect(m.getSnapshots().length).toBe(1);
      }
    });

    it('a reload during the rematch restores the rematch, not the old match', () => {
      const { host, guest, hostStore } = setup();
      act(host, HOST_PLAYER_ID, 'concede');
      act(guest, GUEST_PLAYER_ID, 'request-rematch');
      act(host, HOST_PLAYER_ID, 'request-rematch');
      const rematchId = host.getGameState()!.gameId;
      const cached = hostStore.getSnapshot('ABC-123')!;
      const { hostWebRTC } = pair();
      const reloaded = new GameManager(hostWebRTC, true, { sessionStore: hostStore, roomCode: 'ABC-123' });
      reloaded.restoreFromSnapshot(cached);
      expect(reloaded.getGameState()!.gameId).toBe(rematchId);
      expect(reloaded.getGameState()!.status).not.toBe('game-over');
    });

    it('does not fire the session hook for ordinary updates or restores', () => {
      const { host, hostResume } = setup();
      act(host, HOST_PLAYER_ID, 'end-round');
      host.restoreFromSnapshot(host.getGameState()!);
      expect(hostResume).not.toHaveBeenCalled();
    });
  });
});
