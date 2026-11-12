import { describe, it, expect } from 'vitest';
import {
  createHazardRangeMap,
  createInitialGameState,
  createUnitsFromStarterArmy,
  STARTER_ARMIES,
  GameState,
  Unit,
  Vector3,
  TERRAIN_PALETTE_CATALOG,
  TerrainPiece,
} from '@skirmish-lab/shared';
import {
  moveHazardPieceIds,
  placementHazardPieceIds,
  dangerousTerrainLabelText,
  hazardPulseOpacity,
} from '../../src/ui/hazardIndicators';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function setupState(): { state: GameState; waders: Unit; hero: Unit; flyers: Unit } {
  const state = createInitialGameState(HOST, GUEST);
  state.terrain = createHazardRangeMap().terrain;
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = HOST;

  const units = createUnitsFromStarterArmy(STARTER_ARMIES['test-hazard-army'], HOST);
  const waders = units[0]; // 5 Tough 1 models
  const hero = units[1]; // Tough 3 Hero
  const flyers = units[2]; // 3 Flying models

  state.units = [waders, hero, flyers];
  return { state, waders, hero, flyers };
}

describe('hazardIndicators', () => {
  describe('dangerousTerrainLabelText', () => {
    it('formats name and effect in our own words for hazard-pool', () => {
      const pool = TERRAIN_PALETTE_CATALOG['hazard-pool'];
      const piece: TerrainPiece = {
        id: 'test-pool',
        terrainType: 'hazard-pool',
        position: P(0, 0, 0),
        rotation: P(0, 0, 0),
        scale: { ...pool.defaultScale },
        blocksLineOfSight: pool.blocksLineOfSight,
        providesCover: pool.providesCover,
        isObstacle: pool.isObstacle,
        isDangerous: true,
      };
      expect(dangerousTerrainLabelText(piece)).toBe(
        'Hazard pool · dangerous: roll per wound, each 1 is a wound'
      );
    });
  });

  describe('hazardPulseOpacity', () => {
    it('oscillates with a 1000 ms (1 s) period', () => {
      const t0 = 12345;
      const op0 = hazardPulseOpacity(t0);
      const op1 = hazardPulseOpacity(t0 + 1000);
      expect(op0).toBeCloseTo(op1, 5);
      expect(hazardPulseOpacity(t0 + 2000)).toBeCloseTo(op0, 5);
    });

    it('stays strictly within [0.35, 0.95]', () => {
      for (let t = 0; t <= 1000; t += 50) {
        const val = hazardPulseOpacity(t);
        expect(val).toBeGreaterThanOrEqual(0.35 - 1e-4);
        expect(val).toBeLessThanOrEqual(0.95 + 1e-4);
      }
    });
  });

  describe('moveHazardPieceIds', () => {
    it('a planned path across a hazard pool highlights exactly that piece and matches hazard dice count pieces', () => {
      const { state, waders } = setupState();
      // On Hazard Range, pool A is at x: -9, z: -8 (spans x: -11..-7, z: -10..-6)
      const poolA = state.terrain.find((t) => t.position.x === -9 && t.position.z === -8)!;
      expect(poolA).toBeDefined();

      // Path crossing pool A along z = -8 from x = -13 to clear strip at x = -6
      const crossingPath = [P(-13, 0, -8), P(-6, 0, -8)];
      const pieces = moveHazardPieceIds(state, [crossingPath], waders);
      expect(pieces).toEqual([poolA.id]);
    });

    it('a path that avoids dangerous terrain returns nothing', () => {
      const { state, waders } = setupState();
      // Path walking along the 2" clear strip between pool A and pool B (x = -6, z from -15 to -2)
      const clearPath = [P(-6, 0, -15), P(-6, 0, -2)];
      const pieces = moveHazardPieceIds(state, [clearPath], waders);
      expect(pieces).toEqual([]);
    });

    it('Flying units are immune and return no highlighted pieces while planning', () => {
      const { state, flyers } = setupState();
      // Flyers crossing pool A
      const crossingPath = [P(-13, 0, -8), P(-6, 0, -8)];
      const pieces = moveHazardPieceIds(state, [crossingPath], flyers);
      expect(pieces).toEqual([]);
    });

    it('crossing a piece already tested this activation costs no hazard dice and highlights nothing', () => {
      const { state, waders } = setupState();
      const poolA = state.terrain.find((t) => t.position.x === -9 && t.position.z === -8)!;
      waders.hazardTestedPieceIds = [poolA.id];

      const crossingPath = [P(-13, 0, -8), P(-6, 0, -8)];
      const pieces = moveHazardPieceIds(state, [crossingPath], waders);
      expect(pieces).toEqual([]);
    });
  });

  describe('placementHazardPieceIds', () => {
    it('returns piece under unit when placing into a hazard pool', () => {
      const { state, hero } = setupState();
      const poolA = state.terrain.find((t) => t.position.x === -9 && t.position.z === -8)!;
      const pieces = placementHazardPieceIds(state, hero, P(-9, 0, -8));
      expect(pieces).toEqual([poolA.id]);
    });

    it('returns empty when placing in clear ground', () => {
      const { state, waders } = setupState();
      const pieces = placementHazardPieceIds(state, waders, P(0, 0, -15));
      expect(pieces).toEqual([]);
    });

    it('returns empty for Flying units placing in hazard pool', () => {
      const { state, flyers } = setupState();
      const pieces = placementHazardPieceIds(state, flyers, P(-9, 0, -8));
      expect(pieces).toEqual([]);
    });
  });
});
