// Aliases hls.js to the locally-built vendor/hls.js so the unreleased
// I-frame trick-play API (video-dev/hls.js#7757) is available at runtime.
// Also aliases @pbs/media-preview-hls-iframe to the local src so the demo
// exercises the in-repo component without a build step.

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HLS_MJS = resolve(ROOT, 'vendor/hls.js/dist/hls.mjs');
const COMPONENT = resolve(ROOT, 'src/index.js');

export default defineConfig({
  root: __dirname,
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: [
      { find: 'hls.js/dist/hls.mjs', replacement: HLS_MJS },
      { find: /^hls\.js$/, replacement: HLS_MJS },
      { find: /^@pbs\/media-preview-hls-iframe$/, replacement: COMPONENT },
    ],
  },
  server: { port: 5173 },
  build: {
    outDir: resolve(ROOT, 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        advanced: resolve(__dirname, 'advanced.html'),
      },
    },
  },
});
