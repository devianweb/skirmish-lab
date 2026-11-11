const { scene, launch, GR, HR } = require('../scene');
// 14C-3 PR 1C: TEST: Loadouts Check army: carrier counts, firing counts, two-weapon melee
const base = { hostArmy: 'test-loadouts-army', guestArmy: 'test-loadouts-army', map: 'hazard-range', focus: [0, 0.5, 8], mutate: "s.turnState.phase = 'activation'; s.turnState.currentPlayerId = ux.HOST; s.status = 'in-progress';" };
const SQ = HR + 'loadout-squad-1';
const LEAD = HR + 'loadout-leader-2';
const GSQ = GR + 'loadout-squad-1';
const GLEAD = GR + 'loadout-leader-2';
(async () => {
  const b = await launch();
  // Shooting: unit list counts, chips with firing counts, confirmation
  let p = await scene(b, { ...base, arrange: [[SQ, 0, -4], [GSQ, 0, 8, { facing: Math.PI }], [LEAD, 12, -4], [GLEAD, 12, 8, { facing: Math.PI }]] });
  await p.btn('.sl-hud-units >> text=Test Mixed Squad 1'); await p.btn('[data-action="confirm"]');
  await p.shot('l13-01-loadout-unit-list');
  await p.btn('[data-action="shoot"]');
  await p.pick(GSQ);
  await p.shot('l13-02-loadout-shoot-confirm');
  await p.close();
  // Melee: the two-weapon leader charges; strike-back prompt; per-weapon dice lines
  p = await scene(b, { ...base, arrange: [[LEAD, 0, -1.5], [GLEAD, 0, 4, { facing: Math.PI }], [SQ, 12, -4], [GSQ, 12, 8, { facing: Math.PI }]] });
  await p.evaluate(() => ux.force({ 'to-hit': [5, 5], 'w1-to-hit': [5, 5], defense: [6, 1, 1, 1], 'w1-defense': [6, 1, 1, 1], morale: 1, push: 5 }));
  await p.btn('.sl-hud-units >> text=Test Two-Weapon Leader 2'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="charge"]'); await p.pick(GLEAD);
  await p.shot('l13-03-leader-charge-confirm');
  await p.btn('[data-action="confirm"]');
  await p.waitForTimeout(1200);
  await p.shot('l13-04-leader-charge-dice');
  await p.as('guest');
  await p.shot('l13-05-strike-back-two-weapons');
  await p.btn('[data-reaction-choice="strike-back"]');
  await p.waitForTimeout(1200);
  await p.as('host');
  await p.shot('l13-06-strike-back-dice');
  await p.close();
  await b.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 600)); process.exit(1); });
