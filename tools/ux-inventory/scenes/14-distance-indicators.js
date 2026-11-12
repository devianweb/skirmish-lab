const { scene, launch } = require('../scene');
// 14G distance-rule indicators: target badge, threshold ring, Hero aura, Blast outline (Orc Marauders vs HDF)
const H = 'player-host-', G = 'player-guest-';
const LEADER = H + 'orc-leader-1';
const SQUAD = G + 'hdf-infantry-squad-3';
const VETS = G + 'hdf-veterans-2';
const CAPTAIN = G + 'hdf-company-leader-1';
const base = { hostArmy: 'orc-marauders', guestArmy: 'hdf', map: 'hazard-range', focus: [0, 2, 18], mutate: "s.turnState.phase = 'activation'; s.turnState.currentPlayerId = ux.HOST; s.status = 'in-progress';" };
(async () => {
  const b = await launch();
  // Badge and threshold ring: the Leader aims at a squad more than 9" away
  let p = await scene(b, { ...base, focus: [0, 1, 20], arrange: [[LEADER, 0, -6], [SQUAD, 0, 8, { facing: Math.PI }]] });
  await p.btn('.sl-hud-units >> text=Orc Leader'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="shoot"]');
  await p.shot('g14-02-threshold-ring');
  await p.hoverUnit(SQUAD);
  await p.shot('g14-01-target-badge');
  await p.close();
  // Hero aura: hovering an HDF squad 4" from its Company Leader
  p = await scene(b, { ...base, focus: [3, 7, 13], arrange: [[LEADER, 0, -10], [SQUAD, 0, 6, { facing: Math.PI }], [CAPTAIN, 6, 10, { facing: Math.PI }], [VETS, -14, 10, { facing: Math.PI }]] });
  await p.hoverUnit(SQUAD);
  await p.shot('g14-03-hero-aura');
  await p.close();
  // Blast outline: the Heavy Flamer-Mod aimed at a squad with the Veterans close by
  p = await scene(b, { ...base, focus: [2, 6, 13], arrange: [[LEADER, 0, -1], [SQUAD, 0, 8, { facing: Math.PI }], [VETS, 5.5, 9, { facing: Math.PI }]] });
  await p.btn('.sl-hud-units >> text=Orc Leader'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="shoot"]');
  await p.hoverUnit(SQUAD);
  await p.shot('g14-04-blast-outline');
  await p.close();
  await b.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 600)); process.exit(1); });
