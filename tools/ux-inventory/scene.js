const { launch, harness, shot, shotEl } = require('./lib');
const { pageHelpers } = require('./common');
async function scene(b, cfg) {
  const p = await harness(b); await p.evaluate(pageHelpers);
  await p.evaluate((cfg) => {
    ux.mountHud(cfg.as === 'guest' ? ux.GUEST : ux.HOST);
    ux.start({ hostArmyId: cfg.hostArmy, guestArmyId: cfg.guestArmy, useDeploymentPhase: !!cfg.deploy, customMap: ux.BUILTIN_MAPS[cfg.map ?? 'hazard-range']() });
    if (!cfg.deploy) {
      const s = JSON.parse(JSON.stringify(ux.state));
      const keep = (cfg.arrange ?? []).map((a) => a[0]);
      if (cfg.arrange) window.H.hide(s, keep);
      for (const [id, x, z, o] of cfg.arrange ?? []) window.H.arrange(s, id, x, z, o ?? {});
      if (!s.objectives || s.objectives.length === 0) s.objectives = [[-12, 0], [12, 0], [0, 9], [0, -9]].map(([x, z], i) => ux.shared.createObjectiveMarker(i + 1, { x, y: 0, z }));
      // Games without the deployment phase open in the objectives phase (14C-2 PR 9B): skip straight to round 1
      if (s.turnState.phase === 'objectives') { s.turnState.phase = 'activation'; s.turnState.roundNumber = 1; s.turnState.currentPlayerId = ux.HOST; }
      if (cfg.current === 'guest') { s.turnState.currentPlayerId = ux.GUEST; }
      if (cfg.mutate) new Function('s', 'ux', cfg.mutate)(s, ux);
      ux.setState(s);
    }
    if (cfg.focus) ux.focus(...cfg.focus); else ux.setCamera(cfg.as === 'guest' ? 'guest' : 'host');
  }, cfg);
  await p.waitForTimeout(800);
  const proj = (x, y, z) => p.evaluate(([x, y, z]) => ux.project(x, y, z), [x, y, z]);
  p.clickAt = async (x, y, z) => { const c = await proj(x, y, z); await p.mouse.click(c.x, c.y); await p.waitForTimeout(300); };
  p.hoverAt = async (x, y, z) => { const c = await proj(x, y, z); await p.mouse.move(c.x, c.y); await p.waitForTimeout(300); };
  p.act = async (actor, type, payload) => { await p.evaluate(([a, t, pl]) => ux.act(a === 'guest' ? ux.GUEST : ux.HOST, t, pl), [actor, type, payload]); await p.waitForTimeout(500); };
  p.btn = async (sel) => { await p.click(sel, { timeout: 5000 }); await p.waitForTimeout(400); };
  p.as = async (who) => { await p.evaluate((w) => ux.mountHud(w === 'guest' ? ux.GUEST : ux.HOST), who); await p.waitForTimeout(400); };
  p.shot = (n, o) => shot(p, n, o);
  p.shotEl = (s, n) => shotEl(p, s, n);
  p.pick = async (unitId) => { await p.evaluate((id) => ux.hud.handleBoardPick({ kind: 'unit', unitId: id }), unitId); await p.waitForTimeout(400); };
  p.pickAt = async (x, y, z) => { await p.evaluate(([x, y, z]) => ux.hud.handleBoardPick({ kind: 'position', position: { x, y, z } }), [x, y, z]); await p.waitForTimeout(400); };
  p.hoverPick = async (x, y, z) => { await p.evaluate(([x, y, z]) => ux.hud.handleBoardHover({ kind: 'position', position: { x, y, z } }), [x, y, z]); await p.waitForTimeout(400); };
  p.hoverUnit = async (id) => { await p.evaluate((id) => ux.hud.handleBoardHover({ kind: 'unit', unitId: id }), id); await p.waitForTimeout(400); };
  return p;
}
const HS = 'player-host-test-special-', GR = 'player-guest-test-', HR = 'player-host-test-';
module.exports = { scene, launch, HS, GR, HR };
