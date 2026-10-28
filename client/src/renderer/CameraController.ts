import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class CameraController {
  private controls: OrbitControls;
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI / 2;
  }

  update(): void {
    this.controls.update();
  }

  setTarget(x: number, y: number, z: number): void {
    this.controls.target.set(x, y, z);
    this.controls.update();
  }

  /**
   * Set up isometric corner view from behind the player's deployment edge.
   * Host deploys at z = -12 facing +z (camera placed at south corner: +x, +y, -z).
   * Guest deploys at z = +12 facing -z (camera placed at north corner: -x, +y, +z).
   */
  setupForRole(role: 'host' | 'guest'): void {
    if (role === 'host') {
      this.camera.position.set(20, 20, -20);
    } else {
      this.camera.position.set(-20, 20, 20);
    }
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}
