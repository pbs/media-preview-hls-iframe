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

/**
 * Custom element that renders an hls.js I-frame trick-play preview inside a
 * Media Chrome `<media-time-range>` hover popup.
 *
 * Usage:
 * ```html
 * <media-controller>
 *   <hls-video slot="media" src="…/master.m3u8" playsinline></hls-video>
 *   <media-control-bar>
 *     <media-time-range>
 *       <media-preview-hls-iframe slot="preview"></media-preview-hls-iframe>
 *     </media-time-range>
 *   </media-control-bar>
 * </media-controller>
 * ```
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
 *
 * Light-DOM children are slotted on top of the internal `<video>`. The host
 * is `position: relative`, so consumers can position overlays absolutely
 * (e.g. debug badges, watermarks, time indicators):
 * ```html
 * <media-preview-hls-iframe slot="preview">
 *   <div style="position: absolute; bottom: 4px; left: 4px;">I-frame: 1:23</div>
 * </media-preview-hls-iframe>
 * ```
 */
export class MediaPreviewHlsIframe extends HTMLElement {
  static readonly observedAttributes: readonly ['mediapreviewtime'];

  /** The currently wired I-frame player, or null. Read-only. */
  readonly player: IFramePlayerLike | null;

  attributeChangedCallback(
    name: 'mediapreviewtime',
    oldValue: string | null,
    newValue: string | null,
  ): void;

  connectedCallback(): void;
  disconnectedCallback(): void;
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
