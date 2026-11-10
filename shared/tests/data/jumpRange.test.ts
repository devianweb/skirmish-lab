import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { BUILTIN_MAPS, createJumpRangeMap } from '../../src/data/builtinMaps';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { TERRAIN_PALETTE_CATALOG } from '../../src/data/mapSchema';
import { findNavPath } from '../../src/engine/spatial';
import { findJumpOption } from '../../src/engine/traversal';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function stateWithMap(): GameState {
  const state = createInitialGameState(HOST, GUEST);
  state.terrain = createJumpRangeMap().terrain;
  return state;
}

function walker(state: GameState, at: Vector3, rules: string[] = []): Unit {
  const [unit] = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST, { defaultZ: at.z });
  unit.specialRules = rules;
  unit.position = at;
  unit.speed = 6;
  state.units = [unit];
  return unit;
}

describe('Jump Range map (manual jump testing)', () => {
  it('is a built-in map and builds a fresh copy each time', () => {
    expect(BUILTIN_MAPS['jump-range']().name).toBe('Jump Range');
    const a = createJumpRangeMap();
    a.terrain[0].position.x += 5;
    expect(createJumpRangeMap().terrain[0].position.x).not.toBe(a.terrain[0].position.x);
  });

  it('is point-symmetric so both players get the same range', () => {
    const { terrain } = createJumpRangeMap();
    for (const t of terrain) {
      const twin = terrain.find(
        (o) => o !== t && o.terrainType === t.terrainType && Math.abs(o.position.x + t.position.x) < 1e-6 && Math.abs(o.position.z + t.position.z) < 1e-6
      );
      expect(twin, `twin of ${t.id}`).toBeDefined();
    }
  });

  it('keeps every deck height and opening on the 0.25" grid', () => {
    for (const t of createJumpRangeMap().terrain) {
      for (const v of [t.scale.x, t.scale.y, t.scale.z]) expect((v * 4) % 1).toBe(0);
    }
    expect(TERRAIN_PALETTE_CATALOG['platform-small']).toBeDefined();
  });

  it('a model walks from the host deployment edge up the stairs onto a 3-inch deck', () => {
    const state = stateWithMap();
    const unit = walker(state, P(-9, 0, -16));
    const path = findNavPath(state, unit, P(-9, 3, -7), 14, { keepAway: true });
    const end = path[path.length - 1];
    expect(Math.hypot(end.x + 9, end.z + 7)).toBeLessThan(0.3);
    expect(end.y).toBeCloseTo(3, 1);
  });

  it('offers a 2" gap jump (deck A to B) and a 4" gap jump (deck B to C), each with a roll', () => {
    const state = stateWithMap();
    const unit = walker(state, P(-7.55, 3, -6));
    const short = findJumpOption(state, unit, P(-7.55, 3, -6), P(-4.45, 3, -6));
    expect(short?.kind).toBe('jump-gap');
    expect(short!.dice).toBeGreaterThanOrEqual(2);
    const long = findJumpOption(state, unit, P(-1.55, 3, -6), P(3.55, 3, -6));
    expect(long?.kind).toBe('jump-gap');
    expect(long!.dice).toBeGreaterThan(short!.dice);
    expect(long!.distance).toBeLessThanOrEqual(6);
  });

  it('offers a jump-down of more than 3" from the tall deck, and every edge spot along it fits a 4-model squad', () => {
    const state = stateWithMap();
    const unit = walker(state, P(-16.55, 4.5, -6));
    for (const dz of [0, 1, -1, 2, -2]) {
      const option = findJumpOption(state, unit, P(-16.55, 4.5, -6 + dz), P(-15.45, 0, -6 + dz));
      expect(option?.kind, `edge spot z offset ${dz}`).toBe('jump-drop');
      expect(option!.dice).toBeGreaterThanOrEqual(4);
    }
  });

  it('a model can reach the tall deck by its ladder', () => {
    const state = stateWithMap();
    const unit = walker(state, P(-21.5, 0, -6));
    const path = findNavPath(state, unit, P(-17.5, 4.5, -6), 12, { keepAway: true });
    const end = path[path.length - 1];
    expect(end.y).toBeGreaterThan(4);
  });
});

describe('TEST jump-check army', () => {
  it('has a 4-model squad, a Strider squad and a Flying squad', () => {
    const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST);
    expect(units).toHaveLength(3);
    expect(units.every((u) => u.models.filter((m) => !m.isDestroyed).length === 4)).toBe(true);
    expect(units[0].specialRules).not.toContain('strider');
    expect(units[0].specialRules).not.toContain('flying');
    expect(units[1].specialRules).toContain('strider');
    expect(units[2].specialRules).toContain('flying');
    expect(STARTER_ARMIES['test-jump-army'].name).toMatch(/TEST/);
  });

  it('starts every model more than 1" from every model of the other units', () => {
    const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], HOST);
    for (let a = 0; a < units.length; a++) {
      for (let b = a + 1; b < units.length; b++) {
        for (const ma of units[a].models) {
          for (const mb of units[b].models) {
            const centre = Math.hypot(ma.position!.x - mb.position!.x, ma.position!.z - mb.position!.z);
            expect(centre).toBeGreaterThan(2.0);
          }
        }
      }
    }
  });
});
