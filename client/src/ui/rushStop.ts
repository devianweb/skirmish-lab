/** Why a rush preview ends short of the hovered target. */
export type RushStopReason = 'height' | 'budget' | 'difficult' | 'blocked';

/**
 * Classifies why a rush path ends short of the cursor. No promise of a later turn is ever made: climbing up to
 * 3" is ordinary movement, so a path that ends below a higher target means either the budget ran out or the
 * height cannot be reached on foot (stairs/ladders only).
 */
export function rushStopReason(opts: {
  /** Target is more than 0.5" above where the path ended. */
  heightShort: boolean;
  /** Movement cost of the previewed path. */
  pathCost: number;
  /** Movement available for this rush. */
  budget: number;
  /** The same route would reach the target if no other unit were in the way (their 1" zones or bodies block it). */
  blockedByUnits?: boolean;
}): RushStopReason {
  if (!opts.heightShort) return 'difficult';
  if (opts.pathCost >= opts.budget - 0.05) return 'budget';
  return opts.blockedByUnits ? 'blocked' : 'height';
}

/** One-line player-facing text for a rush stop. */
export function rushStopText(reason: RushStopReason): string {
  switch (reason) {
    case 'height':
      return "Can't reach that height from here — use stairs or a ladder";
    case 'budget':
      return 'Out of movement';
    case 'blocked':
      return 'Blocked by another unit: the way up is within 1" of it, so you cannot get past';
    default:
      return 'Rush stops at the edge of difficult terrain';
  }
}
