import { Model, Unit, Vector3, Weapon, modelCarries } from '@skirmish-lab/shared';

/**
 * Which model carries which weapon (14C-3 PR 1E, Decision 3d). Pure helpers for the data card, the model hover
 * card, the aim-line labels and the casualty prompt, so all four number and name models the same way.
 */

/**
 * A model's number: its fixed place in the unit's model list, 1-based. It never shifts when other models die,
 * so "Model 2" means the same model in the data card, the hover card, the aim labels and the casualty prompt.
 * Returns 0 for a model the unit does not list.
 */
export function modelNumber(unit: Pick<Unit, 'models'>, modelId: string): number {
  const i = (unit.models ?? []).findIndex((m) => m.id === modelId);
  return i < 0 ? 0 : i + 1;
}

/** "Model 2" (the fixed number; "Model ?" for a model the unit does not list). */
export function modelLabel(unit: Pick<Unit, 'models'>, modelId: string): string {
  const n = modelNumber(unit, modelId);
  return n > 0 ? `Model ${n}` : 'Model ?';
}

/** The unit's equipped weapons this model carries, in the unit's weapon order. */
export function modelWeapons(unit: Pick<Unit, 'weapons'>, model: Pick<Model, 'weaponIds'>): Weapon[] {
  return unit.weapons.filter((w) => w.isEquipped && modelCarries(model, w.id));
}

/** Names of the weapons a model carries, e.g. "Battle Rifle, Strike". */
export function modelWeaponNames(unit: Pick<Unit, 'weapons'>, model: Pick<Model, 'weaponIds'>): string {
  return modelWeapons(unit, model)
    .map((w) => w.name)
    .join(', ');
}

/**
 * True when the unit's models do not all carry the same weapons. Dead models count, so the per-model view does
 * not flip back to the plain list as casualties are taken.
 */
export function loadoutsDiffer(unit: Pick<Unit, 'weapons' | 'models'>): boolean {
  const models = unit.models ?? [];
  if (models.length < 2) return false;
  const key = (m: Model) =>
    modelWeapons(unit, m)
      .map((w) => w.id)
      .sort()
      .join('|');
  const first = key(models[0]);
  return models.some((m) => key(m) !== first);
}

export interface ModelWeaponLine {
  number: number;
  modelId: string;
  removed: boolean;
  /** "Battle Rifle, Strike"; empty for a removed model. */
  weapons: string;
}

/** One entry per model in fixed order, for the data card's per-model list. */
export function modelWeaponLines(unit: Pick<Unit, 'weapons' | 'models'>): ModelWeaponLine[] {
  return (unit.models ?? []).map((m, i) => ({
    number: i + 1,
    modelId: m.id,
    removed: m.isDestroyed,
    weapons: m.isDestroyed ? '' : modelWeaponNames(unit, m),
  }));
}

/** The text for one model: "Model 2: Battle Rifle, Strike" or "Model 2: removed". */
export function modelWeaponText(line: ModelWeaponLine): string {
  return `Model ${line.number}: ${line.removed ? 'removed' : line.weapons || 'no weapons'}`;
}

/** One weapon's view of a shooter model for the aim preview (the engine's `ModelAim`). */
interface WeaponAim {
  shooter: Vector3;
  from: Vector3;
  to: Vector3;
  fires: boolean;
}

export interface LabelledAimLine {
  from: Vector3;
  to: Vector3;
  fires: boolean;
  /** Every weapon this model fires at the target, joined with " + "; absent when it fires none. */
  label?: string;
}

/**
 * One aim line per shooter model across several weapons: the line of the first weapon that fires (else the
 * first weapon's), labelled with every weapon this model fires at the target. Models are matched by position.
 */
export function mergeAimLines(perWeapon: Array<{ weapon: Pick<Weapon, 'name'>; aims: WeaponAim[] }>): LabelledAimLine[] {
  const key = (p: Vector3) => `${p.x.toFixed(3)},${(p.y ?? 0).toFixed(3)},${p.z.toFixed(3)}`;
  const order: string[] = [];
  const byModel = new Map<string, { line: LabelledAimLine; names: string[] }>();
  for (const { weapon, aims } of perWeapon) {
    for (const a of aims) {
      const k = key(a.shooter);
      let entry = byModel.get(k);
      if (!entry) {
        entry = { line: { from: a.from, to: a.to, fires: a.fires }, names: [] };
        byModel.set(k, entry);
        order.push(k);
      } else if (a.fires && !entry.line.fires) {
        entry.line = { from: a.from, to: a.to, fires: true };
      }
      if (a.fires) entry.names.push(weapon.name);
    }
  }
  return order.map((k) => {
    const { line, names } = byModel.get(k)!;
    return names.length > 0 ? { ...line, label: names.join(' + ') } : line;
  });
}
