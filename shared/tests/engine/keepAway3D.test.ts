import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/gameState';
import { GameState, Unit, Vector3 } from '../../src/gameTypes';
import { createJumpRangeMap } from '../../src/data/builtinMaps';
import { STARTER_ARMIES, createUnitsFromStarterArmy } from '../../src/data/armies';
import { findKeepAwayViolation, findMoveBlocker, findNavPath, pushBackChargerModels } from '../../src/engine/spatial';
import { endSpotProblem } from '../../src/engine/closestApproach';
import { keepAwayCentreRadius, keepAwayGap3D } from '../../src/engine/unitGeometry';
import { deploymentFootprintProblem } from '../../src/engine/activation';

const HOST = 'host-1';
const GUEST = 'guest-1';
const P = (x: number, y: number, z: number): Vector3 => ({ x, y, z });

function squad(id: string, owner: string, spots: Vector3[], flying = false): Unit {
  const u = createUnitsFromStarterArmy(STARTER_ARMIES['test-jump-army'], owner)[flying ? 2 : 0] as Unit;
  u.id = id;
  u.models = u.models.slice(0, spots.length);
  u.models.forEach((m, i) => (m.position = { ...spots[i] }));
  u.position = { ...spots[0] };
  u.isDeployed = true;
  return u;
}

function world(units: Unit[], terrain = false): GameState {
  const state = createInitialGameState(HOST, GUEST, 'A', 'B');
  state.status = 'in-progress';
  state.terrain = terrain ? createJumpRangeMap().terrain : [];
  state.units = units;
  return state;
}

describe('keepAwayGap3D', () => {
  it('is the horizontal base gap combined with the height difference', () => {
    expect(keepAwayGap3D(P(0, 0, 0), P(2, 0, 0))).toBeCloseTo(1, 9);
    expect(keepAwayGap3D(P(0, 0, 0), P(1, 3, 0))).toBeCloseTo(3, 9); // bases overlap in plan view: only dy counts
    expect(keepAwayGap3D(P(0, 0, 0), P(2, 0.75, 0))).toBeCloseTo(Math.hypot(1, 0.75), 9);
  });
  it('keepAwayCentreRadius is the centre distance inside which the gap is under 1"', () => {
    expect(keepAwayCentreRadius(0)).toBeCloseTo(2, 9);
    expect(keepAwayCentreRadius(0.6)).toBeCloseTo(1 + 0.8, 9);
    expect(keepAwayCentreRadius(1)).toBeNull();
    expect(keepAwayCentreRadius(-3)).toBeNull();
  });
});

describe('1" keep-away is true 3D distance', () => {
  it('a segment that climbs onto a 3" deck is not held up by models on the ground beneath the landing', () => {
    const mover = squad('mover', HOST, [P(-6, 0, 0)]);
    const under = squad('under', GUEST, [P(-1, 0, 0)]);
    const state = world([mover, under]);
    // The climb ends right above the model (centres 1" apart in plan view); the deck run then passes over it
    const path = [P(-6, 0, 0), P(-2, 3, 0), P(4, 3, 0)];
    expect(findMoveBlocker(state, mover, path, { keepAway: true })).toEqual({ blocked: false });
  });

  it('a model on the deck stepping to the ground beneath another deck is judged by its real height', () => {
    const mover = squad('mover', HOST, [P(-6, 3, 0)]);
    const under = squad('under', GUEST, [P(0, 0, 0)]);
    const state = world([mover, under]);
    expect(findMoveBlocker(state, mover, [P(-6, 3, 0), P(0, 3, 0.3)], { keepAway: true })).toEqual({ blocked: false });
  });

  it('still refuses a path that really passes within 1" in 3D (a low step beside a model)', () => {
    const mover = squad('mover', HOST, [P(-8, 0, 0)]);
    const foe = squad('foe', GUEST, [P(-5, 0, 1.5)]);
    const state = world([mover, foe]);
    const res = findMoveBlocker(state, mover, [P(-8, 0, 0), P(-5, 0.5, 0)], { keepAway: true });
    expect(res.blocked).toBe(true);
    // The same step a full inch higher is clear
    expect(findMoveBlocker(state, mover, [P(-8, 0, 0), P(-5, 1.2, 0)], { keepAway: true })).toEqual({ blocked: false });
  });

  it('refuses climbing right beside a model at the foot of the climb', () => {
    const mover = squad('mover', HOST, [P(-8, 0, 0)]);
    const foe = squad('foe', GUEST, [P(-4.6, 0, 1.2)]);
    const state = world([mover, foe]);
    // Steep climb whose lower part brushes the model (3D gap under 1") before it gains height
    const res = findMoveBlocker(state, mover, [P(-8, 0, 0), P(-4.6, 3, 0)], { keepAway: true });
    expect(res.blocked).toBe(false); // gains height quickly: at the point beside the model it is already high
    const low = findMoveBlocker(state, mover, [P(-8, 0, 0), P(-4.6, 0.6, 0)], { keepAway: true });
    expect(low.blocked).toBe(true);
  });

  it('a model on the deck directly above a ground model does not block landing on that spot', () => {
    const mover = squad('mover', HOST, [P(-6, 0, 0)]);
    const above = squad('above', GUEST, [P(0, 3, 0)]);
    const state = world([mover, above]);
    expect(findKeepAwayViolation(state, 'mover', P(0, 0, 0), P(-6, 0, 0))).toBeNull();
    expect(findMoveBlocker(state, mover, [P(-6, 0, 0), P(0, 0, 0)], { keepAway: true })).toEqual({ blocked: false });
  });

  it('a model 0.6" above still keeps a mover away (3D gap under 1"), 1" above does not', () => {
    const mover = squad('mover', HOST, [P(-6, 0, 0)]);
    const state = world([mover, squad('o', GUEST, [P(0, 0.6, 0)])]);
    expect(findKeepAwayViolation(state, 'mover', P(1.5, 0, 0), P(-6, 0, 0))).not.toBeNull();
    const state2 = world([mover, squad('o', GUEST, [P(0, 1, 0)])]);
    expect(findKeepAwayViolation(state2, 'mover', P(1.5, 0, 0), P(-6, 0, 0))).toBeNull();
  });

  it('a Flying stop under (or over) a model 3" away vertically is allowed, beside it is not', () => {
    const flyer = squad('flyer', HOST, [P(-6, 0, 0)], true);
    const state = world([flyer, squad('o', GUEST, [P(0, 3, 0)])]);
    expect(findMoveBlocker(state, flyer, [P(-6, 0, 0), P(0, 0, 0)], { keepAway: true })).toEqual({ blocked: false });
    expect(findMoveBlocker(state, flyer, [P(-6, 0, 0), P(0, 3, 1.5)], { keepAway: true }).blocked).toBe(true);
  });

  it('keeps the "started closer may not get closer" allowance in 3D', () => {
    const mover = squad('mover', HOST, [P(0, 0, 0)]);
    const state = world([mover, squad('o', GUEST, [P(1.6, 0, 0)])]);
    // starts 0.6" away; sliding away is fine, closing in is not
    expect(findMoveBlocker(state, mover, [P(0, 0, 0), P(-2, 0, 0)], { keepAway: true })).toEqual({ blocked: false });
    expect(findMoveBlocker(state, mover, [P(0, 0, 0), P(0.5, 0, 0)], { keepAway: true }).blocked).toBe(true);
  });
});

