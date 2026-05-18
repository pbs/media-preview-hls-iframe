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

  get player() {
    return this.#player;
  }

  set player(p) {
    if (this.#player === p) return;
    if (this.#player) {
      try { this.#player.detachMedia?.(); } catch { /* destroyed or no-op */ }
    }
    this.#player = p;
    if (!p) return;
    p.attachMedia(this.#video);
    p.startLoad();
    try { p.loadMediaAt(0); } catch { /* player not ready; first hover will work */ }
  }

  attributeChangedCallback(name, _oldVal, newVal) {
    if (name !== 'mediapreviewtime' || !this.#player || newVal == null) return;
    const t = parseFloat(newVal);
    if (!Number.isFinite(t)) return;
    this.#player.loadMediaAt(Math.max(0, t));
  }

  disconnectedCallback() {
    this.#video?.removeEventListener('seeked', this.#onSeeked);
    if (this.#rvfcHandle != null && this.#video?.cancelVideoFrameCallback) {
      this.#video.cancelVideoFrameCallback(this.#rvfcHandle);
      this.#rvfcHandle = null;
    }
    if (this.#player) {
      try { this.#player.detachMedia?.(); } catch { /* ignore */ }
      this.#player = null;
    }
  }
}

if (!customElements.get('media-preview-hls-iframe')) {
  customElements.define('media-preview-hls-iframe', MediaPreviewHlsIframe);
}

export { MediaPreviewHlsIframe };
