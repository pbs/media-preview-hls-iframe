import 'hls-video-element';
import 'media-chrome';
import 'media-chrome/menu';
import { MediaRenditionMenu } from 'media-chrome/menu';
import 'media-preview-hls-iframe';
import Hls from 'hls.js';

document.getElementById('hlsVersion').textContent = `v${Hls.version}`;

function friendlyCodec(codec) {
  if (!codec) return '???';
  for (const part of codec.split(',').map(s => s.trim().toLowerCase())) {
    if (part.startsWith('avc1') || part.startsWith('avc3')) return 'AVC';
    if (part.startsWith('hvc1') || part.startsWith('hev1')) return 'HEVC';
    if (part.startsWith('vp09') || part === 'vp9')          return 'VP9';
    if (part.startsWith('av01') || part === 'av1')          return 'AV1';
  }
  return '???';
}

class MediaRenditionCodecMenu extends MediaRenditionMenu {
  static formatRendition(rendition, opts = {}) {
    const base = super.formatRendition(rendition, { ...opts, showBitrate: false });
    return `${base} · ${friendlyCodec(rendition.codec)}`;
  }

  #activeCodec = '';

  get activeCodec() { return this.#activeCodec; }

  // In auto mode, media-chrome's MediaRenditionMenu doesn't know which
  // rendition is actually playing (see the TODO in its source), so the Auto
  // label is just "Auto". We expose this setter so the page can plug in the
  // codec from hls.js LEVEL_SWITCHED, and force a re-render past the parent's
  // prevState gate by round-tripping the rendition list through the setter.
  set activeCodec(codec) {
    if (codec === this.#activeCodec) return;
    this.#activeCodec = codec;
    const list = this.mediaRenditionList;
    this.mediaRenditionList = [];
    this.mediaRenditionList = list;
  }

  formatMenuItemText(text, rendition) {
    const isAuto = !this.mediaRenditionSelected;
    if (isAuto && !rendition && this.#activeCodec && text.startsWith('Auto')) {
      // Parent builds either "Auto (1080p)" or just "Auto"; inject the codec
      // inside the parens, or add a fresh pair when there are none.
      const withCodec = text.endsWith(')')
        ? text.replace(/\)$/, ` ·  ${this.#activeCodec})`)
        : `${text} (${this.#activeCodec})`;
      return super.formatMenuItemText(withCodec, rendition);
    }
    return super.formatMenuItemText(text, rendition);
  }
}

if (!customElements.get('media-rendition-codec-menu')) {
  customElements.define('media-rendition-codec-menu', MediaRenditionCodecMenu);
}

const PRESETS = {
  'pbs-test-pattern':
    'https://pbs.github.io/test-streams/pbs/test-pattern/pbs-bars_hevc-avc.m3u8',
  'bbb-iframes':
    'https://pbs.github.io/test-streams/test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'apple-bipbop-hevc':
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/master.m3u8?88001',
  'apple-adv-dv-atmos':
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8',
};
const DEFAULT_PRESET = 'pbs-test-pattern';

const $ = (id) => document.getElementById(id);
const preview = $('preview');
const iframeTimeBadge = $('iframeTimeBadge');
const presetSelect = $('presetSelect');
const urlInput = $('urlInput');
const loadForm = $('loadForm');
const variantsBody = $('variantsBody');
const iframePlayerStatus = $('iframePlayerStatus');
const eventLog = $('eventLog');
const clearLogBtn = $('clearLogBtn');
const renditionMenu = $('renditionMenu');

const LOG_MAX = 200;

function tsNow() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function log(label, data, kind = '') {
  const li = document.createElement('li');
  const t = document.createElement('span');
  t.className = 'ts';
  t.textContent = tsNow();
  const tag = document.createElement('span');
  tag.className = `tag${kind ? ' ' + kind : ''}`;
  tag.textContent = label;
  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = data == null ? '' : (typeof data === 'string' ? data : JSON.stringify(data));
  li.append(t, tag, body);
  eventLog.prepend(li);
  while (eventLog.children.length > LOG_MAX) eventLog.removeChild(eventLog.lastChild);
}

function shortenUrl(u) {
  try { return new URL(u).pathname.split('/').pop() || u; } catch { return u; }
}

function renderVariants(variants) {
  variantsBody.innerHTML = '';
  if (!variants?.length) {
    const tr = document.createElement('tr');
    tr.className = 'muted';
    tr.innerHTML = '<td colspan="4">no I-frame variants</td>';
    variantsBody.appendChild(tr);
    return;
  }
  variants.forEach((v, i) => {
    const tr = document.createElement('tr');
    const codec = (v.imageCodec || v.videoCodec || v.codecSet || v.codecs || '').slice(0, 4);
    const bitrate = v.bitrate ? `${Math.round(v.bitrate / 1000)} kbps` : '—';
    const res = v.width && v.height ? `${v.width}×${v.height}` : '—';
    // Stash the variant URL so we can find this row when the preview player
    // picks a level. The iframe instance constructs Level objects from these
    // LevelParsed entries and stores `[data.url]` on `Level.url`, so URL is
    // a stable join key — bitrate+resolution isn't, because hls.js merges
    // codec-paired variants (e.g. AVC+HEVC at the same resolution) into a
    // single Level with multiple URLs, and image players use a filtered
    // subset of variants so indices don't line up either.
    if (v.url) tr.dataset.url = v.url;
    tr.dataset.index = String(i);
    tr.innerHTML = `<td>${i}</td><td>${res}</td><td>${bitrate}</td><td>${codec || '—'}</td>`;
    variantsBody.appendChild(tr);
  });
}

// Toggles the bold row in the variants table and returns the matched row
// (or null), so callers can derive the variant index for the status line.
function highlightActiveVariant(player) {
  const rows = variantsBody.querySelectorAll('tr[data-url]');
  const level = player?.levels?.[player.currentLevel];
  const levelUrls = level?.url || (level?.uri ? [level.uri] : []);
  let activeRow = null;
  rows.forEach((tr) => {
    const matches = levelUrls.includes(tr.dataset.url);
    tr.classList.toggle('active', matches);
    if (matches) activeRow = tr;
  });
  return activeRow;
}

// Status line for the I-frame variants panel. Prefers the variant # from the
// table (i.e. the index in hls.iframeVariants on the main player) over the
// iframe instance's internal level index, since those don't agree for
// codec-paired manifests or image (MJPG) players.
function formatPlayerStatus(player, isImage) {
  const activeRow = highlightActiveVariant(player);
  const level = player?.levels?.[player.currentLevel];
  const dims = level
    ? `${level.width || '?'}×${level.height || '?'}`
    : '';
  const prefix = isImage ? 'image ' : '';
  if (activeRow) {
    return `${prefix}variant ${activeRow.dataset.index}${dims ? `: ${dims}` : ''}`;
  }
  if (level) return `${prefix}level ${player.currentLevel}: ${dims}`;
  return `${prefix}(no level yet)`;
}

function setIframePlayerStatus(text) {
  iframePlayerStatus.textContent = text;
}

function attachIframePlayerLoggers(player) {
  player.on(Hls.Events.LEVEL_LOADED, (_, d) =>
    log('LEVEL_LOADED', { level: d.level, live: d.details?.live, frags: d.details?.fragments?.length }));
  player.on(Hls.Events.LEVEL_SWITCHED, (_, d) => {
    log('LEVEL_SWITCHED', { level: d.level });
    const isImage = typeof player.attachImage === 'function';
    setIframePlayerStatus(formatPlayerStatus(player, isImage));
  });
  player.on(Hls.Events.FRAG_BUFFERED, (_, d) =>
    log('FRAG_BUFFERED', { sn: d.frag?.sn, start: +d.frag?.start?.toFixed?.(2), file: shortenUrl(d.frag?.url) }));
  player.on(Hls.Events.ERROR, (_, d) =>
    log('ERROR (iframe)', { type: d.type, details: d.details, fatal: d.fatal }, 'err'));
}

clearLogBtn.addEventListener('click', () => {
  eventLog.innerHTML = '';
});

function presetKeyForUrl(url) {
  for (const [k, v] of Object.entries(PRESETS)) if (v === url) return k;
  return 'custom';
}

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
  // hls-video-element merges `.config` into the hls.js constructor; it reads
  // the value lazily inside `load()`, which is triggered by setting `src`,
  // so set config BEFORE src. capLevelToPlayerSize keeps ABR from picking
  // 4K renditions for a ~1100px-wide player (the adv_dv_atmos stream has
  // 4K HEVC variants that would otherwise saturate the network and starve
  // the I-frame playlist fetch behind them). ignoreDevicePixelRatio is
  // required too: without it hls.js multiplies the CSS player size by the
  // display's DPR (often 2 or 3), so a 1150px player gets treated as
  // 2300–3450 effective pixels and the cap is effectively a no-op.
  v.config = {
    capLevelToPlayerSize: true,
    ignoreDevicePixelRatio: true,
  };
  v.setAttribute('src', url);
  oldVideo.replaceWith(v);
  return v;
}

