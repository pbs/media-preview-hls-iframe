import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPreviewHlsIframe } from './media-preview-hls-iframe';

// Minimal hls.js stand-in. Only the surface the component reads is implemented:
// `iframeVariants`, `createIFramePlayer`, `createImageIFramePlayer`, and a
// `once` that captures the INIT_PTS_FOUND handler so each test can trigger it
// synchronously. Players record their attach calls so we can assert which
// render path was wired up.
function makeFakeApi(opts: {
  iframeVariants: Array<{ imageCodec?: string; videoCodec?: string }>;
  hasImageFactory?: boolean;
}) {
  const events: Record<string, Array<() => void>> = {};
  const videoPlayer = {
    attachMedia: vi.fn(),
    loadMediaAt: vi.fn(),
    destroy: vi.fn(),
  };
  const imagePlayer = {
    attachImage: vi.fn(),
    loadMediaAt: vi.fn(),
    destroy: vi.fn(),
  };
  const api = {
    iframeVariants: opts.iframeVariants,
    once(event: string, handler: () => void) {
      (events[event] ||= []).push(handler);
    },
    createIFramePlayer: vi.fn(() => videoPlayer),
    ...(opts.hasImageFactory
      ? { createImageIFramePlayer: vi.fn(() => imagePlayer) }
      : {}),
    // Test helper, not part of the duck-typed contract.
    _fire(event: string) {
      (events[event] || []).forEach((h) => h());
    },
  };
  return { api, videoPlayer, imagePlayer };
}

// `<media-controller>` is opaque to the component — it just walks closest()
// looking for it and then queries for an hls-video. We mock both as plain
// HTMLElements so we don't need to load media-chrome or hls-video-element.
// We construct the preview via `new` rather than `document.createElement` to
// avoid relying on happy-dom's upgrade timing for tag-name-based lookups.
function mount(api: unknown) {
  const controller = document.createElement('media-controller');
  const hostVideo = document.createElement('hls-video') as HTMLElement & {
    api?: unknown;
  };
  hostVideo.api = api;
  controller.appendChild(hostVideo);
  const preview = new MediaPreviewHlsIframe();
  controller.appendChild(preview);
  document.body.appendChild(controller);
  return { controller, hostVideo, preview };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<media-preview-hls-iframe> MJPG/image I-frame support', () => {
  it('prefers createImageIFramePlayer and attaches to <img> when an MJPG iframe variant is present', () => {
    const { api, videoPlayer, imagePlayer } = makeFakeApi({
      iframeVariants: [
        { videoCodec: 'avc1.64001f' },
        { imageCodec: 'mjpg' },
      ],
      hasImageFactory: true,
    });
    const { preview } = mount(api);

    api._fire('hlsInitPtsFound');

    expect(api.createImageIFramePlayer).toHaveBeenCalledTimes(1);
    expect(api.createIFramePlayer).not.toHaveBeenCalled();
    expect(imagePlayer.attachImage).toHaveBeenCalledTimes(1);
    expect(videoPlayer.attachMedia).not.toHaveBeenCalled();

    const img = imagePlayer.attachImage.mock.calls[0]![0] as HTMLElement;
    expect(img.tagName).toBe('IMG');
    expect(preview.getAttribute('data-renderer')).toBe('image');
    expect(preview.player).toBe(imagePlayer);
  });

  it('falls back to createIFramePlayer and attaches to <video> when only video iframe variants exist', () => {
    const { api, videoPlayer, imagePlayer } = makeFakeApi({
      iframeVariants: [{ videoCodec: 'avc1.64001f' }],
      hasImageFactory: true,
    });
    const { preview } = mount(api);

    api._fire('hlsInitPtsFound');

    expect(api.createIFramePlayer).toHaveBeenCalledTimes(1);
    expect(api.createImageIFramePlayer).not.toHaveBeenCalled();
    expect(videoPlayer.attachMedia).toHaveBeenCalledTimes(1);
    expect(imagePlayer.attachImage).not.toHaveBeenCalled();

    const video = videoPlayer.attachMedia.mock.calls[0]![0] as HTMLElement;
    expect(video.tagName).toBe('VIDEO');
    expect(preview.hasAttribute('data-renderer')).toBe(false);
  });

  it('forwards mediapreviewtime hover to player.loadMediaAt on the image path', () => {
    const { api, imagePlayer } = makeFakeApi({
      iframeVariants: [{ imageCodec: 'mjpg' }],
      hasImageFactory: true,
    });
    const { preview } = mount(api);

    api._fire('hlsInitPtsFound');

    preview.setAttribute('mediapreviewtime', '12.5');
    expect(imagePlayer.loadMediaAt).toHaveBeenCalledWith(12.5);

    // Dedupe: a near-identical time within 0.1s should not re-trigger.
    preview.setAttribute('mediapreviewtime', '12.55');
    expect(imagePlayer.loadMediaAt).toHaveBeenCalledTimes(1);

    preview.setAttribute('mediapreviewtime', '20');
    expect(imagePlayer.loadMediaAt).toHaveBeenCalledTimes(2);
    expect(imagePlayer.loadMediaAt).toHaveBeenLastCalledWith(20);
  });

  it('falls back to createIFramePlayer when an MJPG variant exists but the hls.js build predates createImageIFramePlayer', () => {
    const { api, videoPlayer } = makeFakeApi({
      iframeVariants: [{ imageCodec: 'mjpg' }],
      hasImageFactory: false,
    });
    const { preview } = mount(api);

    api._fire('hlsInitPtsFound');

    expect(api.createIFramePlayer).toHaveBeenCalledTimes(1);
    expect(videoPlayer.attachMedia).toHaveBeenCalledTimes(1);
    expect(preview.hasAttribute('data-renderer')).toBe(false);
  });
});
