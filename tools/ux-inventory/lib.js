const { chromium } = require('playwright');
const OUT = __dirname + '/out/';
async function launch() {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  return b;
}
async function harness(b) {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
  await p.goto('http://localhost:' + (process.env.PORT || 3000) + '/skirmish-lab/ux-harness.html');
  await p.waitForFunction(() => window.uxReady === true, null, { timeout: 60000 });
  return p;
}
async function shot(p, name, opts = {}) {
  await p.waitForTimeout(opts.wait ?? 600);
  await p.screenshot({ path: OUT + name + '.png', ...(opts.clip ? { clip: opts.clip } : {}) });
  console.log('shot', name);
}
async function shotEl(p, sel, name) {
  await p.waitForTimeout(400);
  const el = await p.$(sel);
  if (!el) { console.log('MISSING', sel, name); return; }
  await el.screenshot({ path: OUT + name + '.png' });
  console.log('shot', name);
}
module.exports = { launch, harness, shot, shotEl, OUT };
