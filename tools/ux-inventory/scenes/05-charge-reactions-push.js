const { scene, launch, HS, GR } = require('../scene');
const base = { hostArmy: 'test-special-rules-army', guestArmy: 'test-rules-army', map: 'hazard-range', focus: [0, 0.5, 14] };
const SQA = GR + 'rules-squad-a-2';
const pend = (p) => p.evaluate(() => { const r = ux.state.turnState.pendingReaction; return r ? r.type + '/' + r.promptingPlayerId : 'none'; });
(async () => {
  const b = await launch();
  let p = await scene(b, { ...base, arrange: [[HS + 'impact-3', 0, -1.5], [SQA, 0, 3, { facing: Math.PI, dx: 1.6 }]] });
  await p.evaluate(() => ux.force({ impact: 1, 'impact-defense': 6, 'to-hit': [5, 1, 1, 1, 1, 1, 1, 1], defense: 1, morale: 1, push: 5 }));
  await p.btn('.sl-hud-units >> text=Test Impact Brutes 3'); await p.btn('[data-action="confirm"]');
  await p.btn('[data-action="charge"]'); await p.pick(SQA); await p.btn('[data-action="confirm"]');
  await p.pick(SQA);
  await p.shot('s5-20-charge-leg-placed');
  if (await p.$('[data-action="confirm-squad-move"]')) await p.btn('[data-action="confirm-squad-move"]');
  await p.shot('s5-21-charge-leg-confirm');
  if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
  await p.waitForTimeout(1200);
  console.log('after charge', await pend(p));
  await p.shot('s5-22-charge-resolved-host');
  await p.as('guest');
  await p.shot('s5-23-guest-reaction-1');
  await p.btn('[data-action="auto-pile-in"]'); await p.btn('[data-action="confirm-pile-in"]');
  await p.waitForTimeout(1200);
  console.log('after pile-in', await pend(p));
  await p.shot('s5-24-guest-after-pilein');
  for (let i = 0; i < 5; i++) {
    const r = await pend(p);
    if (r === 'none') break;
    const who = r.endsWith('guest') ? 'guest' : 'host';
    await p.as(who);
    await p.shot('s5-25-reaction-' + i + '-' + r.split('/')[0] + '-' + who);
    await p.as(who === 'guest' ? 'host' : 'guest');
    await p.shot('s5-25-reaction-' + i + '-' + r.split('/')[0] + '-waiting');
    await p.as(who);
    if (r.startsWith('pick-casualties')) {
      const n = await p.evaluate(() => ux.state.turnState.pendingReaction.data.entry.count);
      for (let k = 0; k < n; k++) { const t = await p.$$('[data-action="toggle-casualty-model"]'); await t[t.length - 1 - k].click(); await p.waitForTimeout(400); }
      await p.shot('s5-25-reaction-' + i + '-picked');
      await p.btn('[data-action="confirm-casualties"]');
    } else if (r.startsWith('push')) {
      if (await p.$('[data-action="push-confirm"]')) { await p.btn('[data-action="push-confirm"]'); await p.shot('s5-25-reaction-' + i + '-push-confirm'); }
      const m = await p.$$('[data-action="select-push-model"]'); if (m.length) { await m[0].click(); await p.waitForTimeout(400); await p.shot('s5-25-reaction-' + i + '-push-model'); }
      break;
    } else { const btns = await p.$$('[data-reaction-choice]'); if (btns.length) { await btns[btns.length - 1].click(); } else break; }
    await p.waitForTimeout(1500);
  }
  await p.as('host');
  await p.shot('s5-27-host-after-melee');
  if (await p.$('[data-action="end-activation"]')) await p.btn('[data-action="end-activation"]');
  if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
  await p.waitForTimeout(1500);
  console.log('after end', await pend(p));
  await p.shot('s5-28-melee-result-morale');
  const r = await pend(p);
  if (r !== 'none') {
    await p.as(r.endsWith('guest') ? 'guest' : 'host'); await p.shot('s5-29-' + r.split('/')[0]);
    if (await p.$('[data-action="push-confirm"]')) { await p.btn('[data-action="push-confirm"]'); await p.shot('s5-30-push-confirm'); }
    const m = await p.$$('[data-action="select-push-model"]'); if (m.length) { await m[0].click(); await p.waitForTimeout(400); await p.shot('s5-31-push-model'); }
    await p.as(r.endsWith('guest') ? 'host' : 'guest'); await p.shot('s5-32-push-waiting');
  }
  await b.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 400)); process.exit(1); });
