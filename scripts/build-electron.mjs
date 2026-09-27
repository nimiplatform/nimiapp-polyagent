import { build } from 'esbuild';
await build({
  entryPoints: ['src-electron/main.ts'],
  outfile: 'dist-electron/main.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
});
await import('./bundle-electron-preload.mjs');
