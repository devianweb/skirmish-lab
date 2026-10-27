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
});
