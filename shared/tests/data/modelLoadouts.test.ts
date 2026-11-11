import { describe, it, expect } from 'vitest';
import { DEFAULT_ARMIES, STARTER_ARMIES, FighterDefinition, distinctLoadoutWeapons } from '../../src/data/armies';
import { WEAPONS } from '../../src/data/weapons';

const allFighters: FighterDefinition[] = [
  ...DEFAULT_ARMIES.flatMap((a) => a.fighters),
  ...Object.values(STARTER_ARMIES).flatMap((a) => a.fighters),
];

describe('FighterDefinition.modelLoadouts (data)', () => {
  it('has one loadout per model, naming only known weapons, and `weapons` lists exactly the distinct ones', () => {
    for (const f of allFighters.filter((x) => x.modelLoadouts)) {
      const loadouts = f.modelLoadouts!;
      expect(loadouts, f.id).toHaveLength(f.modelCount ?? 1);
      for (const ids of loadouts) {
        expect(ids.length, `${f.id} has a model with no weapon`).toBeGreaterThan(0);
        for (const id of ids) expect(WEAPONS[id], `${f.id}: unknown weapon ${id}`).toBeDefined();
      }
      expect([...f.weapons].sort(), f.id).toEqual([...distinctLoadoutWeapons(loadouts)].sort());
    }
  });

  it('distinctLoadoutWeapons keeps first-appearance order', () => {
    expect(distinctLoadoutWeapons([['b', 'a'], ['a'], ['c', 'b']])).toEqual(['b', 'a', 'c']);
  });
});
