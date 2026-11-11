// Writes the screenshot harness into the client (client/ux-harness.html + client/src/uxHarness.ts).
// The marker wiring is copied from client/src/main.ts so it stays in sync. Remove with `node make-harness.js --clean`.
// The harness is never committed: it only exists while screenshots are taken.
const fs = require('fs');
const path = require('path');
const CLIENT = path.join(__dirname, '..', '..', 'client');
const TS = path.join(CLIENT, 'src', 'uxHarness.ts');
const HTML = path.join(CLIENT, 'ux-harness.html');
if (process.argv.includes('--clean')) {
  for (const f of [TS, HTML]) if (fs.existsSync(f)) fs.unlinkSync(f);
  console.log('harness removed');
  process.exit(0);
}
const main = fs.readFileSync(path.join(CLIENT, 'src', 'main.ts'), 'utf8');
const markers = main.slice(main.indexOf('function unitForMarkers'), main.indexOf('// Separate containers for Lobby and HUD'));
const tpl = fs.readFileSync(path.join(__dirname, 'harness.template.ts'), 'utf8');
fs.writeFileSync(TS, tpl.replace('/*__MARKERS__*/', markers));
fs.writeFileSync(HTML, `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><title>UX harness</title></head>
<body style="margin: 0; background: #1a1a1a; color: #fff;"><div id="app"></div>
<script type="module" src="/src/uxHarness.ts"></script></body></html>
`);
console.log('harness written');
