// Builds site/index.html + site/img/*.png from catalog.js and out/*.png
const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');
const SITE = path.join(__dirname, 'site');
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.join(SITE, 'img'), { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const used = [];
let n = 0;
let missingCount = 0;

const observations = [
  ['Dice panel', 'During setup the Dice panel shows an empty attack template ("Attacker → target", "To-Hit (need Q4+)", "0 hits · 0 blocked · 0 wounds") because the latest roll (objective count, roll-offs) is not an attack. See the objective screenshots.'],
  ['Log wording', 'Some log lines print the raw action name: "Host concede", "Guest request-rematch", "Host held with …" for an idle Shaken unit.'],
  ['Header colours', 'The turn label shows "Defeat" in the same green as "Your turn", and "Victory" in orange.'],
  ['Confirm summaries', 'Multi-weapon and charge confirmations are 4 to 5 lines of dense text in one paragraph (weapons, dice, target numbers, pile-in, step-back). A structured layout (one row per weapon, icons for Q/D) would scan faster.'],
  ['Bottom of the screen', 'The data card and the action/prompt bar are two separate floating panels stacked at the bottom; together they cover a large part of the board, and the red keep-away legend banner overlaps the data card.'],
  ['Roster panel', 'Both sides share one tall scrolling panel; the enemy list usually falls below the fold. Friendly cards are large, enemy cards are compact one-liners. Status tags (UNDEPLOYED, ACTIVATED, SHAKEN, FATIGUED, ENGAGED, IN RESERVE (AMBUSH), HELD AS SCOUT) are all small coloured text, so Shaken does not stand out.'],
  ['Top-centre slot', 'Toasts, the setup panel, the terrain-debugger pill and rejection banners all appear in the same spot under the header and can stack on each other.'],
  ['Icons', 'Emoji act as icons in some prompts (📍 placement, ⚠️ alerts, 🎯 objectives, ⏳ waiting) while the rest of the HUD is text-only.'],
  ['Reaction docks', 'The docks share a pattern (title, countdown, description, buttons), but button order and colours differ: Push = Auto (green) / Confirm / Don\'t push (red); Pile in = Auto place / Confirm (green) / Reset; Casualties = Auto pick / Confirm.'],
  ['Board scale', 'The default camera frames the whole 48" board, so units are small and the action often sits far from the camera. A focus-on-selection camera or zoom shortcut would help.'],
  ['Lobby', 'The guest has no army choice (the host picks both; already a 14G item). The deployment checkbox reads "Interactive Pre-Match Deployment (12" Zones)" and without it a game starts with no objectives.'],
  ['Map Builder', 'The top toolbar is crowded with two-line button labels; the status pill (Ready / Notice) looks like a button.'],
  ['Match end', 'The results modal sits over the live HUD; the roster, Dice/Log and data card stay visible behind it.'],
  ['Setup header', 'During setup the header still shows the objective score (Host 0 — Guest 0), and the "Round N started" toast fires before the Ambush step of that round.'],
];

let toc = '';
let body = '';
for (const sec of catalog) {
  toc += `<li><a href="#${sec.id}">${esc(sec.title)}</a> <span class="count">${sec.entries.length}</span></li>`;
  let cards = '';
  for (const e of sec.entries) {
    n++;
    const src = path.join(__dirname, 'out', e.img + '.png');
    if (!fs.existsSync(src)) {
      console.log('MISSING', e.img);
      missingCount++;
      continue;
    }
    fs.copyFileSync(src, path.join(SITE, 'img', e.img + '.png'));
    used.push(e.img);
    cards += `
      <article class="entry" id="${esc(e.img)}">
        <a class="shot" href="#${esc(e.img)}-full" aria-label="Enlarge: ${esc(e.title)}"><img src="img/${esc(e.img)}.png" alt="${esc(e.title)}" loading="lazy" width="1600" height="900"></a>
        <div class="text">
          <p class="num">${String(n).padStart(2, '0')}</p>
          <h3>${esc(e.title)}</h3>
          <dl>
            <dt>What it is</dt><dd>${esc(e.what)}</dd>
            <dt>Purpose</dt><dd>${esc(e.purpose)}</dd>
          </dl>
        </div>
      </article>
      <a class="lightbox" id="${esc(e.img)}-full" href="#${esc(e.img)}"><img src="img/${esc(e.img)}.png" alt="${esc(e.title)} (full size)"></a>`;
  }
  body += `
    <section id="${sec.id}">
      <header class="sec-head"><h2>${esc(sec.title)}</h2><p>${esc(sec.blurb)}</p></header>
      ${cards}
    </section>`;
}

const obsHtml = observations.map(([t, d]) => `<li><strong>${esc(t)}.</strong> ${esc(d)}</li>`).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SkirmishLab UI Inventory</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  /* One dark world, matching the game's HUD: slate panels, the HUD's cyan and amber accents.
     Layout: sticky contents rail on the left, one card per UI element (screenshot left, notes right). */
  --bg: #12161c;
  --panel: #1b2129;
  --line: #2c3540;
  --ink: #e6ebf0;
  --muted: #9aa7b4;
  --accent: #29b6f6;
  --amber: #ffd54f;
  --display: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 var(--body); }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 32px; max-width: 1440px; margin: 0 auto; padding: 32px 24px 80px; }