describe('the Jump Range deck (owner case)', () => {
  it('a squad under the 3" deck does not stop another squad walking up the stairs and across the deck', () => {
    const under = squad('under', GUEST, [P(-9, 0, -9.2), P(-8, 0, -9.2)]);
    const walker = squad('walker', HOST, [P(-9, 0, -15)]);
    const state = world([walker, under], true);
    const path = findNavPath(state, walker, P(-9, 3, -4), 30, { keepAway: true });
    const end = path[path.length - 1];
    expect(Math.hypot(end.x + 9, end.z + 4)).toBeLessThan(0.3);
    expect(end.y).toBeCloseTo(3, 1);
    expect(findMoveBlocker(state, walker, path, { keepAway: true })).toEqual({ blocked: false });
  });
});

describe('placements use 3D too', () => {
  it('deployment: a spot directly over (or under) a deployed unit is legal, beside it still is not', () => {
    const foe = squad('foe', GUEST, [P(-9, 3, -14)]);
    const mine = squad('mine', HOST, [P(0, 0, -20)]);
    mine.isDeployed = false;
    const state = world([foe, mine]);
    expect(deploymentFootprintProblem(state, mine, P(-9, 0, -14))).toBeNull();
    expect(deploymentFootprintProblem(state, mine, P(-9, 3, -15.6))).toMatch(/within 1"/);
    expect(deploymentFootprintProblem(state, mine, P(-9, 2.5, -15.6))).toMatch(/within 1"/);
  });
});

describe('end spots, group crossings and push-backs use 3D', () => {
  it('endSpotProblem (also used for squad-mates carried across a gap): over a model on the ground is fine', () => {
    const mover = squad('mover', HOST, [P(-9, 0, -15)]);
    const under = squad('under', GUEST, [P(-9, 0, -6)]);
    const state = world([mover, under], true);
    expect(endSpotProblem(state, mover, P(-9, 0, -15), P(-9, 3, -6))).toBeNull();
    // on the ground right beside it is still within 1"
    expect(endSpotProblem(state, mover, P(-9, 0, -15), P(-9, 0, -4.5))).toBe('is within 1" of another unit');
  });

  it('a charger standing on a deck is not pushed back from a foe on the ground beneath it', () => {
    const charger = squad('charger', HOST, [P(-9, 3, -6)]);
    const foe = squad('foe', GUEST, [P(-9, 0, -6.6)]);
    const state = world([charger, foe], true);
    pushBackChargerModels(state, charger, foe);
    expect(charger.models[0].position).toMatchObject({ x: -9, y: 3, z: -6 });
  });
});
