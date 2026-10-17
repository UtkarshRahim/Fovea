# Fovea

A local-first presentation and review tool for wildlife photographers.

Open a folder of camera RAW files, see the original camera data, caption each photograph, present fullscreen with a
clean metadata overlay, and hand the whole project to someone else as one `.fovea` file. They open it on a Mac,
a Windows PC, or in the browser on an Android phone, iPhone or iPad, with no install and no account.

- **Desktop app** for macOS and Windows (Tauri 2 + Rust): RAW import (NEF, CR2, CR3, ARW, plus JPEG/TIFF/PNG), ExifTool
  metadata, fast previews, fullscreen presentation, image and bundle export.
- **Web app / PWA** for phones and tablets: open `.fovea` files, open RAW and JPEG files from the device, edit
  captions, present with touch gestures, and export. Works offline after the first visit.
- **Nothing leaves your device.** No accounts, uploads, analytics or AI services.

New to Fovea? The [how-to guide](docs/HOW-TO.md) walks through every screen with screenshots.

## Install on a Mac

The `.dmg` is not signed with an Apple Developer ID, so macOS blocks it the first time. Drag *Fovea* to
Applications, then run this once in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Fovea.app"
```

If macOS still says the app "is damaged and can't be opened", re-sign it locally and open it again:

```bash
codesign --force --deep --sign - "/Applications/Fovea.app"
xattr -dr com.apple.quarantine "/Applications/Fovea.app"
```

Windows instructions are under [Opening the unsigned apps](#opening-the-unsigned-apps).

## What works today

| | Desktop | Phone / browser |
|---|---|---|
| Create, rename, delete, switch projects | ✓ | ✓ |
| View mode: photo first, swipe or arrow keys between photos | ✓ | ✓ |
| Zoom: pinch, trackpad, Ctrl/⌘ + wheel, double-click/tap, `+` `−` `0` | ✓ | ✓ |
| Review mode (`R`): notes, comments, camera data, reordering, export | ✓ | ✓ |
| Add RAW files (NEF, CR2, CR3, ARW) | ✓ embedded full-size preview + ExifTool metadata | ✓ embedded preview; metadata via exifr (not CR3) |
| Add JPEG / PNG | ✓ | ✓ |
| Add TIFF | ✓ | Safari only |
| Add a whole folder | ✓ | — |
| Captions, species, location, project notes | ✓ | ✓ |
| Review comments (anyone, optional name) | ✓ | ✓ |
| Drag or keyboard reordering | ✓ | ✓ (long-press drag, or arrow buttons) |
| Fullscreen presentation, overlay, "Show on photo" picker | ✓ | ✓ (iPhone: no Fullscreen API, chrome is hidden instead) |
| Export image with overlay (JPEG/PNG) | ✓ | ✓ (downscaled to the 16 MP canvas limit on phones) |
| Export / import `.fovea` | ✓ | ✓ (share sheet on phones) |
| Import an unzipped `.fovea` folder | ✓ | ✓ desktop browsers and Android; not iPhone/iPad (import the `.fovea` instead) |
| Focus point (`A`): where the camera focused, as subtle corner brackets | ✓ Nikon, Canon, Sony, Fujifilm, OM/Olympus, Panasonic, phones | ✓ Nikon Z bodies and phones |
| View a folder without a project (`#/view`): open one photo, step through every photo next to it | ✓ any format, "Open With" from Finder/Explorer | ✓ files you pick or drop; whole folders in Chrome/Edge |
| Recent folders (remembered by path or folder permission; photos are never copied) | ✓ | ✓ Chrome/Edge |

**Not yet:** full RAW decoding for files with no usable embedded preview, HEIC in browsers other than Safari, video,
and automatic phone ↔ desktop sync (sync is by hand with `.fovea` files; see `docs/SYNC.md`).

