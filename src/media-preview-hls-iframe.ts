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
    video, img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: fill;
      pointer-events: none;
    }
    img { display: none; }
    :host([data-renderer="image"]) video { display: none; }
    :host([data-renderer="image"]) img { display: block; }
  </style>
  <video muted playsinline tabindex="-1" aria-hidden="true"></video>
  <img alt="" aria-hidden="true">
  <slot></slot>
`;

/**
 * Minimal duck-typed contract for the I-frame player the component manages.
 * Matches the surface exposed by hls.js's HlsIFramesOnly + HlsImageIFramesOnly.
 * Video players implement `attachMedia`; image (MJPG) players implement
 * `attachImage` instead.
 */
export interface IFramePlayerLike {
  attachMedia?(videoEl: HTMLVideoElement): void;
  attachImage?(imageEl: HTMLImageElement): void;
  loadMediaAt(time: number, options?: unknown): void;
  detachMedia?(): void;
  detachImage?(): void;
  destroy?(): void;
}

interface IFrameVariantLike {
  imageCodec?: string;
}

interface HlsLikeApi {
  once(event: string, handler: () => void): void;
  iframeVariants?: IFrameVariantLike[];
  createIFramePlayer(): IFramePlayerLike;
  createImageIFramePlayer?(): IFramePlayerLike | null;
}

interface HostVideoLike extends HTMLElement {
  api?: HlsLikeApi | null;
}

/**
 * Custom element that renders an hls.js I-frame trick-play preview inside a
 * Media Chrome `<media-time-range>` hover popup.
 *
 * The element finds its `<hls-video>` host automatically — the one inside the
 * nearest `<media-controller>` ancestor, or any element pointed to by
 * `for="<id>"`. When the host's hls.js instance fires `INIT_PTS_FOUND`, the
 * component creates an I-frame player and starts rendering frames on each
 * hover. If any iframe variant exposes an MJPG image codec, it uses
 * `createImageIFramePlayer()` and renders into an internal `<img>`;
 * otherwise it falls back to `createIFramePlayer()` and an internal `<video>`.
 * If the host's hls.js instance changes (src swap, element replacement) it
 * tears down and re-wires.
 *
 * The component observes Media Chrome's `mediapreviewtime` attribute and
 * calls `player.loadMediaAt(t)` for each hover.
 *
 * Events:
 * - `iframe-player-ready` — `CustomEvent<{ player }>` fired each time a new
 *   I-frame player is wired up. Useful for attaching diagnostic listeners.
 * - `frame-rendered` — `CustomEvent<{ currentTime }>` fired each time a new
 *   frame is composited (via `requestVideoFrameCallback` where available,
 *   falling back to `seeked`).
 */
export class MediaPreviewHlsIframe extends HTMLElement {
  static readonly observedAttributes = ['mediapreviewtime', 'for'] as const;

  #player: IFramePlayerLike | null = null;
  readonly #video: HTMLVideoElement;
  readonly #image: HTMLImageElement;
  #rvfcHandle: number | null = null;
  #lastLoadedTime = -Infinity;
  #pollHandle: number | null = null;
  #currentApi: HlsLikeApi | null = null;

  #emit = (currentTime: number): void => {
    this.dispatchEvent(
      new CustomEvent('frame-rendered', { detail: { currentTime } }),
    );
  };
  // Fires when a frame is actually composited; metadata.mediaTime is the exact
  // presented frame time. Re-scheduled each call to keep listening for the next.
  #onFrame: VideoFrameRequestCallback = (_now, metadata) => {
    this.#emit(metadata.mediaTime);
    if (this.isConnected) {
      this.#rvfcHandle = this.#video.requestVideoFrameCallback(this.#onFrame);
    }
  };
  // Fallback for browsers without requestVideoFrameCallback. Only fires when
  // currentTime actually changes — won't catch repaints on same I-frame, but
  // it's the best we can do without rVFC.
  #onSeeked = (): void => this.#emit(this.#video.currentTime);
  // For MJPG image I-frame players we don't have a presentation-time signal —
  // the closest analog is the time we asked the player to load.
  #onImageLoad = (): void => this.#emit(this.#lastLoadedTime);

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const root = this.shadowRoot!;
    root.innerHTML = TEMPLATE;
    this.#video = root.querySelector('video')!;
    this.#image = root.querySelector('img')!;
    if (typeof this.#video.requestVideoFrameCallback === 'function') {
      this.#rvfcHandle = this.#video.requestVideoFrameCallback(this.#onFrame);
    } else {
      this.#video.addEventListener('seeked', this.#onSeeked);
    }
    this.#image.addEventListener('load', this.#onImageLoad);
  }

  connectedCallback(): void {
    if (this.#pollHandle != null) return;
    this.#watch();
  }

  disconnectedCallback(): void {
    if (this.#pollHandle != null) {
      cancelAnimationFrame(this.#pollHandle);
      this.#pollHandle = null;
    }
    this.#currentApi = null;
    this.#detachPlayer();
    this.#video.removeEventListener('seeked', this.#onSeeked);
    this.#image.removeEventListener('load', this.#onImageLoad);
    if (this.#rvfcHandle != null && this.#video.cancelVideoFrameCallback) {
      this.#video.cancelVideoFrameCallback(this.#rvfcHandle);
      this.#rvfcHandle = null;
    }
  }

  /** The currently wired I-frame player, or null. Read-only. */
  get player(): IFramePlayerLike | null {
    return this.#player;
  }

  attributeChangedCallback(
    name: string,
    _oldVal: string | null,
    newVal: string | null,
  ): void {
    if (name === 'for') {
      this.#syncHostApi();
      return;
    }
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
  #watch(): void {
    const tick = (): void => {
      if (!this.isConnected) return;
      this.#syncHostApi();
      this.#pollHandle = requestAnimationFrame(tick);
    };
    tick();
  }

  // Wires (or rewires) the I-frame player when the host's hls.js instance
  // changes. Called every rAF by #watch and synchronously by `for` attribute
  // changes via attributeChangedCallback.
  #syncHostApi(): void {
    if (!this.isConnected) return;
    const api = this.#findHostVideo()?.api ?? null;
    if (api === this.#currentApi) return;
    this.#currentApi = api;
    this.#detachPlayer();
    if (!api) return;
    // 'hlsInitPtsFound' === Hls.Events.INIT_PTS_FOUND. Using the string
    // keeps this component free of a direct hls.js import.
    api.once('hlsInitPtsFound', () => {
      if (!this.isConnected || this.#currentApi !== api) return;
      const variants = api.iframeVariants;
      if (!variants?.length) return;
      // Prefer MJPG image I-frame variants when present: they're cheaper
      // to decode and avoid spinning up an MSE pipeline for previews.
      const hasImage = variants.some((v) => !!v?.imageCodec);
      if (hasImage && typeof api.createImageIFramePlayer === 'function') {
        const imagePlayer = api.createImageIFramePlayer();
        if (imagePlayer) {
          this.#installPlayer(imagePlayer, 'image');
          return;
        }
      }
      this.#installPlayer(api.createIFramePlayer(), 'video');
    });
  }

  #installPlayer(
    player: IFramePlayerLike | null,
    kind: 'video' | 'image',
  ): void {
    if (!player) return;
    this.#detachPlayer();
    this.#player = player;
    this.#lastLoadedTime = -Infinity;
    if (kind === 'image') {
      this.setAttribute('data-renderer', 'image');
    } else {
      this.removeAttribute('data-renderer');
    }
    // Fire before attach* so listeners can subscribe to MEDIA_ATTACHING etc.
    this.dispatchEvent(
      new CustomEvent('iframe-player-ready', { detail: { player } }),
    );
    if (kind === 'image') {
      player.attachImage?.(this.#image);
    } else {
      player.attachMedia?.(this.#video);
    }
  }

  #detachPlayer(): void {
    if (!this.#player) return;
    try { this.#player.destroy?.(); } catch { /* already torn down */ }
    this.#player = null;
    this.#lastLoadedTime = -Infinity;
    this.removeAttribute('data-renderer');
    // Drop the last decoded image so a re-attach starts from a clean slate.
    if (this.#image.src) {
      this.#image.removeAttribute('src');
    }
  }

  // Either an explicit `for="<id>"` attribute or the <hls-video> inside the
  // nearest <media-controller>.
  #findHostVideo(): HostVideoLike | null {
    const forId = this.getAttribute('for');
    if (forId) {
      const root = this.getRootNode();
      const fromRoot = 'getElementById' in root
        ? (root as Document | ShadowRoot).getElementById(forId)
        : null;
      return (fromRoot ?? document.getElementById(forId)) as HostVideoLike | null;
    }
    const controller = this.closest('media-controller');
    if (!controller) return null;
    return (controller.querySelector('hls-video') ??
      controller.querySelector('[slot="media"]')) as HostVideoLike | null;
  }
}

if (!customElements.get('media-preview-hls-iframe')) {
  customElements.define('media-preview-hls-iframe', MediaPreviewHlsIframe);
}

declare global {
  interface HTMLElementTagNameMap {
    'media-preview-hls-iframe': MediaPreviewHlsIframe;
  }

  interface HTMLElementEventMap {
    'frame-rendered': CustomEvent<{ currentTime: number }>;
    'iframe-player-ready': CustomEvent<{ player: IFramePlayerLike }>;
  }
}
