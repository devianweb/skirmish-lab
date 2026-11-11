import { describe, it, expect } from 'vitest';
import { Model, Unit, WEAPONS } from '@skirmish-lab/shared';
import {
  loadoutsDiffer,
  mergeAimLines,
  modelLabel,
  modelNumber,
  modelWeaponBlocks,
  modelWeaponNames,
  modelBlockHeading,
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

describe('modelWeaponBlocks', () => {
  it('gives one block per model in fixed order, each with its own weapons; a dead model keeps its number and lists none', () => {
    const unit = unitOf([model('a', ['rifle', 'blade']), model('b', ['rifle', 'blade'], true), model('c', ['frag-launcher', 'blade'])]);
    const blocks = modelWeaponBlocks(unit);
    expect(blocks.map(modelBlockHeading)).toEqual(['Model 1', 'Model 2 — removed', 'Model 3']);
    expect(blocks.map((b) => b.weapons.map((w) => w.name))).toEqual([['Rifle', 'Blade'], [], ['Blade', 'Frag Launcher']]);
    expect(modelWeaponNames(unit, unit.models![2])).toBe('Blade, Frag Launcher');
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
