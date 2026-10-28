import { GameState, TerrainPiece, Unit } from '@skirmish-lab/shared';
import { createInitialGameState } from '@skirmish-lab/shared';

let unitCounter = 0;

export function makeUnit(overrides: Partial<Unit> = {}): Unit {
  unitCounter += 1;
  return {
    id: `u${unitCounter}`,
    ownerId: 'host-1',
    armyId: 'army-host',
    unitType: 'trooper',
    name: `Unit ${unitCounter}`,
    quality: 3,
    defense: 4,
    speed: 6,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    status: [],
    wounds: 1,
    maxWounds: 1,
    isActivated: false,
    isDestroyed: false,
    models: [],
    weapons: [],
    specialRules: [],
    hasMoved: false,
    remainingMovement: 6,
    ...overrides,
  };
}

export function makeTerrain(overrides: Partial<TerrainPiece> = {}): TerrainPiece {
  return {
    id: 'terrain-1',
    terrainType: 'ruin',
    position: { x: 0, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 2, y: 1, z: 2 },
    blocksLineOfSight: true,
    providesCover: true,
    isObstacle: true,
    ...overrides,
  };
}

export function makeState(overrides: Partial<GameState> = {}): GameState {
  const state = createInitialGameState('host-1', 'guest-1');
  return { ...state, ...overrides };
}

/** Collect all mesh materials' hex colors under an object (for owner-color tests). */
export function collectHexColors(root: { traverse(cb: (o: unknown) => void): void }): string[] {
  const colors: string[] = [];
  root.traverse((child: unknown) => {
    const material = (child as { material?: { color?: { getHexString(): string } } })
      .material;
    if (material?.color) {
      colors.push(material.color.getHexString());
    }
  });
  return colors;
}
