// node grid.js out.png a.png b.png c.png d.png  -> 2x2 contact sheet at 1600x900
const { chromium } = require('playwright');
(async () => {
  const [out, ...files] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const fs = require('fs');
  const imgs = files.map((f) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><span style="position:absolute;top:2px;left:4px;background:#000;color:#ff0;font:12px sans-serif">${require('path').basename(f)}</span></div>`).join('');
  await p.setContent(`<body style="margin:0;background:#333;display:grid;grid-template-columns:1fr 1fr;gap:2px">${imgs}</body>`);
  await p.screenshot({ path: out, fullPage: true }); await b.close();
})();
