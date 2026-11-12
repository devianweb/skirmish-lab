import type { GameState, TerrainPiece, Unit, Vector3 } from '@skirmish-lab/shared';
import {
  dangerousPieceIdsOnPaths,
  dangerousPieceIdsUnderUnit,
  createSquadPositions,
  hasTrait,
  TERRAIN_PALETTE_CATALOG,
} from '@skirmish-lab/shared';

/**
 * Summary label for dangerous terrain when hovered, in our own words:
 * e.g. "Hazard pool · dangerous: roll per wound, each 1 is a wound".
 */
export function dangerousTerrainLabelText(piece: TerrainPiece): string {
  const meta = TERRAIN_PALETTE_CATALOG[piece.terrainType];
  const rawName = meta?.displayName ?? piece.terrainType.replace(/-/g, ' ');
  const clean = rawName.replace(/\s*\([^)]*\)$/, '').trim();
  const name = clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : 'Dangerous terrain';
  return `${name} · dangerous: roll per wound, each 1 is a wound`;
}

/**
 * Opacity for the pulsing outline (about 1 s period):
 * Smoothly oscillates between 0.35 and 0.95.
 */
export function hazardPulseOpacity(timeMs: number): number {
  const phase = (timeMs % 1000) / 1000;
  return 0.35 + 0.60 * (0.5 + 0.5 * Math.sin(phase * 2 * Math.PI));
}

/**
 * Filter pieces crossed by `paths` to those that still call for a test this activation
 * (same logic the host uses: not already in `unit.hazardTestedPieceIds`).
 */
export function moveHazardPieceIds(state: GameState, paths: Vector3[][], unit: Unit): string[] {
  const pieces = dangerousPieceIdsOnPaths(state, paths, unit);
  const tested = unit.hazardTestedPieceIds ?? [];
  return pieces.filter((id, i) => !tested.includes(id) && pieces.indexOf(id) === i);
}

/**
 * Dangerous pieces under a unit placed at `position` during deployment/Scout/Ambush,
 * using the same host check (`dangerousPieceIdsUnderUnit`).
 */
export function placementHazardPieceIds(state: GameState, unit: Unit, position: Vector3): string[] {
  if (hasTrait(unit.specialRules, 'flying')) return [];
  const modelCount = unit.models && unit.models.length > 0 ? unit.models.length : 1;
  const positions = modelCount > 1 ? createSquadPositions(position, modelCount) : [position];
  const dummyUnit: Unit = {
    ...unit,
    position,
    models:
      unit.models && unit.models.length > 0
        ? unit.models.map((m, i) => ({ ...m, position: positions[i] }))
        : [{ id: unit.id, position, wounds: unit.wounds, maxWounds: unit.wounds, isDestroyed: false }],
  };
  const pieces = dangerousPieceIdsUnderUnit(state, dummyUnit);
  const tested = unit.hazardTestedPieceIds ?? [];
  return pieces.filter((id, i) => !tested.includes(id) && pieces.indexOf(id) === i);
}
