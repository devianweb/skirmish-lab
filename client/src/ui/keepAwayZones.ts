import type { GameState, Unit, Vector3 } from '@skirmish-lab/shared';
import { baseRadius, ENEMY_KEEP_AWAY_GAP, livingModelPositions } from '@skirmish-lab/shared';

/**
 * One no-go disc of the 1" keep-away rule: a moving model's centre may not enter it. Purely a picture of the host
 * rule (`findKeepAwayViolation`): a model of another unit blocks every centre closer than
 * (its base radius + 1" + the mover's base radius), and models on another tier (1.8" or more apart in height) don't.
 */
export interface KeepAwayZone {
  x: number;
  y: number;
  z: number;
  /** Centre distance the moving model must stay beyond (same number as the engine's KEEP_AWAY_CENTRE_DISTANCE). */
  radius: number;
  /** The declared charge target: the rule does not apply to it, so it is drawn as an allowed zone. */
  exempt: boolean;
  /** On another tier than the mover, so it does not block; drawn faint. */
  otherTier: boolean;
  unitId: string;
}

/** Extra distance past the mover's reach within which zones are still drawn (limits clutter). */
export const KEEP_AWAY_DRAW_MARGIN = 4;
const TIER_TOLERANCE = 1.8;

export function computeKeepAwayZones(
  state: GameState,
  mover: Unit,
  options: { reach: number; exemptUnitId?: string | null; origins?: Vector3[] }
): KeepAwayZone[] {
  const origins = options.origins && options.origins.length > 0 ? options.origins : livingModelPositions(mover);
  const moverRadius = baseRadius(mover);
  const zones: KeepAwayZone[] = [];
  for (const other of state.units) {
    if (other.isDestroyed || other.id === mover.id) continue;
    const radius = baseRadius(other) + ENEMY_KEEP_AWAY_GAP + moverRadius;
    const limit = options.reach + radius + KEEP_AWAY_DRAW_MARGIN;
    for (const pos of livingModelPositions(other)) {
      const near = origins.find((o) => Math.hypot(o.x - pos.x, o.z - pos.z) <= limit);
      if (!near) continue;
      zones.push({
        x: pos.x,
        y: pos.y ?? 0,
        z: pos.z,
        radius,
        exempt: other.id === options.exemptUnitId,
        otherTier: Math.abs((near.y ?? 0) - (pos.y ?? 0)) >= TIER_TOLERANCE,
        unitId: other.id,
      });
    }
  }
  return zones;
}
