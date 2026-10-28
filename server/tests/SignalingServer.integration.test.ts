import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SignalingServer } from '../src/SignalingServer';
import WebSocket from 'ws';

describe('SignalingServer Integration', () => {
  let server: SignalingServer;
  const port = 19999;

  beforeAll(() => {
    server = new SignalingServer(port);
  });

  afterAll(() => {
    server.close();
  });

  it('should create a room and return room code', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    
    await new Promise((resolve) => ws.on('open', resolve));
    
    ws.send(JSON.stringify({ type: 'create-room' }));
    
    const message = await new Promise<any>((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });
    
    expect(message.type).toBe('room-created');
    expect(message.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    
    ws.close();
  });

  it('should allow guest to join room and notify host', async () => {
    const host = new WebSocket(`ws://localhost:${port}`);
    const guest = new WebSocket(`ws://localhost:${port}`);
    
    await Promise.all([
      new Promise((resolve) => host.on('open', resolve)),
      new Promise((resolve) => guest.on('open', resolve)),
    ]);
    
    // Host creates room
    host.send(JSON.stringify({ type: 'create-room' }));
    const roomMsg = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const code = roomMsg.code;
    
    // Guest joins
    guest.send(JSON.stringify({ type: 'join-room', code }));
    const guestMsg = await new Promise<any>((resolve) => {
      guest.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(guestMsg.type).toBe('room-joined');
    expect(guestMsg.role).toBe('guest');
    expect(guestMsg.code).toBe(code);
    
    // Host notified
    const peerMsg = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(peerMsg.type).toBe('peer-joined');
    
    host.close();
    guest.close();
  });

  it('should relay offer/answer/ice-candidate between peers', async () => {
    const host = new WebSocket(`ws://localhost:${port}`);
    const guest = new WebSocket(`ws://localhost:${port}`);
    
    await Promise.all([
      new Promise((resolve) => host.on('open', resolve)),
      new Promise((resolve) => guest.on('open', resolve)),
    ]);
    
    host.send(JSON.stringify({ type: 'create-room' }));
    const roomMsg = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const code = roomMsg.code;
    
    guest.send(JSON.stringify({ type: 'join-room', code }));
    await new Promise((resolve) => guest.once('message', resolve));
    await new Promise((resolve) => host.once('message', resolve));
    
    // Guest sends offer, host receives
    const offer = { type: 'offer', sdp: { type: 'offer', sdp: 'test-sdp' } };
    guest.send(JSON.stringify(offer));
    const receivedOffer = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(receivedOffer.type).toBe('offer');
    expect(receivedOffer.sdp.sdp).toBe('test-sdp');
    
    // Host sends answer, guest receives
    const answer = { type: 'answer', sdp: { type: 'answer', sdp: 'test-answer' } };
    host.send(JSON.stringify(answer));
    const receivedAnswer = await new Promise<any>((resolve) => {
      guest.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(receivedAnswer.type).toBe('answer');
    
    host.close();
    guest.close();
  });

  it('should roll dice on server and broadcast to both peers', async () => {
    const host = new WebSocket(`ws://localhost:${port}`);
    const guest = new WebSocket(`ws://localhost:${port}`);
    
    await Promise.all([
      new Promise((resolve) => host.on('open', resolve)),
      new Promise((resolve) => guest.on('open', resolve)),
    ]);
    
    host.send(JSON.stringify({ type: 'create-room' }));
    const roomMsg = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const code = roomMsg.code;
    
    guest.send(JSON.stringify({ type: 'join-room', code }));
    await new Promise((resolve) => guest.once('message', resolve));
    await new Promise((resolve) => host.once('message', resolve));
    
    // Request dice roll
    guest.send(JSON.stringify({
      type: 'roll-dice-request',
      rollId: 'test-roll-1',
      dice: [{ count: 2, sides: 6, purpose: 'to-hit' }]
    }));
    
    const [guestResult, hostResult] = await Promise.all([
      new Promise<any>((resolve) => guest.once('message', (data) => resolve(JSON.parse(data.toString())))),
      new Promise<any>((resolve) => host.once('message', (data) => resolve(JSON.parse(data.toString())))),
    ]);
    
    expect(guestResult.type).toBe('roll-dice-result');
    expect(hostResult.type).toBe('roll-dice-result');
    expect(guestResult.rollId).toBe('test-roll-1');
    expect(hostResult.rollId).toBe('test-roll-1');
    expect(guestResult.results[0].rolls).toHaveLength(2);
    expect(hostResult.results[0].rolls).toHaveLength(2);
    
    host.close();
    guest.close();
  });

  it('should respond to ping with pong', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws.on('open', resolve));
    
    ws.send(JSON.stringify({ type: 'ping' }));
    const message = await new Promise<any>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    
    expect(message.type).toBe('pong');
    
    ws.close();
  });

  it('should reject joining non-existent room', async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => ws.on('open', resolve));
    
    ws.send(JSON.stringify({ type: 'join-room', code: 'XXX-XXX' }));
    const message = await new Promise<any>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    
    expect(message.type).toBe('error');
    
    ws.close();
  });

  it('should reject joining full room', async () => {
    const host = new WebSocket(`ws://localhost:${port}`);
    const guest1 = new WebSocket(`ws://localhost:${port}`);
    const guest2 = new WebSocket(`ws://localhost:${port}`);
    
    await Promise.all([
      new Promise((resolve) => host.on('open', resolve)),
      new Promise((resolve) => guest1.on('open', resolve)),
      new Promise((resolve) => guest2.on('open', resolve)),
    ]);
    
    host.send(JSON.stringify({ type: 'create-room' }));
    const roomMsg = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const code = roomMsg.code;
    
    guest1.send(JSON.stringify({ type: 'join-room', code }));
    await new Promise((resolve) => guest1.once('message', resolve));
    await new Promise((resolve) => host.once('message', resolve));
    
    guest2.send(JSON.stringify({ type: 'join-room', code }));
    const errorMsg = await new Promise<any>((resolve) => {
      guest2.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(errorMsg.type).toBe('error');
    
    host.close();
    guest1.close();
    guest2.close();
  });

  it('should refresh room activity on ping so mid-game rooms survive cleanup', async () => {
    const host = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => host.on('open', resolve));

    host.send(JSON.stringify({ type: 'create-room' }));
    const roomMsg = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const code = roomMsg.code;

    // Age the room past the inactivity timeout, then ping.
    const room = server['roomManager'].getRoom(code)!;
    room.lastActivity = Date.now() - 10 * 60 * 1000;

    host.send(JSON.stringify({ type: 'ping' }));
    const pong = await new Promise<any>((resolve) => {
      host.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(pong.type).toBe('pong');

    // The ping refreshed the activity timestamp, so cleanup keeps the room.
    expect(room.lastActivity).toBeGreaterThan(Date.now() - 60 * 1000);
    server['roomManager'].cleanup();
    expect(server['roomManager'].getRoom(code)).toBeDefined();

    host.close();
  });
});
