export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Returns true if two axis-aligned bounding boxes overlap in screen space.
 * Touching edges without interior intersection are not considered overlapping.
 */
export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Pure layout algorithm for overlapping labels.
 *
 * Going through boxes in order, shifts any box that overlaps an already placed
 * box upward by just enough to clear it (repeating until clear of all placed boxes).
 *
 * Assumes a screen coordinate system where y=0 is the top of the screen and
 * positive y goes downward. An upward shift decreases y (toward 0).
 *
 * @param boxes Array of initial bounding boxes in placement order.
 * @returns Array of upward offsets in pixels (>= 0), one per box.
 *          The new y position of box[i] is box[i].y - offsets[i].
 */
export function labelLayout(boxes: readonly LabelBox[]): number[] {
  const offsets: number[] = [];
  const placed: LabelBox[] = [];

  for (const box of boxes) {
    let currentY = box.y;
    let shifted = true;

    while (shifted) {
      shifted = false;
      const currentBox: LabelBox = {
        x: box.x,
        y: currentY,
        width: box.width,
        height: box.height,
      };

      // Check against all already placed boxes
      for (const p of placed) {
        if (boxesOverlap(currentBox, p)) {
          // Shift currentBox upward just enough so its bottom (currentY + height) clears p.y
          // i.e. new currentY + box.height <= p.y => new currentY = p.y - box.height
          const targetY = p.y - box.height;
          if (targetY < currentY) {
            currentY = targetY;
            shifted = true;
            // Break and re-check all placed boxes with the new currentY
            break;
          }
        }
      }
    }

    const upwardOffset = box.y - currentY;
    offsets.push(upwardOffset);
    placed.push({
      x: box.x,
      y: currentY,
      width: box.width,
      height: box.height,
    });
  }

  return offsets;
}
