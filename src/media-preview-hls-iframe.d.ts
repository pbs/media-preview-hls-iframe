/**
 * Minimal duck-typed contract for the player passed to MediaPreviewHlsIframe.
 * Matches the surface exposed by hls.js's HlsIFramesOnly (PR #7757).
 */
export interface IFramePlayerLike {
  attachMedia(videoEl: HTMLVideoElement): void;
  startLoad(): void;
  loadMediaAt(time: number, options?: unknown): void;
  detachMedia?(): void;
}

/**
 * Custom element that renders an hls.js I-frame trick-play preview inside a
 * Media Chrome `<media-time-range>` hover popup.
 *
 * Usage:
 * ```html
 * <media-time-range>
 *   <media-preview-hls-iframe slot="preview" id="hoverPreview"></media-preview-hls-iframe>
 * </media-time-range>
 * ```
 *
 * Then, once an `HlsIFramesOnly`-like player is available:
 * ```js
 * document.getElementById('hoverPreview').player = hls.createIFramePlayer();
 * ```
 *
 * The component observes Media Chrome's `mediapreviewtime` attribute and calls
 * `player.loadMediaAt(t)` for each hover. Emits a `frame-rendered` CustomEvent
 * each time a new frame is actually presented — via
 * `requestVideoFrameCallback` where available (Chrome/Edge/Safari, Firefox
 * 132+), falling back to the internal `<video>`'s `seeked` event.
 *
 * Light-DOM children are slotted on top of the internal `<video>`. The host is
 * `position: relative`, so consumers can position overlays absolutely (e.g.
 * debug badges, watermarks, time indicators):
 * ```html
 * <media-preview-hls-iframe slot="preview">
 *   <div style="position: absolute; bottom: 4px; left: 4px;">I-frame: 1:23</div>
 * </media-preview-hls-iframe>
 * ```
 */
export class MediaPreviewHlsIframe extends HTMLElement {
  static readonly observedAttributes: readonly ['mediapreviewtime'];

  /** The assigned I-frame player, or null if none is set. */
  player: IFramePlayerLike | null;

  attributeChangedCallback(
    name: 'mediapreviewtime',
    oldValue: string | null,
    newValue: string | null,
  ): void;

  disconnectedCallback(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'media-preview-hls-iframe': MediaPreviewHlsIframe;
  }

  interface HTMLElementEventMap {
    'frame-rendered': CustomEvent<{ currentTime: number }>;
  }
}
