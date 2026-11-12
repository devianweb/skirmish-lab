import type { DiceSpec, DiceResult } from './types';
export type { DiceSpec, DiceResult };

// Signaling message types
export type SignalingMessage =
  | { type: 'create-room' }
  | { type: 'room-created', code: string, rejoinToken?: string }
  | { type: 'join-room', code: string, rejoinToken?: string }
  | { type: 'room-joined', code: string, role: 'host' | 'guest', rejoinToken?: string }
  | { type: 'reconnect-room', code: string, role: 'host' | 'guest', rejoinToken?: string }
  | { type: 'room-reconnected', code: string, role: 'host' | 'guest' }
  | { type: 'peer-joined' }
  | { type: 'peer-reconnected', role: 'host' | 'guest' }
  | { type: 'offer', sdp: any }
  | { type: 'answer', sdp: any }
  | { type: 'ice-candidate', candidate: any }
  | { type: 'error', message: string }
  | { type: 'roll-dice-request', rollId: string, dice: DiceSpec[] }
  | { type: 'roll-dice-result', rollId: string, results: DiceResult[] }
  | { type: 'leave-room' }
  | { type: 'ping' }
  | { type: 'pong' };

