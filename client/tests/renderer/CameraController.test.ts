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
    expect(camera.position.z).toBeCloseTo(-24);
    expect(camera.position.x).toBeCloseTo(24);
    expect(camera.position.y).toBeCloseTo(24);
    const controls = (controller as any).controls;
    expect(controls.target.x).toBeCloseTo(0);
    expect(controls.target.y).toBeCloseTo(0);
    expect(controls.target.z).toBeCloseTo(0);
  });

  it('setupForRole("guest") positions camera at north corner looking toward board center', () => {
    const { controller, camera } = setup();
    controller.setupForRole('guest');
    expect(camera.position.z).toBeCloseTo(24);
    expect(camera.position.x).toBeCloseTo(-24);
    expect(camera.position.y).toBeCloseTo(24);
    const controls = (controller as any).controls;
    expect(controls.target.x).toBeCloseTo(0);
    expect(controls.target.y).toBeCloseTo(0);
    expect(controls.target.z).toBeCloseTo(0);
  });

  it('scales the start distance with the board and keeps host south / guest north', () => {
    const small = setup();
    small.controller.setupForRole('host', { width: 24, height: 36 });
    const big = setup();
    big.controller.setupForRole('host', { width: 72, height: 72 });
    const dist = (c: THREE.PerspectiveCamera) => c.position.length();
    expect(dist(big.camera)).toBeGreaterThan(dist(small.camera) * 1.9);
    // host: +x, +y, -z; guest: -x, +y, +z, at any size
    expect(big.camera.position.x).toBeGreaterThan(0);
    expect(big.camera.position.z).toBeLessThan(0);
    const guest = setup();
    guest.controller.setupForRole('guest', { width: 72, height: 72 });
    expect(guest.camera.position.x).toBeLessThan(0);
    expect(guest.camera.position.z).toBeGreaterThan(0);
    expect(guest.camera.position.y).toBeGreaterThan(0);
  });

  it('44x30 starts close to the previous fixed (20,20,-20) view; zoom limit grows for big boards', () => {
    const { controller, camera } = setup();
    controller.setupForRole('host', { width: 44, height: 30 });
    expect(camera.position.x).toBeCloseTo(22);
    expect(camera.position.z).toBeCloseTo(-22);
    const controls = (controller as any).controls;
    expect(controls.maxDistance).toBeGreaterThanOrEqual(50);
    const big = setup();
    big.controller.setupForRole('guest', { width: 72, height: 72 });
    const bigControls = (big.controller as any).controls;
    expect(bigControls.maxDistance).toBeGreaterThan(big.camera.position.length());
  });
});
