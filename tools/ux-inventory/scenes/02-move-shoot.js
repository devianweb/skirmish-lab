const { scene, launch, HS, GR } = require('../scene');
const base = { hostArmy: 'test-special-rules-army', guestArmy: 'test-rules-army', map: 'hazard-range', focus: [0, 0, 22] };
(async () => {
  const b = await launch();
  // A: squad Advance
  let p = await scene(b, { ...base, arrange: [[HS + 'impact-3', 0, -4], [GR + 'rules-squad-a-2', 0, 5, { facing: Math.PI }]] });
  await p.btn('.sl-hud-units >> text=Test Impact Brutes 3'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="move"]');
  await p.hoverAt(-1, 0, 0); await p.clickAt(-1, 0, 0);
  await p.shot('06-squad-first-placed');
  await p.btn('[data-action="confirm-squad-move"]');
  await p.shot('07-move-confirm-summary');
  await p.btn('[data-action="confirm"]');
  await p.shot('08-after-move', { wait: 1200 });
  await p.close();
  // B: single-weapon shot
  p = await scene(b, { ...base, arrange: [[HS + 'assault-7', -3, -6], [GR + 'rules-squad-a-2', 0, 6, { facing: Math.PI }]] });
  await p.btn('.sl-hud-units >> text=Test Assault Troops 7'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="shoot"]');
  await p.hoverAt(0, 0.4, 6);
  await p.shot('09-shoot-targeting');
  await p.clickAt(0, 0.4, 6);
  await p.shot('10-shoot-confirm');
  const c = await p.$('[data-action="confirm"]'); if (c) await p.btn('[data-action="confirm"]');
  await p.shot('11-shoot-dice-result', { wait: 1500 });
  await p.close();
  // C: multi-weapon (guest heavy gunner)
  p = await scene(b, { ...base, as: 'guest', current: 'guest', focus: [0, 0, 22, 'guest'], arrange: [[GR + 'heavy-gunner-4', 2, 6, { facing: Math.PI }], [HS + 'impact-3', 0, -6], [HS + 'fear-6', 7, -4]] });
  await p.btn('.sl-hud-units >> text=Test Heavy Gunner 4'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="shoot"]');
  await p.shot('12-multiweapon-targeting');
  await p.clickAt(0, 0.4, -6);
  await p.shot('13-multiweapon-chips');
  await p.close();
  await b.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 400)); process.exit(1); });
