import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MapStore } from '../../src/storage/MapStore';
import { CustomMapDefinition } from '@skirmish-lab/shared';

describe('MapStore', () => {
  let mockStorage: Storage;
  let storeData: Record<string, string>;
  let mapStore: MapStore;

  const sampleMap: CustomMapDefinition = {
    id: 'test-map-1',
    name: 'Sector 42 Outpost',
    description: 'A heavily fortified outpost.',
    author: 'Commander Webst',
    board: { width: 44, height: 30, theme: 'outpost' },
    terrain: [
      {
        id: 'b-1',
        type: 'building-a',
        position: { x: 0, y: 1.75, z: 0 },
        scale: { x: 6, y: 3.5, z: 6 },
        rotation: 0,
        blocksLineOfSight: true,
        providesCover: true,
        isObstacle: true,
      },
    ],
    objectives: [
      { id: 'obj-1', name: 'Alpha', position: { x: 0, y: 3.5, z: 0 }, points: 1 },
    ],
  };

  beforeEach(() => {
    storeData = {};
    mockStorage = {
      getItem: vi.fn((key: string) => storeData[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        storeData[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete storeData[key];
      }),
      clear: vi.fn(() => {
        storeData = {};
      }),
      length: 0,
      key: vi.fn(),
    };
    mapStore = new MapStore(mockStorage);
  });

  it('returns empty array when no maps are stored', () => {
    expect(mapStore.getMaps()).toEqual([]);
  });

  it('saves and retrieves a custom map definition', () => {
    mapStore.saveMap(sampleMap);
    const maps = mapStore.getMaps();
    expect(maps).toHaveLength(1);
    expect(maps[0].id).toBe('test-map-1');
    expect(maps[0].name).toBe('Sector 42 Outpost');

    const single = mapStore.getMap('test-map-1');
    expect(single).toBeDefined();
    expect(single?.name).toBe('Sector 42 Outpost');
    expect(single?.terrain).toHaveLength(1);
  });

  it('updates an existing map if saved with the same id', () => {
    mapStore.saveMap(sampleMap);

    const updated: CustomMapDefinition = {
      ...sampleMap,
      name: 'Sector 42 Outpost (Modified)',
      terrain: [],
    };
    mapStore.saveMap(updated);

    const maps = mapStore.getMaps();
    expect(maps).toHaveLength(1);
    expect(maps[0].name).toBe('Sector 42 Outpost (Modified)');
    expect(maps[0].terrain).toHaveLength(0);
  });

  it('deletes a custom map by id', () => {
    mapStore.saveMap(sampleMap);
    expect(mapStore.deleteMap('test-map-1')).toBe(true);
    expect(mapStore.getMaps()).toHaveLength(0);
    expect(mapStore.getMap('test-map-1')).toBeNull();
    expect(mapStore.deleteMap('non-existent')).toBe(false);
  });

  it('clears all custom maps', () => {
    mapStore.saveMap(sampleMap);
    mapStore.saveMap({ ...sampleMap, id: 'test-map-2', name: 'Refinery' });
    expect(mapStore.getMaps()).toHaveLength(2);

    mapStore.clear();
    expect(mapStore.getMaps()).toHaveLength(0);
  });

  it('handles corrupted storage data gracefully without crashing', () => {
    storeData[MapStore.STORAGE_KEY] = 'INVALID JSON DATA {;';
    expect(mapStore.getMaps()).toEqual([]);
  });

  it('falls back to memory store when storage operations throw errors', () => {
    const errorStorage: Storage = {
      ...mockStorage,
      getItem: vi.fn(() => {
        throw new Error('SecurityError: Access Denied');
      }),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
    };
    const store = new MapStore(errorStorage);

    store.saveMap(sampleMap);
    const retrieved = store.getMap('test-map-1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Sector 42 Outpost');
  });

  it('exports map definition as formatted JSON', () => {
    const json = mapStore.exportMapJson(sampleMap);
    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('test-map-1');
    expect(parsed.name).toBe('Sector 42 Outpost');
  });

  it('imports valid map JSON and persists to store', () => {
    const rawJson = JSON.stringify({
      id: 'imported-1',
      name: 'Imported Factory',
      description: 'Shared via JSON file',
      board: { width: 44, height: 30 },
      terrain: [
        {
          id: 'silo-1',
          type: 'building-f',
          position: { x: 5, y: 2, z: -5 },
          scale: { x: 4, y: 4, z: 4 },
          rotation: 0,
        },
      ],
      objectives: [],
    });

    const imported = mapStore.importMapJson(rawJson);
    expect(imported.id).toBe('imported-1');
    expect(imported.name).toBe('Imported Factory');
    expect(mapStore.getMap('imported-1')).toBeDefined();
  });

  it('generates an ID if imported JSON has no ID', () => {
    const rawJson = JSON.stringify({
      name: 'Nameless Map',
      terrain: [],
    });

    const imported = mapStore.importMapJson(rawJson);
    expect(imported.id).toBeTruthy();
    expect(imported.name).toBe('Nameless Map');
    expect(mapStore.getMap(imported.id)).toBeDefined();
  });

  it('throws descriptive errors on invalid JSON or missing required fields', () => {
    expect(() => mapStore.importMapJson('bad json')).toThrow('Invalid JSON format');
    expect(() => mapStore.importMapJson(JSON.stringify(null))).toThrow(
      'Map data must be a JSON object'
    );
    expect(() => mapStore.importMapJson(JSON.stringify({}))).toThrow(
      'Map definition missing valid name property'
    );
    expect(() => mapStore.importMapJson(JSON.stringify({ name: 'Valid Name' }))).toThrow(
      'Map definition missing valid terrain array'
    );
  });
});
