// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameHUD, MarkerSnapshot } from '../../src/ui/GameHUD';
import {
  GameState,
  GUEST_PLAYER_ID,
  HOST_PLAYER_ID,
  Unit,
  applyDefaultScenario,
  baseRadius,
  createBlankMap,
  createInitialGameState,
  unitDistance,
} from '@skirmish-lab/shared';
import { startRoundOne } from '../../../shared/tests/fixtures/setupFlow';

const HOST = HOST_PLAYER_ID; // Human Defense Force (default scenario)
const GUEST = GUEST_PLAYER_ID; // Orc Marauders

function openField(): GameState {
  const state = createInitialGameState(HOST, GUEST, 'Alice', 'Bob');
  applyDefaultScenario(state, { customMap: { ...createBlankMap(), id: 'open', terrain: [] } });
  startRoundOne(state);
  // Park everything far apart so only the units a test moves matter.
  state.units.forEach((u, i) => place(u, [{ x: -22 + i * 5, z: u.ownerId === HOST ? -22 : 22 }]));
  return state;
}

const unitOf = (state: GameState, fighter: string): Unit => {
  const u = state.units.find((x) => x.id.includes(fighter));
  if (!u) throw new Error(`no unit ${fighter}`);
  return u;
};

/** Stand the unit's living models on the given floor spots (one model per spot, in order). */
function place(unit: Unit, spots: Array<{ x: number; z: number }>): void {
  unit.position = { x: spots[0].x, y: 0, z: spots[0].z };
  const models = unit.models ?? [];
  models.forEach((m, i) => {
    const s = spots[Math.min(i, spots.length - 1)];
    m.position = { x: s.x, y: 0, z: s.z };
  });
}

function activate(state: GameState, unit: Unit): void {
  unit.isActivated = true;
  unit.status = unit.status.filter((s) => s !== 'stunned');
  state.turnState.activeUnitId = unit.id;
  state.turnState.unitsActivatedThisRound.push(unit.id);
  state.turnState.currentPlayerId = unit.ownerId;
  state.turnState.phase = 'activation';
}

function setup(state: GameState, localPlayerId: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const hud = new GameHUD(container, { localPlayerId, controller: { submitAction: vi.fn() } });
  hud.show();
  hud.syncFromState(state);
  const snapshots: MarkerSnapshot[] = [];
  hud.onMarkers((m) => snapshots.push(m));
  const last = (): MarkerSnapshot => snapshots[snapshots.length - 1];
  return { hud, container, last };
}

function clickButton(container: HTMLElement, text: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  if (!btn) throw new Error(`no button ${text}`);
  (btn as HTMLElement).click();
}

function chooseWeapon(container: HTMLElement, weaponId: string): void {
  (container.querySelector(`[data-weapon-id="${weaponId}"]`) as HTMLElement).click();
}

const texts = (m: MarkerSnapshot, unitId: string): string[] =>
  m.targetBadges!.find((b) => b.unitId === unitId)!.segments.map((s) => s.text);

