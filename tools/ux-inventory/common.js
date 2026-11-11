// Shared scenario helpers evaluated in the page
module.exports.pageHelpers = () => {
  window.H = {
    arrange(state, id, x, z, opts = {}) {
      const u = state.units.find((u) => u.id === id);
      const n = u.models.length;
      const dx = opts.dx ?? 1.3, dz = opts.dz ?? 0, y = opts.y ?? 0;
      u.position = { x, y, z };
      u.isDeployed = true;
      u.models.forEach((m, i) => { m.position = { x: x + (i - (n - 1) / 2) * dx, y, z: z + i * dz }; });
      if (opts.facing !== undefined) { u.rotation = { x: 0, y: opts.facing, z: 0 }; u.models.forEach((m) => (m.rotation = { x: 0, y: opts.facing, z: 0 })); }
      return u;
    },
    hide(state, keep) { // park every other unit far away in own zone corners
      let hi = 0, gi = 0;
      for (const u of state.units) {
        if (keep.includes(u.id)) continue;
        const host = u.ownerId === ux.HOST;
        const idx = host ? hi++ : gi++;
        H.arrange(state, u.id, -21 + idx * 0 + (idx % 4) * 5, host ? -22 + Math.floor(idx / 4) * 0 : 22, {});
        u.isActivated = false;
      }
    },
    unitIds(state, owner) { return state.units.filter((u) => u.ownerId === owner).map((u) => u.id + ':' + u.name); },
  };
};
