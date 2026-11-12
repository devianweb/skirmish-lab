import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignalingClient } from '../../src/network/SignalingClient';

describe('SignalingClient', () => {
  let client: SignalingClient;

  beforeEach(() => {
    client = new SignalingClient('ws://localhost:8080');
  });

  it('should route messages to registered handlers by type', () => {
    const handler = vi.fn();
    client.on('room-created', handler);
    
    // Access private method for testing
    (client as any).handleMessage({ type: 'room-created', code: 'ABC-123' });
    
    expect(handler).toHaveBeenCalledWith({ type: 'room-created', code: 'ABC-123' });
  });

  it('should call multiple handlers for the same message type', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    client.on('peer-joined', handler1);
    client.on('peer-joined', handler2);
    
    (client as any).handleMessage({ type: 'peer-joined' });
    
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it('should remove handlers when off is called', () => {
    const handler = vi.fn();
    client.on('error', handler);
    client.off('error', handler);
    
    (client as any).handleMessage({ type: 'error', message: 'test' });
    
    expect(handler).not.toHaveBeenCalled();
  });

  it('should call wildcard handlers for all messages', () => {
    const wildcardHandler = vi.fn();
    client.on('*', wildcardHandler);
    
    (client as any).handleMessage({ type: 'room-created', code: 'ABC-123' });
    
    expect(wildcardHandler).toHaveBeenCalled();
  });

  it('should format room creation message correctly', () => {
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => {});
    client.createRoom();
    expect(sendSpy).toHaveBeenCalledWith({ type: 'create-room' });
  });

  it('should format room join message correctly', () => {
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => {});
    client.joinRoom('ABC-123');
    expect(sendSpy).toHaveBeenCalledWith({ type: 'join-room', code: 'ABC-123' });
  });

  it('should format offer message correctly', () => {
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => {});
    const sdp = { type: 'offer', sdp: 'test' } as RTCSessionDescriptionInit;
    client.sendOffer(sdp);
    expect(sendSpy).toHaveBeenCalledWith({ type: 'offer', sdp });
  });

  it('should format dice roll request correctly', () => {
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => {});
    client.requestDiceRoll('roll-1', [{ count: 2, sides: 6 }]);
    expect(sendSpy).toHaveBeenCalledWith({ 
      type: 'roll-dice-request', 
      rollId: 'roll-1', 
      dice: [{ count: 2, sides: 6 }] 
    });
  });

  it('startKeepAlive sends periodic pings and can be stopped', () => {
    vi.useFakeTimers();
    try {
      const pingSpy = vi.spyOn(client, 'ping').mockImplementation(() => {});
      const stop = client.startKeepAlive(25000);
      expect(pingSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(25000);
      expect(pingSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(25000);
      expect(pingSpy).toHaveBeenCalledTimes(2);

      stop();
      vi.advanceTimersByTime(25000);
      expect(pingSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnectRoom sends reconnect-room message with code and role', () => {
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => {});
    client.reconnectRoom('ABC-123', 'host');
    expect(sendSpy).toHaveBeenCalledWith({
      type: 'reconnect-room',
      code: 'ABC-123',
      role: 'host',
    });
  });

  it('captures rejoinToken from room-created and room-joined and sends it with reconnect-room and join-room', () => {
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => {});

    (client as any).handleMessage({
      type: 'room-created',
      code: 'ABC-123',
      rejoinToken: 'host-token-1',
    });
    expect(client.getRejoinToken()).toBe('host-token-1');

    client.reconnectRoom('ABC-123', 'host');
    expect(sendSpy).toHaveBeenLastCalledWith({
      type: 'reconnect-room',
      code: 'ABC-123',
      role: 'host',
      rejoinToken: 'host-token-1',
    });

    (client as any).handleMessage({
      type: 'room-joined',
      code: 'ABC-123',
      role: 'guest',
      rejoinToken: 'guest-token-2',
    });
    expect(client.getRejoinToken()).toBe('guest-token-2');

    client.joinRoom('ABC-123', 'resume-token-3');
    expect(sendSpy).toHaveBeenLastCalledWith({
      type: 'join-room',
      code: 'ABC-123',
      rejoinToken: 'resume-token-3',
    });

    client.leaveRoom();
    expect(client.getRejoinToken()).toBeNull();
  });

  it('connect rejects when socket closes before opening without scheduling internal reconnect', async () => {
    let createdSocket: any = null;
    vi.stubGlobal(
      'WebSocket',
      class {
        onopen: (() => void) | null = null;
        onmessage: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        onclose: (() => void) | null = null;
        constructor() {
          createdSocket = this;
        }
      }
    );
    try {
      client.on('room-created', () => {});
      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect');
      const connectPromise = client.connect();
      createdSocket.onclose?.();
      await expect(connectPromise).rejects.toThrow('WebSocket closed before opening');
      expect(reconnectSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps reconnecting in the background when an attempt fails after the socket had been open', async () => {
    const sockets: any[] = [];
    vi.stubGlobal(
      'WebSocket',
      class {
        static OPEN = 1;
        readyState = 0;
        onopen: (() => void) | null = null;
        onmessage: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        onclose: (() => void) | null = null;
        constructor() {
          sockets.push(this);
        }
        close() {}
      }
    );
    try {
      client.on('room-created', () => {});
      const first = client.connect();
      sockets[0].onopen?.();
      await first;
      // The game's socket drops; a dice request's ensureConnected() then tries straight away and fails
      const reconnectSpy = vi.spyOn(client, 'scheduleReconnect').mockImplementation(() => {});
      const retry = client.ensureConnected();
      sockets[1].onclose?.();
      await expect(retry).rejects.toThrow('WebSocket closed before opening');
      expect(reconnectSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
