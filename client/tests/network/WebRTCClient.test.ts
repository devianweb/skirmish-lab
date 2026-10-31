import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebRTCClient } from '../../src/network/WebRTCClient';

describe('WebRTCClient', () => {
  let client: WebRTCClient;

  beforeEach(() => {
    client = new WebRTCClient();
  });

  it('should route game messages to registered handlers', () => {
    const handler = vi.fn();
    client.on('state-update', handler);
    
    (client as any).handleMessage({ type: 'state-update', state: {}, actionId: '123' });
    
    expect(handler).toHaveBeenCalledWith({ type: 'state-update', state: {}, actionId: '123' });
  });

  it('should respond to heartbeat-ping with heartbeat-pong', () => {
    const sendSpy = vi.spyOn(client, 'send').mockImplementation(() => {});
    
    (client as any).setupDataChannel();
    const dataChannel = {
      readyState: 'open',
      send: vi.fn(),
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };
    (client as any).dataChannel = dataChannel;
    (client as any).setupDataChannel();
    
    // Simulate ping
    dataChannel.onmessage!({ data: JSON.stringify({ type: 'heartbeat-ping', timestamp: 12345 }) });
    
    expect(sendSpy).toHaveBeenCalledWith({ type: 'heartbeat-pong', timestamp: 12345 });
  });

  it('should update lastPongTime when receiving heartbeat-pong', () => {
    const before = (client as any).lastPongTime;
    (client as any).handleMessage({ type: 'heartbeat-pong', timestamp: Date.now() });
    const after = (client as any).lastPongTime;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('should report not connected when data channel is closed', () => {
    expect(client.isConnected()).toBe(false);
  });

  it('should clean up on close', () => {
    const stopHeartbeatSpy = vi.spyOn(client as any, 'stopHeartbeat');
    client.close();
    expect(stopHeartbeatSpy).toHaveBeenCalled();
    expect((client as any).dataChannel).toBeNull();
    expect((client as any).peerConnection).toBeNull();
  });

  it('should transition to disconnected state when heartbeat times out after 6000ms', () => {
    const stateCallback = vi.fn();
    client.onConnectionState(stateCallback);

    // Force connected state
    (client as any).setConnectionState('connected');
    expect(stateCallback).toHaveBeenLastCalledWith('connected');

    // Simulate 6100ms of silence
    (client as any).lastPongTime = Date.now() - 6100;
    client.checkHeartbeat();

    expect(stateCallback).toHaveBeenLastCalledWith('disconnected');
  });

  it('should restore connection to connected when a game message arrives after timeout', () => {
    const stateCallback = vi.fn();
    (client as any).setConnectionState('disconnected');
    client.onConnectionState(stateCallback);

    const dataChannel = {
      readyState: 'open',
      send: vi.fn(),
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };
    (client as any).dataChannel = dataChannel;
    (client as any).setupDataChannel();

    // Message arrives from peer
    dataChannel.onmessage!({ data: JSON.stringify({ type: 'heartbeat-pong', timestamp: Date.now() }) });

    expect(stateCallback).toHaveBeenLastCalledWith('connected');
  });
});
