import 'hls-video-element';
import 'media-chrome';
import 'media-chrome/menu'; // registers <media-rendition-menu>, <media-rendition-menu-button>, etc.
import '@pbs/media-preview-hls-iframe';
import Hls from 'hls.js';

const video = document.getElementById('video');
const preview = document.getElementById('preview');

// hls-video-element creates its internal hls.js instance asynchronously after
// src is set. Poll until .api is available, then hand the I-frame player off
// to the preview component once hls.js has parsed init PTS.
function whenApiReady(el) {
  return new Promise((resolve) => {
    const tick = () => (el.api ? resolve(el.api) : requestAnimationFrame(tick));
    tick();
  });
}

whenApiReady(video).then((hls) => {
  hls.once(Hls.Events.INIT_PTS_FOUND, () => {
    if (hls.iframeVariants?.length) {
      preview.player = hls.createIFramePlayer();
    }
  });
});
