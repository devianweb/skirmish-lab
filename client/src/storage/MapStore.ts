import { CustomMapDefinition } from '@skirmish-lab/shared';

/**
 * MapStore handles persistent storage and JSON import/export
 * for custom user-created tabletop maps in localStorage.
 */
export class MapStore {
  private storage: Storage | null;
  private memoryFallback: Map<string, string> = new Map();

  static readonly STORAGE_KEY = 'skirmish_lab_custom_maps';

  constructor(customStorage?: Storage) {
    if (customStorage) {
      this.storage = customStorage;
    } else {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          this.storage = window.localStorage;
        } else {
          this.storage = null;
        }
      } catch {
        this.storage = null;
      }
    }
  }

  private getItem(key: string): string | null {
    try {
      if (this.storage) {
        return this.storage.getItem(key);
      }
    } catch (e) {
      console.warn(`[MapStore] Failed to read key "${key}":`, e);
    }
    return this.memoryFallback.get(key) ?? null;
  }

  private setItem(key: string, value: string): void {
    try {
      if (this.storage) {
        this.storage.setItem(key, value);
        return;
      }
    } catch (e) {
      console.warn(`[MapStore] Failed to write key "${key}":`, e);
    }
    this.memoryFallback.set(key, value);
  }

  /**
   * Returns all stored custom maps. Corrupted or invalid items are filtered out.
   */
  getMaps(): CustomMapDefinition[] {
    const raw = this.getItem(MapStore.STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (m) =>
            m &&
            typeof m.id === 'string' &&
            typeof m.name === 'string' &&
            Array.isArray(m.terrain)
        );
      }
    } catch (e) {
      console.warn('[MapStore] Corrupted maps data in storage; returning empty list:', e);
    }
    return [];
  }

  /**
   * Retrieves a map definition by its unique ID.
   */
  getMap(id: string): CustomMapDefinition | null {
    const maps = this.getMaps();
    return maps.find((m) => m.id === id) ?? null;
  }

  /**
   * Saves or updates a custom map.
   */
  saveMap(map: CustomMapDefinition): void {
    if (!map.id || !map.name) {
      throw new Error('Map must have an id and a name');
    }
    const maps = this.getMaps();
    const existingIndex = maps.findIndex((m) => m.id === map.id);
    const sanitizedMap: CustomMapDefinition = {
      ...map,
      terrain: Array.isArray(map.terrain) ? map.terrain : [],
      objectives: Array.isArray(map.objectives) ? map.objectives : [],
    };

    if (existingIndex >= 0) {
      maps[existingIndex] = sanitizedMap;
    } else {
      maps.push(sanitizedMap);
    }
    this.setItem(MapStore.STORAGE_KEY, JSON.stringify(maps));
  }

  /**
   * Deletes a custom map by ID. Returns true if the map existed and was deleted.
   */
  deleteMap(id: string): boolean {
    const maps = this.getMaps();
    const index = maps.findIndex((m) => m.id === id);
    if (index >= 0) {
      maps.splice(index, 1);
      this.setItem(MapStore.STORAGE_KEY, JSON.stringify(maps));
      return true;
    }
    return false;
  }

  /**
   * Clears all stored custom maps.
   */
  clear(): void {
    try {
      if (this.storage) {
        this.storage.removeItem(MapStore.STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[MapStore] Failed to clear storage:', e);
    }
    this.memoryFallback.delete(MapStore.STORAGE_KEY);
  }

  /**
   * Serializes a map definition to formatted JSON for sharing and file download.
   */
  exportMapJson(map: CustomMapDefinition): string {
    return JSON.stringify(map, null, 2);
  }

  /**
   * Parses and validates raw JSON into a CustomMapDefinition and saves it into the store.
   */
  importMapJson(jsonString: string): CustomMapDefinition {
    let parsed: any;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('Invalid JSON format');
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Map data must be a JSON object');
    }

    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new Error('Map definition missing valid name property');
    }

    if (!Array.isArray(parsed.terrain)) {
      throw new Error('Map definition missing valid terrain array');
    }

    const id =
      typeof parsed.id === 'string' && parsed.id.trim()
        ? parsed.id.trim()
        : `map-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const sanitizedMap: CustomMapDefinition = {
      id,
      name: parsed.name.trim(),
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      author: typeof parsed.author === 'string' ? parsed.author : undefined,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      board:
        parsed.board && typeof parsed.board === 'object'
          ? {
              width: Number(parsed.board.width) || 44,
              height: Number(parsed.board.height) || 30,
              theme: typeof parsed.board.theme === 'string' ? parsed.board.theme : 'outpost',
            }
          : { width: 44, height: 30, theme: 'outpost' },
      terrain: parsed.terrain,
      objectives: Array.isArray(parsed.objectives) ? parsed.objectives : [],
      deploymentZones: parsed.deploymentZones,
    };

    this.saveMap(sanitizedMap);
    return sanitizedMap;
  }
}

export const defaultMapStore = new MapStore();