**View and review.** A project opens in view mode: the photo, a thumbnail strip and a small control bar. Notes,
comments, camera data, reordering and export live behind the **Review** button (or `R`); the app remembers which mode
you used last. Press `?` (or the keyboard button in the top bar) for every keyboard shortcut. Zooming goes up to twice the stored preview's actual pixels. Imported photos are stored at up to
4096 px on the long edge, so 100% is 100% of that preview, not of the original RAW.

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
pnpm --filter @fovea/core test       # format, validation, security, formatters, layout, RAW scanner
pnpm --filter @fovea/ui test         # presentation keys/gestures, field picker, autosave, editor
cd apps/desktop/src-tauri && cargo test  # RAW scanner, pipeline, cache, storage, ExifTool

# Optional: run the RAW scanner against real camera files
FOVEA_RAW_SAMPLES=/path/to/raw/folder pnpm --filter @fovea/core test
```

## Building installers (.dmg and .exe)

Installers have to be built on their own OS. macOS builds need a Mac and Windows builds need Windows.

```bash
pnpm fetch:exiftool
pnpm build:desktop
# macOS  → apps/desktop/src-tauri/target/release/bundle/dmg/Fovea_0.1.0_aarch64.dmg
# Windows→ apps/desktop/src-tauri/target/release/bundle/nsis/Fovea_0.1.0_x64-setup.exe
```

For 32-bit Windows, fetch the 32-bit ExifTool and build for the `i686` target:

```bash
rustup target add i686-pc-windows-msvc
node scripts/fetch-exiftool.mjs --arch=x86
pnpm build:desktop --target i686-pc-windows-msvc
# → apps/desktop/src-tauri/target/i686-pc-windows-msvc/release/bundle/nsis/Fovea_0.1.0_x86-setup.exe
```

## GitHub Actions: installers and web app

`.github/workflows/build.yml` ("Build and deploy") does both jobs on GitHub's Mac and Windows machines, so you don't
need a Windows PC to make the `.exe`.

| Trigger | Tests | Web app (GitHub Pages) | `.dmg` + `.exe` |
|---|---|---|---|
| Push to `main` | ✓ | refreshed | — |
| Push a tag `v*` (e.g. `v0.1.0`) | ✓ | — | published as release `v0.1.0` |
| Actions → Build and deploy → **Run workflow** | ✓ | if "web" is ticked | if "desktop" is ticked, published as a new release `v0.1.0-build.<run number>` |

Every run that builds installers publishes them as a **public release**, marked as the latest, so anyone can
download them from the repository's *Releases* page without signing in. If one platform's build fails, the others are
still published and the release notes say which one is missing. The same files are also kept on the run page under
*Artifacts* (`fovea-macos-apple-silicon`, `fovea-macos-intel`, `fovea-windows-x64`,
`fovea-windows-x86`) for 90 days.

For a numbered release, bump the version in `apps/desktop/src-tauri/tauri.conf.json`, then:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Setting up the web app once: in the repository go to **Settings → Pages → Build and deployment → Source** and pick
**GitHub Actions**. After the next push to `main` the app is live at `https://<user>.github.io/<repo>/` (for this
repo, `https://utkarshrahim.github.io/Fovea/`). Installed PWAs pick up the new version the next time they're opened.
The build sets `BASE_PATH=/<repo>/`; a local `pnpm build:web` still builds for `/`.

### Opening the unsigned apps

The builds are not signed with an Apple Developer ID or a Windows code-signing certificate.

**macOS.** Use the Terminal command in [Install on a Mac](#install-on-a-mac). Or, without Terminal, right-click the app
→ Open → Open, or go to System Settings → Privacy & Security → "Open Anyway".

**Windows.** Run `Fovea_x.y.z_x64-setup.exe` (or `Fovea_x.y.z_x86-setup.exe` on 32-bit Windows). If SmartScreen shows "Windows protected your PC", click **More
info → Run anyway**. It installs for the current user without admin rights.

## Privacy

Photographs and notes stay on your device: in the app-data folder on desktop, in browser storage (IndexedDB) on the
web. Browsers can clear their storage, so export a `.fovea` file as your backup. Exported images contain no EXIF or
GPS, and GPS is left out of `.fovea` files unless you tick the box.

## Licence

MIT. Bundled third-party components and their licences are listed in [`docs/LICENSES.md`](docs/LICENSES.md).
