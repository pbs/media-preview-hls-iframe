# `<media-preview-hls-iframe>`

A [Media Chrome](https://github.com/muxinc/media-chrome) preview-slot add-on that renders [hls.js](https://github.com/video-dev/hls.js) I-frame trick-play previews on `<media-time-range>` hover. 

## Install

```bash
npm install media-preview-hls-iframe
```

## Usage

Drop it into Media Chrome's `<media-time-range>` preview slot. Pair it with [`<hls-video>`](https://github.com/muxinc/media-elements/tree/main/packages/hls-video-element):

```html
<script type="module">
  import 'hls-video-element';
  import 'media-chrome';
  import 'media-preview-hls-iframe';
</script>

<media-controller>
  <hls-video slot="media" src="…/master.m3u8" playsinline></hls-video>
  <media-control-bar>
    <media-play-button></media-play-button>
    <media-time-range>
      <media-preview-hls-iframe slot="preview"></media-preview-hls-iframe>
    </media-time-range>
  </media-control-bar>
</media-controller>
```

## Requirements

| | |
|---|---|
| **`hls.js`** (consumer-installed) | Version with the I-frame trick-play API: `hls.iframeVariants` + `hls.createIFramePlayer()` + `hlsIframesOnly.loadMediaAt()`. Currently this lives in [video-dev/hls.js#7757](https://github.com/video-dev/hls.js/pull/7757) on `master`; not yet in a published release. Once released, any version that exposes those methods works. |
| **`media-chrome`** (consumer-installed) | The component slots into `<media-time-range>` and reads its `mediapreviewtime` attribute. |
| **Host video element** | An `<hls-video>` (or anything that exposes its hls.js instance as `.api`) inside the same `<media-controller>`, or addressed by `for="<id>"`. |
| **Stream content** | Must publish `#EXT-X-I-FRAME-STREAM-INF` variants in the master playlist (and `#EXT-X-I-FRAMES-ONLY` in each I-frame variant playlist). If absent, no preview is created and the popup stays empty. |
| **Browser** | Any browser with MSE + ES2022 (private class fields). All evergreen browsers. |

## API

### `<media-preview-hls-iframe>`

**Attributes**

- `for` *(optional)* — id of the host element to bind to. Defaults to the `<hls-video>` inside the nearest `<media-controller>` ancestor.

**Properties**

- `player` *(read-only)* — the currently wired I-frame player, or `null`. Provided for inspection; the component owns its lifecycle.

**Events**

- `iframe-player-ready` — `CustomEvent<{ player }>` fired each time a new I-frame player is wired up (initial mount + each stream switch). Fired *before* `attachMedia`, so listeners can subscribe to early events like `MEDIA_ATTACHING`.
- `frame-rendered` — `CustomEvent<{ currentTime }>` fired each time a new frame is composited. Useful for observability/logging.

**Internal render target** — Created in shadow DOM with `aria-hidden="true"` and `pointer-events: none`. When the manifest exposes an MJPG-coded I-frame variant (image codec on `iframeVariants`), the component uses `hls.createImageIFramePlayer()` and renders into an `<img>`; otherwise it uses `hls.createIFramePlayer()` and renders into a `<video muted playsinline tabindex="-1">`. The host element gets a `data-renderer="image"` attribute while the image path is active.

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

The `demo/` directory has three pages:

- `index.html` — minimal end-to-end example: one `<hls-video>` + one `<media-controller>` + the component.
- `advanced.html` — preset URL picker, `hls.iframeVariants` readout, event log, custom rendition menu with codec.
- `vanilla-hlsjs.html` — bare hls.js test harness (no Media Chrome, no component) for reproducing trick-play API behavior directly.

## Local development

```bash
npm install
npm run dev        # demo dev server at http://localhost:5173
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end tests (playwright)
npm run build      # publishable ESM artifact in dist/
```

The demo (`demo/index.html` and `demo/advanced.html`) is intentionally wired to fetch the *published* `media-preview-hls-iframe` from jsDelivr via its importmap, so it reflects what consumers actually see. Vite is configured to externalize the package — local changes to `src/` won't appear in the demo until they're published. For in-progress component work, drive the component through the unit / e2e tests rather than the demo.

A single [vite.config.js](./vite.config.js) handles both jobs — the library build (`vite build --mode library` → `dist/`) and the demo build (`vite build` → `dist-demo/`).

The demo pins hls.js to `@canary` ([package.json](./package.json)) so it tracks the bleeding-edge build that contains the unreleased I-frame trick-play API ([video-dev/hls.js#7757](https://github.com/video-dev/hls.js/pull/7757)). Once that API ships in a stable release, the pin can be relaxed to a normal version range.

To preview what publishing produces:

```bash
npm pack --dry-run
```

## License

[MIT](./LICENSE) © PBS
