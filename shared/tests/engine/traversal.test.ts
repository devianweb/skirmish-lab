import { describe, expect, it } from 'vitest';
import {
  allocateSquadCasualties,
  calculateFallingDamage,
  calculateLedgeKnockback,
  detectPathFall,
  detectPathGapJump,
  distance3D,
  distanceHorizontal,
  getEffectiveMaxMovement,
  isPathDangerous,
  isPathDifficult,
  pathLength3D,
  resolveDangerousTerrain,
  resolveFallingDamage,
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

    it('exempts units with pathfinder or airborne from difficult terrain capping', () => {
      const pathfinder: Unit = { ...dummyUnit, speed: 6, specialRules: ['pathfinder'] };
      expect(getEffectiveMaxMovement(pathfinder, 'rush', true)).toBe(12.0);

      const flyer: Unit = { ...dummyUnit, speed: 6, specialRules: ['airborne'] };
      expect(getEffectiveMaxMovement(flyer, 'charge', true)).toBe(12.0);
    });

    it('detects sheer wall climbs as difficult terrain without a ladder/stairs', () => {
      const state = makeState();
      state.terrain = []; // empty terrain, sheer vertical ascent

      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 2.0, z: 1.0 }, // scales 2" vertically
      ];
      expect(isPathDifficult(state, path, dummyUnit)).toBe(true);
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

  describe('Drops & Falling Damage', () => {
    it('treats drops <= 3.0" as completely safe with 0 damage', () => {
      const drop = calculateFallingDamage(3.0);
      expect(drop.isDangerous).toBe(false);
      expect(drop.damageHits).toBe(0);
      expect(drop.armorPiercing).toBe(0);
    });

    it('inflicts 1 hit with AP(1) per full 3.0" dropped for drops > 3.0"', () => {
      // 3.5" fall -> 1 full 3" -> 1 hit with AP 1
      const fall1 = calculateFallingDamage(3.5);
      expect(fall1.isDangerous).toBe(true);
      expect(fall1.damageHits).toBe(1);
      expect(fall1.armorPiercing).toBe(1);

      // 6.2" fall -> 2 full 3" -> 1 hit with AP 2
      const fall2 = calculateFallingDamage(6.2);
      expect(fall2.isDangerous).toBe(true);
      expect(fall2.damageHits).toBe(1);
      expect(fall2.armorPiercing).toBe(2);

      // 9.0" fall -> 3 full 3" -> 1 hit with AP 3
      const fall3 = calculateFallingDamage(9.0);
      expect(fall3.isDangerous).toBe(true);
      expect(fall3.damageHits).toBe(1);
      expect(fall3.armorPiercing).toBe(3);
    });

    it('resolves falling defense rolls with AP applied', () => {
      // Unit has Defense 4. Fall has AP 1. Effective defense is 5 (4 + 1).
      // Roll of 4 fails; roll of 5 succeeds; roll of 6 auto-saves; roll of 1 auto-fails.
      const resFail = resolveFallingDamage(dummyUnit, 4.0, 4);
      expect(resFail.saved).toBe(false);
      expect(resFail.wounds).toBe(1);

      const resPass = resolveFallingDamage(dummyUnit, 4.0, 5);
      expect(resPass.saved).toBe(true);
      expect(resPass.wounds).toBe(0);

      const resSix = resolveFallingDamage(dummyUnit, 4.0, 6);
      expect(resSix.saved).toBe(true);
      expect(resSix.wounds).toBe(0);

      const resOne = resolveFallingDamage(dummyUnit, 4.0, 1);
      expect(resOne.saved).toBe(false);
      expect(resOne.wounds).toBe(1);
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
    });
  });

  describe('Horizontal Gap Jumping', () => {
    it('steps across small gaps <= 1.0" freely without testing', () => {
      const res = resolveGapJump(0.8, dummyUnit);
      expect(res.requiresTest).toBe(false);
      expect(res.passed).toBe(true);
    });

    it('requires a Quality test for gaps > 1.0"', () => {
      // Quality 4: roll of 3 fails; roll of 4 passes
      const fail = resolveGapJump(2.5, dummyUnit, 3);
      expect(fail.requiresTest).toBe(true);
      expect(fail.passed).toBe(false);

      const pass = resolveGapJump(2.5, dummyUnit, 4);
      expect(pass.requiresTest).toBe(true);
      expect(pass.passed).toBe(true);
    });

    it('airborne units auto-pass gap jumps without testing', () => {
      const flyer: Unit = { ...dummyUnit, specialRules: ['airborne'] };
      const res = resolveGapJump(4.0, flyer);
      expect(res.requiresTest).toBe(false);
      expect(res.passed).toBe(true);
    });

    it('pathfinder units pass gap jumps on 2+', () => {
      const scout: Unit = { ...dummyUnit, quality: 5, specialRules: ['pathfinder'] };
      const passOnTwo = resolveGapJump(3.0, scout, 2);
      expect(passOnTwo.passed).toBe(true);

      const failOnOne = resolveGapJump(3.0, scout, 1);
      expect(failOnOne.passed).toBe(false);
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
      expect(res.gapDistance).toBe(4);
      expect(res.targetQuality).toBe(dummyUnit.quality);

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

    it('airborne units ignore dangerous terrain', () => {
      const flyer: Unit = { ...dummyUnit, specialRules: ['airborne'] };
      const outcome = resolveDangerousTerrain(flyer, [1, 1, 1]);
      expect(outcome.woundsInflicted).toBe(0);
    });

    it('allocates squad casualties to designated models from player selection modal', () => {
      const squad: Unit = {
        ...dummyUnit,
        wounds: 3,
        maxWounds: 3,
        models: [
          { id: 'm1', name: 'Trooper A', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
          { id: 'm2', name: 'Trooper B', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
          { id: 'm3', name: 'Trooper C', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        ],
      };

      // Player selects Trooper B ('m2') to take the hazard wound
      const res = allocateSquadCasualties(squad, 1, ['m2']);
      expect(res.modelsDestroyed.length).toBe(1);
      expect(res.modelsDestroyed[0].id).toBe('m2');
      expect(squad.models[1].isDestroyed).toBe(true);
      expect(squad.models[0].isDestroyed).toBe(false);
      expect(squad.models[2].isDestroyed).toBe(false);
      expect(squad.wounds).toBe(2);
    });
  });

  describe('High Ledge Knockback', () => {
    it('causes models pushed over ledges > 3.0" tall to plummet to the ground', () => {
      const elevatedPos = { x: 10, y: 3.5, z: 10 };
      const push = { x: 1.0, z: 0 };
      const knockback = calculateLedgeKnockback(elevatedPos, push, 0);

      expect(knockback.didPlummet).toBe(true);
      expect(knockback.fallHeight).toBe(3.5);
      expect(knockback.destination).toEqual({ x: 11, y: 0, z: 10 });
    });

    it('keeps models on level ground when pushed on low surfaces <= 3.0"', () => {
      const groundPos = { x: 5, y: 1.0, z: 5 };
      const push = { x: 0, z: 1.0 };
      const knockback = calculateLedgeKnockback(groundPos, push, 0);

      expect(knockback.didPlummet).toBe(false);
      expect(knockback.destination).toEqual({ x: 5, y: 1.0, z: 6 });
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

      const moveAction = createAction('host-1', 'move-unit', {
        unitId: unit.id,
        path: [
          { x: 0, y: 4.0, z: 0 },
          { x: 1.0, y: 0, z: 0 }, // 4" drop
        ],
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
