const { scene, launch, GR, HR } = require('../scene');
// Host heavy gunner fires a Blast weapon at one guest squad with a second squad 3" behind it (14C-2 PR 10)
const base = { hostArmy: 'test-rules-army', guestArmy: 'test-rules-army', map: 'hazard-range', focus: [0, 0, 20], mutate: "s.turnState.phase = 'activation'; s.turnState.currentPlayerId = ux.HOST; s.status = 'in-progress';" };
const SQA = GR + 'rules-squad-a-2';
const SQB = GR + 'rules-squad-b-3';
(async () => {
  const b = await launch();
  const p = await scene(b, { ...base, arrange: [[HR + 'heavy-gunner-4', 0, -4], [SQA, 0, 6, { facing: Math.PI }], [SQB, 0, 9, { facing: Math.PI }]] });
  await p.evaluate(() => ux.force({ 'to-hit': [5, 5, 5], defense: 1, morale: 1 }));
  await p.btn('.sl-hud-units >> text=Test Heavy Gunner'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="shoot"]');
  await p.pick(SQA);
  // Only the Frag Launcher: deselect the other four weapons
  for (let i = 0; i < 4; i++) await p.btn('.sl-hud-weapon-chip >> nth=1');
  await p.btn('[data-action="confirm"]');
  await p.shot('s12-01-waiting-host', { wait: 900 });
  await p.as('guest');
  await p.shot('s12-02-split-dock-guest', { wait: 900 });
  await p.btn('button[data-action="blast-step"][data-col="0"][data-delta="1"]');
  await p.btn('button[data-action="blast-step"][data-col="1"][data-delta="-1"]');
  await p.shot('s12-03-split-edited-guest');
  await p.close();
  await b.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 400)); process.exit(1); });
