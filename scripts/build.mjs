// Build entry point that uses the esbuild JS API so we can register the
// Markdown plugin (CLI esbuild has no plugin support).
//
// This is the single source of truth for esbuild configs; the Makefile and
// package.json just forward to it.
//
//   npm run esbuild                  # all targets (see configs below)
//   npm run esbuild -- worker        # one target
//   npm run esbuild -- ui --watch    # watch mode
//
// Targets: worker, ui, server, all (default)
import esbuild from 'esbuild';
import { readFileSync } from 'fs';
import mdPlugin from './md-loader.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const define = {
  // identifies this build; the IDE puts it in the worker URL to defeat stale caches
  __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  // the version shown in the IDE's About menu
  __APP_VERSION__: JSON.stringify(pkg.version),
};

const configs = {
  worker: {
    entryPoints: ['src/worker/workermain.ts'],
    bundle: true,
    sourcemap: true,
    target: 'es2017',
    outfile: './gen/worker/bundle.js',
  },
  ui: {
    entryPoints: ['src/ide/ui.ts', 'src/ide/embedui.ts'],
    splitting: true,
    format: 'esm',
    bundle: true,
    minify: true,
    sourcemap: true,
    target: 'es2017',
    outdir: './gen/',
    external: ['path', 'fs'],
  },
  server: {
    entryPoints: ['src/worker/server/server.ts'],
    platform: 'node',
    bundle: true,
    sourcemap: true,
    target: 'es2020',
    outfile: './gen/server/server.js',
  },
};

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const target = args.find((a) => !a.startsWith('-')) ?? 'all';
const targets = target === 'all' ? Object.keys(configs) : [target];

for (const name of targets) {
  const config = configs[name];
  if (!config) {
    console.error(`Unknown build target: ${name}`);
    process.exit(1);
  }
  const ctx = await esbuild.context({
    ...config,
    define,
    plugins: [mdPlugin],
  });
  if (watch) {
    await ctx.watch();
    console.error(`[esbuild] watching ${name}`);
  } else {
    const result = await ctx.rebuild();
    await ctx.dispose();
    for (const msg of result.warnings) console.error(msg.text);
  }
}
