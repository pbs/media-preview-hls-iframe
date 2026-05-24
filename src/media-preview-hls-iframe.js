const TEMPLATE = `
  <style>
    :host {
      display: block;
      aspect-ratio: 16 / 9;
      width: var(--media-preview-thumbnail-max-width, 240px);
      max-width: 100%;
      background: #000;
      overflow: hidden;
      position: relative;
    }
    video {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: fill;
      pointer-events: none;
    }
  </style>
  <video muted playsinline tabindex="-1" aria-hidden="true"></video>
  <slot></slot>
`;

class MediaPreviewHlsIframe extends HTMLElement {
  static get observedAttributes() {
    return ['mediapreviewtime'];
  }

  #player = null;
  #video = null;
  #rvfcHandle = null;
  #lastLoadedTime = -Infinity;
  #pollHandle = null;
  #currentApi = null;

  #emit = (currentTime) => {
    this.dispatchEvent(
      new CustomEvent('frame-rendered', { detail: { currentTime } }),
    );
  };
  // Fires when a frame is actually composited; metadata.mediaTime is the exact
  // presented frame time. Re-scheduled each call to keep listening for the next.
  #onFrame = (_now, metadata) => {
    this.#emit(metadata.mediaTime);
    if (this.isConnected) {
      this.#rvfcHandle = this.#video.requestVideoFrameCallback(this.#onFrame);
    }
  };
  // Fallback for browsers without requestVideoFrameCallback. Only fires when
  // currentTime actually changes — won't catch repaints on same I-frame, but
  // it's the best we can do without rVFC.
  #onSeeked = () => this.#emit(this.#video.currentTime);

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = TEMPLATE;
    this.#video = this.shadowRoot.querySelector('video');
    if (typeof this.#video.requestVideoFrameCallback === 'function') {
      this.#rvfcHandle = this.#video.requestVideoFrameCallback(this.#onFrame);
    } else {
      this.#video.addEventListener('seeked', this.#onSeeked);
    }
  }

  connectedCallback() {
    if (this.#pollHandle != null) return;
    this.#watch();
  }

  disconnectedCallback() {
    if (this.#pollHandle != null) {
      cancelAnimationFrame(this.#pollHandle);
      this.#pollHandle = null;
    }
    this.#currentApi = null;
    this.#detachPlayer();
    this.#video?.removeEventListener('seeked', this.#onSeeked);
    if (this.#rvfcHandle != null && this.#video?.cancelVideoFrameCallback) {
      this.#video.cancelVideoFrameCallback(this.#rvfcHandle);
      this.#rvfcHandle = null;
    }
  }

  get player() {
    return this.#player;
  }

  attributeChangedCallback(name, _oldVal, newVal) {
    if (name !== 'mediapreviewtime' || !this.#player || newVal == null) return;
    const t = parseFloat(newVal);
    if (!Number.isFinite(t) || t < 0) return;
    // Dedupe: skip if the new time is essentially the previous one. Multiple
    // mousemove events at the same pixel produce the same media time, and any
    // seek smaller than ~0.1s rounds to the same I-frame anyway.
    if (Math.abs(t - this.#lastLoadedTime) < 0.1) return;
    this.#lastLoadedTime = t;
    this.#player.loadMediaAt(t);
  }

  // Watch the host hls-video for changes to its hls.js instance. Every time a
  // new instance appears (initial mount, src swap, element replacement) we
  // tear down any existing I-frame player and wait for the new instance's
  // INIT_PTS_FOUND to install a fresh one. rAF-paced because the listener
  // must be attached before INIT_PTS_FOUND fires — manifest parsing can
  // complete in well under 100ms.
  #watch() {
    const tick = () => {
      if (!this.isConnected) return;
      const api = this.#findHostVideo()?.api ?? null;
      if (api !== this.#currentApi) {
        this.#currentApi = api;
        this.#detachPlayer();
        if (api) {
          // 'hlsInitPtsFound' === Hls.Events.INIT_PTS_FOUND. Using the string
          // keeps this component free of a direct hls.js import.
          api.once('hlsInitPtsFound', () => {
            if (!this.isConnected || this.#currentApi !== api) return;
            if (api.iframeVariants?.length) {
              this.#installPlayer(api.createIFramePlayer());
            }
          });
        }
      }
      this.#pollHandle = requestAnimationFrame(tick);
    };
    tick();
  }

  #installPlayer(player) {
    if (!player) return;
    this.#detachPlayer();
    this.#player = player;
    this.#lastLoadedTime = -Infinity;
    // Fire before attachMedia so listeners can subscribe to MEDIA_ATTACHING etc.
    this.dispatchEvent(new CustomEvent('iframe-player-ready', { detail: { player } }));
    player.attachMedia(this.#video);
  }

  #detachPlayer() {
    if (!this.#player) return;
    try { this.#player.destroy?.(); } catch { /* already torn down */ }
    this.#player = null;
    this.#lastLoadedTime = -Infinity;
  }

  // Either an explicit `for="<id>"` attribute or the <hls-video> inside the
  // nearest <media-controller>.
  #findHostVideo() {
    const forId = this.getAttribute('for');
    if (forId) {
      const root = this.getRootNode();
      return (root.getElementById && root.getElementById(forId)) ||
        document.getElementById(forId) || null;
    }
    const controller = this.closest('media-controller');
    if (!controller) return null;
    return controller.querySelector('hls-video') ||
      controller.querySelector('[slot="media"]');
  }
}

if (!customElements.get('media-preview-hls-iframe')) {
  customElements.define('media-preview-hls-iframe', MediaPreviewHlsIframe);
}

export { MediaPreviewHlsIframe };
