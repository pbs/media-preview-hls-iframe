import 'hls-video-element';
import 'media-chrome';
import 'media-chrome/menu';
import '@pbs/media-preview-hls-iframe';
import Hls from 'hls.js';

// Local stream is served from Vite's base path: '/' in dev,
// '/media-preview-hls-iframe/' on GitHub Pages. import.meta.env.BASE_URL
// always has a trailing slash, so we just append the rest.
const PRESETS = {
  'mux-x36xhzz': `${import.meta.env.BASE_URL}streams/test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`,
  'apple-bipbop-hevc':
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8?88001',
};
const DEFAULT_PRESET = 'mux-x36xhzz';

const $ = (id) => document.getElementById(id);
const controller = $('controller');
const preview = $('preview');
const iframeTimeBadge = $('iframeTimeBadge');
const presetSelect = $('presetSelect');
const urlInput = $('urlInput');
const loadForm = $('loadForm');
const statusUrl = $('statusUrl');
const statusVariants = $('statusVariants');

function presetKeyForUrl(url) {
  for (const [k, v] of Object.entries(PRESETS)) if (v === url) return k;
  return 'custom';
}

let currentIframePlayer = null;

function formatTime(t) {
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function whenApiReady(el, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const tick = () => {
      if (el.api) return resolve(el.api);
      if (performance.now() - start > timeoutMs) {
        return reject(new Error('hls-video .api never became ready'));
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// Replace the <hls-video> element entirely so each load starts from a clean
// slate (no carry-over hls.js state, no stale event listeners on the api).
function freshVideoElement(url) {
  const oldVideo = $('video');
  const v = document.createElement('hls-video');
  v.id = 'video';
  v.setAttribute('slot', 'media');
  v.setAttribute('playsinline', '');
  v.muted = true;
  v.setAttribute('autoplay', '');
  v.setAttribute('src', url);
  oldVideo.replaceWith(v);
  return v;
}

async function load(url) {
  if (!url) return;

  // Detach the preview's player and clear the overlay so the previous stream's
  // state can't bleed into the new one.
  preview.player = null;
  if (currentIframePlayer) {
    try { currentIframePlayer.destroy?.(); } catch { /* already torn down */ }
    currentIframePlayer = null;
  }
  iframeTimeBadge.textContent = '';
  statusUrl.textContent = url;
  statusVariants.textContent = 'loading…';

  const video = freshVideoElement(url);

  let hls;
  try {
    hls = await whenApiReady(video);
  } catch (e) {
    statusVariants.textContent = `error: ${e.message}`;
    return;
  }

  hls.once(Hls.Events.MANIFEST_PARSED, () => {
    hls.subtitleTrack = -1;
    const n = hls.iframeVariants?.length || 0;
    statusVariants.textContent = n
      ? `${n} I-frame variant${n === 1 ? '' : 's'}`
      : 'none — preview unavailable for this stream';
  });

  hls.on(Hls.Events.ERROR, (_name, data) => {
    if (data.fatal) {
      statusVariants.textContent = `fatal error: ${data.details}`;
    }
  });

  hls.once(Hls.Events.INIT_PTS_FOUND, () => {
    if (hls.iframeVariants?.length) {
      currentIframePlayer = hls.createIFramePlayer();
      preview.player = currentIframePlayer;
    }
  });
}

// frame-rendered fires on every internal preview <video> 'seeked', so this
// always reflects the time of the I-frame actually decoded for the popup —
// which may lag the hover time when no I-frame exists at that exact second.
preview.addEventListener('frame-rendered', (e) => {
  iframeTimeBadge.textContent = formatTime(e.detail.currentTime);
});

loadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  presetSelect.value = presetKeyForUrl(url);
  load(url);
});

presetSelect.addEventListener('change', () => {
  const key = presetSelect.value;
  if (key === 'custom') {
    urlInput.focus();
    return;
  }
  urlInput.value = PRESETS[key];
  load(PRESETS[key]);
});

// Typing/pasting in the input shouldn't leave the menu showing the wrong preset.
urlInput.addEventListener('input', () => {
  presetSelect.value = presetKeyForUrl(urlInput.value.trim());
});

presetSelect.value = DEFAULT_PRESET;
urlInput.value = PRESETS[DEFAULT_PRESET];
load(PRESETS[DEFAULT_PRESET]);
