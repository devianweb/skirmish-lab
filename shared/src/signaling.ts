// Signaling message types
export type SignalingMessage =
  | { type: 'create-room' }
  | { type: 'room-created', code: string }
  | { type: 'join-room', code: string }
  | { type: 'room-joined', code: string, role: 'host' | 'guest' }
  | { type: 'peer-joined' }
  | { type: 'offer', sdp: any }
  | { type: 'answer', sdp: any }
  | { type: 'ice-candidate', candidate: any }
  | { type: 'error', message: string }
  | { type: 'roll-dice-request', rollId: string, dice: DiceSpec[] }
  | { type: 'roll-dice-result', rollId: string, results: DiceResult[] }
  | { type: 'leave-room' }
  | { type: 'ping' }
  | { type: 'pong' };

export interface DiceSpec {
  count: number;
  sides: number;
  purpose?: string;
  modifier?: number;
}

export interface DiceResult {
  rolls: number[];
  total: number;
  modifier?: number;
  finalTotal: number;
  purpose?: string;
  success?: boolean;
  threshold?: number;
}
