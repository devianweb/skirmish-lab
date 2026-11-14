// Real two-browser P2P check of the objectives phase on master
const { launch, shot } = require('../lib');
const URL = 'http://localhost:3000/skirmish-lab/';
(async () => {
  const b = await launch();
  const h = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const g = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  for (const p of [h, g]) p.on('pageerror', (e) => console.log('ERR', e.message));
  await h.goto(URL); await h.waitForSelector('#createBtn', { timeout: 90000 });
  await h.click('#createBtn'); await h.waitForTimeout(2000);
  const code = await h.evaluate(() => (document.body.innerText.match(/[A-Z0-9]{3}-[A-Z0-9]{3}/) || [''])[0]);
  await g.goto(URL); await g.waitForTimeout(2000); await g.fill('#codeInput', code); await g.click('#joinBtn');
  await h.waitForSelector('#startMatchBtn:not([disabled])', { timeout: 15000 });
  await h.click('#startMatchBtn');
  await h.waitForSelector('.sl-hud-turn', { timeout: 15000 });
  await g.waitForSelector('.sl-hud-turn', { timeout: 15000 });
  const turn = async (p) => p.evaluate(() => (document.querySelector('.sl-hud-turn') || {}).textContent || '');
  console.log('host:', await turn(h), '| guest:', await turn(g));
  const spots = [[800, 450], [700, 400], [900, 500], [650, 520], [950, 380], [760, 560], [860, 340], [600, 450], [1000, 450]];
  let placed = 0;
  for (let round = 0; round < 12 && placed < 10; round++) {
    const hp = (await turn(h)).includes('Your turn to place');
    const gp = (await turn(g)).includes('Your turn to place');
    const p = hp ? h : gp ? g : null;
    if (!p) break;
    let ok = false;
    for (const [x, y] of spots) {
      await p.mouse.click(x, y); await p.waitForTimeout(400);
      const c = await p.$('[data-action="confirm"]');
      if (c) { await c.click(); await p.waitForTimeout(1500); ok = true; placed++; console.log((hp ? 'host' : 'guest') + ' placed at', x, y); break; }
    }
    if (!ok) { console.log('could not place for', hp ? 'host' : 'guest'); break; }
  }
  console.log('host:', await turn(h), '| guest:', await turn(g));
  await shot(h, 's11-p2p-host'); await shot(g, 's11-p2p-guest');
  await b.close();
})();
