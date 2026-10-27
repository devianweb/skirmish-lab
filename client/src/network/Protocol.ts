export type ConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'signaling'
  | 'connected'
  | 'failed';

export interface RoomInfo {
  code: string;
  role: 'host' | 'guest';
}

export interface ConnectionStatus {
  state: ConnectionState;
  roomCode?: string;
  role?: 'host' | 'guest';
  peerConnected: boolean;
}
