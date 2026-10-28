import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// GitHub Pages serves the client from https://devianweb.github.io/skirmish-lab/
// so all asset URLs must be prefixed with the repo name.
export default defineConfig({
  base: '/skirmish-lab/',
  resolve: {
    alias: {
      // Shared compiles to CommonJS, whose barrel re-exports (__exportStar)
      // rollup cannot statically analyze for named exports. Alias the client
      // build to the shared TypeScript source instead. Vitest picks this up
      // too, so client tests also resolve shared from source (the server
      // still resolves @skirmish-lab/shared via its compiled dist/).
      '@skirmish-lab/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 3000
  }
});
