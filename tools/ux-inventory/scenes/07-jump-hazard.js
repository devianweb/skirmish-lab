const { scene, launch } = require('../scene');
(async () => {
  const b = await launch();
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAIL', name, e.message.slice(0, 200)); } };
  await step('jump', async () => {
    const p = await scene(b, { hostArmy: 'test-jump-army', guestArmy: 'test-jump-army', map: 'jump-range', focus: [-15, -6, 14],
      mutate: "const ids = s.units.filter(u => u.ownerId === ux.HOST).map(u => u.id); const u = s.units.find(u => u.id === ids[0]); u.position = { x: -16.6, y: 4.5, z: -6 }; u.models.forEach((m, i) => m.position = { x: -16.6 - (i % 2) * 1.2, y: 4.5, z: -6.6 + Math.floor(i / 2) * 1.2 }); window.__ids = ids; window.__t = s.terrain.map(t => t.id + '@' + t.position.x + ',' + t.position.z).join(' ');" });
    console.log(await p.evaluate(() => window.__t));
    const ids = await p.evaluate(() => window.__ids);
    await p.pick(ids[0]); await p.btn('[data-action="confirm"]');
    await p.btn('[data-action="move"]');
    const deckB = await p.evaluate(() => ux.state.terrain.find(t => t.position.x === -3 && t.position.z === -6).id);
    await p.evaluate((id) => ux.hud.handleBoardHover({ kind: 'position', position: { x: -13, y: 0, z: -6.5 } }), deckB); await p.waitForTimeout(500);
    await p.shot('40-jump-preview');
    await p.evaluate((id) => ux.hud.handleBoardPick({ kind: 'position', position: { x: -13, y: 0, z: -6.5 } }), deckB); await p.waitForTimeout(500);
    await p.shot('41-jump-placed');
    if (await p.$('[data-action="confirm-squad-move"]')) await p.btn('[data-action="confirm-squad-move"]');
    await p.shot('42-jump-confirm');
    if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
    await p.shot('43-jump-result', { wait: 1500 });
    await p.close();
  });
  await step('hazard', async () => {
    const p = await scene(b, { hostArmy: 'test-hazard-army', guestArmy: 'test-hazard-army', map: 'hazard-range', focus: [-9, -6, 16],
      mutate: "const ids = s.units.filter(u => u.ownerId === ux.HOST).map(u => u.id); const u = s.units.find(u => u.id === ids[0]); u.position = { x: -9, y: 0, z: -3.4 }; u.models.forEach((m, i) => m.position = { x: -10.2 + (i % 3) * 1.2, y: 0, z: -3.4 + Math.floor(i / 3) * 1.2 }); window.__ids = ids;" });
    const ids = await p.evaluate(() => window.__ids);
    await p.pick(ids[0]); await p.btn('[data-action="confirm"]');
    await p.btn('[data-action="move"]');
    await p.hoverPick(-9, 0, -8);
    await p.shot('45-hazard-preview');
    await p.pickAt(-9, 0, -8);
    if (await p.$('[data-action="confirm-squad-move"]')) await p.btn('[data-action="confirm-squad-move"]');
    await p.shot('46-hazard-confirm');
    if (await p.$('[data-action="confirm"]')) await p.btn('[data-action="confirm"]');
    await p.shot('47-hazard-result', { wait: 1500 });
    await p.close();
  });
  await b.close();
})();
