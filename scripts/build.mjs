import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const minify = !watch;

const node = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify,
  logLevel: 'info',
  external: ['electron']
};

const web = {
  bundle: true,
  platform: 'browser',
  target: 'chrome126',
  sourcemap: true,
  minify,
  logLevel: 'info',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  loader: { '.css': 'css', '.svg': 'file' },
  assetNames: 'assets/[name]'
};

const targets = [
  { ...node, entryPoints: [path.join(root, 'src/main/index.ts')], outfile: path.join(root, 'dist/main/index.js') },
  { ...node, entryPoints: [path.join(root, 'src/preload/index.ts')], outfile: path.join(root, 'dist/preload/index.js') },
  {
    ...web,
    entryPoints: [path.join(root, 'src/renderer/island.tsx'), path.join(root, 'src/renderer/gallery.tsx'), path.join(root, 'src/renderer/customize.tsx'), path.join(root, 'src/renderer/update.tsx')],
    outdir: path.join(root, 'dist/renderer')
  }
];

await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist/renderer'), { recursive: true });

if (watch) {
  for (const t of targets) {
    const ctx = await context(t);
    await ctx.watch();
  }
} else {
  await Promise.all(targets.map((t) => build(t)));
}

for (const f of ['island.html', 'gallery.html', 'customize.html', 'update.html']) {
  await cp(path.join(root, 'src/renderer', f), path.join(root, 'dist/renderer', f));
}

await cp(path.join(root, 'src/renderer/assets'), path.join(root, 'dist/renderer/assets'), { recursive: true });