async function load(url) {
  if (!url) return;

  iframeTimeBadge.textContent = '';
  renditionMenu.activeCodec = '';
  setIframePlayerStatus('(waiting for manifest…)');
  variantsBody.innerHTML = '<tr class="muted"><td colspan="4">waiting for manifest…</td></tr>';
  log('load', { url });

  const video = freshVideoElement(url);

  let hls;
  try {
    hls = await whenApiReady(video);
  } catch (e) {
    log('error', { message: e.message }, 'err');
    return;
  }

  hls.once(Hls.Events.MANIFEST_PARSED, (_, data) => {
    hls.subtitleTrack = -1;
    const variants = hls.iframeVariants || [];
    renderVariants(variants);
    log('MANIFEST_PARSED', { levels: data.levels?.length, iframeVariants: variants.length });
    if (!variants.length) setIframePlayerStatus('(no I-frame variants)');
    // Workaround for a CapLevelController race: its ResizeObserver fires on
    // initial observe (set up during attachMedia) BEFORE the master playlist
    // is parsed, so detectPlayerSize bails on `levels.length > 1`. When
    // MANIFEST_PARSED finally arrives, startCapping bails because the
    // observer is already set, and detectPlayerSize never runs again until
    // the player is resized. Re-trigger it manually now that levels exist.
    hls.capLevelController?.detectPlayerSize?.();
  });

  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) {
      log('ERROR (main)', { type: data.type, details: data.details, fatal: true }, 'err');
    }
  });

  hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => {
    const level = hls.levels?.[d.level];
    renditionMenu.activeCodec = friendlyCodec(level?.videoCodec || level?.codecSet);
  });

  hls.once(Hls.Events.INIT_PTS_FOUND, () => log('INIT_PTS_FOUND'));
}

// <media-preview-hls-iframe> owns the I-frame player lifecycle: it creates a
// new player whenever the host hls-video's hls.js instance changes, and
// destroys the old one. We only attach diagnostic loggers each time.
preview.addEventListener('iframe-player-ready', (e) => {
  const player = e.detail.player;
  // attachImage is only present on HlsImageIFramesOnly (MJPG image I-frames).
  const isImage = typeof player.attachImage === 'function';
  log(isImage ? 'createImageIFramePlayer' : 'createIFramePlayer', { level: player.currentLevel });
  attachIframePlayerLoggers(player);
  setIframePlayerStatus(formatPlayerStatus(player, isImage));
});

// frame-rendered fires on every internal preview <video> 'seeked', so this
// always reflects the time of the I-frame actually decoded for the popup —
// which may lag the hover time when no I-frame exists at that exact second.
preview.addEventListener('frame-rendered', (e) => {
  const ct = e.detail.currentTime;
  iframeTimeBadge.textContent = formatTime(ct);
  log('frame-rendered', { ct: +ct.toFixed(3) }, 'preview');
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
