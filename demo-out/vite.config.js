// Demo build: produces a static site under dist-demo/ for GitHub Pages.
// Aliases hls.js to the locally-built vendor/hls.js so the unreleased
// PR #7757 trick-play API is exercised end-to-end.

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HLS_MJS = resolve(ROOT, 'vendor/hls.js/dist/hls.mjs');

export default defineConfig({
  root: __dirname,
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: [
      { find: 'hls.js/dist/hls.mjs', replacement: HLS_MJS },
      { find: /^hls\.js$/, replacement: HLS_MJS },
    ],
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: resolve(ROOT, 'dist-demo'),
    emptyOutDir: true,
  },
});
