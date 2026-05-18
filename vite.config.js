// Library build: produces the publishable ESM artifact in dist/.
// The component has no runtime dependencies (it duck-types against an
// HlsIFramesOnly-shaped player). hls-video-element, media-chrome, and hls.js
// are runtime requirements of the consumer, not bundled here.

import { defineConfig } from 'vite';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/media-preview-hls-iframe.js'),
      formats: ['es'],
      fileName: () => 'media-preview-hls-iframe.js',
    },
    rollupOptions: {
      external: [],
    },
  },
  plugins: [
    {
      name: 'copy-types',
      closeBundle() {
        copyFileSync(
          resolve(__dirname, 'src/media-preview-hls-iframe.d.ts'),
          resolve(__dirname, 'dist/media-preview-hls-iframe.d.ts'),
        );
      },
    },
  ],
});
