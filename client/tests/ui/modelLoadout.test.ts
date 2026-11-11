import { describe, it, expect } from 'vitest';
import { Model, Unit, WEAPONS } from '@skirmish-lab/shared';
import {
  loadoutsDiffer,
  mergeAimLines,
  modelLabel,
  modelNumber,
  modelWeaponGroups,
  modelWeaponNames,
  modelMemberText,
  showsModelHeadings,
} from '../../src/ui/modelLoadout';

const weapon = (id: keyof typeof WEAPONS) => ({ ...WEAPONS[id], profile: { ...WEAPONS[id].profile }, isEquipped: true });
const model = (id: string, weaponIds?: string[], isDestroyed = false): Model => ({
  id,
  wounds: 1,
  maxWounds: 1,
  isDestroyed,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  ...(weaponIds ? { weaponIds } : {}),
});
const unitOf = (models: Model[]): Pick<Unit, 'weapons' | 'models'> => ({
  weapons: [weapon('rifle'), weapon('blade'), weapon('frag-launcher')],
  models,
});

describe('model numbers', () => {
  it('are fixed by position in the model list, so a death never renumbers the others', () => {
    const unit = unitOf([model('a'), model('b'), model('c')]);
    expect(modelNumber(unit, 'c')).toBe(3);
    unit.models![1].isDestroyed = true;
    expect(modelNumber(unit, 'c')).toBe(3);
    expect(modelLabel(unit, 'b')).toBe('Model 2');
    expect(modelLabel(unit, 'zzz')).toBe('Model ?');
  });
});

describe('loadoutsDiffer', () => {
  it('is false when every model carries the same weapons (with or without explicit ids)', () => {
    expect(loadoutsDiffer(unitOf([model('a'), model('b')]))).toBe(false);
    expect(loadoutsDiffer(unitOf([model('a', ['rifle', 'blade']), model('b', ['blade', 'rifle'])]))).toBe(false);
  });
  it('is true when one model carries something different, and stays true after the odd one dies', () => {
    const unit = unitOf([model('a', ['rifle', 'blade']), model('b', ['rifle', 'blade']), model('c', ['frag-launcher', 'blade'])]);
    expect(loadoutsDiffer(unit)).toBe(true);
    unit.models![2].isDestroyed = true;
    expect(loadoutsDiffer(unit)).toBe(true);
  });
  it('is false for a single model', () => {
    expect(loadoutsDiffer(unitOf([model('a', ['rifle'])]))).toBe(false);
  });
});

const tough = (m: Model, maxWounds: number, wounds = maxWounds): Model => ({ ...m, maxWounds, wounds });
const texts = (g: ReturnType<typeof modelWeaponGroups>[number]) => g.members.map(modelMemberText);

describe('modelWeaponGroups', () => {
  it('groups models carrying the same weapons under one entry, ordered by lowest model number', () => {
    const unit = unitOf([model('a', ['rifle', 'blade']), model('b', ['rifle', 'blade']), model('c', ['frag-launcher', 'blade'])]);
    const groups = modelWeaponGroups(unit);
    expect(groups.map(texts)).toEqual([['Model 1', 'Model 2'], ['Model 3']]);
    expect(groups.map((g) => g.weapons.map((w) => w.name))).toEqual([['Rifle', 'Blade'], ['Blade', 'Frag Launcher']]);
    expect(modelWeaponNames(unit, unit.models![2])).toBe('Blade, Frag Launcher');
  });

  it('groups non-adjacent identical models, members in number order', () => {
    const unit = unitOf([model('a', ['rifle']), model('b', ['blade']), model('c', ['rifle'])]);
    expect(modelWeaponGroups(unit).map(texts)).toEqual([['Model 1', 'Model 3'], ['Model 2']]);
  });

  it('keeps a removed model in its group, marked removed, and keeps the rows while a member lives', () => {
    const unit = unitOf([model('a', ['rifle', 'blade']), model('b', ['rifle', 'blade'], true), model('c', ['frag-launcher', 'blade'])]);
    const groups = modelWeaponGroups(unit);
    expect(groups.map(texts)).toEqual([['Model 1', 'Model 2 — removed'], ['Model 3']]);
    expect(groups[0].weapons.map((w) => w.name)).toEqual(['Rifle', 'Blade']);
    expect(groups[0].allRemoved).toBe(false);
  });

  it('a group with every member removed has no rows', () => {
    const unit = unitOf([model('a', ['rifle'], true), model('b', ['rifle'], true), model('c', ['blade'])]);
    const groups = modelWeaponGroups(unit);
    expect(groups[0].allRemoved).toBe(true);
    expect(groups[0].weapons).toEqual([]);
    expect(groups[1].weapons.map((w) => w.name)).toEqual(['Blade']);
  });

  it('shows wounds taken out of Tough for Tough above 1 only, and none for Tough 1', () => {
    const t3 = unitOf([tough(model('a'), 3, 3), tough(model('b'), 3, 1), tough(model('c'), 3, 3)]);
    expect(modelWeaponGroups(t3).map(texts)).toEqual([['Model 1 · 0/3 W', 'Model 2 · 2/3 W', 'Model 3 · 0/3 W']]);
    const t1 = unitOf([model('a'), model('b')]);
    expect(modelWeaponGroups(t1).map(texts)).toEqual([['Model 1', 'Model 2']]);
  });
});

describe('showsModelHeadings', () => {
  it('is true when loadouts differ, or when a multi-model unit has Tough above 1', () => {
    expect(showsModelHeadings(unitOf([model('a', ['rifle']), model('b', ['blade'])]))).toBe(true);
    expect(showsModelHeadings(unitOf([tough(model('a'), 3), tough(model('b'), 3)]))).toBe(true);
  });
  it('is false for identical Tough 1 squads and for single models, even with Tough', () => {
    expect(showsModelHeadings(unitOf([model('a'), model('b')]))).toBe(false);
    expect(showsModelHeadings(unitOf([tough(model('a'), 9)]))).toBe(false);
  });
});

describe('mergeAimLines', () => {
  const at = (x: number) => ({ x, y: 0, z: 0 });
  const aim = (x: number, fires: boolean) => ({ shooter: at(x), from: { ...at(x), y: 1.1 }, to: { x, y: 1.1, z: 9 }, fires });

  it('labels each model with every weapon it fires, one line per model', () => {
    const lines = mergeAimLines([
      { weapon: { name: 'Rifle' }, aims: [aim(0, true), aim(1, true)] },
      { weapon: { name: 'Frag Launcher' }, aims: [aim(1, true)] },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].label).toBe('Rifle');
    expect(lines[1].label).toBe('Rifle + Frag Launcher');
  });

  it('leaves a model that fires nothing unlabelled and not firing', () => {
    const lines = mergeAimLines([{ weapon: { name: 'Rifle' }, aims: [aim(0, false), aim(1, true)] }]);
    expect(lines[0]).toMatchObject({ fires: false });
    expect(lines[0].label).toBeUndefined();
    expect(lines[1].label).toBe('Rifle');
  });

  it('a weapon that does fire makes the line a firing one even if the first weapon was blocked', () => {
    const lines = mergeAimLines([
      { weapon: { name: 'Rifle' }, aims: [aim(0, false)] },
      { weapon: { name: 'Frag Launcher' }, aims: [aim(0, true)] },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ fires: true, label: 'Frag Launcher' });
  });
});