describe('GameHUD: target badges while shooting', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('Orc Leader aiming the Carbine at an HDF squad 12" away: Ferocious on, Hold the Line on', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(leader, [{ x: 0, z: 0 }]);
    place(squad, [{ x: -1, z: 13 }, { x: 0, z: 13 }, { x: 1, z: 13 }]);
    activate(state, leader);
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    chooseWeapon(container, 'orc-carbine');
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });

    expect(unitDistance(leader, squad)).toBeCloseTo(12, 5);
    expect(texts(last(), squad.id)).toEqual([
      '12.0"',
      'Ferocious ✓ (beyond 9")',
      'Hold the Line +1 morale (beyond 9")',
    ]);
    const badge = last().targetBadges![0];
    expect(badge.segments.map((s) => s.tone)).toEqual(['distance', 'on', 'on']);
    // Above the squad's centre
    expect(badge.position.x).toBeCloseTo(0, 5);
    expect(badge.position.z).toBeCloseTo(13, 5);
    expect(badge.position.y).toBeGreaterThan(1.1);
  });

  it('at 8" both gates read as not applying', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(leader, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 9 }]);
    activate(state, leader);
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    chooseWeapon(container, 'orc-carbine');
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });

    expect(texts(last(), squad.id)).toEqual([
      '8.0"',
      'Ferocious ✗ (needs beyond 9")',
      'Hold the Line ✗ (needs beyond 9")',
    ]);
    expect(last().targetBadges![0].segments.map((s) => s.tone)).toEqual(['distance', 'off', 'off']);
  });

  it('shows two decimals and the engine verdict just either side of 9"', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(leader, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 9.96 }]);
    activate(state, leader);
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    chooseWeapon(container, 'orc-carbine');
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });
    expect(texts(last(), squad.id)[0]).toBe('8.96"');
    expect(texts(last(), squad.id)[1]).toBe('Ferocious ✗ (needs beyond 9")');

    place(squad, [{ x: 0, z: 10.04 }]);
    hud.syncFromState(state);
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });
    expect(texts(last(), squad.id)[0]).toBe('9.04"');
    expect(texts(last(), squad.id)[1]).toBe('Ferocious ✓ (beyond 9")');
  });

  it('HDF aiming at the Orc Infiltrator from 12" meets Stealth; at the Orc Veteran only the distance shows', () => {
    const state = openField();
    const shooter = unitOf(state, 'hdf-infantry-squad');
    const infiltrator = unitOf(state, 'orc-infiltrator');
    const veteran = unitOf(state, 'orc-veteran');
    place(shooter, [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 0 }]);
    place(infiltrator, [{ x: 8, z: 12 }]);
    place(veteran, [{ x: -8, z: 12 }]);
    activate(state, shooter);
    const { hud, container, last } = setup(state, HOST);
    clickButton(container, 'Shoot');

    hud.handleBoardHover({ kind: 'unit', unitId: infiltrator.id });
    const [distance, stealth, ...rest] = texts(last(), infiltrator.id);
    expect(distance).toMatch(/^\d+\.\d"$/);
    expect(stealth).toBe('Stealth −1 to hit (beyond 9")');
    expect(rest).toEqual([]);

    hud.handleBoardHover({ kind: 'unit', unitId: veteran.id });
    expect(last().targetBadges).toHaveLength(1);
    expect(last().targetBadges![0].unitId).toBe(veteran.id);
    expect(texts(last(), veteran.id)).toHaveLength(1);
  });

  it('no badge without a hovered or assigned target, nor while hovering a friendly unit', () => {
    const state = openField();
    const shooter = unitOf(state, 'hdf-infantry-squad');
    activate(state, shooter);
    const { hud, container, last } = setup(state, HOST);
    clickButton(container, 'Shoot');
    expect(last().targetBadges).toEqual([]);
    hud.handleBoardHover({ kind: 'unit', unitId: unitOf(state, 'hdf-sniper').id });
    expect(last().targetBadges).toEqual([]);
  });

  it('split fire: confirming shows a badge for each allocated target, with its own weapons', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    const far = unitOf(state, 'hdf-infantry-squad'); // Carbine only (flamer reaches 12")
    const near = unitOf(state, 'hdf-veterans');
    place(leader, [{ x: 0, z: 0 }]);
    place(far, [{ x: -1, z: 15 }, { x: 0, z: 15 }, { x: 1, z: 15 }]);
    place(near, [{ x: 6, z: 3 }, { x: 7, z: 3 }, { x: 8, z: 3 }]);
    activate(state, leader);
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    hud.handleBoardPick({ kind: 'unit', unitId: far.id });
    // Only the Carbine reaches the far squad: one allocated target so far.
    expect(last().targetBadges!.map((b) => b.unitId)).toEqual([far.id]);

    hud.handleBoardPick({ kind: 'unit', unitId: near.id });
    expect(last().targetBadges!.map((b) => b.unitId).sort()).toEqual([far.id, near.id].sort());
    expect(texts(last(), far.id)[1]).toContain('Ferocious ✓');
    expect(texts(last(), near.id)[1]).toContain('Ferocious ✗');
  });

  it('Fight shows no badge', () => {
    const state = openField();
    const shooter = unitOf(state, 'orc-leader');
    const foe = unitOf(state, 'hdf-infantry-squad');
    place(shooter, [{ x: 0, z: 0 }]);
    place(foe, [{ x: 0, z: 1.5 }]);
    shooter.status = ['engaged'];
    foe.status = ['engaged'];
    activate(state, shooter);
    const { hud, container, last } = setup(state, GUEST);
    (hud as any).beginActionTargeting('fight');
    hud.handleBoardHover({ kind: 'unit', unitId: foe.id });
    expect(last().targetBadges).toEqual([]);
  });
});

describe('GameHUD: target badges while charging', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hovering a target while choosing uses the current distance', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(leader, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 8.5 }]); // gap 7.5
    activate(state, leader);
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Charge');
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });
    expect(texts(last(), squad.id)).toEqual([
      '7.5"',
      'Ferocious ✓ (beyond 6")',
      'Hold the Line +1 morale (beyond 6")',
    ]);
  });

  it('after the charge is declared the badge keeps the distance it started from', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(leader, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 3.5 }]); // the leader has since closed in: gap now 2.5
    activate(state, leader);
    state.turnState.charge = { unitId: leader.id, targetId: squad.id, legs: 1 };
    state.turnState.attackedFrom = { [squad.id]: { charged: 7.2 } } as GameState['turnState']['attackedFrom'];
    const { hud, container, last } = setup(state, GUEST);
    hud.handleBoardHover(null);
    // A declared charge keeps the player in the charge flow; the declared target carries the badge.
    expect(container.textContent).toContain('Charge');
    expect(texts(last(), squad.id)[0]).toBe('7.2"');
    expect(texts(last(), squad.id)[1]).toBe('Ferocious ✓ (beyond 6")');
  });
});

