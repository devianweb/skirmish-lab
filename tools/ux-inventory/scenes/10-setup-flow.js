// End-to-end setup flow on the PR 9 build: objectives -> deployment (+held Scout) -> Scout stage -> round 1 -> round 2 Ambush
const { launch, harness, shot } = require('../lib');
const { pageHelpers } = require('../common');
(async () => {
  const b = await launch();
  const p = await harness(b); await p.evaluate(pageHelpers);
  const st = () => p.evaluate(() => { const s = ux.state; return { phase: s.turnState.phase, cur: s.turnState.currentPlayerId, round: s.turnState.roundNumber, scout: s.turnState.scoutStage, ambush: s.turnState.ambushStep, objs: (s.objectives || []).length, status: s.status, pending: s.turnState.pendingReaction && s.turnState.pendingReaction.type }; });
  const as = async (pid) => { await p.evaluate((id) => ux.mountHud(id), pid); await p.waitForTimeout(300); };
  const confirm = async () => { const c = await p.$('[data-action="confirm"]'); if (c) { await c.click(); await p.waitForTimeout(700); return true; } return false; };
  const pickAt = (x, z) => p.evaluate(([x, z]) => ux.hud.handleBoardPick({ kind: 'position', position: { x, y: 0, z } }), [x, z]);
  const hoverAt = (x, z) => p.evaluate(([x, z]) => ux.hud.handleBoardHover({ kind: 'position', position: { x, y: 0, z } }), [x, z]);
  await p.evaluate(() => { ux.mountHud(ux.HOST); ux.start({ hostArmyId: 'test-scout-ambush-army', guestArmyId: 'test-scout-ambush-army', useDeploymentPhase: true, customMap: ux.BUILTIN_MAPS['standard-battlefield']() }); ux.setCamera('host'); });
  await p.waitForTimeout(2000);
  console.log('start', JSON.stringify(await st()));
  await p.screenshot({ path: __dirname + '/../out/s9-00-objectives-start.png' });
  // objectives
  const cands = [[0, 0], [-12, 0], [12, 0], [-6, 6], [6, -6], [-14, 8], [14, -8], [0, 9.5], [0, -9.5], [-18, -4], [18, 4]];
  let n = 0;
  for (let guard = 0; guard < 20; guard++) {
    const s = await st(); if (s.phase !== 'objectives') break;
    await as(s.cur);
    let placed = false;
    for (const [x, z] of cands) {
      const prob = await p.evaluate(([x, z]) => ux.shared.objectivePlacementProblem(ux.state, { x, y: 0, z }), [x, z]);
      if (prob) continue;
      await hoverAt(x, z); await p.waitForTimeout(300);
      if (n === 0) await shot(p, 's9-01-objective-place-preview');
      if (n === 1) { await hoverAt(x + 3, z); await p.waitForTimeout(300); await shot(p, 's9-02-objective-bad-spot'); await hoverAt(x, z); }
      await pickAt(x, z); await p.waitForTimeout(300);
      if (n === 0) await shot(p, 's9-03-objective-confirm');
      await confirm();
      if (n === 0) { const other = (await st()).cur; await as(other === s.cur ? (s.cur === 'player-host' ? 'player-guest' : 'player-host') : s.cur); await shot(p, 's9-04-objective-waiting'); await as((await st()).cur); }
      placed = true; n++; break;
    }
    if (!placed) { console.log('no legal objective spot'); break; }
  }
  console.log('after objectives', JSON.stringify(await st()));
  await shot(p, 's9-05-deployment-start', { wait: 800 });
  // deployment
  const xs = { 'player-host': -18, 'player-guest': 18 };
  let heldOne = { 'player-host': false, 'player-guest': false }, d = 0;
  for (let guard = 0; guard < 40; guard++) {
    const s = await st(); if (s.phase !== 'deployment') break;
    await as(s.cur);
    const hs = await p.$('[data-action="hold-scout"]');
    if (hs && !heldOne[s.cur]) { if (s.cur === 'player-host') await shot(p, 's9-06-scout-choice'); await hs.click(); await p.waitForTimeout(400); await confirm(); heldOne[s.cur] = true; continue; }
    const host = s.cur === 'player-host';
    const z = s.scout ? (host ? -6 : 6) : (host ? -16 : 16);
    if (s.scout && d < 100) { await hoverAt(xs[s.cur], z); await p.waitForTimeout(300); await shot(p, 's9-07-scout-stage-' + (host ? 'host' : 'guest')); d = 100; }
    await pickAt(xs[s.cur], z); await p.waitForTimeout(300);
    if (d === 0) { await shot(p, 's9-05b-deploy-confirm'); d = 1; }
    if (!(await confirm())) { console.log('deploy: no confirm', JSON.stringify(s)); await shot(p, 's9-err-deploy'); break; }
    xs[s.cur] += host ? 6 : -6;
  }
  console.log('after deployment', JSON.stringify(await st()));
  await shot(p, 's9-08-round1', { wait: 800 });
  // round 1: everyone holds
  for (let guard = 0; guard < 30; guard++) {
    const s = await st(); if (s.round > 1 || s.phase !== 'activation' || s.ambush) break;
    const id = await p.evaluate((cur) => { const u = ux.state.units.find((u) => u.ownerId === cur && !u.isDestroyed && u.isDeployed !== false && !u.isActivated && !ux.state.turnState.unitsActivatedThisRound.includes(u.id)); return u && u.id; }, s.cur);
    if (!id) { console.log('no unit to activate', JSON.stringify(s)); break; }
    await p.evaluate(([cur, id]) => ux.act(cur, 'hold', { unitId: id }), [s.cur, id]); await p.waitForTimeout(400);
    for (let k = 0; k < 3; k++) {
      const r = await p.evaluate(() => { const r = ux.state.turnState.pendingReaction; return r && { id: r.id, who: r.promptingPlayerId, opt: (r.options.find((o) => o.isDefault) || r.options[0]).id }; });
      if (!r) break;
      await p.evaluate((r) => ux.act(r.who, 'respond-reaction', { reactionId: r.id, choiceId: r.opt }), r); await p.waitForTimeout(500);
    }
    const ac = await p.evaluate(() => ux.state.turnState.activeUnitId);
    if (ac) { const cur = (await st()).cur; await p.evaluate(([cur]) => ux.act(cur, 'end-activation', {}), [cur]); await p.waitForTimeout(400); }
  }
  console.log('round 2?', JSON.stringify(await st()));
  // ambush
  let a = 0;
  for (let guard = 0; guard < 10; guard++) {
    const s = await st(); if (!s.ambush) break;
    await as(s.cur);
    if (a === 0) { await hoverAt(-4, 2); await p.waitForTimeout(300); await shot(p, 's9-09-ambush-step'); }
    if (a === 0) { await pickAt(-4, 2); await p.waitForTimeout(300); if (!(await confirm())) { console.log('ambush place fail'); } a++; continue; }
    const sk = await p.$('[data-action="skip-ambush"]');
    if (sk) { if (a === 1) { await sk.click(); await p.waitForTimeout(300); await shot(p, 's9-10-ambush-skip-confirm'); } else await sk.click(); await confirm(); a++; continue; }
    console.log('ambush: no skip'); break;
  }
  console.log('end', JSON.stringify(await st()));
  await shot(p, 's9-11-round2-after-ambush', { wait: 800 });
  await b.close();
})();
