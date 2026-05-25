// All three packages are loaded from jsDelivr via the importmap in
// index.html and register custom elements as a side effect of evaluation.
// The check at the bottom is load-bearing: with every dep marked external
// in vite.config.js, the build chunk contains nothing but bare imports,
// which Rollup elides — which in turn strips the <script> tag from the
// rendered HTML. A real top-level expression keeps the chunk alive, and a
// sanity check at least surfaces silent CDN failures.
import 'media-chrome';
import 'hls-video-element';
import 'media-preview-hls-iframe';

for (const tag of ['media-controller', 'hls-video', 'media-preview-hls-iframe']) {
  if (!customElements.get(tag)) console.error(`<${tag}> failed to register`);
}
