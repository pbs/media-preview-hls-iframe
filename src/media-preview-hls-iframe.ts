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

/**
 * Minimal duck-typed contract for the I-frame player the component manages.
 * Matches the surface exposed by hls.js's HlsIFramesOnly (PR #7757).
 */
export interface IFramePlayerLike {
  attachMedia(videoEl: HTMLVideoElement): void;
  loadMediaAt(time: number, options?: unknown): void;
  detachMedia?(): void;
  destroy?(): void;
}

interface HlsLikeApi {
  once(event: string, handler: () => void): void;
  iframeVariants?: unknown[];
  createIFramePlayer(): IFramePlayerLike;
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
 * component creates an I-frame player, attaches it to its internal `<video>`,
 * and starts rendering frames on each hover. If the host's hls.js instance
 * changes (src swap, element replacement) it tears down and re-wires.
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
  static readonly observedAttributes = ['mediapreviewtime'] as const;

  #player: IFramePlayerLike | null = null;
  readonly #video: HTMLVideoElement;
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

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const root = this.shadowRoot!;
    root.innerHTML = TEMPLATE;
    this.#video = root.querySelector('video')!;
    if (typeof this.#video.requestVideoFrameCallback === 'function') {
      this.#rvfcHandle = this.#video.requestVideoFrameCallback(this.#onFrame);
    } else {
      this.#video.addEventListener('seeked', this.#onSeeked);
    }
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

  #installPlayer(player: IFramePlayerLike | null): void {
    if (!player) return;
    this.#detachPlayer();
    this.#player = player;
    this.#lastLoadedTime = -Infinity;
    // Fire before attachMedia so listeners can subscribe to MEDIA_ATTACHING etc.
    this.dispatchEvent(
      new CustomEvent('iframe-player-ready', { detail: { player } }),
    );
    player.attachMedia(this.#video);
  }

  #detachPlayer(): void {
    if (!this.#player) return;
    try { this.#player.destroy?.(); } catch { /* already torn down */ }
    this.#player = null;
    this.#lastLoadedTime = -Infinity;
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
