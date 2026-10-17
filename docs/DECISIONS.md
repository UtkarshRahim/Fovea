# Decisions

Short record of implementation choices and their trade-offs. Newest at the bottom.

## Product

- **Name and format.** The product is **Frame Note**. Files use the `.framenote` extension and the manifest says
  `"format": "framenote"`. The original spec called it FIELDNOTE/`.fieldnote`; nothing has shipped under that name.
- **Desktop first, macOS + Windows.** Linux is not a target. It is only used here as a development host.
- **Phones use the browser.** No native mobile app. The PWA can open `.framenote` files and RAW files directly (see
  "RAW on phones" below).
- **Sync is by hand for now.** Moving `.framenote` files around (AirDrop, Files, USB, cloud drive) is the only transport.
  `docs/SYNC.md` keeps the proposal for later.
- **Anyone can comment.** Each image has `comments[]` with an optional author name and no identity or login. A
  comment-author name is remembered locally for convenience.

## Architecture

- **pnpm workspace** with `packages/core` (pure TS), `packages/ui` (React), `apps/web` (Vite PWA) and `apps/desktop`
  (Tauri 2). No Turborepo/Nx.
- **Platform interface.** `packages/ui` depends only on `Platform` (`packages/ui/src/platform.ts`). Compared with the
  spec's sketch, file picking and processing are combined into `addImages()`, because on desktop the processing is
  native and paths never need to go through the UI.
- **UI primitives.** Radix UI primitives (the headless layer under shadcn/ui), styled with a small hand-written CSS
  design system that follows the spec tokens. A stock shadcn/Tailwind theme would push the look towards the
  "SaaS dashboard" style the spec rules out.
- **Fonts bundled locally** via `@fontsource` (IBM Plex Sans, IBM Plex Mono, Newsreader). No CDN.
- **Routing** is a tiny hash router. It works from `file://`-like origins and needs no server configuration.

## Format

- **ZIP via fflate.** Images are stored (level 0) and the manifest/README are deflated.
- **Zip-bomb defence** has two layers. First the central directory is parsed for entry count and declared sizes
  without inflating anything. Then the archive is streamed through `fflate.Unzip`, counting real inflated bytes and
  aborting when a limit is hit, so lying headers cannot exhaust memory.
- **Stored assets are always upright JPEGs**, so `orientation` is recorded as `1` and the source orientation is
  kept in `rawMetadata.sourceOrientation`.
- **Assets are re-encoded** (4096 px long edge, JPEG q90; thumbnails 512 px, q80) even for JPEG sources. This bounds
  bundle size and strips EXIF/GPS from embedded images. Camera metadata lives only in the manifest.
- **GPS** is stripped from exported bundles unless the user opts in. Exported images never contain EXIF (canvas
  output).
- **`comments` and `user.updatedAt`** were added to v1 before anything shipped. Full sync clocks (see SYNC.md) are
  deferred, and a migration will add them.

## Metadata

- **ExifTool on desktop**, run as one `-stay_open` process shared by import workers. Tags are requested with `-json -n`
  and normalised in TypeScript (`normalizeTags`) so desktop and web share one normaliser.
- **Lens names** come only from `LensModel` (+ `LensMake`). `LensID`/`LensType`/`Lens` can be lookup-derived or
  ambiguous ("Sigma or Tamron …"), so they are kept in `rawMetadata` and never shown as the lens.
- **exifr in the browser** for JPEG/TIFF-based RAWs. Missing values stay missing. CR3 metadata is usually unavailable
  in the browser.
- **RAW original size in the browser.** exifr reads IFD0, whose ImageWidth/ImageHeight in a NEF describe the
  160×120 thumbnail. EXIF sizes are used when present (CR2, ARW, DNG). Otherwise `rawImageSize` walks the TIFF IFDs
  and SubIFDs for the largest full-resolution image, which matches ExifTool on desktop. Sizes smaller than the stored
  asset are not shown, which hides wrong values saved by older versions.

- **Focus areas** are normalised to fractions of the upright image at import (`focusAreasFromTags`), so drawing them
  needs no camera knowledge. Per brand: Nikon AFArea X/Y/Width/Height in AFImage pixels, mapped through
  `CropHiSpeed` for DX and aspect crops; Canon AFInfo2 points relative to the centre (Y up on EOS bodies, down on
  compacts), keeping the points in focus; Sony `FocusLocation`; Fujifilm `FocusPixel`; OM/Olympus
  `AFPointSelected`; Panasonic `AFPointPosition`; EXIF `SubjectArea` otherwise. EXIF orientation is applied last.
  Areas whose centre falls outside the frame are dropped rather than clamped onto the edge.
- **Nikon focus in the browser.** exifr does not decode maker notes, so `nikonFocusTags` reads the AFInfo2 block
  (versions 0300 and 0400–0402, all Z bodies) and `CropHiSpeed` from the raw note and returns ExifTool tag names.
  exifr only returns the raw note when given a buffer, so the first 2 MB are read separately. Other brands are
  desktop-only for now.

## RAW

- **Embedded preview first, on both platforms.** A scanner finds every complete baseline/progressive JPEG inside the
  file (TIFF-based NEF/CR2/ARW/DNG and ISO-BMFF CR3), reads the real dimensions from the SOF marker, skips lossless
  JPEG (CR2 sensor data) and truncated streams, and picks the largest. It is written in TS
  (`packages/core/src/rawPreview.ts`) and ported to Rust (`apps/desktop/src-tauri/src/preview.rs`) for speed. Both
  have the same tests. This was chosen over ExifTool's `-b -JpgFromRaw` because tag names differ per camera and the
  scanner works without ExifTool.
