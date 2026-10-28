import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class CameraController {
  private controls: OrbitControls;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
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
}