describe('GameHUD: threshold rings', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shooting fan: one ring at 9" plus the base radius, labelled Ferocious', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    place(leader, [{ x: 0, z: 0 }]);
    activate(state, leader);
    const { container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    expect(last().thresholdRings).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rings: [{ radius: 9 + baseRadius(leader), label: '9": Ferocious' }],
    });
  });

  it('charge fan: the 6" Ferocious ring', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    place(leader, [{ x: 0, z: 0 }]);
    activate(state, leader);
    const { container, last } = setup(state, GUEST);
    clickButton(container, 'Charge');
    expect(last().thresholdRings!.rings).toEqual([{ radius: 6 + baseRadius(leader), label: '6": Ferocious' }]);
  });

  it('a unit with two rules at one distance gets one labelled ring', () => {
    const state = openField();
    const specialist = unitOf(state, 'orc-specialist');
    place(specialist, [{ x: 0, z: 0 }]);
    activate(state, specialist);
    const { container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    expect(last().thresholdRings!.rings.map((r) => r.label)).toEqual(['9": Ferocious, Relentless']);
  });

  it('HDF has no attacker gates: no ring', () => {
    const state = openField();
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(squad, [{ x: 0, z: 0 }]);
    activate(state, squad);
    const { container, last } = setup(state, HOST);
    clickButton(container, 'Shoot');
    expect(last().attackRange).not.toBeNull();
    expect(last().thresholdRings).toBeNull();
  });

  it('drops a ring that lies beyond the fan', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    place(leader, [{ x: 0, z: 0 }]);
    // Shrink the leader's ranged reach below the 9" switch.
    for (const w of leader.weapons) if (w.profile.type === 'ranged') w.profile = { ...w.profile, range: 8 };
    activate(state, leader);
    const { container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    expect(last().attackRange).not.toBeNull();
    expect(last().thresholdRings).toBeNull();
  });

  it('no ring in Fight, nor in a squad charge flow', () => {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    place(leader, [{ x: 0, z: 0 }]);
    leader.status = ['engaged'];
    activate(state, leader);
    const fight = setup(state, GUEST);
    fight.hud.handleBoardHover({ kind: 'unit', unitId: unitOf(state, 'hdf-sniper').id });
    (fight.hud as any).beginActionTargeting('fight');
    expect(fight.last().thresholdRings).toBeNull();

    document.body.innerHTML = '';
    const state2 = openField();
    const squad = unitOf(state2, 'hdf-infantry-squad');
    const foe = unitOf(state2, 'orc-leader');
    place(squad, [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: -1, z: 0 }]);
    place(foe, [{ x: 0, z: 8 }]);
    activate(state2, squad);
    state2.turnState.charge = { unitId: squad.id, targetId: foe.id, legs: 0 };
    const charge = setup(state2, HOST);
    charge.hud.handleBoardHover({ kind: 'unit', unitId: foe.id }); // a declared charge keeps the charge flow open
    expect(charge.last().targetBadges).toHaveLength(1); // the declared target still carries its badge
    expect(charge.last().attackRange ?? null).toBeNull();
    expect(charge.last().thresholdRings).toBeNull();
  });
});

