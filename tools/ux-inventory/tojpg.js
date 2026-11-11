// Converts site/ (from build.js) into the committed inventory: doc/ux/inventory/index.html + img/*.jpg
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, 'site');
const DEST = path.join(__dirname, '..', '..', 'doc', 'ux', 'inventory');
(async () => {
  fs.rmSync(path.join(DEST, 'img'), { recursive: true, force: true });
  fs.mkdirSync(path.join(DEST, 'img'), { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  for (const f of fs.readdirSync(path.join(SITE, 'img'))) {
    const png = fs.readFileSync(path.join(SITE, 'img', f)).toString('base64');
    await p.setContent(`<body style="margin:0"><img src="data:image/png;base64,${png}" style="display:block">`);
    await p.waitForTimeout(50);
    await p.screenshot({ path: path.join(DEST, 'img', f.replace(/\.png$/, '.jpg')), type: 'jpeg', quality: 80 });
  }
  await b.close();
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8')
    .replace(/\.png"/g, '.jpg"')
    .replace('Click a screenshot to enlarge it.', 'Click a screenshot to enlarge it. Open this file directly in a browser; it needs no server.');
  fs.writeFileSync(path.join(DEST, 'index.html'), html);
  console.log('wrote', DEST);
})();
