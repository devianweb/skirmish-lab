/**
 * Deterministic accent palette for squad base rims.
 * Distinguishes squads and units at a glance with high tabletop contrast.
 */
export const UNIT_RIM_PALETTE: number[] = [
  0xffd54f, // Amber Gold
  0x26c6da, // Cyan / Teal
  0xff7043, // Coral Orange
  0xab47bc, // Bright Violet
  0x66bb6a, // Emerald Green
  0xec407a, // Rose Pink
  0xffca28, // Bright Yellow
  0x42a5f5, // Sky Blue
  0x8d6e63, // Leather Bronze
  0xeeeeee, // White
];

export function getUnitRimColor(unitId: string): number {
  if (!unitId) return UNIT_RIM_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < unitId.length; i++) {
    hash = (hash * 31 + unitId.charCodeAt(i)) >>> 0;
  }
  return UNIT_RIM_PALETTE[hash % UNIT_RIM_PALETTE.length];
}
