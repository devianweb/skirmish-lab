import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  HOST_PLAYER_ID,
  GUEST_PLAYER_ID,
  KEEP_AWAY_CENTRE_DISTANCE,
  Unit,
} from '@skirmish-lab/shared';
import { computeKeepAwayZones, KEEP_AWAY_DRAW_MARGIN } from '../../src/ui/keepAwayZones';

function mk(id: string, ownerId: string, spots: Array<[number, number, number?]>, destroyedIdx: number[] = []): Unit {
  const models = spots.map(([x, z, y], i) => ({
    id: `${id}-m${i}`,
    wounds: 1,
    maxWounds: 1,
    isDestroyed: destroyedIdx.includes(i),
    position: { x, y: y ?? 0, z },
  }));
  return { id, ownerId, position: { ...models[0].position }, models, isDestroyed: false } as unknown as Unit;
}

function stateWith(...units: Unit[]) {
  const state = createInitialGameState(HOST_PLAYER_ID, GUEST_PLAYER_ID, 'A', 'B');
  state.units = units;
  return state;
}

describe('computeKeepAwayZones', () => {
  it('draws one zone per living model of every other unit (friend or foe), at the engine keep-away distance', () => {
    const mover = mk('mover', HOST_PLAYER_ID, [[0, 0]]);
    const friend = mk('friend', HOST_PLAYER_ID, [[3, 0]]);
    const foe = mk('foe', GUEST_PLAYER_ID, [[0, 4], [1, 4], [2, 4]], [2]);
    const zones = computeKeepAwayZones(stateWith(mover, friend, foe), mover, { reach: 6 });

    expect(zones.filter((z) => z.unitId === 'friend')).toHaveLength(1);
    expect(zones.filter((z) => z.unitId === 'foe')).toHaveLength(2); // destroyed model skipped
    expect(zones.some((z) => z.unitId === 'mover')).toBe(false);
    for (const z of zones) expect(z.radius).toBeCloseTo(KEEP_AWAY_CENTRE_DISTANCE, 9);
  });

  it('leaves out models beyond reach + radius + margin, keeps ones just inside', () => {
    const mover = mk('mover', HOST_PLAYER_ID, [[0, 0]]);
    const edge = 6 + KEEP_AWAY_CENTRE_DISTANCE + KEEP_AWAY_DRAW_MARGIN;
    const inside = mk('in', GUEST_PLAYER_ID, [[edge - 0.01, 0]]);
    const outside = mk('out', GUEST_PLAYER_ID, [[0, edge + 0.01]]);
    const zones = computeKeepAwayZones(stateWith(mover, inside, outside), mover, { reach: 6 });
    expect(zones.map((z) => z.unitId)).toEqual(['in']);
  });

  it('marks only the declared charge target exempt', () => {
    const mover = mk('mover', HOST_PLAYER_ID, [[0, 0]]);
    const target = mk('target', GUEST_PLAYER_ID, [[0, 5]]);
    const other = mk('other', GUEST_PLAYER_ID, [[3, 5]]);
    const zones = computeKeepAwayZones(stateWith(mover, target, other), mover, { reach: 12, exemptUnitId: 'target' });
    expect(zones.find((z) => z.unitId === 'target')!.exempt).toBe(true);
    expect(zones.find((z) => z.unitId === 'other')!.exempt).toBe(false);
  });

  it('uses 3D: a model 1" or more above/below the mover blocks nothing from there (faint), a closer one blocks a smaller disc', () => {
    const mover = mk('mover', HOST_PLAYER_ID, [[0, 0, 0]]);
    const high = mk('high', GUEST_PLAYER_ID, [[2, 0, 3]]);
    const step = mk('step', GUEST_PLAYER_ID, [[0, 2, 0.6]]);
    const edge = mk('edge', GUEST_PLAYER_ID, [[-2, 0, 1]]);
    const zones = computeKeepAwayZones(stateWith(mover, high, step, edge), mover, { reach: 6 });
    expect(zones.find((z) => z.unitId === 'high')!.otherTier).toBe(true);
    expect(zones.find((z) => z.unitId === 'edge')!.otherTier).toBe(true);
    const s = zones.find((z) => z.unitId === 'step')!;
    expect(s.otherTier).toBe(false);
    expect(s.radius).toBeCloseTo(1 + Math.sqrt(1 - 0.36), 9);
    expect(s.radius).toBeLessThan(KEEP_AWAY_CENTRE_DISTANCE);
  });

  it('under-deck models are faint when the mover stands on a 3" deck, and vice versa', () => {
    const onDeck = mk('deck', HOST_PLAYER_ID, [[0, 0, 3]]);
    const under = mk('under', GUEST_PLAYER_ID, [[0, 1, 0]]);
    const z1 = computeKeepAwayZones(stateWith(onDeck, under), onDeck, { reach: 6 });
    expect(z1.find((z) => z.unitId === 'under')!.otherTier).toBe(true);
    const ground = mk('ground', HOST_PLAYER_ID, [[0, 0, 0]]);
    const above = mk('above', GUEST_PLAYER_ID, [[0, 1, 3]]);
    const z2 = computeKeepAwayZones(stateWith(ground, above), ground, { reach: 6 });
    expect(z2.find((z) => z.unitId === 'above')!.otherTier).toBe(true);
  });

  it('measures reach from every living model of a squad mover, or explicit origins', () => {
    const mover = mk('mover', HOST_PLAYER_ID, [[0, 0], [30, 0]]);
    const near = mk('near', GUEST_PLAYER_ID, [[30, 5]]);
    expect(computeKeepAwayZones(stateWith(mover, near), mover, { reach: 6 })).toHaveLength(1);
    expect(computeKeepAwayZones(stateWith(mover, near), mover, { reach: 6, origins: [{ x: 0, y: 0, z: 0 }] })).toHaveLength(0);
  });
});
