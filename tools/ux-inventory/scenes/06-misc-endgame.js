const { scene, launch, HS, GR, HR } = require('../scene');
(async () => {
  const b = await launch();
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAIL', name, e.message.slice(0, 200)); } };

  // 1. Jumps on Jump Range
  await step('jump', async () => {
    const p = await scene(b, { hostArmy: 'test-jump-army', guestArmy: 'test-jump-army', map: 'jump-range', focus: [-5, -6, 16],
      arrange: [], mutate: `
        const ids = s.units.filter(u => u.ownerId === ux.HOST).map(u => u.id);
        const put = (id, x, z, y) => { const u = s.units.find(u => u.id === id); u.position = { x, y, z }; u.models.forEach((m, i) => m.position = { x: x + (i % 2) * 1.2, y, z: z + Math.floor(i / 2) * 1.2 }); };
        put(ids[0], -8.4, -7, 3); put(ids[2], -14, -3, 0);
        window.__ids = ids;` });
    const ids = await p.evaluate(() => window.__ids);
    await p.pick(ids[0]); await p.btn('[data-action="confirm"]');
    await p.btn('[data-action="move"]');
    await p.hoverAt(-3, 3, -6.5);
    await p.shot('40-jump-preview');
    await p.clickAt(-3, 3, -6.5);
    await p.shot('41-jump-placed');
    if (await p.$('[data-action="confirm-squad-move"]')) await p.btn('[data-action="confirm-squad-move"]');
    await p.shot('42-jump-confirm');
    if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
    await p.shot('43-jump-result', { wait: 1500 });
    await p.close();
  });
  // 1b. Flying
  await step('fly', async () => {
    const p = await scene(b, { hostArmy: 'test-jump-army', guestArmy: 'test-jump-army', map: 'jump-range', focus: [-5, -6, 16], mutate: `
        const ids = s.units.filter(u => u.ownerId === ux.HOST).map(u => u.id);
        const u = s.units.find(u => u.id === ids[2]); u.position = { x: -14, y: 0, z: -2 }; u.models.forEach((m, i) => m.position = { x: -14 + i * 1.2, y: 0, z: -2 });
        window.__ids = ids;` });
    const ids = await p.evaluate(() => window.__ids);
    await p.pick(ids[2]); await p.btn('[data-action="confirm"]');
    await p.btn('[data-action="move"]');
    await p.hoverAt(-9, 3, -5);
    await p.shot('44-flying-preview');
    await p.close();
  });
  // 2. Dangerous terrain move
  await step('hazard', async () => {
    const p = await scene(b, { hostArmy: 'test-hazard-army', guestArmy: 'test-hazard-army', map: 'hazard-range', focus: [-6, -8, 16], mutate: `
        const ids = s.units.filter(u => u.ownerId === ux.HOST).map(u => u.id);
        const u = s.units.find(u => u.id === ids[0]); u.position = { x: -9, y: 0, z: -4 }; u.models.forEach((m, i) => m.position = { x: -11 + i * 1.1, y: 0, z: -4 });
        window.__ids = ids;` });
    const ids = await p.evaluate(() => window.__ids);
    await p.pick(ids[0]); await p.btn('[data-action="confirm"]');
    await p.btn('[data-action="rush"]');
    await p.hoverAt(-9, 0, -12);
    await p.shot('45-hazard-preview');
    await p.clickAt(-9, 0, -12);
    if (await p.$('[data-action="confirm-squad-move"]')) await p.btn('[data-action="confirm-squad-move"]');
    await p.shot('46-hazard-confirm');
    if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
    await p.shot('47-hazard-result', { wait: 1500 });
    await p.close();
  });
  // 3. Shaken unit, enemy hover card, alerts, toasts, debug, concede, game over
  await step('misc', async () => {
    const base = { hostArmy: 'test-special-rules-army', guestArmy: 'test-rules-army', map: 'hazard-range', focus: [0, 0, 20] };
    const p = await scene(b, { ...base, arrange: [[HS + 'impact-3', 0, -4], [HS + 'fear-6', -6, -3], [GR + 'rules-squad-a-2', 0, 5, { facing: Math.PI }], [GR + 'hero-1', 6, 4, { facing: Math.PI }]],
      mutate: `s.units.find(u => u.id === '${HS}fear-6').status = ['shaken'];` });
    await p.hoverUnit(GR + 'hero-1');
    await p.shot('50-enemy-hover-card');
    await p.pick(HS + 'fear-6');
    await p.shot('51-shaken-activate');
    await p.evaluate(() => ux.hud.setNetworkStatus({ peer: 'disconnected' }));
    await p.shot('52-alert-opponent-disconnected');
    await p.evaluate(() => { ux.hud.setNetworkStatus({ peer: 'connected', signaling: 'reconnecting' }); });
    await p.shot('53-alert-signaling-reconnecting');
    await p.evaluate(() => { ux.hud.setNetworkStatus({ signaling: 'connected' }); ux.hud.notifyRejected('Move exceeds unit speed'); });
    await p.shot('54-toast-rejected', { wait: 300 });
    await p.evaluate(() => ux.hud.toggleTerrainDebug(true));
    await p.hoverAt(-9, 0, -8);
    await p.shot('55-terrain-debugger');
    await p.evaluate(() => ux.hud.toggleTerrainDebug(false));
    await p.btn('[data-action="concede-open"]');
    await p.shot('56-concede-dialog');
    await p.btn('[data-action="concede-confirm"]');
    await p.shot('57-gameover-defeat', { wait: 1500 });
    await p.as('guest');
    await p.shot('58-gameover-victory');
    await p.btn('[data-action="play-again"]');
    await p.shot('59-gameover-rematch-waiting');
    await p.as('host');
    await p.shot('60-gameover-rematch-offered');
    await p.close();
  });
  // 4. Deployment: guest waiting + placement hover
  await step('deploy', async () => {
    const p = await scene(b, { hostArmy: 'test-special-rules-army', guestArmy: 'test-rules-army', map: 'hazard-range', deploy: true });
    await p.waitForTimeout(1500);
    console.log('phase', await p.evaluate(() => ux.state.turnState.phase));
    await p.shot('61-setup-phase-host');
    await p.as('guest');
    await p.shot('62-setup-phase-guest');
    await p.close();
  });
  await b.close();
})();
