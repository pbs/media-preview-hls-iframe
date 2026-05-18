import 'hls-video-element';
import 'media-chrome';
import '../src/index.js';
import Hls from 'hls.js';

const PRESETS = {
  'bipbop-ts': {
    label: 'Apple bipbop_16x9 — TS I-frames',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
  },
  'adv-fmp4': {
    label: 'Apple adv_dv_atmos — fMP4 I-frames',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8',
  },
  'ireplay-live': {
    label: 'iReplay Blender — LIVE fMP4 I-frames (1080p60)',
    url: 'https://ireplay.tv/test/blender.m3u8',
  },
};
const DEFAULT_PRESET = 'bipbop-ts';
const LS_KEY = 'hls-iframe-test:lastUrl';

const $ = (id) => document.getElementById(id);
const mainVideo = $('mainVideo');
const hoverPreview = $('hoverPreview');
const variantsReadout = $('variantsReadout');
const iframeStatus = $('iframeStatus');
const eventLog = $('eventLog');
const presetSelect = $('presetSelect');
const urlInput = $('urlInput');
const loadBtn = $('loadBtn');

mainVideo.config = { autoStartLoad: true, debug: false };

let hls = null;
let hlsIframesOnly = null;

function ts() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function log(label, data) {
  const li = document.createElement('li');
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = ts();
  const tag = document.createElement('span');
  tag.className = `tag tag-${label.replace(/[^a-z]/gi, '').toLowerCase()}`;
  tag.textContent = label;
  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = data ? JSON.stringify(data) : '';
  li.append(time, tag, body);
  eventLog.prepend(li);
  while (eventLog.children.length > 200) eventLog.removeChild(eventLog.lastChild);
}

function shortenUrl(u) {
  try {
    const url = new URL(u);
    return url.pathname.split('/').pop();
  } catch {
    return u;
  }
}

function renderVariants(variants) {
  variantsReadout.innerHTML = '';
  if (!variants || !variants.length) {
    variantsReadout.innerHTML = '<li><em>no I-frame variants</em></li>';
    return;
  }
  for (const v of variants) {
    const li = document.createElement('li');
    const codecs = v.videoCodec || v.codecSet || v.codecs || '';
    li.textContent = `${v.width}×${v.height} @ ${Math.round((v.bitrate || 0) / 1000)} kbps${codecs ? ` [${codecs}]` : ''} — ${shortenUrl(v.url || v.uri || '')}`;
    variantsReadout.appendChild(li);
  }
}

function updateIframeStatus() {
  if (!hlsIframesOnly) {
    iframeStatus.textContent = '(no IFrame player)';
    return;
  }
  const idx = hlsIframesOnly.currentLevel;
  const lvl = hlsIframesOnly.levels?.[idx];
  if (lvl) {
    iframeStatus.textContent = `level ${idx}: ${lvl.width}×${lvl.height} @ ${Math.round((lvl.bitrate || 0) / 1000)} kbps`;
  } else {
    iframeStatus.textContent = `level ${idx}`;
  }
}

function attachIframeLoggers(player) {
  player.on(Hls.Events.LEVEL_UPDATED, (_name, data) => {
    log('LEVEL_UPDATED', { level: data.level });
    updateIframeStatus();
  });
  player.on(Hls.Events.LEVEL_SWITCHED, (_name, data) => {
    log('LEVEL_SWITCHED', { level: data.level });
    updateIframeStatus();
  });
  player.on(Hls.Events.FRAG_BUFFERED, (_name, data) => {
    const f = data.frag;
    log('FRAG_BUFFERED', { sn: f.sn, start: +f.start.toFixed(2), file: shortenUrl(f.url) });
  });
  player.on(Hls.Events.ERROR, (_name, data) => {
    log('ERROR', { type: data.type, details: data.details, fatal: data.fatal });
  });
}

function createIframePlayerIfNeeded() {
  if (!hls) return;
  if (hls.url !== hlsIframesOnly?.url) hlsIframesOnly = null;
  if (!hlsIframesOnly && hls.iframeVariants?.length) {
    hlsIframesOnly = hls.createIFramePlayer();
    if (hlsIframesOnly) {
      window.hlsIframesOnly = hlsIframesOnly;
      log('createIFramePlayer', { variants: hls.iframeVariants.length });
      attachIframeLoggers(hlsIframesOnly);
      hoverPreview.player = hlsIframesOnly;
      updateIframeStatus();
    } else {
      log('createIFramePlayer', { result: 'null — variants not ready' });
    }
  }
}

function waitForApi(el, timeoutMs = 5000) {
  return new Promise((resolveP, reject) => {
    if (el.api) return resolveP(el.api);
    const start = performance.now();
    const tick = () => {
      if (el.api) return resolveP(el.api);
      if (performance.now() - start > timeoutMs) return reject(new Error('hls-video .api never became ready'));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function resetUiForNewStream() {
  iframeStatus.textContent = '(waiting…)';
  variantsReadout.innerHTML = '<li><em>waiting for manifest…</em></li>';
}

async function loadStream(url) {
  if (!url) return;
  log('loadStream', { url });

  if (hlsIframesOnly) {
    try { hlsIframesOnly.destroy(); } catch { /* ignore */ }
    hlsIframesOnly = null;
    window.hlsIframesOnly = null;
  }
  hoverPreview.player = null;
  hls = null;
  window.hls = null;
  resetUiForNewStream();

  if (!Hls.isSupported()) {
    log('unsupported', { reason: 'Hls.isSupported() === false' });
    return;
  }

  mainVideo.setAttribute('src', url);

  let api;
  try {
    api = await waitForApi(mainVideo);
  } catch (e) {
    log('error', { message: e.message });
    return;
  }
  hls = api;
  window.hls = hls;

  hls.on(Hls.Events.MANIFEST_PARSED, (_name, data) => {
    log('MANIFEST_PARSED', {
      levels: data.levels?.length,
      iframeVariants: hls.iframeVariants?.length || 0,
    });
    renderVariants(hls.iframeVariants || []);
  });

  hls.on(Hls.Events.ERROR, (_name, data) => {
    if (data.fatal) log('MAIN ERROR', { type: data.type, details: data.details, fatal: true });
  });

  hls.once(Hls.Events.INIT_PTS_FOUND, () => {
    log('INIT_PTS_FOUND', null);
    createIframePlayerIfNeeded();
  });

  try {
    localStorage.setItem(LS_KEY, url);
  } catch { /* ignore */ }

  const newQs = new URL(window.location.href);
  newQs.searchParams.set('src', url);
  window.history.replaceState(null, '', newQs.toString());
}

hoverPreview.addEventListener('frame-rendered', (e) => {
  log('preview frame', { currentTime: +e.detail.currentTime.toFixed(3) });
});

presetSelect.addEventListener('change', () => {
  const key = presetSelect.value;
  if (key === 'custom') {
    urlInput.focus();
    return;
  }
  const preset = PRESETS[key];
  if (preset) {
    urlInput.value = preset.url;
    loadStream(preset.url);
  }
});

loadBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (url) {
    presetSelect.value = matchPresetKey(url) || 'custom';
    loadStream(url);
  }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadBtn.click();
});

function matchPresetKey(url) {
  for (const [k, p] of Object.entries(PRESETS)) if (p.url === url) return k;
  return null;
}

function initialUrl() {
  const qs = new URL(window.location.href).searchParams.get('src');
  if (qs) return qs;
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  return PRESETS[DEFAULT_PRESET].url;
}

const startUrl = initialUrl();
urlInput.value = startUrl;
presetSelect.value = matchPresetKey(startUrl) || 'custom';
loadStream(startUrl);
