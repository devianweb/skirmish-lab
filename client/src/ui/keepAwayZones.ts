import type { GameState, Unit, Vector3 } from '@skirmish-lab/shared';
import { baseRadius, ENEMY_KEEP_AWAY_GAP, keepAwayCentreRadius, livingModelPositions } from '@skirmish-lab/shared';

/**
 * One no-go disc of the 1" keep-away rule: a moving model's centre may not enter it. Purely a picture of the host
 * rule (`findKeepAwayViolation`), which measures the 1" in 3D (`keepAwayGap3D`: the horizontal base gap combined
 * with the height difference). At the mover's starting height a model on the same level blocks every centre closer
 * than (its base radius + 1" + the mover's base radius); one `dy` higher or lower blocks a smaller disc, and one
 * 1" or more above/below blocks nothing from there. Such "other level" zones are drawn faint with the full radius,
 * because they can still matter once the mover climbs or drops next to them.
 */
export interface KeepAwayZone {
  x: number;
  y: number;
  z: number;
  /** Centre distance the moving model must stay beyond (the engine's KEEP_AWAY_CENTRE_DISTANCE at equal height, shrinking with the height difference). */
  radius: number;
  /** The declared charge target: the rule does not apply to it, so it is drawn as an allowed zone. */
  exempt: boolean;
  /** 1" or more above/below the mover's starting height, so it does not block from there; drawn faint. */
  otherTier: boolean;
  unitId: string;
}

/** Extra distance past the mover's reach within which zones are still drawn (limits clutter). */
export const KEEP_AWAY_DRAW_MARGIN = 4;

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
    const fullRadius = baseRadius(other) + ENEMY_KEEP_AWAY_GAP + moverRadius;
    const limit = options.reach + fullRadius + KEEP_AWAY_DRAW_MARGIN;
    for (const pos of livingModelPositions(other)) {
      const near = origins.find((o) => Math.hypot(o.x - pos.x, o.z - pos.z) <= limit);
      if (!near) continue;
      const shrunk = keepAwayCentreRadius(
        (near.y ?? 0) - (pos.y ?? 0),
        ENEMY_KEEP_AWAY_GAP,
        moverRadius,
        baseRadius(other)
      );
      zones.push({
        x: pos.x,
        y: pos.y ?? 0,
        z: pos.z,
        radius: shrunk ?? fullRadius,
        exempt: other.id === options.exemptUnitId,
        otherTier: shrunk === null,
        unitId: other.id,
      });
    }
  }
  return zones;
}
