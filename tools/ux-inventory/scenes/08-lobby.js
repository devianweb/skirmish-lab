const { launch, shot } = require('../lib');
const URL = 'http://localhost:3000/skirmish-lab/';
(async () => {
  const b = await launch();
  const ctx1 = await b.newContext({ viewport: { width: 1600, height: 900 } });
  const ctx2 = await b.newContext({ viewport: { width: 1600, height: 900 } });
  const h = await ctx1.newPage(); h.on('pageerror', (e) => console.log('ERR', e.message));
  await h.goto(URL); await h.waitForTimeout(2500);
  await shot(h, '70-lobby');
  await h.keyboard.press('F9'); await h.waitForTimeout(500);
  await shot(h, '71-lobby-dev-mode');
  await h.click('#createBtn'); await h.waitForTimeout(2500);
  await shot(h, '72-lobby-waiting-room');
  const code = await h.evaluate(() => (document.body.innerText.match(/[A-Z0-9]{3}-[A-Z0-9]{3}/) || [''])[0]);
  console.log('code', code);
  const g = await ctx2.newPage(); g.on('pageerror', (e) => console.log('ERR', e.message));
  await g.goto(URL); await g.waitForTimeout(2000);
  await g.fill('#codeInput', code);
  await shot(g, '73-lobby-join-filled');
  await g.click('#joinBtn'); await g.waitForTimeout(800);
  await shot(g, '74-lobby-joining');
  await g.waitForTimeout(6000);
  await shot(h, '75-game-start-host');
  await shot(g, '76-game-start-guest');
  // map editor
  const e = await ctx1.newPage(); e.on('pageerror', (er) => console.log('ERR', er.message));
  await e.goto(URL); await e.waitForTimeout(2000);
  await e.click('#openMapEditorBtn'); await e.waitForTimeout(1500);
  await shot(e, '77-map-editor');
  const items = await e.$$('.editor-palette-item'); if (items.length > 2) { await items[2].click(); await e.waitForTimeout(400); }
  await e.mouse.click(800, 500); await e.waitForTimeout(800);
  await shot(e, '78-map-editor-piece-selected');
  const cats = await e.$$('.editor-cat-btn'); if (cats.length > 1) { await cats[1].click(); await e.waitForTimeout(400); }
  await shot(e, '79-map-editor-category');
  await b.close();
})();
