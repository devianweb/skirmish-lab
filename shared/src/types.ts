// Core types shared between client and server.
// Game state types live in gameTypes.ts (schema v2, alternating activations).
export interface Vector3 {
  x: number;
  y: number;
  z: number;
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
