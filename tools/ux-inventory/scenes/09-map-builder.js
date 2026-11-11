const { launch, shot } = require('../lib');
const URL = 'http://localhost:3000/skirmish-lab/';
(async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
  const e = await ctx.newPage(); e.on('pageerror', (er) => console.log('ERR', er.message));
  e.on('dialog', (d) => d.accept());
  await e.goto(URL); await e.waitForTimeout(2000);
  await e.click('#openMapEditorBtn'); await e.waitForTimeout(1500);
  const opts = await e.$$eval('#loadMapSelect option', (os) => os.map((o) => o.value + '|' + o.textContent));
  console.log(opts.join(' ; '));
  const std = opts.find((o) => /standard/i.test(o)); if (std) await e.selectOption('#loadMapSelect', std.split('|')[0]);
  await e.waitForTimeout(2000);
  await shot(e, '77-map-editor');
  await e.mouse.click(800, 520); await e.waitForTimeout(800);
  await shot(e, '78-map-editor-piece-selected');
  await e.keyboard.press('Escape');
  const items = await e.$$('.editor-palette-item'); if (items.length) { await items[0].click(); await e.waitForTimeout(300); }
  await e.mouse.move(700, 600); await e.waitForTimeout(800);
  await shot(e, '79-map-editor-placing');
  await b.close();
})();