describe('GameHUD: Hero aura', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const heroAuras = (m: MarkerSnapshot) => m.auras!.filter((a) => a.kind === 'hero');

  it('selecting a unit 5" from the Company Leader gives an active aura around the Leader', () => {
    const state = openField();
    const hero = unitOf(state, 'hdf-company-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(hero, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 6 }]); // gap 5
    const { hud, last } = setup(state, HOST);
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });
    expect(heroAuras(last())).toEqual([
      { kind: 'hero', position: { x: 0, y: 0, z: 0 }, radius: 6 + baseRadius(hero), active: true },
    ]);
  });

  it('7" away the aura is drawn faint', () => {
    const state = openField();
    const hero = unitOf(state, 'hdf-company-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(hero, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 8 }]); // gap 7
    const { hud, last } = setup(state, HOST);
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });
    expect(heroAuras(last())).toHaveLength(1);
    expect(heroAuras(last())[0].active).toBe(false);
  });

  it('exactly 6" counts as inside (the engine uses within, inclusive)', () => {
    const state = openField();
    const hero = unitOf(state, 'hdf-company-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(hero, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 7 }]);
    const { hud, last } = setup(state, HOST);
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });
    expect(heroAuras(last())[0].active).toBe(true);
  });

  it('a Shaken or Routed Hero gives no aura', () => {
    const state = openField();
    const hero = unitOf(state, 'hdf-company-leader');
    const squad = unitOf(state, 'hdf-infantry-squad');
    place(hero, [{ x: 0, z: 0 }]);
    place(squad, [{ x: 0, z: 4 }]);
    hero.status = ['shaken'];
    const { hud, last } = setup(state, HOST);
    hud.handleBoardHover({ kind: 'unit', unitId: squad.id });
    expect(heroAuras(last())).toEqual([]);
  });

  it('the Hero itself, hovered, shows its own active aura on each living model', () => {
    const state = openField();
    const hero = unitOf(state, 'hdf-company-leader');
    place(hero, [{ x: 3, z: 4 }]);
    const { hud, last } = setup(state, HOST);
    hud.handleBoardHover({ kind: 'unit', unitId: hero.id });
    expect(heroAuras(last())).toEqual([
      { kind: 'hero', position: { x: 3, y: 0, z: 4 }, radius: 6 + baseRadius(hero), active: true },
    ]);
  });

  it("hovering an enemy unit shows that enemy side's Heroes, not yours", () => {
    const state = openField();
    const myHero = unitOf(state, 'hdf-company-leader');
    const orcLeader = unitOf(state, 'orc-leader');
    const orcVet = unitOf(state, 'orc-veteran');
    place(myHero, [{ x: 0, z: 0 }]);
    place(orcLeader, [{ x: 10, z: 10 }]);
    place(orcVet, [{ x: 10, z: 14 }]);
    const { hud, last } = setup(state, HOST);
    hud.handleBoardHover({ kind: 'unit', unitId: orcVet.id });
    const auras = heroAuras(last());
    expect(auras).toHaveLength(1);
    expect(auras[0].position).toEqual({ x: 10, y: 0, z: 10 });
    expect(auras[0].active).toBe(true); // gap 3
  });

  it('shows nothing with no unit hovered or selected', () => {
    const state = openField();
    const { hud, last } = setup(state, HOST);
    hud.handleBoardHover({ kind: 'unit', unitId: unitOf(state, 'hdf-sniper').id });
    hud.handleBoardHover(null);
    expect(last().auras).toEqual([]);
  });
});

describe('GameHUD: Blast spread outline', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function blastScene() {
    const state = openField();
    const leader = unitOf(state, 'orc-leader');
    const target = unitOf(state, 'hdf-infantry-squad');
    const neighbour = unitOf(state, 'hdf-veterans');
    place(leader, [{ x: 0, z: 0 }]);
    place(target, [{ x: -1, z: 8 }, { x: 1, z: 8 }, { x: 0, z: 9 }]);
    place(neighbour, [{ x: 4, z: 8 }, { x: 5, z: 8 }, { x: 6, z: 8 }]); // 2" from the target's nearest model
    activate(state, leader);
    return { state, leader, target, neighbour };
  }

  it('Heavy Flamer-Mod: an outline per living target model and the units that would share the hits', () => {
    const { state, target, neighbour } = blastScene();
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    chooseWeapon(container, 'heavy-flamer-mod');
    hud.handleBoardHover({ kind: 'unit', unitId: target.id });

    const blast = last().auras!.filter((a) => a.kind === 'blast');
    expect(blast).toHaveLength(3);
    expect(blast.map((a) => a.position.x).sort()).toEqual([-1, 0, 1]);
    for (const a of blast) {
      expect(a.radius).toBeCloseTo(3 + baseRadius(target), 5);
      expect(a.active).toBe(true);
    }
    expect(last().blastSharingUnitIds).toEqual([neighbour.id]);
  });

  it('a destroyed model gets no outline', () => {
    const { state, target } = blastScene();
    target.models![0].isDestroyed = true;
    target.models![0].wounds = 0;
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    chooseWeapon(container, 'heavy-flamer-mod');
    hud.handleBoardHover({ kind: 'unit', unitId: target.id });
    expect(last().auras!.filter((a) => a.kind === 'blast')).toHaveLength(target.models!.filter((m) => !m.isDestroyed).length);
  });

  it('a non-Blast weapon draws nothing', () => {
    const { state, target } = blastScene();
    const { hud, container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    chooseWeapon(container, 'orc-carbine');
    hud.handleBoardHover({ kind: 'unit', unitId: target.id });
    expect(last().auras!.filter((a) => a.kind === 'blast')).toEqual([]);
    expect(last().blastSharingUnitIds).toEqual([]);
  });

  it('nothing without a hovered enemy', () => {
    const { state } = blastScene();
    const { container, last } = setup(state, GUEST);
    clickButton(container, 'Shoot');
    chooseWeapon(container, 'heavy-flamer-mod');
    expect(last().auras!.filter((a) => a.kind === 'blast')).toEqual([]);
    expect(last().blastSharingUnitIds).toEqual([]);
  });
});
