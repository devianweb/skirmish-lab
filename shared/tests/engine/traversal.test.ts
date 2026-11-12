import { describe, expect, it } from 'vitest';
import {
  calculateJumpDice,
  countFallWounds,
  fallDiceCount,
  detectPathFall,
  detectPathGapJump,
  distance3D,
  distanceHorizontal,
  getEffectiveMaxMovement,
  isPathDangerous,
  isPathDifficult,
  pathLength3D,
  resolveDangerousTerrain,
  resolveGapJump,
  validateMeleeVerticalReach,
} from '../../src/engine/traversal';
import { createInitialGameState, createAction } from '../../src/gameState';
import { applyDefaultScenario } from '../../src/data/scenario';
import { applyAction, validateAction } from '../../src/engine/actions';
import { Unit } from '../../src/gameTypes';

function makeState() {
  const state = createInitialGameState('host-1', 'guest-1');
  applyDefaultScenario(state);
  state.status = 'in-progress';
  state.turnState.phase = 'activation';
  state.turnState.currentPlayerId = 'host-1';
  return state;
}

describe('Phase 11A: Shared Traversal Engine', () => {
  const dummyUnit: Unit = {
    id: 'u1',
    name: 'Veteran',
    faction: 'human-crusaders',
    ownerId: 'host-1',
    speed: 6,
    quality: 4,
    defense: 4,
    wounds: 1,
    maxWounds: 1,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    specialRules: [],
    weapons: [],
    hasMoved: false,
    hasAttacked: false,
    remainingMovement: 6,
    isActivated: true,
    isDestroyed: false,
    models: [
      { id: 'm1', name: 'Model 1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
  };

  describe('3D Euclidean Distances & Path Lengths', () => {
    it('calculates 3D Euclidean distance between coordinates', () => {
      const p1 = { x: 0, y: 0, z: 0 };
      const p2 = { x: 3, y: 4, z: 0 };
      expect(distance3D(p1, p2)).toBeCloseTo(5.0);

      const p3 = { x: 1, y: 2, z: 2 };
      const p4 = { x: 4, y: 2, z: 6 };
      expect(distance3D(p3, p4)).toBeCloseTo(5.0);
    });

    it('calculates 2D horizontal distance ignoring vertical y', () => {
      const p1 = { x: 0, y: 10, z: 0 };
      const p2 = { x: 3, y: 25, z: 4 };
      expect(distanceHorizontal(p1, p2)).toBeCloseTo(5.0);
    });

    it('calculates total 3D path length across multiple waypoints', () => {
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 3, z: 0 }, // climbs 3"
        { x: 4, y: 3, z: 0 }, // moves 4" along platform
      ];
      expect(pathLength3D(path)).toBeCloseTo(7.0);
    });
  });

  describe('Difficult Terrain Speed Capping', () => {
    it('caps Move, Rush, and Charge at 6.0" when encountering Difficult Terrain', () => {
      const fastFighter: Unit = { ...dummyUnit, speed: 7 };
      // Standard move
      expect(getEffectiveMaxMovement(fastFighter, 'move', true)).toBe(6.0);
      // Rush normally 14", capped at 6.0"
      expect(getEffectiveMaxMovement(fastFighter, 'rush', true)).toBe(6.0);
      // Charge normally 14", capped at 6.0"
      expect(getEffectiveMaxMovement(fastFighter, 'charge', true)).toBe(6.0);
    });

    it('retains normal movement allowances when terrain is not difficult', () => {
      const normalFighter: Unit = { ...dummyUnit, speed: 6 };
      expect(getEffectiveMaxMovement(normalFighter, 'move', false)).toBe(6.0);
      expect(getEffectiveMaxMovement(normalFighter, 'rush', false)).toBe(12.0);
      expect(getEffectiveMaxMovement(normalFighter, 'charge', false)).toBe(12.0);
    });

    it('exempts units with pathfinder or flying from difficult terrain capping', () => {
      const pathfinder: Unit = { ...dummyUnit, speed: 6, specialRules: ['strider'] };
      expect(getEffectiveMaxMovement(pathfinder, 'rush', true)).toBe(12.0);

      const flyer: Unit = { ...dummyUnit, speed: 6, specialRules: ['flying'] };
      expect(getEffectiveMaxMovement(flyer, 'charge', true)).toBe(12.0);
    });

    it('a climb up a wall is ordinary movement, never difficult terrain', () => {
      const state = makeState();
      state.terrain = []; // empty terrain, sheer vertical ascent

      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2.0, z: 1.0 }, // scales 2" vertically
      ];
      expect(isPathDifficult(state, path, dummyUnit)).toBe(false);
    });

    it('allows vertical ascent without difficult terrain penalty when climbing a ladder', () => {
      const state = makeState();
      state.terrain = [
        {
          id: 'ladder-1',
          name: 'Access Ladder',
          terrainType: 'ladder',
          climbType: 'ladder',
          position: { x: 0, y: 1.0, z: 1.0 },
          scale: { x: 1, y: 1, z: 1 },
          size: { x: 2, y: 3, z: 2 },
          rotation: { x: 0, y: 0, z: 0 },
          blocksMovement: false,
          blocksLineOfSight: false,
          providesCover: false,
          isObstacle: false,
        },
      ];

      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2.0, z: 1.0 },
      ];
      expect(isPathDifficult(state, path, dummyUnit)).toBe(false);
    });
  });

  describe('Drops & falls', () => {
    it('a fall under 2" rolls no dice; from 2" it rolls one die per started inch', () => {
      expect(fallDiceCount(1.9)).toBe(0);
      expect(fallDiceCount(2.0)).toBe(2);
      expect(fallDiceCount(3.0)).toBe(3);
      expect(fallDiceCount(3.1)).toBe(4);
      expect(fallDiceCount(6.0)).toBe(6);
      expect(fallDiceCount(9.0)).toBe(9);
    });

    it('each fall die showing 1-3 is a wound (no Defense roll)', () => {
      expect(countFallWounds([1, 2, 3, 4, 5, 6])).toBe(3);
      expect(countFallWounds([4, 5, 6])).toBe(0);
      expect(countFallWounds([3, 3])).toBe(2);
    });

    it('detects vertical drops in paths', () => {
      const safePath = [
        { x: 0, y: 2.0, z: 0 },
        { x: 2, y: 0, z: 0 }, // 2.0" drop
      ];
      expect(detectPathFall(safePath).maxDrop).toBe(2.0);

      const dangerousPath = [
        { x: 0, y: 4.5, z: 0 },
        { x: 1, y: 0, z: 0 }, // 4.5" drop
      ];
      expect(detectPathFall(dangerousPath).maxDrop).toBe(4.5);

      // Descending stairs should NOT count as a free fall drop
      const stairs: TerrainPiece = {
        id: 'stairs-1',
        terrainType: 'stairs',
        climbType: 'stairs',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 2, y: 4.5, z: 2 },
        blocksLineOfSight: false,
        providesCover: false,
        isObstacle: false,
      };
      const stairsState = makeState();
      stairsState.terrain = [stairs];
      // (a path that follows the slope surface: head toward +Z at 4.5", foot at -Z at 0)
      const downTheSlope = [
        { x: 0, y: 4.5, z: 1 },
        { x: 0, y: 0, z: -1 },
      ];
      expect(detectPathFall(downTheSlope, stairsState).maxDrop).toBe(0);
      // ...but a dive straight through the wedge is a fall, not stairs
      expect(detectPathFall(dangerousPath, stairsState).maxDrop).toBe(4.5);
    });
  });

  describe('Horizontal Gap Jumping', () => {
    it('steps across small gaps <= 1.0" freely without testing', () => {
      const res = resolveGapJump(0.8, dummyUnit);
      expect(res.requiresTest).toBe(false);
      expect(res.passed).toBe(true);
    });

    it('gaps of 1-6" use the jump test: one die per started inch, each 2+', () => {
      expect(resolveGapJump(1.1, dummyUnit)).toMatchObject({ requiresTest: true, dice: 2, target: 2, passed: false });
      expect(resolveGapJump(2.5, dummyUnit)).toMatchObject({ dice: 3 });
      expect(resolveGapJump(2.5, dummyUnit, [2, 6, 3]).passed).toBe(true);
      expect(resolveGapJump(2.5, dummyUnit, [2, 1, 3]).passed).toBe(false);
      expect(resolveGapJump(6.0, dummyUnit)).toMatchObject({ dice: 6 });
      expect(resolveGapJump(6.0, dummyUnit, [2, 2, 2, 2, 2, 2]).passed).toBe(true);
      expect(resolveGapJump(6.0, dummyUnit, [2, 2, 2, 2, 2, 1]).passed).toBe(false);
    });

    it('calculateJumpDice rounds up per started inch (with a hair of tolerance) and Strider halves, rounding up', () => {
      expect(calculateJumpDice(1.1)).toBe(2);
      expect(calculateJumpDice(5.0)).toBe(5);
      expect(calculateJumpDice(5.1)).toBe(6);
      expect(calculateJumpDice(5, true)).toBe(3);
      expect(calculateJumpDice(6, true)).toBe(3);
      expect(calculateJumpDice(1.1, true)).toBe(1);
    });

    it('a gap wider than 6" cannot be jumped', () => {
      expect(resolveGapJump(7, dummyUnit, [6, 6, 6])).toMatchObject({ canJump: false, passed: false });
    });

    it('flying units auto-pass gap jumps without testing', () => {
      const flyer: Unit = { ...dummyUnit, specialRules: ['flying'] };
      const res = resolveGapJump(4.0, flyer);
      expect(res.requiresTest).toBe(false);
      expect(res.passed).toBe(true);
    });

    it('Strider rolls half the dice (rounding up) on a gap jump', () => {
      const strider: Unit = { ...dummyUnit, specialRules: ['strider'] };
      expect(resolveGapJump(3.5, strider)).toMatchObject({ dice: 2, target: 2 });
      expect(resolveGapJump(3.5, strider, [2, 2]).passed).toBe(true);
      expect(resolveGapJump(3.5, strider, [2, 1]).passed).toBe(false);
    });

    it('detects gap jumps along a path between distinct elevated platforms', () => {
      const state = createInitialGameState('h', 'g');
      state.terrain = [
        {
          id: 'plat1',
          type: 'building',
          name: 'Platform 1',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 2.5, z: 2 },
          isWalkable: true,
          elevation: 2.5,
        },
        {
          id: 'plat2',
          type: 'building',
          name: 'Platform 2',
          position: { x: 4, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 2.5, z: 2 },
          isWalkable: true,
          elevation: 2.5,
        },
      ];

      const jumpPath = [
        { x: 0, y: 2.5, z: 0 },
        { x: 4, y: 2.5, z: 0 },
      ];
      const res = detectPathGapJump(state, jumpPath, dummyUnit);
      expect(res.isGapJump).toBe(true);
      // Platform centres are 4" apart: a straight tape from take-off to landing reads 4" (the open gap is only 2")
      expect(res.gapDistance).toBeCloseTo(4, 1);
      expect(res.dice).toBe(4);
      expect(res.target).toBe(2);

      const samePlatPath = [
        { x: 0, y: 2.5, z: 0 },
        { x: 0.5, y: 2.5, z: 0 },
      ];
      const sameRes = detectPathGapJump(state, samePlatPath, dummyUnit);
      expect(sameRes.isGapJump).toBe(false);

      const groundPath = [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ];
      const groundRes = detectPathGapJump(state, groundPath, dummyUnit);
      expect(groundRes.isGapJump).toBe(false);
    });
  });

  describe('Vertical Melee Reach Restriction', () => {
    it('permits melee engagement when vertical difference is <= 4.0"', () => {
      const groundPos = { x: 5, y: 0, z: 5 };
      const platformPos = { x: 5, y: 3.0, z: 5 };
      expect(validateMeleeVerticalReach(groundPos, platformPos)).toBe(true);
    });

    it('rejects melee engagement when vertical difference is > 4.0"', () => {
      const groundPos = { x: 5, y: 0, z: 5 };
      const tallTowerPos = { x: 5, y: 4.5, z: 5 };
      expect(validateMeleeVerticalReach(groundPos, tallTowerPos)).toBe(false);
    });
  });

  describe('Dangerous Terrain Hazard Tests & Squad Allocation', () => {
    it('inflicts 1 wound for every roll of 1', () => {
      const dice = [1, 4, 1, 6, 2];
      const outcome = resolveDangerousTerrain(dummyUnit, dice);
      expect(outcome.woundsInflicted).toBe(2);
      expect(outcome.failedCount).toBe(2);
    });

    it('flying units ignore dangerous terrain', () => {
      const flyer: Unit = { ...dummyUnit, specialRules: ['flying'] };
      const outcome = resolveDangerousTerrain(flyer, [1, 1, 1]);
      expect(outcome.woundsInflicted).toBe(0);
    });
  });

  describe('Action Integration (Move, Rush, Charge)', () => {
    it('terminates activation immediately when dropping > 3.0" during move', () => {
      const state = makeState();
      state.turnState.phase = 'activation';
      state.turnState.activeUnitId = state.units[0].id;
      const unit = state.units[0];
      unit.isActivated = true;
      unit.position = { x: 0, y: 4.0, z: 0 };
      // A 4" deck whose east edge the unit stands on; the leap is declared (batch 1E: jumps are explicit)
      state.terrain = [
        {
          id: 'deck-4',
          terrainType: 'platform',
          position: { x: -2, y: 4, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 4, y: 0.3, z: 4 },
          elevation: 4,
          isWalkable: true,
          blocksLineOfSight: false,
          providesCover: false,
          isObstacle: false,
        },
      ];

      const moveAction = createAction('host-1', 'advance', {
        unitId: unit.id,
        path: [
          { x: 0, y: 4.0, z: 0 },
          { x: 1.0, y: 0, z: 0 }, // 4" drop
        ],
        traversal: { kind: 'jump-drop', takeoff: { x: 0, y: 4.0, z: 0 }, landing: { x: 1.0, y: 0, z: 0 } },
        fallingDefenseRoll: 6, // Successful defense roll to avoid death
      });

      const outcome = applyAction(state, moveAction);
      expect(outcome.ok).toBe(true);
      // Unit has moved and remainingMovement is 0
      expect(outcome.state!.units[0].hasMoved).toBe(true);
      expect(outcome.state!.units[0].remainingMovement).toBe(0);
      // Activation terminates immediately
      expect(outcome.state!.turnState.activeUnitId).toBeNull();
    });

    it('rejects charge when target is on a ledge outside vertical melee reach (> 4.0")', () => {
      const state = makeState();
      state.turnState.phase = 'activation';
      const attacker = state.units.find((u) => u.ownerId === 'host-1')!;
      const target = state.units.find((u) => u.ownerId === 'guest-1')!;
      state.turnState.activeUnitId = attacker.id;
      attacker.isActivated = true;
      attacker.position = { x: 0, y: 0, z: 0 };
      target.position = { x: 1.0, y: 5.0, z: 0 }; // 5.0" tall ledge (> 4.0" vertical melee reach)
      // Squad models follow the anchor (charges and reach are measured per model)
      for (const m of target.models) m.position = { ...target.position };
      for (const m of attacker.models) m.position = { ...attacker.position };

      const chargeAction = createAction('host-1', 'charge', {
        attackerId: attacker.id,
        targetId: target.id,
        path: [
          { x: 0, y: 0, z: 0 },
          { x: 1.0, y: 0, z: 0 }, // reaches base of ledge
        ],
      });

      const val = validateAction(state, chargeAction);
      expect(val.valid).toBe(false);
      expect(val.reason).toContain('outside vertical melee reach');
    });
  });
});
