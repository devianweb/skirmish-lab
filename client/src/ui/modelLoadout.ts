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

/** One model's entry in a sub-heading: its fixed number, state, and the wounds it has taken (14C-3 PR 1G). */
export interface ModelGroupMember {
  number: number;
  modelId: string;
  removed: boolean;
  /** Tough of this model (its maxWounds). */
  tough: number;
  /** Wounds taken out of Tough; only shown when Tough is above 1 and the model is alive. */
  woundsTaken: number;
}

export interface ModelWeaponGroup {
  /** Models carrying exactly the same weapons, in number order. */
  members: ModelGroupMember[];
  /** The weapons every member carries, in the unit's weapon order; empty once every member is removed. */
  weapons: Weapon[];
  /** True when every member is removed. */
  allRemoved: boolean;
}

/**
 * True when the data card should show per-model sub-headings: the models carry different weapons, or the unit
 * has several models with Tough above 1 (so each model's wounds can be read).
 */
export function showsModelHeadings(unit: Pick<Unit, 'weapons' | 'models'>): boolean {
  const models = unit.models ?? [];
  if (models.length < 2) return false;
  return loadoutsDiffer(unit) || models.some((m) => m.maxWounds > 1);
}

/**
 * Models grouped by identical weapons for the data card's weapons table (14C-3 PR 1G): one sub-heading per
 * group, then one set of weapon rows. Groups are ordered by their lowest model number, members by number
 * (adjacent or not). A removed model stays in its group; the group keeps its rows while any member is alive.
 */
export function modelWeaponGroups(unit: Pick<Unit, 'weapons' | 'models'>): ModelWeaponGroup[] {
  const groups = new Map<string, ModelWeaponGroup>();
  (unit.models ?? []).forEach((m, i) => {
    const carried = modelWeapons(unit, m);
    const key = carried
      .map((w) => w.id)
      .sort()
      .join('|');
    let g = groups.get(key);
    if (!g) {
      g = { members: [], weapons: carried, allRemoved: true };
      groups.set(key, g);
    }
    g.members.push({
      number: i + 1,
      modelId: m.id,
      removed: m.isDestroyed,
      tough: m.maxWounds,
      woundsTaken: m.isDestroyed ? 0 : Math.max(0, m.maxWounds - m.wounds),
    });
    if (!m.isDestroyed) g.allRemoved = false;
  });
  const out = Array.from(groups.values());
  for (const g of out) if (g.allRemoved) g.weapons = [];
  return out;
}

/** One member's heading text: "Model 2", "Model 2 · 1/3 W" (Tough above 1) or "Model 2 — removed". */
export function modelMemberText(member: ModelGroupMember): string {
  if (member.removed) return `Model ${member.number} — removed`;
  return member.tough > 1 ? `Model ${member.number} · ${member.woundsTaken}/${member.tough} W` : `Model ${member.number}`;
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
