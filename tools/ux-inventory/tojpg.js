// Converts site/ (from build.js) into the committed inventory: doc/ux/inventory/index.html + img/*.jpg
const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');

const SITE = path.join(__dirname, 'site');
const DEST = path.join(__dirname, '..', '..', 'doc', 'ux', 'inventory');

// Guard against wiping doc/ux/inventory/img when build.js reported missing images or out/ is incomplete
if (fs.existsSync(path.join(SITE, '.missing'))) {
  console.error('tojpg: refusing to run because build.js reported missing screenshots');
  process.exit(1);
}

const siteImgDir = path.join(SITE, 'img');
if (!fs.existsSync(siteImgDir)) {
  console.error('tojpg: refusing to run because site/img directory does not exist');
  process.exit(1);
}

const allCatalogImages = catalog.flatMap((sec) => sec.entries.map((e) => e.img));
const missing = allCatalogImages.filter((img) => !fs.existsSync(path.join(siteImgDir, img + '.png')));
if (missing.length > 0) {
  console.error(`tojpg: refusing to run because ${missing.length} catalog screenshot(s) are missing from site/img`);
  process.exit(1);
}

(async () => {
  const { chromium } = require('playwright');
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
