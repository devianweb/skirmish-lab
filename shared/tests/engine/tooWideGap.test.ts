import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createInitialGameState } from '../../src/gameState';
import { GameState, TerrainPiece, Unit, Vector3 } from '../../src/gameTypes';
import { WEAPONS } from '../../src/data/weapons';
import { findJumpOption, findTooWideGap } from '../../src/engine/traversal';

const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

// Fixture: a ledge (floor edge at x = 0, top 3") and platform A (x 5..9, top 3").
const fixture = JSON.parse(readFileSync(join(__dirname, '../fixtures/testy-mctestface.json'), 'utf8'))[0];
const terrain: TerrainPiece[] = fixture.terrain;

function unitAt(position: Vector3, rules: string[] = []): Unit {
  return {
    id: 'u', ownerId: 'h', armyId: 'a', unitType: 'trooper', name: 'u', quality: 4, defense: 5, speed: 6,
    position: { ...position }, rotation: P(0, 0, 0), status: [], wounds: 0, maxWounds: 1, isActivated: true,
    isDestroyed: false, models: [], weapons: [{ ...WEAPONS.rifle, profile: { ...WEAPONS.rifle.profile } }],
    specialRules: rules, hasMoved: false, remainingMovement: 12,
  };
}

function stateWith(unit: Unit): GameState {
  const state = createInitialGameState('h', 'g');
  state.units = [unit];
  state.terrain = terrain.map((t) => ({ ...t }));
  return state;
}

describe('findTooWideGap: the hint for a gap that cannot be jumped', () => {
  const edge = P(-0.2, 3, 0);

  it('reports the spot-to-spot distance across a gap wider than 6", and no jump is offered', () => {
    const unit = unitAt(edge);
    const state = stateWith(unit);
    const far = P(6.7, 3, -1);
    expect(findJumpOption(state, unit, edge, far)).toBeNull();
    const wide = findTooWideGap(state, unit, edge, far);
    expect(wide).not.toBeNull();
    expect(wide!.distance).toBeCloseTo(7.0, 1);
  });

  it('a jumpable gap (6" or less) is not "too wide"', () => {
    const unit = unitAt(edge);
    const state = stateWith(unit);
    const near = P(5.6, 3, -1);
    expect(findJumpOption(state, unit, edge, near)).not.toBeNull();
    expect(findTooWideGap(state, unit, edge, near)).toBeNull();
  });

  it('nothing when the model is not at a floor edge heading toward the gap', () => {
    const unit = unitAt(P(-1.5, 3, 0));
    expect(findTooWideGap(stateWith(unit), unit, unit.position, P(6.7, 3, -1))).toBeNull();
  });

  it('nothing when the landing is not solid floor (open air or the ground)', () => {
    const unit = unitAt(edge);
    const state = stateWith(unit);
    expect(findTooWideGap(state, unit, edge, P(-12, 3, 5))).toBeNull();
    expect(findTooWideGap(state, unit, edge, P(-0.2, 0, 9))).toBeNull();
  });

  it('nothing for an flying model, which crosses gaps freely', () => {
    const unit = unitAt(edge, ['flying']);
    expect(findTooWideGap(stateWith(unit), unit, edge, P(6.7, 3, -1))).toBeNull();
  });
});