nav { position: sticky; top: 24px; align-self: start; display: flex; flex-direction: column; gap: 16px; }
nav .brand { font: 600 15px var(--display); color: var(--amber); letter-spacing: .02em; }
nav ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
nav li { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
nav li a { color: var(--ink); text-decoration: none; }
nav li a:hover { color: var(--accent); }
nav .count { font: 500 12px var(--display); color: var(--muted); font-variant-numeric: tabular-nums; }
main { display: flex; flex-direction: column; gap: 48px; min-width: 0; }
.intro h1 { font: 600 28px/1.2 var(--display); margin: 0 0 12px; text-wrap: balance; }
.intro p { max-width: 70ch; margin: 0 0 10px; color: var(--muted); }
.intro .meta { font: 500 12px var(--display); color: var(--muted); }
.obs { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--amber); border-radius: 6px; padding: 20px 24px; }
.obs h2 { font: 600 17px var(--display); margin: 0 0 12px; color: var(--amber); }
.obs ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; max-width: 95ch; }
section { display: flex; flex-direction: column; gap: 20px; }
.sec-head { border-bottom: 1px solid var(--line); padding-bottom: 8px; }
.sec-head h2 { font: 600 20px var(--display); margin: 0; text-wrap: balance; }
.sec-head p { margin: 4px 0 0; color: var(--muted); }
.entry { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 20px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 14px; scroll-margin-top: 16px; }
.shot img { display: block; width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--line); }
.shot:hover img { border-color: var(--accent); }
.text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.num { margin: 0; font: 500 12px var(--display); color: var(--muted); font-variant-numeric: tabular-nums; }
.text h3 { margin: 0; font: 600 17px var(--display); text-wrap: balance; }
dl { margin: 4px 0 0; display: flex; flex-direction: column; gap: 4px; }
dt { font: 600 11px var(--display); text-transform: uppercase; letter-spacing: .06em; color: var(--accent); margin-top: 6px; }
dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.lightbox { display: none; }
.lightbox:target { display: flex; position: fixed; inset: 0; z-index: 10; background: rgba(8, 10, 14, .92); align-items: center; justify-content: center; padding: 24px; cursor: zoom-out; }
.lightbox img { max-width: 100%; max-height: 100%; border-radius: 4px; }
@media (max-width: 1000px) {
  .layout { grid-template-columns: 1fr; }
  nav { position: static; }
  .entry { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="layout">
  <nav aria-label="Contents">
    <span class="brand">SkirmishLab UI</span>
    <ol>${toc}<li><a href="#observations">Design observations</a> <span class="count">${observations.length}</span></li></ol>
  </nav>
  <main>
    <header class="intro">
      <h1>SkirmishLab UI inventory</h1>
      <p>Every screen, panel and prompt in the game as of the 14C-2 PR 9 build (master, 11 Nov 2026), with what each one is and what it is for. Use it as the starting point for the 14G design pass.</p>
      <p>Screenshots come from a headless browser at 1600 × 900. In-match shots run the real HUD and engine on one page with scripted dice, so a prompt can be shown from both seats. Lobby shots use two real browsers over the signaling server. Click a screenshot to enlarge it.</p>
      <p class="meta">${used.length} screenshots · ${catalog.length} sections · not shown: the dangerous-terrain casualty selector on a squad move and the "jump N dice" chip (described in the movement section)</p>
    </header>
    <div class="obs" id="observations">
      <h2>Design observations</h2>
      <ol>${obsHtml}</ol>
    </div>
    ${body}
  </main>
</div>
</body>
</html>`;
fs.writeFileSync(path.join(SITE, 'index.html'), html);
if (missingCount > 0) {
  fs.writeFileSync(path.join(SITE, '.missing'), `${missingCount} missing screenshots\n`);
  console.error(`build: ${missingCount} screenshot(s) missing from out/`);
  process.exitCode = 1;
}
console.log('built', used.length, 'images');
