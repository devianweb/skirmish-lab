import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { TRAIT_REGISTRY, parseTrait, formatTraitLabel } from '../../src/rules/traits';

/** Old core rule ID -> new ID and display name (14C-1, decision 2). */
const RENAMES: Array<[string, string, string]> = [
  ['drop-reserve', 'ambush', 'Ambush'],
  ['pierce', 'ap', 'AP'],
  ['hexed', 'bane', 'Bane'],
  ['channeler', 'caster', 'Caster'],
  ['brace', 'counter', 'Counter'],
  ['lethal', 'deadly', 'Deadly'],
  ['swift', 'fast', 'Fast'],
  ['dread', 'fear', 'Fear'],
  ['stoic', 'fearless', 'Fearless'],
  ['airborne', 'flying', 'Flying'],
  ['frenzy', 'furious', 'Furious'],
  ['commander', 'hero', 'Hero'],
  ['stationary', 'immobile', 'Immobile'],
  ['shock', 'impact', 'Impact'],
  ['lobbed', 'indirect', 'Indirect'],
  ['expendable', 'limited', 'Limited'],
  ['ward', 'regeneration', 'Regeneration'],
  ['sustained', 'relentless', 'Relentless'],
  ['calibrated', 'reliable', 'Reliable'],
  ['vanguard', 'scout', 'Scout'],
  ['ponderous', 'slow', 'Slow'],
  ['camouflaged', 'stealth', 'Stealth'],
  ['pathfinder', 'strider', 'Strider'],
  ['overload', 'surge', 'Surge'],
  ['impale', 'thrust', 'Thrust'],
  ['resilient', 'tough', 'Tough'],
  ['unerring', 'unstoppable', 'Unstoppable'],
];
const OLD_IDS = [...RENAMES.map(([o]) => o), 'move-unit'];
const registry = TRAIT_REGISTRY as Record<string, { displayName: string } | undefined>;

describe('core rule renames', () => {
  it.each(RENAMES)('%s is now %s (%s) in the registry', (_old, id, display) => {
    expect(registry[id]?.displayName).toBe(display);
  });

  it('shred is a valid core rule again, now meaning extra wounds on Defense 1s (not Rending)', () => {
    expect(registry.shred?.displayName).toBe('Shred');
    expect(registry.rending?.displayName).toBe('Rending');
    expect(registry.shred).not.toBe(registry.rending);
  });

  it('keeps blast under its existing name', () => {
    expect(registry.blast?.displayName).toBe('Blast');
  });

  it.each(RENAMES)('old ID %s no longer resolves to a known trait', (old) => {
    expect(registry[old]).toBeUndefined();
    // The parser still reads the text, but it never maps onto a registry entry.
    const parsed = parseTrait(`${old}(2)`);
    expect(parsed.id).toBe(old);
    expect(registry[parsed.id]).toBeUndefined();
  });

  it('formats renamed parameterised traits with their new display names', () => {
    expect(formatTraitLabel('ap(2)')).toBe('AP(2)');
    expect(formatTraitLabel('tough(3)')).toBe('Tough(3)');
    expect(formatTraitLabel('caster(2)')).toBe('Caster(2)');
  });

  it('keeps the remaining faction traits', () => {
    for (const id of ['hold-the-line', 'repel-ambushers', 'bad-shot', 'ferocious']) {
      expect(registry[id]).toBeDefined();
    }
  });
});

/**
 * Source scan. Words such as "commander", "swift", "ward" or "pathfinder" also appear in comments, player
 * names and unrelated identifiers (the movement pathfinder, "toward"), so a plain word search would give
 * false positives. Instead we look for the old IDs only as string literals: a quote or backtick, the old ID,
 * then either `(` (a parameterised trait such as 'pierce(2)') or the closing quote. 'aura-ward' and
 * 'retaliation-ward' never match because the old ID must start right after the opening quote.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('no old rule IDs left in source', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const literal = new RegExp(`['"\`](${OLD_IDS.map((id) => id.replace(/-/g, '\\-')).join('|')})(?:\\(|['"\`])`);

  it.each(['shared/src', 'client/src', 'server/src'])('%s has no old trait or action string literals', (dir) => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(root, dir))) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (literal.test(line)) offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the scan pattern catches old literals and ignores look-alike words', () => {
    expect(literal.test(`hasTrait(rules, 'airborne')`)).toBe(true);
    expect(literal.test(`weapon: ['pierce(2)']`)).toBe(true);
    expect(literal.test(`type: 'move-unit'`)).toBe(true);
    expect(literal.test(`const x = 'aura-ward';`)).toBe(false);
    expect(literal.test(`// the commander of the toward pathfinder`)).toBe(false);
  });
});