- **RAW on phones.** Because the scanner is pure TS, the web app opens NEF/CR2/CR3/ARW directly from the phone. The
  output is labelled `assetSource: "embedded-preview"` and the UI says so. Real-device testing is still pending (see
  TESTING.md).
- **No full RAW decoder yet.** Files without a usable preview fail individually with a clear message. Adding `rawler`
  (LGPL-2.1) or LibRaw (LGPL/CDDL) is the next step for those files and is noted in LICENSES.md.

## Desktop

- **Storage.** `<app data>/assignments/<uuid>/manifest.json` plus `assets/…`, the same layout as a bundle. Manifest
  writes are atomic (write temp, rename). Orphaned assets are removed when an assignment is opened, not on save, to
  avoid racing with an import in progress.
- **Images are served through Tauri's asset protocol**, scoped to `$APPDATA/assignments/**`. Nothing is
  base64-encoded over IPC. Binary IPC (`tauri::ipc::Response` / raw request bodies) is used only for import/export
  bytes.
- **Import pipeline in Rust.** Rayon pool (≤4 threads), cancellation flag, per-file failures, and a cache keyed by
  sha256(path | size | mtime) in the OS cache dir. Resizing uses `fast_image_resize` (Lanczos3).
- **Image export renders in the webview canvas**, not natively. It uses the same `layoutOverlay` + `drawLayout` code as
  the live overlay, so presentation and export match by construction. Canvas limits on desktop webviews are far
  above 4096 px assets.
- **Bundle export is in-memory** (`zipSync`). This is fine for typical assignments (≈3–6 MB per image). Streaming to
  disk is a known follow-up for very large assignments.
- **Unsigned distribution.** The `.dmg` is ad-hoc signed (`signingIdentity: "-"`) so it runs on Apple Silicon. Users
  clear quarantine once with `xattr`. The Windows NSIS `.exe` shows SmartScreen until "Run anyway". Both are explained
  in the README.
- **ExifTool bundling.** `scripts/fetch-exiftool.mjs` downloads the official release and verifies its published
  SHA-256. On macOS it ships the Perl distribution, run by the system `/usr/bin/perl`. If a future macOS removes
  Perl, the app falls back to a PATH ExifTool and otherwise imports images without metadata, with a warning. On
  Windows it ships the standalone build (Perl included, ~35 MB), 64-bit for the x64 installer and 32-bit for the
  x86 installer.

## Overlay

- **One layout function** (`layoutOverlay`) produces text runs and the scrim. The live overlay is a `<canvas>` drawn
  with the same function as the export, with an offscreen text equivalent for screen readers.
- **Scale.** Metrics are defined for a 1920 px long edge and scale proportionally. On small screens the live
  overlay has a minimum scale for legibility, so on phones it is drawn slightly larger than in a proportional
  export. Exports are always proportional.

## Projects, view mode and zoom

- **"Project" in the interface, `assignment` in the format.** The UI says project everywhere. The manifest keeps
  `assignmentId` and the desktop data folder stays `assignments/`, so files and data from earlier builds still open.
- **View first, review behind a toggle.** The editor opens with only the photo, a thumbnail strip and a control bar.
  Review mode adds the filmstrip with reorder/remove, the notes/comments/camera panel and the export buttons. The
  choice is stored per device (`localStorage`), not in the project file.
- **Zoom is drawn, not CSS-transformed.** The zoomed rectangle is applied as the image's position and size, so the
  browser resamples from the full image instead of scaling a rasterised layer. The overlay hides while zoomed.
  Double-tap zooms (it used to toggle fit/fill; fit mode is still in the presentation settings).
- **Folder import is lenient where ZIP import is strict.** An unzipped folder may have picked up `.DS_Store`,
  `__MACOSX` or other files, or lost some. Unreferenced files are ignored and images with missing files are dropped,
  each with a warning. Path safety, size limits and checksums are the same as for `.framenote` files. On desktop the
  folder is listed and read by Rust commands that refuse paths outside the chosen folder and skip symlinks.

## Folder viewer

- **Separate from projects, with a bridge.** `#/view` shows a folder in place: nothing is imported, and it never
  appears as a project. "Add to project" and "New project from all N photos" run the normal import pipeline, so
  projects stay self-contained and shareable.
- **References, not copies.** Recent folders store the path (desktop, `localStorage`) or a File System Access
  directory handle (Chrome/Edge, IndexedDB `folders` store, DB version 2). Reopening asks for permission again if
  the browser dropped it. Other browsers view picked or dropped files for the session only.
- **Display without converting.** Formats the webview decodes are shown as-is (HEIC/TIFF on macOS too). RAW shows
  the largest embedded JPEG; for rotated frames a minimal EXIF orientation segment is prepended
  (`orientationHeader` / `with_orientation`) so the webview rotates it, instead of decoding and re-encoding 45 MP.
  TIFF on Windows/Linux is rendered once through the import pipeline.
- **One photo opens its folder; several photos open just those**, as Preview does. Lists are sorted like Finder
  (natural order) and capped at 20,000 files. The viewer keeps eight decoded photos and preloads the next two and
  the previous one.
- **Open With.** File associations use role Viewer and rank Alternate, so Frame Note is offered but never takes over
  as the default. macOS delivers files through `RunEvent::Opened`; Windows and Linux through argv and the
  single-instance plugin, which forwards to the running window.
- **Projects are loaded before importing into them**, because loading a project deletes stored files its manifest
  does not list yet.
