import * as THREE from 'three';
import { GameState, TerrainPiece } from '@skirmish-lab/shared';
import { ModelLoader } from './ModelLoader';
import { disposeObject3D } from './utils';

// Original palette for generic terrain types (no faction/trademark references).
const TERRAIN_COLORS: Record<string, number> = {
  ruin: 0x6e6a66,
  forest: 0x2f5d34,
  trench: 0x5c4a33,
  barricade: 0x7d6a4a,
  crate: 0x8a7a58,
  hill: 0x6b6b4a,
  toxic: 0x33aa22,
  hazard: 0xdd7700,
  platform: 0x555555,
  ladder: 0x888877,
  stairs: 0x777777,
  pipe: 0x556677,
  'wall-low': 0x6e6a66,
};
const DEFAULT_TERRAIN_COLOR = 0x606058;

/**
 * Renders the battlefield ground, grid, and terrain pieces from game state.
 * Pure view layer: reads from game state, never writes to it.
 *
 * Terrain types registered on the ModelLoader render as GLB models
 * (procedural block fallback); position/rotation/scale always come from
 * the terrain data.
 */
export class BoardRenderer {
  private boardGroup: THREE.Group;
  private terrainGroup: THREE.Group;
  private modelLoader: ModelLoader;

  constructor(scene: THREE.Scene, modelLoader: ModelLoader = new ModelLoader()) {
    this.boardGroup = new THREE.Group();
    this.boardGroup.name = 'board';
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain';
    this.modelLoader = modelLoader;
    scene.add(this.boardGroup);
    scene.add(this.terrainGroup);
  }

  /**
   * Rebuild the ground plane and measurement grid from `state.board`.
   * Full rebuild each call — GameView only invokes this when the board changes.
   */
  renderBoard(gameState: GameState): void {
    this.clearBoard();

    const { board } = gameState;
    const worldWidth = board.width * board.gridSize;
    const worldHeight = board.height * board.gridSize;

    const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a4a2a,
      roughness: 0.8,
      metalness: 0.2,
    });
    const boardMesh = new THREE.Mesh(geometry, material);
    boardMesh.name = 'ground';
    boardMesh.rotation.x = -Math.PI / 2;
    boardMesh.receiveShadow = true;
    this.boardGroup.add(boardMesh);

    this.boardGroup.add(this.createGrid(worldWidth, worldHeight, board.gridSize));
  }

  /**
   * Rebuild terrain meshes from `state.terrain`. Each piece is a simple
   * low-poly block scaled/positioned from its game state data.
   */
  renderTerrain(gameState: GameState): void {
    this.clearTerrain();
    for (const piece of gameState.terrain) {
      this.terrainGroup.add(this.createTerrainMesh(piece));
    }
  }

  clear(): void {
    this.clearBoard();
    this.clearTerrain();
  }

  /**
   * Raycast against rendered terrain meshes and return the hit piece's `id`,
   * or `null` when no terrain mesh is hit.
   */
  raycastTerrain(raycaster: THREE.Raycaster): string | null {
    return this.raycastTerrainHit(raycaster)?.terrainId ?? null;
  }

  /**
   * Raycast against rendered terrain meshes and return the hit piece ID,
   * intersection world point, and original TerrainPiece definition, or `null`.
   */
  raycastTerrainHit(
    raycaster: THREE.Raycaster
  ): { terrainId: string; point: THREE.Vector3; piece?: TerrainPiece } | null {
    this.terrainGroup.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(this.terrainGroup.children, true);
    for (const hit of hits) {
      let current: THREE.Object3D | null = hit.object;
      while (current && current !== this.terrainGroup) {
        if (typeof current.userData?.terrainId === 'string') {
          return {
            terrainId: current.userData.terrainId,
            point: hit.point,
            piece: current.userData.piece as TerrainPiece | undefined,
          };
        }
        current = current.parent;
      }
    }
    return null;
  }

  private createTerrainMesh(piece: TerrainPiece): THREE.Object3D {
    const mesh = this.modelLoader.createTerrainMesh(piece.terrainType);
    mesh.name = `terrain-${piece.id}`;
    mesh.userData.terrainId = piece.id;
    mesh.userData.piece = piece;
    mesh.position.set(piece.position.x, piece.position.y, piece.position.z);
    mesh.rotation.set(piece.rotation.x, piece.rotation.y, piece.rotation.z);
    mesh.scale.set(
      Math.max(piece.scale.x, 0.01),
      Math.max(piece.scale.y, 0.01),
      Math.max(piece.scale.z, 0.01)
    );
    mesh.traverse((child) => {
      const node = child as THREE.Mesh;
      node.castShadow = true;
      node.receiveShadow = true;
      // Palette tint applies to the procedural placeholder; the GLB swap
      // replaces these children, keeping the model's own look.
      const material = node.material as THREE.MeshStandardMaterial | undefined;
      if (material && material.color) {
        material.color.setHex(TERRAIN_COLORS[piece.terrainType] ?? DEFAULT_TERRAIN_COLOR);
      }
    });
    return mesh;
  }

  /**
   * Rectangular grid of lines spaced one gridSize apart, matching the
   * ground plane exactly (GridHelper only supports squares). Index-based
   * loop to avoid float accumulation with fractional grid sizes.
   */
  private createGrid(worldWidth: number, worldHeight: number, step: number): THREE.LineSegments {
    const halfW = worldWidth / 2;
    const halfH = worldHeight / 2;
    const points: number[] = [];

    const xDivisions = Math.max(1, Math.round(worldWidth / step));
    for (let i = 0; i <= xDivisions; i++) {
      const x = -halfW + i * step;
      points.push(x, 0, -halfH, x, 0, halfH);
    }
    const zDivisions = Math.max(1, Math.round(worldHeight / step));
    for (let i = 0; i <= zDivisions; i++) {
      const z = -halfH + i * step;
      points.push(-halfW, 0, z, halfW, 0, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x3a3a3a });
    const grid = new THREE.LineSegments(geometry, material);
    grid.name = 'grid';
    grid.position.y = 0.01;
    return grid;
  }

  private clearBoard(): void {
    for (const child of [...this.boardGroup.children]) {
      this.boardGroup.remove(child);
      disposeObject3D(child);
    }
  }

  private clearTerrain(): void {
    for (const child of [...this.terrainGroup.children]) {
      this.terrainGroup.remove(child);
      disposeObject3D(child);
    }
  }
}
