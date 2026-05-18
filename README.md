# `<media-preview-hls-iframe>`

A [Media Chrome](https://github.com/muxinc/media-chrome) preview-slot add-on that renders [hls.js](https://github.com/video-dev/hls.js) I-frame trick-play previews on `<media-time-range>` hover. No runtime dependencies.

```html
<media-time-range>
  <media-preview-hls-iframe slot="preview" id="hoverPreview"></media-preview-hls-iframe>
</media-time-range>
```

```js
hoverPreview.player = hls.createIFramePlayer();
```

The element observes Media Chrome's `mediapreviewtime` attribute and calls `player.loadMediaAt(t)` for each hover. The "player" is duck-typed against `{ attachMedia, startLoad, loadMediaAt }`, matching hls.js's `HlsIFramesOnly` — but anything with that surface works.

## Install

```bash
npm install @pbs/media-preview-hls-iframe
```

Then either side-effect import (most common — registers the custom element):

```js
import '@pbs/media-preview-hls-iframe';
```

Or named import if you want the class for subclassing / feature detection:

```js
import { MediaPreviewHlsIframe } from '@pbs/media-preview-hls-iframe';
```

## Usage

Drop it into Media Chrome's `<media-time-range>` preview slot. Pair it with your media element of choice — the example below uses [`<hls-video>`](https://github.com/muxinc/media-elements/tree/main/packages/hls-video-element):

```html
<script type="module">
  import 'hls-video-element';
  import 'media-chrome';
  import '@pbs/media-preview-hls-iframe';
</script>

<media-controller>
  <hls-video id="mainVideo" slot="media" src="…/master.m3u8" playsinline></hls-video>
  <media-control-bar>
    <media-play-button></media-play-button>
    <media-time-range>
      <media-preview-hls-iframe slot="preview" id="hoverPreview"></media-preview-hls-iframe>
      <media-preview-time-display slot="preview"></media-preview-time-display>
    </media-time-range>
    <media-time-display showduration></media-time-display>
  </media-control-bar>
</media-controller>
```

Once `<hls-video>`'s internal hls.js instance has an `HlsIFramesOnly` player available (typically after `Events.INIT_PTS_FOUND`), hand it over:

```js
const hlsVideo = document.getElementById('mainVideo');
const preview = document.getElementById('hoverPreview');

hlsVideo.api.once(Hls.Events.INIT_PTS_FOUND, () => {
  if (hlsVideo.api.iframeVariants?.length) {
    preview.player = hlsVideo.api.createIFramePlayer();
  }
});
```

After assignment, the component calls `attachMedia(internalVideo)` + `startLoad()` automatically and renders frames on every hover.

## Requirements

| | |
|---|---|
| **`hls.js`** (consumer-installed) | Version with the I-frame trick-play API: `hls.iframeVariants` + `hls.createIFramePlayer()` + `hlsIframesOnly.loadMediaAt()`. Currently this lives in [video-dev/hls.js#7757](https://github.com/video-dev/hls.js/pull/7757) on `master`; not yet in a published release. Once released, any version that exposes those methods works. |
| **`media-chrome`** (consumer-installed) | The component slots into `<media-time-range>` and reads its `mediapreviewtime` attribute. |
| **Stream content** | Must publish `#EXT-X-I-FRAME-STREAM-INF` variants in the master playlist (and `#EXT-X-I-FRAMES-ONLY` in each I-frame variant playlist). If absent, `hls.createIFramePlayer()` returns `null` and the preview popup stays empty. |
| **Browser** | Any browser with MSE + ES2022 (private class fields). All evergreen browsers. |

## API

### `<media-preview-hls-iframe>`

**Properties**

- `player` *(IFramePlayerLike \| null)* — Assign an object with `{ attachMedia(video), startLoad(), loadMediaAt(time), detachMedia?() }`. The component calls `attachMedia` + `startLoad` on assignment, `detachMedia` on reassignment / disconnect.

**Attributes**

- `mediapreviewtime` *(read-only, set by Media Chrome)* — Hover time in seconds. The component clamps negatives to 0 and forwards finite values to `player.loadMediaAt`.

**Events**

- `frame-rendered` — `CustomEvent<{ currentTime: number }>` fired each time the internal preview `<video>` emits `seeked`. Useful for observability/logging.

**Internal `<video>`** — Created in shadow DOM with `muted`, `playsinline`, `tabindex="-1"`, `aria-hidden="true"`, and `pointer-events: none`. Purely a render target.

## CSS

The component reads a few Media Chrome CSS custom properties so it sizes itself consistently with the default `<media-preview-thumbnail>`:

- `--media-preview-thumbnail-max-width` (default 240px) — the host width

Aspect ratio is locked at 16:9 internally. Override host CSS to customize:

```css
media-preview-hls-iframe {
  aspect-ratio: 4 / 3;
  width: 320px;
}
```

## VTT thumbnail fallback

This component does **not** ship a VTT thumbnail fallback. If you want classic sprite thumbnails when no I-frame variants exist, slot a `<media-preview-thumbnail>` alongside it inside `<media-time-range>` (and provide a `<track kind="metadata" label="thumbnails">` on your media element). Slotting any element into `slot="preview"` replaces Media Chrome's default thumbnail behavior, so you have to opt in to both explicitly.

## Demo

The `demo/` directory contains a minimal runnable example (single `<hls-video>` + `<media-controller>` + the component, ~25 lines of JS) showing the smallest end-to-end wiring against an Apple bipbop test stream.

A more involved diagnostics page (preset URL picker, `hls.iframeVariants` readout, event log) is preserved in `demo-out/` for reference.

Live demo (auto-deployed via the included GitHub Pages workflow): https://pbs.github.io/media-preview-hls-iframe/

## Repository layout

```
.
├── src/
│   ├── index.js                       # public entry (side-effect register)
│   ├── media-preview-hls-iframe.js    # the component
│   └── media-preview-hls-iframe.d.ts  # TypeScript declarations
├── demo/
│   ├── index.html
│   ├── main.js
│   ├── styles.css
│   └── vite.config.js                 # demo dev/build config
├── vendor/
│   └── hls.js/dist/hls.mjs            # temporary: hand-copied pending an upstream npm release with the I-frame API (see PR #7757)
├── vite.config.js                     # library build config
└── package.json
```

## Local development

```bash
npm install
npm run dev        # demo dev server at http://localhost:5173
```

The demo loads hls.js from [`vendor/hls.js/dist/hls.mjs`](./vendor/hls.js/dist/hls.mjs) via a Vite alias ([`demo/vite.config.js`](./demo/vite.config.js)). This is a temporary hand-copied build pending an upstream npm release that includes the I-frame trick-play API ([video-dev/hls.js#7757](https://github.com/video-dev/hls.js/pull/7757)); once that ships, the demo will switch to the published `hls.js` package and the vendor copy will be removed.

To build the library tarball for publishing:

```bash
npm run build      # → dist/media-preview-hls-iframe.{js,d.ts}
npm pack --dry-run # preview what will go on npm
```

To build the demo site for GitHub Pages:

```bash
npm run build:demo # → dist-demo/
```

## License

[MIT](./LICENSE) © PBS
