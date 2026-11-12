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
    
    // Request dice roll from host
    host.send(JSON.stringify({
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

  it('should allow host to rejoin vacant host slot via join-room message', async () => {
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
    const guestJoinMsg = await new Promise<any>((resolve) => {
      guest.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(guestJoinMsg.type).toBe('room-joined');
    expect(guestJoinMsg.role).toBe('guest');

    // Host disconnects, guest remains in room and receives disconnect notice
    const disconnectNotice = new Promise<any>((resolve) => {
      guest.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    host.close();
    const noticeMsg = await disconnectNotice;
    expect(noticeMsg.type).toBe('error');
    expect(noticeMsg.message).toBe('Host disconnected');

    // New host socket joins room using join-room message
    const newHost = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => newHost.on('open', resolve));

    newHost.send(JSON.stringify({ type: 'join-room', code }));
    const hostJoinMsg = await new Promise<any>((resolve) => {
      newHost.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(hostJoinMsg.type).toBe('room-joined');
    expect(hostJoinMsg.role).toBe('host');

    guest.close();
    newHost.close();
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

  it('should respond with 200 OK to HTTP GET / and /healthz for Azure health probes', async () => {
    const rootRes = await fetch(`http://localhost:${port}/`);
    expect(rootRes.status).toBe(200);
    const rootBody = await rootRes.json();
    expect(rootBody).toEqual({ status: 'ok', service: 'skirmish-lab-signaling' });

    const healthRes = await fetch(`http://localhost:${port}/healthz`);
    expect(healthRes.status).toBe(200);
    const healthBody = await healthRes.json();
    expect(healthBody).toEqual({ status: 'ok', service: 'skirmish-lab-signaling' });

    const notFoundRes = await fetch(`http://localhost:${port}/other`);
    expect(notFoundRes.status).toBe(404);
  });

  it('should allow host to reconnect to an existing room and roll dice with cached idempotency', async () => {
    let hostWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => hostWs.on('open', resolve));

    hostWs.send(JSON.stringify({ type: 'create-room' }));
    const createdMsg = await new Promise<any>((resolve) => {
      hostWs.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    const code = createdMsg.code;

    // First dice roll
    hostWs.send(JSON.stringify({
      type: 'roll-dice-request',
      rollId: 'roll-abc',
      dice: [{ count: 2, sides: 6, purpose: 'to-hit' }],
    }));
    const firstRoll = await new Promise<any>((resolve) => {
      hostWs.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(firstRoll.type).toBe('roll-dice-result');
    expect(firstRoll.rollId).toBe('roll-abc');

    // Simulate host network drop
    const hostClosed = new Promise((resolve) => hostWs.once('close', resolve));
    hostWs.close();
    await hostClosed;
    // Wait until server processes close event
    while (server['roomManager'].getRoom(code)?.host !== null) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Room is preserved during grace period
    expect(server['roomManager'].getRoom(code)).toBeDefined();

    // Reconnect with a new socket
    const reconnectedHost = new WebSocket(`ws://localhost:${port}`);
    await new Promise((resolve) => reconnectedHost.on('open', resolve));

    reconnectedHost.send(JSON.stringify({
      type: 'reconnect-room',
      code,
      role: 'host',
    }));
    const reconnectedMsg = await new Promise<any>((resolve) => {
      reconnectedHost.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(reconnectedMsg.type).toBe('room-reconnected');
    expect(reconnectedMsg.code).toBe(code);
    expect(reconnectedMsg.role).toBe('host');

    // Send the same rollId again (retry simulation) -> should return identical cached result
    reconnectedHost.send(JSON.stringify({
      type: 'roll-dice-request',
      rollId: 'roll-abc',
      dice: [{ count: 2, sides: 6, purpose: 'to-hit' }],
    }));
    const secondRoll = await new Promise<any>((resolve) => {
      reconnectedHost.once('message', (data) => resolve(JSON.parse(data.toString())));
    });
    expect(secondRoll.type).toBe('roll-dice-result');
    expect(secondRoll.results).toEqual(firstRoll.results);

    reconnectedHost.close();
  });

  describe('G-01: dice request validation', () => {
    it('rejects invalid dice payloads with an error message without crashing', async () => {
      const host = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => host.on('open', resolve));

      const nextMsg = () =>
        new Promise<any>((resolve) => {
          host.once('message', (data) => resolve(JSON.parse(data.toString())));
        });

      host.send(JSON.stringify({ type: 'create-room' }));
      await nextMsg();

      const invalidDicePayloads = [
        null,
        [],
        Array.from({ length: 65 }, () => ({ count: 1, sides: 6 })),
        [{ count: 0, sides: 6 }],
        [{ count: -2, sides: 6 }],
        [{ count: 1.5, sides: 6 }],
        [{ count: 501, sides: 6 }],
        [{ count: 1, sides: 0 }],
        [{ count: 1, sides: 1 }],
        [{ count: 1, sides: -6 }],
        [{ count: 1, sides: 2.5 }],
        [{ count: 1, sides: 21 }],
        [
          { count: 500, sides: 6 },
          { count: 500, sides: 6 },
          { count: 500, sides: 6 },
          { count: 500, sides: 6 },
          { count: 1, sides: 6 },
        ],
      ];

      for (let i = 0; i < invalidDicePayloads.length; i++) {
        host.send(
          JSON.stringify({
            type: 'roll-dice-request',
            rollId: `bad-${i}`,
            dice: invalidDicePayloads[i],
          })
        );
        const reply = await nextMsg();
        expect(reply.type).toBe('error');
      }

      // Server remains healthy and accepts a valid boundary request (total count 2000, sides 2..20)
      host.send(
        JSON.stringify({
          type: 'roll-dice-request',
          rollId: 'valid-boundary',
          dice: [
            { count: 500, sides: 2 },
            { count: 500, sides: 20 },
            { count: 500, sides: 6 },
            { count: 500, sides: 6 },
          ],
        })
      );
      const okReply = await nextMsg();
      expect(okReply.type).toBe('roll-dice-result');
      expect(okReply.results).toHaveLength(4);
      expect(okReply.results[0].rolls).toHaveLength(500);

      host.close();
    });
  });

  describe('G-05: host-only dice, rollId validation, spec collisions, and cache eviction', () => {
    it('rejects dice requests from guest, missing/empty rollId, or mismatched repeat rollId specs', async () => {
      const host = new WebSocket(`ws://localhost:${port}`);
      const guest = new WebSocket(`ws://localhost:${port}`);
      await Promise.all([
        new Promise((resolve) => host.on('open', resolve)),
        new Promise((resolve) => guest.on('open', resolve)),
      ]);

      const nextMsg = (ws: WebSocket) =>
        new Promise<any>((resolve) => {
          ws.once('message', (data) => resolve(JSON.parse(data.toString())));
        });

      host.send(JSON.stringify({ type: 'create-room' }));
      const { code } = await nextMsg(host);

      guest.send(JSON.stringify({ type: 'join-room', code }));
      await nextMsg(guest);
      await nextMsg(host); // peer-joined

      // Guest attempts to pre-seed or request dice -> rejected with error
      guest.send(
        JSON.stringify({
          type: 'roll-dice-request',
          rollId: 'shared-roll-id',
          dice: [{ count: 3, sides: 2, purpose: 'to-hit' }],
        })
      );
      const guestErr = await nextMsg(guest);
      expect(guestErr.type).toBe('error');

      // Missing or empty rollId from host -> rejected with error
      host.send(
        JSON.stringify({
          type: 'roll-dice-request',
          rollId: '',
          dice: [{ count: 2, sides: 6 }],
        })
      );
      expect((await nextMsg(host)).type).toBe('error');

      host.send(
        JSON.stringify({
          type: 'roll-dice-request',
          dice: [{ count: 2, sides: 6 }],
        })
      );
      expect((await nextMsg(host)).type).toBe('error');

      // Host rolls with 'shared-roll-id' -> succeeds (not poisoned by guest)
      host.send(
        JSON.stringify({
          type: 'roll-dice-request',
          rollId: 'shared-roll-id',
          dice: [{ count: 2, sides: 6, purpose: 'to-hit' }],
        })
      );
      const [hostRoll, guestRoll] = await Promise.all([nextMsg(host), nextMsg(guest)]);
      expect(hostRoll.type).toBe('roll-dice-result');
      expect(guestRoll.type).toBe('roll-dice-result');
      expect(hostRoll.results[0].rolls).toHaveLength(2);

      // Repeat rollId with DIFFERENT specs -> rejected with error
      host.send(
        JSON.stringify({
          type: 'roll-dice-request',
          rollId: 'shared-roll-id',
          dice: [{ count: 5, sides: 6, purpose: 'to-hit' }],
        })
      );
      const collisionErr = await nextMsg(host);
      expect(collisionErr.type).toBe('error');

      // Repeat rollId with IDENTICAL specs -> returns cached results
      host.send(
        JSON.stringify({
          type: 'roll-dice-request',
          rollId: 'shared-roll-id',
          dice: [{ count: 2, sides: 6, purpose: 'to-hit' }],
        })
      );
      const [hostRetry, guestRetry] = await Promise.all([nextMsg(host), nextMsg(guest)]);
      expect(hostRetry.type).toBe('roll-dice-result');
      expect(hostRetry.results).toEqual(hostRoll.results);
      expect(guestRetry.results).toEqual(hostRoll.results);

      host.close();
      guest.close();
    });

    it('evicts the oldest rollCache entry when cache size exceeds 100', async () => {
      const host = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => host.on('open', resolve));

      const nextMsg = () =>
        new Promise<any>((resolve) => {
          host.once('message', (data) => resolve(JSON.parse(data.toString())));
        });

      host.send(JSON.stringify({ type: 'create-room' }));
      const { code } = await nextMsg();

      for (let i = 0; i < 101; i++) {
        host.send(
          JSON.stringify({
            type: 'roll-dice-request',
            rollId: `r-${i}`,
            dice: [{ count: 1, sides: 6 }],
          })
        );
        await nextMsg();
      }

      const room = server['roomManager'].getRoom(code)!;
      expect(room.rollCache?.size).toBe(100);
      expect(room.rollCache?.has('r-0')).toBe(false);
      expect(room.rollCache?.has('r-100')).toBe(true);

      host.close();
    });
  });

  describe('G-02: seat takeover protection & rejoin tokens', () => {
    it('issues rejoinToken on room-created and room-joined, blocks unauthorized takeover of OPEN seats, and cleans up replaced clientRooms entries', async () => {
      const host = new WebSocket(`ws://localhost:${port}`);
      const guest = new WebSocket(`ws://localhost:${port}`);
      const attacker = new WebSocket(`ws://localhost:${port}`);
      await Promise.all([
        new Promise((resolve) => host.on('open', resolve)),
        new Promise((resolve) => guest.on('open', resolve)),
        new Promise((resolve) => attacker.on('open', resolve)),
      ]);

      const nextMsg = (ws: WebSocket) =>
        new Promise<any>((resolve) => {
          ws.once('message', (data) => resolve(JSON.parse(data.toString())));
        });

      host.send(JSON.stringify({ type: 'create-room' }));
      const created = await nextMsg(host);
      expect(created.type).toBe('room-created');
      expect(typeof created.rejoinToken).toBe('string');
      expect(created.rejoinToken.length).toBeGreaterThan(0);
      const code = created.code;
      const hostToken = created.rejoinToken;

      guest.send(JSON.stringify({ type: 'join-room', code }));
      const joined = await nextMsg(guest);
      await nextMsg(host); // peer-joined
      expect(joined.type).toBe('room-joined');
      expect(typeof joined.rejoinToken).toBe('string');
      expect(joined.rejoinToken.length).toBeGreaterThan(0);
      const guestToken = joined.rejoinToken;

      // Attacker tries to hijack open host seat via reconnect-room (no token / wrong token)
      attacker.send(JSON.stringify({ type: 'reconnect-room', code, role: 'host' }));
      expect((await nextMsg(attacker)).type).toBe('error');

      attacker.send(JSON.stringify({ type: 'reconnect-room', code, role: 'host', rejoinToken: 'bad' }));
      expect((await nextMsg(attacker)).type).toBe('error');

      // Attacker tries to hijack open guest seat via reconnect-room
      attacker.send(JSON.stringify({ type: 'reconnect-room', code, role: 'guest' }));
      expect((await nextMsg(attacker)).type).toBe('error');

      // Original host is still active and able to relay offers to guest
      host.send(JSON.stringify({ type: 'offer', sdp: { type: 'offer', sdp: 'v=0' } }));
      const relayed = await nextMsg(guest);
      expect(relayed.type).toBe('offer');

      // Legitimate host replaces its still-OPEN seat using its rejoinToken via reconnect-room
      const newHost = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => newHost.on('open', resolve));

      newHost.send(JSON.stringify({ type: 'reconnect-room', code, role: 'host', rejoinToken: hostToken }));
      const [reconReply, peerReconNotice] = await Promise.all([nextMsg(newHost), nextMsg(guest)]);
      expect(reconReply.type).toBe('room-reconnected');
      expect(peerReconNotice).toEqual({ type: 'peer-reconnected', role: 'host' });

      // Old replaced host socket was removed from clientRooms -> cannot relay messages anymore
      host.send(JSON.stringify({ type: 'offer', sdp: { type: 'offer', sdp: 'stale' } }));
      const staleErr = await nextMsg(host);
      expect(staleErr.type).toBe('error');
      expect(staleErr.message).toBe('Not in a room');

      // Legitimate guest resumes its still-OPEN seat using its rejoinToken via join-room
      const newGuest = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => newGuest.on('open', resolve));

      newGuest.send(JSON.stringify({ type: 'join-room', code, rejoinToken: guestToken }));
      const [guestRejoin, hostPeerJoined] = await Promise.all([nextMsg(newGuest), nextMsg(newHost)]);
      expect(guestRejoin.type).toBe('room-joined');
      expect(guestRejoin.role).toBe('guest');
      expect(typeof guestRejoin.rejoinToken).toBe('string');
      expect(hostPeerJoined.type).toBe('peer-joined');

      // Old replaced guest socket was removed from clientRooms
      guest.send(JSON.stringify({ type: 'answer', sdp: { type: 'answer', sdp: 'stale' } }));
      expect((await nextMsg(guest)).type).toBe('error');

      host.close();
      guest.close();
      attacker.close();
      newHost.close();
      newGuest.close();
    });
  });

  describe('G-25 & G-29: limits, malformed messages, and leave/disconnect notices', () => {
    it('configures 64 KB maxPayload on WebSocketServer and rejects oversized payloads', async () => {
      expect((server['wss'].options as any).maxPayload).toBe(64 * 1024);

      const ws = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => ws.on('open', resolve));

      const closePromise = new Promise<number>((resolve) => {
        ws.once('close', (code) => resolve(code));
      });

      ws.send('x'.repeat(65 * 1024));
      const closeCode = await closePromise;
      expect(closeCode).toBe(1009);
    });

    it('handles malformed messages and leave-room notifications cleanly', async () => {
      const host = new WebSocket(`ws://localhost:${port}`);
      const guest = new WebSocket(`ws://localhost:${port}`);
      await Promise.all([
        new Promise((resolve) => host.on('open', resolve)),
        new Promise((resolve) => guest.on('open', resolve)),
      ]);

      const nextMsg = (ws: WebSocket) =>
        new Promise<any>((resolve) => {
          ws.once('message', (data) => resolve(JSON.parse(data.toString())));
        });

      // Non-JSON, JSON primitive, missing type, unknown type, missing code/role
      host.send('not-json{{{');
      expect((await nextMsg(host)).type).toBe('error');

      host.send('null');
      expect((await nextMsg(host)).type).toBe('error');

      host.send(JSON.stringify({}));
      expect((await nextMsg(host)).type).toBe('error');

      host.send(JSON.stringify({ type: 'unknown-cmd' }));
      expect((await nextMsg(host)).type).toBe('error');

      host.send(JSON.stringify({ type: 'join-room' }));
      expect((await nextMsg(host)).type).toBe('error');

      host.send(JSON.stringify({ type: 'reconnect-room', code: 'ABC-123', role: 'spectator' }));
      expect((await nextMsg(host)).type).toBe('error');

      // Create and join a room, then guest leaves explicitly via leave-room
      host.send(JSON.stringify({ type: 'create-room' }));
      const { code } = await nextMsg(host);

      guest.send(JSON.stringify({ type: 'join-room', code }));
      await nextMsg(guest);
      await nextMsg(host); // peer-joined

      guest.send(JSON.stringify({ type: 'leave-room' }));
      const leaveNotice = await nextMsg(host);
      expect(leaveNotice).toEqual({ type: 'error', message: 'Guest left room' });

      host.close();
      guest.close();
    });

    it('enforces at most one room per socket and refuses room creation beyond 500 rooms with an error', async () => {
      const host = new WebSocket(`ws://localhost:${port}`);
      const guest = new WebSocket(`ws://localhost:${port}`);
      await Promise.all([
        new Promise((resolve) => host.on('open', resolve)),
        new Promise((resolve) => guest.on('open', resolve)),
      ]);

      const nextMsg = (ws: WebSocket) =>
        new Promise<any>((resolve) => {
          ws.once('message', (data) => resolve(JSON.parse(data.toString())));
        });

      host.send(JSON.stringify({ type: 'create-room' }));
      const firstRoom = await nextMsg(host);
      guest.send(JSON.stringify({ type: 'join-room', code: firstRoom.code }));
      await nextMsg(guest);
      await nextMsg(host); // peer-joined

      // Host creates a second room on the same socket -> guest in first room gets 'Host left room'
      host.send(JSON.stringify({ type: 'create-room' }));
      const [secondRoom, guestNotice] = await Promise.all([nextMsg(host), nextMsg(guest)]);
      expect(secondRoom.type).toBe('room-created');
      expect(secondRoom.code).not.toBe(firstRoom.code);
      expect(guestNotice).toEqual({ type: 'error', message: 'Host left room' });
      expect(server['roomManager'].getRoom(firstRoom.code)?.host).toBeNull();
      expect(server['roomManager'].getRoom(secondRoom.code)?.host).toBeDefined();

      // Fill room manager to 500 rooms, then verify 501st socket receives an error
      const roomManager = server['roomManager'];
      const dummySockets: WebSocket[] = [];
      while (roomManager.getRoomCount() < 500) {
        const fakeWs = { readyState: WebSocket.OPEN } as unknown as WebSocket;
        dummySockets.push(fakeWs);
        roomManager.createRoom(fakeWs);
      }
      expect(roomManager.getRoomCount()).toBe(500);

      const overflowClient = new WebSocket(`ws://localhost:${port}`);
      await new Promise((resolve) => overflowClient.on('open', resolve));
      overflowClient.send(JSON.stringify({ type: 'create-room' }));
      const overflowReply = await nextMsg(overflowClient);
      expect(overflowReply.type).toBe('error');

      // Clean up dummy rooms so other tests are unaffected
      for (const fakeWs of dummySockets) {
        roomManager.removeClient(fakeWs);
      }
      roomManager['rooms'].forEach((r, c) => {
        if (!r.host && !r.guest) roomManager['rooms'].delete(c);
      });

      host.close();
      guest.close();
      overflowClient.close();
    });
  });
});
