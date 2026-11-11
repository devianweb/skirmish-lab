const { scene, launch, HS, GR } = require('../scene');
const base = { hostArmy: 'test-special-rules-army', guestArmy: 'test-rules-army', map: 'hazard-range', focus: [0, 0, 20] };
const SQA = GR + 'rules-squad-a-2';
(async () => {
  const b = await launch();
  // B: single-weapon shot
  let p = await scene(b, { ...base, arrange: [[HS + 'assault-7', -2, -4], [SQA, 1, 5, { facing: Math.PI }]] });
  await p.btn('.sl-hud-units >> text=Test Assault Troops 7'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="shoot"]');
  await p.hoverUnit(SQA);
  await p.shot('09-shoot-targeting');
  await p.pick(SQA);
  await p.shot('10-shoot-confirm');
  if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
  await p.shot('11-shoot-dice-result', { wait: 1500 });
  await p.close();
  // C: multi-weapon (guest heavy gunner)
  p = await scene(b, { ...base, as: 'guest', current: 'guest', focus: [0, 0, 20, 'guest'], arrange: [[GR + 'heavy-gunner-4', 2, 4, { facing: Math.PI }], [HS + 'impact-3', 0, -4], [HS + 'fear-6', 7, -3]] });
  await p.btn('.sl-hud-units >> text=Test Heavy Gunner 4'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="shoot"]');
  await p.shot('12-multiweapon-targeting');
  await p.pick(HS + 'impact-3');
  await p.shot('13-multiweapon-chips');
  await p.btn('.sl-hud-weapon-chip >> nth=1');
  await p.pick(HS + 'fear-6');
  await p.shot('14-multiweapon-split');
  if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
  await p.shot('15-multiweapon-dice', { wait: 1500 });
  await p.close();
  // D: charge
  p = await scene(b, { ...base, arrange: [[HS + 'impact-3', 0, -4], [SQA, 0, 4, { facing: Math.PI }]] });
  await p.btn('.sl-hud-units >> text=Test Impact Brutes 3'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="charge"]');
  await p.shot('16-charge-targeting');
  await p.pick(SQA);
  await p.shot('17-charge-after-pick');
  await p.close();
  await b.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 400)); process.exit(1); });
