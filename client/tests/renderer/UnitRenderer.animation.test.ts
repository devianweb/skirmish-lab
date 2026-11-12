import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { UnitRenderer } from '../../src/renderer/UnitRenderer';
import { makeState, makeUnit, collectHexColors } from './helpers';
import { GameAction, ActionLogEntry } from '@skirmish-lab/shared';

function createLogEntry(action: Partial<GameAction>): ActionLogEntry {
  return {
    action: {
      id: action.id ?? `act-${Math.random()}`,
      timestamp: action.timestamp ?? Date.now(),
      actorId: action.actorId ?? 'host-1',
      type: action.type ?? 'advance',
      payload: (action.payload ?? { type: 'advance' }) as any,
    },
    result: 'accepted',
    appliedAt: Date.now(),
  };
}

describe('UnitRenderer Animations (15D)', () => {
  function setup(): { renderer: UnitRenderer; scene: THREE.Scene; unitGroup: THREE.Group } {
    const scene = new THREE.Scene();
    const renderer = new UnitRenderer(scene);
    renderer.setReducedMotion(false); // explicit animation mode for tests
    const unitGroup = (renderer as any).unitGroup as THREE.Group;
    return { renderer, scene, unitGroup };
  }

  describe('Movement Tweens', () => {
    it('tweens a single-model unit at 0%, 50%, and 100% of the duration over a straight line', () => {
      const { renderer, unitGroup } = setup();
      const unit = makeUnit({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
      const state1 = makeState({ units: [unit] });
      renderer.syncFromState(state1);

      const mesh = unitGroup.children[0];
      expect(mesh.position.x).toBe(0);

      // Move unit to (10, 0, 0) via Advance
      const movedUnit = { ...unit, position: { x: 10, y: 0, z: 0 } };
      const actionLog = [
        createLogEntry({
          id: 'act-1',
          type: 'advance',
          payload: {
            type: 'advance',
            unitId: 'u1',
            path: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
            finalPosition: { x: 10, y: 0, z: 0 },
          },
        }),
      ];
      const state2 = makeState({ units: [movedUnit], actionLog, lastActionId: 'act-1' });

      renderer.syncFromState(state2);

      // 0%: immediately after sync, mesh is still at start position (0, 0, 0)
      expect(mesh.position.x).toBeCloseTo(0, 2);
      expect(mesh.position.y).toBeCloseTo(0, 2);
      expect(mesh.position.z).toBeCloseTo(0, 2);

      // 50%: advance by 0.2 s (half of 0.4 s duration)
      renderer.update(0.2);
      expect(mesh.position.x).toBeCloseTo(5, 1);
      expect(mesh.position.z).toBeCloseTo(0, 2);

      // 100%: advance another 0.2 s (total 0.4 s)
      renderer.update(0.2);
      expect(mesh.position.x).toBeCloseTo(10, 2);
      expect(mesh.position.z).toBeCloseTo(0, 2);
    });

    it('follows multi-segment waypoints in action payload at 0%, 50%, and 100%', () => {
      const { renderer, unitGroup } = setup();
      const unit = makeUnit({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
      const state1 = makeState({ units: [unit] });
      renderer.syncFromState(state1);

      const mesh = unitGroup.children[0];

      // Path turns 90 degrees: (0,0,0) -> (10,0,0) -> (10,0,10) (total length 20)
      const path = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ];
      const movedUnit = { ...unit, position: { x: 10, y: 0, z: 10 } };
      const actionLog = [
        createLogEntry({
          id: 'act-rush',
          type: 'rush',
          payload: {
            type: 'rush',
            unitId: 'u1',
            path,
            finalPosition: { x: 10, y: 0, z: 10 },
          },
        }),
      ];
      const state2 = makeState({ units: [movedUnit], actionLog, lastActionId: 'act-rush' });
      renderer.syncFromState(state2);

      // 0%
      expect(mesh.position.x).toBeCloseTo(0, 2);
      expect(mesh.position.z).toBeCloseTo(0, 2);

      // 50% (elapsed 0.2s): should be exactly at the corner waypoint (10, 0, 0)
      renderer.update(0.2);
      expect(mesh.position.x).toBeCloseTo(10, 1);
      expect(mesh.position.z).toBeCloseTo(0, 1);

      // 100% (elapsed 0.4s): at final destination (10, 0, 10)
      renderer.update(0.2);
      expect(mesh.position.x).toBeCloseTo(10, 2);
      expect(mesh.position.z).toBeCloseTo(10, 2);
    });

    it('tweens constituent models in a squad along modelPaths', () => {
      const { renderer, unitGroup } = setup();
      const squad = makeUnit({
        id: 'squad-1',
        position: { x: 5, y: 0, z: 5 },
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.0, y: 0, z: 5.0 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 6.0, y: 0, z: 5.0 } },
        ],
      });
      const state1 = makeState({ units: [squad] });
      renderer.syncFromState(state1);

      const squadRoot = unitGroup.children[0] as THREE.Group;
      const m1Mesh = squadRoot.children[0];
      const m2Mesh = squadRoot.children[1];

      // Move squad forward 10" in z
      const movedSquad = {
        ...squad,
        position: { x: 5, y: 0, z: 15 },
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.0, y: 0, z: 15.0 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 6.0, y: 0, z: 15.0 } },
        ],
      };
      const modelPaths = [
        [{ x: 5.0, y: 0, z: 5.0 }, { x: 5.0, y: 0, z: 15.0 }],
        [{ x: 6.0, y: 0, z: 5.0 }, { x: 6.0, y: 0, z: 15.0 }],
      ];
      const actionLog = [
        createLogEntry({
          id: 'act-squad-move',
          type: 'advance',
          payload: {
            type: 'advance',
            unitId: 'squad-1',
            path: [{ x: 5, y: 0, z: 5 }, { x: 5, y: 0, z: 15 }],
            finalPosition: { x: 5, y: 0, z: 15 },
            modelPositions: [{ x: 5.0, y: 0, z: 15.0 }, { x: 6.0, y: 0, z: 15.0 }],
            modelPaths,
          },
        }),
      ];
      const state2 = makeState({ units: [movedSquad], actionLog, lastActionId: 'act-squad-move' });
      renderer.syncFromState(state2);

      // 0%
      squadRoot.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      m1Mesh.getWorldPosition(v);
      expect(v.z).toBeCloseTo(5.0, 2);

      // 50%
      renderer.update(0.2);
      squadRoot.updateMatrixWorld(true);
      m1Mesh.getWorldPosition(v);
      expect(v.z).toBeCloseTo(10.0, 1);
      m2Mesh.getWorldPosition(v);
      expect(v.z).toBeCloseTo(10.0, 1);

      // 100%
      renderer.update(0.2);
      squadRoot.updateMatrixWorld(true);
      m1Mesh.getWorldPosition(v);
      expect(v.z).toBeCloseTo(15.0, 2);
      m2Mesh.getWorldPosition(v);
      expect(v.z).toBeCloseTo(15.0, 2);
    });

    it('a new state arriving mid-tween snaps the active tween to its end first, then starts the next', () => {
      const { renderer, unitGroup } = setup();
      const unit = makeUnit({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
      const state1 = makeState({ units: [unit] });
      renderer.syncFromState(state1);

      const mesh = unitGroup.children[0];

      // Step 1: Move from (0, 0, 0) to (10, 0, 0)
      const state2 = makeState({
        units: [{ ...unit, position: { x: 10, y: 0, z: 0 } }],
        actionLog: [
          createLogEntry({
            id: 'act-1',
            type: 'advance',
            payload: {
              type: 'advance',
              unitId: 'u1',
              path: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
              finalPosition: { x: 10, y: 0, z: 0 },
            },
          }),
        ],
        lastActionId: 'act-1',
      });
      renderer.syncFromState(state2);

      // Advance halfway (0.2s) -> mesh at ~5
      renderer.update(0.2);
      expect(mesh.position.x).toBeCloseTo(5, 1);

      // Step 2: New state arrives moving to (20, 0, 0) before previous tween finishes
      const state3 = makeState({
        units: [{ ...unit, position: { x: 20, y: 0, z: 0 } }],
        actionLog: [
          createLogEntry({
            id: 'act-2',
            type: 'rush',
            payload: {
              type: 'rush',
              unitId: 'u1',
              path: [{ x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }],
              finalPosition: { x: 20, y: 0, z: 0 },
            },
          }),
        ],
        lastActionId: 'act-2',
      });

      renderer.syncFromState(state3);

      // Mid-tween snapped to end (10), so new tween starts at (10, 0, 0) at 0%
      expect(mesh.position.x).toBeCloseTo(10, 2);

      // Advance halfway into new tween (0.2s) -> midpoint between 10 and 20 is 15
      renderer.update(0.2);
      expect(mesh.position.x).toBeCloseTo(15, 1);

      // Advance to end of new tween (0.2s) -> 20
      renderer.update(0.2);
      expect(mesh.position.x).toBeCloseTo(20, 2);
    });

    it('falls back to a straight line when payload has no path', () => {
      const { renderer, unitGroup } = setup();
      const unit = makeUnit({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
      renderer.syncFromState(makeState({ units: [unit] }));

      const mesh = unitGroup.children[0];

      // Push move with no path in payload
      const movedUnit = { ...unit, position: { x: 0, y: 0, z: 4 } };
      const actionLog = [
        createLogEntry({
          id: 'act-push',
          type: 'push-move',
          payload: {
            type: 'push-move',
            modelId: `${unit.id}-model-1`,
            destination: { x: 0, y: 0, z: 4 },
          },
        }),
      ];
      renderer.syncFromState(makeState({ units: [movedUnit], actionLog, lastActionId: 'act-push' }));

      // 0%
      expect(mesh.position.z).toBeCloseTo(0, 2);

      // 50%
      renderer.update(0.2);
      expect(mesh.position.z).toBeCloseTo(2, 1);

      // 100%
      renderer.update(0.2);
      expect(mesh.position.z).toBeCloseTo(4, 2);
    });
  });

  describe('Casualty Animations', () => {
    it('fades out and sinks a removed model 0.3" over 0.4s before disposing it', () => {
      const { renderer, scene, unitGroup } = setup();
      const squad = makeUnit({
        id: 'squad-1',
        position: { x: 5, y: 0, z: 5 },
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 5.0, y: 0, z: 5.0 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 6.0, y: 0, z: 5.0 } },
        ],
      });
      const state1 = makeState({ units: [squad] });
      renderer.syncFromState(state1);

      const squadRoot = unitGroup.children[0] as THREE.Group;
      expect(squadRoot.children.length).toBe(2);

      // Model m1 is destroyed
      const damagedSquad = {
        ...squad,
        position: { x: 6.0, y: 0, z: 5.0 },
        models: [
          { id: 'm1', wounds: 1, maxWounds: 1, isDestroyed: true, position: { x: 5.0, y: 0, z: 5.0 } },
          { id: 'm2', wounds: 1, maxWounds: 1, isDestroyed: false, position: { x: 6.0, y: 0, z: 5.0 } },
        ],
      };
      const state2 = makeState({ units: [damagedSquad] });
      renderer.syncFromState(state2);

      // The live squad root now has only m2
      expect(squadRoot.children.length).toBe(1);
      expect(squadRoot.children[0].userData.modelId).toBe('m2');

      // The casualty m1 is in the casualtiesGroup on scene
      const casualtiesGroup = (renderer as any).casualtiesGroup as THREE.Group;
      expect(casualtiesGroup.children.length).toBe(1);
      const casualtyMesh = casualtiesGroup.children[0];

      // At 0%: start y = 0
      expect(casualtyMesh.position.y).toBeCloseTo(0, 2);

      // At 50% (0.2s): has sunk 0.15" and faded to ~0.5 opacity
      renderer.update(0.2);
      expect(casualtyMesh.position.y).toBeCloseTo(-0.15, 2);

      // At 100% (0.4s): has sunk 0.3", fade complete -> disposed and removed from scene
      renderer.update(0.2);
      expect(casualtiesGroup.children.length).toBe(0);
    });
  });

  describe('Hit Flash Animations', () => {
    it('flashes a red tint on a model that took wounds for 0.25 s, then restores owner color', () => {
      const { renderer, unitGroup } = setup();
      const unit = makeUnit({ id: 'u1', ownerId: 'host-1', wounds: 0, maxWounds: 3 });
      const state1 = makeState({ units: [unit] });
      renderer.syncFromState(state1);

      const mesh = unitGroup.children[0];
      const initialColors = collectHexColors(mesh);

      // Unit takes 1 wound
      const woundedUnit = { ...unit, wounds: 1 };
      const state2 = makeState({ units: [woundedUnit] });
      renderer.syncFromState(state2);

      // Immediately after taking wounds: mesh colors contain red flash tint
      const flashColors = collectHexColors(mesh);
      expect(flashColors).toContain('ff2222');

      // Midway through flash (0.1s): still red
      renderer.update(0.1);
      expect(collectHexColors(mesh)).toContain('ff2222');

      // Flash finishes at 0.25s (advance 0.15s more) -> restored to initial colors
      renderer.update(0.15);
      const restoredColors = collectHexColors(mesh);
      expect(restoredColors).not.toContain('ff2222');
      expect(restoredColors).toEqual(initialColors);
    });
  });

  describe('Prefers Reduced Motion', () => {
    it('snaps movements immediately without tweening when reduced motion is enabled', () => {
      const { renderer, unitGroup } = setup();
      renderer.setReducedMotion(true);

      const unit = makeUnit({ id: 'u1', position: { x: 0, y: 0, z: 0 } });
      renderer.syncFromState(makeState({ units: [unit] }));

      const mesh = unitGroup.children[0];
      expect(mesh.position.x).toBe(0);

      // Move unit to (10, 0, 0)
      const movedUnit = { ...unit, position: { x: 10, y: 0, z: 0 } };
      const actionLog = [
        createLogEntry({
          id: 'act-red',
          type: 'advance',
          payload: {
            type: 'advance',
            unitId: 'u1',
            path: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
            finalPosition: { x: 10, y: 0, z: 0 },
          },
        }),
      ];
      renderer.syncFromState(makeState({ units: [movedUnit], actionLog, lastActionId: 'act-red' }));

      // Immediately at destination (no tweening needed)
      expect(mesh.position.x).toBe(10);
    });

    it('disposes casualties immediately without fade or sink when reduced motion is enabled', () => {
      const { renderer, unitGroup } = setup();
      renderer.setReducedMotion(true);

      const unit = makeUnit({ id: 'u1' });
      renderer.syncFromState(makeState({ units: [unit] }));
      expect(unitGroup.children.length).toBe(1);

      // Unit destroyed
      unit.isDestroyed = true;
      renderer.syncFromState(makeState({ units: [unit] }));

      expect(unitGroup.children.length).toBe(0);
      const casualtiesGroup = (renderer as any).casualtiesGroup as THREE.Group;
      expect(casualtiesGroup.children.length).toBe(0);
    });

    it('skips hit flashes when reduced motion is enabled', () => {
      const { renderer, unitGroup } = setup();
      renderer.setReducedMotion(true);

      const unit = makeUnit({ id: 'u1', ownerId: 'host-1', wounds: 0, maxWounds: 3 });
      renderer.syncFromState(makeState({ units: [unit] }));

      const mesh = unitGroup.children[0];
      const initialColors = collectHexColors(mesh);

      // Unit takes 1 wound
      renderer.syncFromState(makeState({ units: [{ ...unit, wounds: 1 }] }));

      // Should not flash red
      expect(collectHexColors(mesh)).toEqual(initialColors);
    });
  });

  describe('Integrity & Edge Cases', () => {
    it('syncing unchanged state is idempotent and creates no tweens', () => {
      const { renderer, unitGroup } = setup();
      const unit = makeUnit({ id: 'u1', position: { x: 5, y: 0, z: 5 } });
      const state = makeState({ units: [unit] });

      renderer.syncFromState(state);
      renderer.syncFromState(state);
      renderer.syncFromState(state);

      expect((renderer as any).activeMovementTweens.length).toBe(0);
      expect((renderer as any).activeCasualties.length).toBe(0);
      expect((renderer as any).activeHitFlashes.length).toBe(0);
    });

    it('clear() cleans up all active tweens, casualties, and hit flashes', () => {
      const { renderer, unitGroup } = setup();
      const unit = makeUnit({ id: 'u1', position: { x: 0, y: 0, z: 0 }, wounds: 0, maxWounds: 3 });
      renderer.syncFromState(makeState({ units: [unit] }));

      // Start movement and hit flash
      const movedUnit = { ...unit, position: { x: 10, y: 0, z: 0 }, wounds: 1 };
      const actionLog = [
        createLogEntry({
          id: 'act-mv',
          type: 'advance',
          payload: {
            type: 'advance',
            unitId: 'u1',
            path: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
            finalPosition: { x: 10, y: 0, z: 0 },
          },
        }),
      ];
      renderer.syncFromState(makeState({ units: [movedUnit], actionLog, lastActionId: 'act-mv' }));

      renderer.clear();

      expect(unitGroup.children.length).toBe(0);
      expect((renderer as any).activeMovementTweens.length).toBe(0);
      expect((renderer as any).activeCasualties.length).toBe(0);
      expect((renderer as any).activeHitFlashes.length).toBe(0);
    });
  });
});
