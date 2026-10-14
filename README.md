# Frame Note

A local-first presentation and review tool for wildlife photographers.

Open a folder of camera RAW files, see the original camera data, caption each photograph, present fullscreen with a
clean metadata overlay, and hand the whole assignment to someone else as one `.framenote` file. They open it on a Mac,
a Windows PC, or in the browser on an Android phone, iPhone or iPad, with no install and no account.

- **Desktop app** for macOS and Windows (Tauri 2 + Rust): RAW import (NEF, CR2, CR3, ARW, plus JPEG/TIFF/PNG), ExifTool
  metadata, fast previews, fullscreen presentation, image and bundle export.
- **Web app / PWA** for phones and tablets: open `.framenote` files, open RAW and JPEG files from the device, edit
  captions, present with touch gestures, and export. Works offline after the first visit.
- **Nothing leaves your device.** No accounts, uploads, analytics or AI services.

## What works today

| | Desktop | Phone / browser |
|---|---|---|
| Create, rename, delete assignments | ✓ | ✓ |
| Add RAW files (NEF, CR2, CR3, ARW) | ✓ embedded full-size preview + ExifTool metadata | ✓ embedded preview; metadata via exifr (not CR3) |
| Add JPEG / PNG | ✓ | ✓ |
| Add TIFF | ✓ | Safari only |
| Add a whole folder | ✓ | — |
| Captions, species, location, assignment notes | ✓ | ✓ |
| Review comments (anyone, optional name) | ✓ | ✓ |
| Drag or keyboard reordering | ✓ | ✓ (long-press drag, or arrow buttons) |
| Fullscreen presentation, overlay, "Show on photo" picker | ✓ | ✓ (iPhone: no Fullscreen API, chrome is hidden instead) |
| Export image with overlay (JPEG/PNG) | ✓ | ✓ (downscaled to the 16 MP canvas limit on phones) |
| Export / import `.framenote` | ✓ | ✓ (share sheet on phones) |

**Not yet:** full RAW decoding for files with no usable embedded preview, HEIC, video, and automatic phone ↔ desktop
sync (sync is by hand with `.framenote` files; see `docs/SYNC.md`).

RAW files are shown from the camera's embedded JPEG preview. On the tested cameras that preview is full resolution,
but its colour follows the camera's JPEG settings, not a RAW development. The app says so wherever it matters.

## Repository layout

```
packages/core     Format, schema, validation, ZIP pack/unpack, metadata formatting, overlay layout, RAW preview scanner
packages/ui       React screens and components (library, editor, presentation), Platform interface
apps/web          Vite PWA + IndexedDB platform adapter, in-browser image pipeline
apps/desktop      Tauri 2 app; src-tauri/ is the Rust backend (ExifTool, import pipeline, storage)
docs/             FORMAT, DECISIONS, TESTING, LICENSES, SYNC, original SPEC, JSON Schema
scripts/          fetch-exiftool.mjs (downloads and verifies ExifTool for bundling)
```

## Running locally

Requirements: Node 22+, pnpm 10+, and for the desktop app Rust (stable) plus the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) (Xcode Command Line Tools on macOS, the MSVC Build Tools
and WebView2 on Windows).

```bash
pnpm install

# Web / phone app at http://localhost:43217
pnpm dev:web

# Desktop app (first build compiles the Rust side and takes a few minutes)
pnpm fetch:exiftool          # bundles ExifTool for your platform (optional for dev if exiftool is on PATH)
pnpm dev:desktop
```

To try the web app on your phone, run `pnpm dev:web` and open `http://<your-computer's-LAN-IP>:43217` on a phone on the
same Wi-Fi. Offline mode and installation need HTTPS, so use a production build behind HTTPS for those.

### Tests

```bash
pnpm typecheck
pnpm --filter @framenote/core test       # format, validation, security, formatters, layout, RAW scanner
pnpm --filter @framenote/ui test         # presentation keys/gestures, field picker, autosave, editor
cd apps/desktop/src-tauri && cargo test  # RAW scanner, pipeline, cache, storage, ExifTool

# Optional: run the RAW scanner against real camera files
FRAMENOTE_RAW_SAMPLES=/path/to/raw/folder pnpm --filter @framenote/core test
```

## Building installers (.dmg and .exe)

Installers have to be built on their own OS. macOS builds need a Mac and Windows builds need Windows.

```bash
pnpm fetch:exiftool
pnpm build:desktop
# macOS  → apps/desktop/src-tauri/target/release/bundle/dmg/Frame Note_0.1.0_aarch64.dmg
# Windows→ apps/desktop/src-tauri/target/release/bundle/nsis/Frame Note_0.1.0_x64-setup.exe
```

Or push a tag such as `v0.1.0` to GitHub. `.github/workflows/release.yml` then builds the Apple Silicon and Intel
`.dmg` and the Windows `.exe` and attaches them to a draft release.

### Opening the unsigned apps

The builds are not signed with an Apple Developer ID or a Windows code-signing certificate.

**macOS.** Drag *Frame Note* to Applications, then run once in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Frame Note.app"
```

After that it opens normally. Alternatively: right-click the app → Open → Open, or System Settings → Privacy &
Security → "Open Anyway".

**Windows.** Run `Frame Note_x.y.z_x64-setup.exe`. If SmartScreen shows "Windows protected your PC", click **More
info → Run anyway**. It installs for the current user without admin rights.

## Privacy

Photographs and notes stay on your device: in the app-data folder on desktop, in browser storage (IndexedDB) on the
web. Browsers can clear their storage, so export a `.framenote` file as your backup. Exported images contain no EXIF or
GPS, and GPS is left out of `.framenote` files unless you tick the box.

## Licence

MIT. Bundled third-party components and their licences are listed in [`docs/LICENSES.md`](docs/LICENSES.md).
