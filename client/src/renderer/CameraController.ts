import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_BOARD_SIZE } from '@skirmish-lab/shared';

/** Start offset from the board centre, per axis, as a fraction of the board's longer edge. */
export const CAMERA_START_OFFSET_RATIO = 0.5;

/** Per-axis start offset (x, y and z) that frames a board of the given size. */
export function cameraStartOffset(board?: { width: number; height: number }): number {
  const longest = Math.max(board?.width ?? DEFAULT_BOARD_SIZE, board?.height ?? DEFAULT_BOARD_SIZE);
  return longest * CAMERA_START_OFFSET_RATIO;
}

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
   * Host deploys at the -z edge facing +z (camera at the south corner: +x, +y, -z).
   * Guest deploys at the +z edge facing -z (camera at the north corner: -x, +y, +z).
   * The corner distance and the zoom limit scale with the board's longer edge so the whole board is framed.
   */
  setupForRole(role: 'host' | 'guest', board?: { width: number; height: number }): void {
    const d = cameraStartOffset(board);
    this.controls.maxDistance = Math.max(50, d * 3);
    if (role === 'host') {
      this.camera.position.set(d, d, -d);
    } else {
      this.camera.position.set(-d, d, d);
    }
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }
}
