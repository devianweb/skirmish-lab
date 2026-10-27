import { describe, it, expect, beforeEach } from 'vitest';
import { WebRTCClient } from '../../src/network/WebRTCClient';

describe('WebRTCClient', () => {
  let client: WebRTCClient;

  beforeEach(() => {
    client = new WebRTCClient();
  });

  it('should create instance', () => {
    expect(client).toBeInstanceOf(WebRTCClient);
  });

  it('should have createPeerConnection method', () => {
    expect(typeof client.createPeerConnection).toBe('function');
  });

  it('should have createDataChannel method', () => {
    expect(typeof client.createDataChannel).toBe('function');
  });

  it('should have createOffer method', () => {
    expect(typeof client.createOffer).toBe('function');
  });

  it('should have createAnswer method', () => {
    expect(typeof client.createAnswer).toBe('function');
  });

  it('should have setRemoteDescription method', () => {
    expect(typeof client.setRemoteDescription).toBe('function');
  });

  it('should have addIceCandidate method', () => {
    expect(typeof client.addIceCandidate).toBe('function');
  });

  it('should have send method', () => {
    expect(typeof client.send).toBe('function');
  });

  it('should have on method', () => {
    expect(typeof client.on).toBe('function');
  });

  it('should have isConnected method', () => {
    expect(typeof client.isConnected).toBe('function');
    expect(client.isConnected()).toBe(false);
  });

  it('should have close method', () => {
    expect(typeof client.close).toBe('function');
  });

  it('should register event handlers', () => {
    const handler = () => {};
    client.on('heartbeat-ping', handler);
    expect(client.isConnected()).toBe(false);
  });
});
