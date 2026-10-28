import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the client from https://devianweb.github.io/skirmish-lab/
  // so all asset URLs must be prefixed with the repo name.
  base: '/skirmish-lab/',
  server: {
    port: 3000
  }
});
