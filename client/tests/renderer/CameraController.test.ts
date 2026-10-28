// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../../src/renderer/CameraController';

describe('CameraController', () => {
  function setup(): { controller: CameraController; camera: THREE.PerspectiveCamera; element: HTMLElement } {
    const camera = new THREE.PerspectiveCamera(75, 1024 / 768, 0.1, 1000);
    const element = document.createElement('div');
    document.body.appendChild(element);
    const controller = new CameraController(camera, element);
    return { controller, camera, element };
  }

  it('starts with the camera looking at the board origin', () => {
    const { controller } = setup();
    const controls = (controller as any).controls;
    expect(controls.target.x).toBe(0);
    expect(controls.target.y).toBe(0);
    expect(controls.target.z).toBe(0);
  });

  it('setTarget moves the orbit target', () => {
    const { controller } = setup();
    controller.setTarget(5, 0, -8);
    const controls = (controller as any).controls;
    expect(controls.target.x).toBe(5);
    expect(controls.target.y).toBe(0);
    expect(controls.target.z).toBe(-8);
  });

  it('update() applies damping without errors', () => {
    const { controller } = setup();
    controller.setTarget(1, 0, 1);
    expect(() => controller.update()).not.toThrow();
  });

  it('keeps the camera above the board plane (max polar angle limit)', () => {
    const { controller } = setup();
    const controls = (controller as any).controls;
    expect(controls.maxPolarAngle).toBeLessThanOrEqual(Math.PI / 2);
    expect(controls.minDistance).toBeGreaterThan(0);
    expect(controls.maxDistance).toBeGreaterThan(controls.minDistance);
  });

  it('setupForRole("host") positions camera at south corner looking toward board center', () => {
    const { controller, camera } = setup();
    controller.setupForRole('host');
    expect(camera.position.z).toBeCloseTo(-20);
    expect(camera.position.x).toBeCloseTo(20);
    expect(camera.position.y).toBeCloseTo(20);
    const controls = (controller as any).controls;
    expect(controls.target.x).toBeCloseTo(0);
    expect(controls.target.y).toBeCloseTo(0);
    expect(controls.target.z).toBeCloseTo(0);
  });

  it('setupForRole("guest") positions camera at north corner looking toward board center', () => {
    const { controller, camera } = setup();
    controller.setupForRole('guest');
    expect(camera.position.z).toBeCloseTo(20);
    expect(camera.position.x).toBeCloseTo(-20);
    expect(camera.position.y).toBeCloseTo(20);
    const controls = (controller as any).controls;
    expect(controls.target.x).toBeCloseTo(0);
    expect(controls.target.y).toBeCloseTo(0);
    expect(controls.target.z).toBeCloseTo(0);
  });
});
