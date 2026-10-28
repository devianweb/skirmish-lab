import { Vector3 } from './types';

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
  activationIndex?: number;
  turnStartTime?: number;
}

export type UnitStatus = 
  | 'pinned'
  | 'suppressed'
  | 'broken'
  | 'engaged'
  | 'in-cover'
  | 'hidden'
  | { type: 'custom', name: string, data?: any };

export interface Model {
  id: string;
  wounds: number;
  maxWounds: number;
  isDestroyed: boolean;
}

export interface WeaponProfile {
  range: number;
  attacks: number | string;
  toHit: number;
  toWound: number;
  armorPierce: number;
  damage: number | string;
  special: string[];
}

export interface Weapon {
  id: string;
  weaponType: string;
  name: string;
  profile: WeaponProfile;
  isEquipped: boolean;
}

export interface Unit {
  id: string;
  ownerId: string;
  armyId: string;
  unitType: string;
  name: string;
  position: Vector3;
  rotation: Vector3;
  status: UnitStatus[];
  wounds: number;
  maxWounds: number;
  isActivated: boolean;
  isDestroyed: boolean;
  models: Model[];
  weapons: Weapon[];
  abilities: string[];
  hasMoved: boolean;
  hasShot: boolean;
  hasFought: boolean;
  remainingMovement: number;
}

export interface TerrainPiece {
  id: string;
  terrainType: string;
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  blocksLineOfSight: boolean;
  providesCover: boolean;
  isObstacle: boolean;
  data?: Record<string, any>;
}

export interface GameMarker {
  id: string;
  type: 'objective' | 'marker' | 'template';
  position: Vector3;
  data?: Record<string, any>;
}

export interface Board {
  width: number;
  height: number;
  gridSize: number;
  scale: number;
  terrain: string[];
}

export interface Player {
  id: string;
  name: string;
  role: 'host' | 'guest';
  armyId: string;
  isActive: boolean;
}

export type ActionType =
  | 'move-unit'
  | 'advance-unit'
  | 'shoot'
  | 'charge'
  | 'fight'
  | 'use-ability'
  | 'activate-unit'
  | 'end-phase'
  | 'end-turn'
  | 'pass'
  | 'declare-action'
  | 'resolve-action';

export type ActionPayload =
  | { type: 'move-unit', unitId: string, path: Vector3[], finalPosition: Vector3 }
  | { type: 'advance-unit', unitId: string, path: Vector3[], finalPosition: Vector3 }
  | { type: 'shoot', attackerId: string, targetId: string, weaponId: string }
  | { type: 'charge', attackerId: string, targetId: string, path: Vector3[] }
  | { type: 'fight', attackerId: string, targetId: string, weaponId: string }
  | { type: 'use-ability', unitId: string, abilityId: string, targetIds?: string[] }
  | { type: 'activate-unit', unitId: string }
  | { type: 'end-phase' }
  | { type: 'end-turn' }
  | { type: 'pass' };

export interface GameAction {
  id: string;
  timestamp: number;
  actorId: string;
  type: ActionType;
  payload: ActionPayload;
  sequence?: number;
}

export interface ActionLogEntry {
  action: GameAction;
  result: 'accepted' | 'rejected';
  reason?: string;
  stateHash?: string;
  appliedAt: number;
}

export type GameStatus = 
  | 'lobby'
  | 'setting-up'
  | 'in-progress'
  | 'paused'
  | 'game-over';

export interface GameState {
  version: string;
  gameId: string;
  createdAt: number;
  lastActionId: string;
  hostId: string;
  guestId: string;
  players: Player[];
  turnState: TurnState;
  board: Board;
  units: Unit[];
  terrain: TerrainPiece[];
  markers: GameMarker[];
  actionLog: ActionLogEntry[];
  status: GameStatus;
  winner?: string;
  endReason?: string;
}
