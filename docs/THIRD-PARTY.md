# Third-party components in the desktop build

The macOS app bundles two runtimes under `Contents/Resources/engine/`:

- **Node.js** (the exact `node` binary used at build time). MIT-style license;
  see https://nodejs.org/en/about/resources and the `LICENSE` file in the
  Node.js distribution.
- **ffmpeg 6.0** static build for macOS arm64 from the `ffmpeg-static`
  project (release `b6.1.1`, https://github.com/eugeneware/ffmpeg-static),
  fetched and checksum-pinned by `scripts/fetch-ffmpeg.mjs`. FFmpeg is
  licensed under the GNU General Public License v3 (the static build
  includes libx264/libmp3lame). Corresponding source is available from the
  FFmpeg project (https://ffmpeg.org/download.html) and the ffmpeg-static
  release page. This matters only if you redistribute the app; for personal
  use on your own Mac nothing further is required.

The app icon (`apps/desktop/src-tauri/icons/source.svg`) is built from the
Lucide "aperture" glyph (ISC license, lucide-react 0.511.0), recolored to the
Q Studio safelight-amber palette. The same glyph is used in the UI itself.

Everything else in the app is this repository's own code plus its npm and
crates dependencies, each under their respective licenses.
