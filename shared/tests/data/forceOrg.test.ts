import { describe, it, expect } from 'vitest';
import { FighterDefinition, STARTER_ARMIES } from '../../src/data/armies';
import { getTraitValue, hasTrait } from '../../src/rules/traits';

/** 400-point Force Org limits (14C-3 Decision 1). */
const LIMITS = { points: 400, heroes: 1, copies: 2, unitPoints: 140, units: 5, tough: 30 };

interface Roster {
  id: string;
  fighters: FighterDefinition[];
}

/** Total Tough of a unit: per-model Tough (1 if none) times its models. */
function unitTough(f: FighterDefinition): number {
  return (getTraitValue(f.specialRules, 'tough') ?? 1) * (f.modelCount ?? 1);
}

function forceOrgProblems(army: Roster): string[] {
  const problems: string[] = [];
  const f = army.fighters;
  const total = f.reduce((s, u) => s + u.points, 0);
  if (total !== LIMITS.points) problems.push(`total ${total} pts, expected ${LIMITS.points}`);
  const heroes = f.filter((u) => hasTrait(u.specialRules, 'hero')).length;
  if (heroes > LIMITS.heroes) problems.push(`${heroes} Heroes`);
  const counts = new Map<string, number>();
  for (const u of f) counts.set(u.id, (counts.get(u.id) ?? 0) + 1);
  for (const [id, n] of counts) if (n > LIMITS.copies) problems.push(`${n} copies of ${id}`);
  for (const u of f) if (u.points > LIMITS.unitPoints) problems.push(`${u.name} costs ${u.points}`);
  if (f.length > LIMITS.units) problems.push(`${f.length} units`);
  const tough = f.reduce((s, u) => s + unitTough(u), 0);
  if (tough > LIMITS.tough) problems.push(`total Tough ${tough}`);
  return problems;
}

const rosters: Roster[] = [
  ...Object.values(STARTER_ARMIES).map((a) => ({ id: a.id, fighters: a.fighters })),
].filter((a) => !a.id.startsWith('test'));

describe('Force Org checker', () => {
  const unit = (over: Partial<FighterDefinition>): FighterDefinition => ({
    id: 'u', name: 'U', faction: 'x', points: 80, quality: 4, defense: 5, wounds: 3, speed: 6,
    modelType: 'trooper', weapons: ['rifle'], specialRules: ['tough(3)'], ...over,
  });
  const five = (over: Partial<FighterDefinition> = {}) =>
    [1, 2, 3, 4, 5].map((i) => unit({ id: `u${i}`, ...over }));
  const problems = (fighters: FighterDefinition[]) => forceOrgProblems({ id: 'x', fighters }).join('; ');

  it('accepts a legal 400-pt list', () => {
    expect(forceOrgProblems({ id: 'ok', fighters: five() })).toEqual([]);
  });
  it('flags a wrong total', () => {
    expect(problems(five({ points: 79 }))).toMatch(/total 395/);
  });
  it('flags a second Hero', () => {
    expect(problems(five({ specialRules: ['hero', 'tough(3)'] }))).toMatch(/5 Heroes/);
    const oneHero = five();
    oneHero[0] = unit({ id: 'u1', specialRules: ['hero', 'tough(3)'] });
    expect(problems(oneHero)).toBe('');
  });
  it('flags three copies of a unit but allows two', () => {
    expect(problems(five({ id: 'same' }))).toMatch(/5 copies of same/);
    const two = five();
    two[1] = unit({ id: 'u1' });
    expect(problems(two)).toBe('');
  });
  it('flags a unit over 140 pts but allows exactly 140', () => {
    const f = five({ points: 65 });
    f[0] = unit({ id: 'u1', points: 140 });
    expect(problems(f)).toBe('');
    f[0] = unit({ id: 'u1', points: 141 });
    expect(problems(f)).toMatch(/costs 141/);
  });
  it('flags a sixth unit', () => {
    expect(problems([...five({ points: 60 }), unit({ id: 'u6', points: 100 })])).toMatch(/6 units/);
  });
  it('counts Tough per model: 5 x 3 x 3 = 45 is too much, 30 is fine, no Tough counts as 1 per model', () => {
    expect(problems(five({ modelCount: 3 }))).toMatch(/total Tough 45/);
    expect(unitTough(unit({ specialRules: [], modelCount: 4 }))).toBe(4);
    expect(unitTough(unit({ specialRules: ['tough(3)'], modelCount: 3 }))).toBe(9);
    const ten = five({ modelCount: 2 }); // 5 units x Tough 3 x 2 models = 30
    expect(problems(ten)).toBe('');
  });
});

describe('every non-TEST army follows Force Org at 400 pts', () => {
  it('checks Human Defense Force explicitly (400 pts, Force Org)', () => {
    expect(rosters.map((a) => a.id)).toContain('hdf');
    expect(forceOrgProblems(rosters.find((a) => a.id === 'hdf')!)).toEqual([]);
  });
  it('checks exactly the two ready-made armies, with no exemptions', () => {
    expect(rosters.map((a) => a.id).sort()).toEqual(['hdf', 'orc-marauders']);
  });
  for (const army of rosters) {
    it(army.id, () => {
      expect(forceOrgProblems(army)).toEqual([]);
    });
  }
});
