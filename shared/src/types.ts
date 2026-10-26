// Core types shared between client and server
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Player {
  id: string;
  name: string;
  role: 'host' | 'guest';
  armyId: string;
  isActive: boolean;
}

export type TurnPhase = 
  | 'setup'
  | 'deployment'
  | 'initiative'
  | 'command'
  | 'movement'
  | 'shooting'
  | 'fight'
  | 'morale'
  | 'end-turn'
  | 'game-over';

export interface TurnState {
  currentPlayerId: string;
  turnNumber: number;
  phase: TurnPhase;
  phaseStep?: string;
}

export interface GameState {
  version: string;
  gameId: string;
  createdAt: number;
  lastActionId: string;
  hostId: string;
  guestId: string;
  players: Player[];
  turnState: TurnState;
  status: 'lobby' | 'setting-up' | 'in-progress' | 'paused' | 'game-over';
  winner?: string;
  endReason?: string;
}

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
