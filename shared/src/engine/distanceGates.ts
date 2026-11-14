import type { GameState, Unit, Weapon } from '../gameTypes';
import {
  TRAIT_REGISTRY,
  distanceGatesOf,
  hasTrait,
  parseTrait,
  type DistanceGate,
  type DistanceGateContext,
} from '../rules/traits';
import { isCarried, isMeleeWeapon } from './specialRules';
import { unitDistance } from './unitGeometry';

/**
 * Pure distance-gate maths. Gates live in the trait registry; the engine and the HUD both read them through
 * here, so what a badge, ring or aura shows is exactly what the rules do.
 */

/** Slack on `within` gates (inches): Blast's spread is wider than the Hero aura's. */
const WITHIN_TOLERANCE: Partial<Record<DistanceGateContext, number>> = { 'blast-spread': 0.01 };
const DEFAULT_WITHIN_TOLERANCE = 0.001;

/** Rules whose gate is a to-hit penalty that Unstoppable cancels. */
const NEGATIVE_TO_HIT_TRAITS: readonly string[] = ['stealth'];

/** True when `distance` (base edge to base edge) switches the gate on. `beyond` is strict; `within` is inclusive. */
export function gateApplies(gate: DistanceGate, distance: number): boolean {
  if (gate.comparison === 'beyond') return distance > gate.distance;
  return distance <= gate.distance + (WITHIN_TOLERANCE[gate.context] ?? DEFAULT_WITHIN_TOLERANCE);
}

/** `gateApplies` for the rule's own gate in `context` (throws when the rule declares none). */
export function traitGateApplies(traitId: string, context: DistanceGateContext, distance: number): boolean {
  const gate = distanceGatesOf(traitId).find((g) => g.context === context);
  if (!gate) throw new Error(`Trait '${traitId}' declares no ${context} distance gate`);
  return gateApplies(gate, distance);
}

export type AttackGateContext = 'shooting' | 'charge';

export interface AttackGateEntry {
  traitId: string;
  displayName: string;
  holder: DistanceGate['holder'];
  gate: DistanceGate;
  applies: boolean;
  /** Set when the attacker's Unstoppable cancels this (negative to-hit) gate; it still reports `applies`. */
  negatedBy?: 'unstoppable';
}

export interface AttackDistanceRules {
  /** Shooting: the current distance. Charge: the recorded start distance when declared, else the current one. */
  distance: number;
  /** Attacker entries first (unit rules, then weapon rules), then the target's. */
  entries: AttackGateEntry[];
}

export interface AttackDistanceInput {
  state: GameState;
  attacker: Unit;
  target: Unit;
  context: AttackGateContext;
  /**
   * Weapons in this attack. Their rules count alongside the unit's. Omitted: shooting counts no weapon rules,
   * a charge counts all of the unit's melee weapons.
   */
  weaponIds?: readonly string[];
}

const weaponRuleList = (weapon: Weapon): string[] => weapon.profile.specialRules;

/** Equipped carried weapons whose rules count for `context`: the listed ones, else (charge only) every melee weapon. */
function weaponsInAttack(unit: Unit, context: AttackGateContext, weaponIds?: readonly string[]): Weapon[] {
  const usable = unit.weapons.filter((w) => w.isEquipped && isCarried(unit, w));
  if (weaponIds) return usable.filter((w) => weaponIds.includes(w.id));
  return context === 'charge' ? usable.filter((w) => isMeleeWeapon(w)) : [];
}

/** Distinct trait ids in `rules`, in order. */
function traitIds(rules: readonly string[]): string[] {
  return [...new Set(rules.map((r) => parseTrait(r).id))];
}

function entriesFor(
  rules: readonly string[],
  holder: DistanceGate['holder'],
  context: AttackGateContext,
  distance: number,
  unstoppable: boolean
): AttackGateEntry[] {
  const out: AttackGateEntry[] = [];
  for (const traitId of traitIds(rules)) {
    for (const gate of distanceGatesOf(traitId)) {
      if (gate.holder !== holder || gate.context !== context) continue;
      const entry: AttackGateEntry = {
        traitId,
        displayName: TRAIT_REGISTRY[traitId as keyof typeof TRAIT_REGISTRY].displayName,
        holder,
        gate,
        applies: gateApplies(gate, distance),
      };
      if (unstoppable && NEGATIVE_TO_HIT_TRAITS.includes(traitId)) entry.negatedBy = 'unstoppable';
      out.push(entry);
    }
  }
  return out;
}

/** Which distance gates one attack involves, and whether each switches on. */
export function attackDistanceRules(input: AttackDistanceInput): AttackDistanceRules {
  const { state, attacker, target, context, weaponIds } = input;
  const current = unitDistance(attacker, target);
  const distance =
    context === 'charge' ? (state.turnState.attackedFrom?.[target.id]?.charged ?? current) : current;
  const attackerRules = [
    ...attacker.specialRules,
    ...weaponsInAttack(attacker, context, weaponIds).flatMap(weaponRuleList),
  ];
  const unstoppable = hasTrait(attackerRules, 'unstoppable');
  return {
    distance,
    entries: [
      ...entriesFor(attackerRules, 'attacker', context, distance, unstoppable),
      ...entriesFor(target.specialRules, 'target', context, distance, unstoppable),
    ],
  };
}

export interface ThresholdRing {
  /** Base-edge distance of the switch (not padded by the attacker's base radius). */
  distance: number;
  traitIds: string[];
  names: string[];
  /** e.g. `9": Ferocious, Relentless` */
  label: string;
}

/**
 * The attacker's own switch distances for a context: one entry per distinct distance with the rules that switch
 * there. Shooting counts the unit's rules plus its ranged weapons'; a charge the unit's rules plus its melee weapons'.
 */
export function ownThresholdRings(unit: Unit, context: AttackGateContext): ThresholdRing[] {
  const matchesContext = (w: Weapon) =>
    w.isEquipped && isCarried(unit, w) && (context === 'shooting' ? w.profile.type === 'ranged' : isMeleeWeapon(w));
  const rules = [
    ...unit.specialRules,
    ...unit.weapons.filter(matchesContext).flatMap(weaponRuleList),
  ];
  const byDistance = new Map<number, string[]>();
  for (const traitId of traitIds(rules)) {
    for (const gate of distanceGatesOf(traitId)) {
      if (gate.holder !== 'attacker' || gate.context !== context) continue;
      byDistance.set(gate.distance, [...(byDistance.get(gate.distance) ?? []), traitId]);
    }
  }
  return [...byDistance.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([distance, ids]) => {
      const sorted = ids
        .map((id) => ({ id, name: TRAIT_REGISTRY[id as keyof typeof TRAIT_REGISTRY].displayName }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const names = sorted.map((s) => s.name);
      return { distance, traitIds: sorted.map((s) => s.id), names, label: `${distance}": ${names.join(', ')}` };
    });
}
