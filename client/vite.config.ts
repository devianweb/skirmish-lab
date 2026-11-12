import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** Short commit: GITHUB_SHA in CI/deploy, else git, else `dev`. */
function resolveCommit(): string {
  const sha = process.env.GITHUB_SHA?.trim();
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

function buildStampPlugin(commit: string, builtAt: string): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'skirmish-lab-version-json',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      root = config.root;
    },
    closeBundle() {
      const dir = fileURLToPath(new URL(outDir, `file://${root}/`));
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/version.json`, JSON.stringify({ commit, builtAt }) + '\n');
    },
  };
}

// A dev server (or test run) shows `dev`; only a production build carries a real stamp.
export default defineConfig(({ command }) => {
  const isBuild = command === 'build' && !process.env.VITEST;
  const commit = isBuild ? resolveCommit() : 'dev';
  const builtAt = new Date().toISOString();
  return {
    // GitHub Pages serves the client from https://devianweb.github.io/skirmish-lab/
    // so all asset URLs must be prefixed with the repo name.
    base: '/skirmish-lab/',
    define: {
      __BUILD_COMMIT__: JSON.stringify(commit),
      __BUILD_TIME__: JSON.stringify(builtAt),
    },
    plugins: [buildStampPlugin(commit, builtAt)],
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
      port: 3000,
    },
  };
});
