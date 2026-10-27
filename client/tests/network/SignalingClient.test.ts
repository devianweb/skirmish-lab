import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignalingClient } from '../../src/network/SignalingClient';

describe('SignalingClient', () => {
  let client: SignalingClient;

  beforeEach(() => {
    client = new SignalingClient('ws://localhost:8080');
  });

  it('should create instance with default url', () => {
    const defaultClient = new SignalingClient();
    expect(defaultClient).toBeInstanceOf(SignalingClient);
  });

  it('should create instance with custom url', () => {
    expect(client).toBeInstanceOf(SignalingClient);
  });

  it('should register event handlers', () => {
    const handler = vi.fn();
    client.on('room-created', handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should unregister event handlers', () => {
    const handler = vi.fn();
    client.on('room-created', handler);
    client.off('room-created', handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should have createRoom method', () => {
    expect(typeof client.createRoom).toBe('function');
  });

  it('should have joinRoom method', () => {
    expect(typeof client.joinRoom).toBe('function');
  });

  it('should have sendOffer method', () => {
    expect(typeof client.sendOffer).toBe('function');
  });

  it('should have sendAnswer method', () => {
    expect(typeof client.sendAnswer).toBe('function');
  });

  it('should have sendIceCandidate method', () => {
    expect(typeof client.sendIceCandidate).toBe('function');
  });

  it('should have ping method', () => {
    expect(typeof client.ping).toBe('function');
  });

  it('should have disconnect method', () => {
    expect(typeof client.disconnect).toBe('function');
  });
});
