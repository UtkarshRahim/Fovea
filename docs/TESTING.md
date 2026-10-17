# Testing

Automated coverage and manual testing are recorded separately. Only tests that were actually run are listed.

## Automated tests

Run on 2026-10-14 on the Linux development VM (Node 22.14, Rust 1.99).

| Suite | Command | Result |
|---|---|---|
| core (Vitest) | `pnpm --filter @fovea/core test` | 80 passed (+4 real-RAW tests when `FOVEA_RAW_SAMPLES` is set: 4 passed) |
| ui (Vitest + RTL, jsdom) | `pnpm --filter @fovea/ui test` | 14 passed |
| desktop (cargo test) | `cd apps/desktop/src-tauri && cargo test` | 12 passed |
| Typecheck | `pnpm typecheck` | clean |
| Web production build + service worker | `pnpm build:web` | builds; 53 precache entries |

What they cover:

- **Manifest:** valid/invalid manifests, missing optional fields (no values invented), extra fields stripped,
  duplicate ids, wrong format names, field-level error paths, migration registry.
- **Bundles:** export → import round-trip preserving order, captions, metadata and presentation settings; images
  stored uncompressed; GPS stripping; checksum mismatch flagged as a warning; import-copy instead of overwrite.
- **Security:** `../`, absolute, backslash, drive-letter and null-byte paths; files outside `assets/`;
  unreferenced files; duplicate normalised names; zip bomb (real inflated size); lying size headers; non-ZIP data; a
  ZIP without a manifest; newer `formatVersion` message; video entries rejected; invalid JSON.
- **Formatting:** shutter speed (1/1600, 0.5 → 1/2, 0.3333 → 1/3, 1/60 snapping, long exposures), aperture decimals,
  focal length, ISO, signed EV, capture date without zone shift, camera-name de-duplication, missing values omitted.
- **Normalisation:** ExifTool `-n` output, exifr output, lookup-only lens tags not used as the lens, GPS refs and
  0,0 dropped.
- **Overlay layout:** bottom/top placement, proportional scaling (export = live × scale), compact single line, wrapping
  on narrow images, empty overlay, title built only from user fields. Export sizing: no upscaling, long edge, iOS
  canvas limit.
- **RAW scanner (TS and Rust):** largest preview chosen among thumbnail/medium/full, lossless JPEG ignored, truncated
  streams ignored, noise yields nothing, source-kind detection (TIFF RAW, CR3 ftyp, HEIC).
- **UI:** arrow/Home/End navigation within bounds, on-screen buttons, swipe left/right and vertical drags ignored, O
  toggles overlay, preview mode starts hidden, I opens the field picker and selections persist via autosave, Esc
  closes it, shortcuts do nothing while a text field is focused (presentation and editor), F requests fullscreen,
  autosave debounce (no save before 500 ms, one save after) and error status, caption editing saves, camera data is
  read-only, keyboard reordering, library empty state.
- **Desktop native:** JPEG import with resize, cache hit on re-import (same hashes, new id), embedded-preview
  extraction from a RAW container, partial failures (corrupt file, RAW without preview, duplicate selection) without
  aborting the batch, EXIF orientation applied, folder scan filtering and sorting, storage path validation, atomic
  manifest write, asset garbage collection, ExifTool `-stay_open` round-trip (run with ExifTool 12.76 on PATH).

## RAW formats and cameras tested

Samples are from [raw.pixls.us](https://raw.pixls.us/) (CC0). They are not committed because of their size; download
them into a folder and set `FOVEA_RAW_SAMPLES` to run the fixture test.

| Camera | File | Format detail | Embedded preview found | Scanner time (TS, Node) |
|---|---|---|---|---|
| Nikon Z 9 | `Nikon_-_NIKON_Z_9_-_14bit_compressed_(Lossless).NEF` | 14-bit lossless compressed | 8256 × 5504 (full size) | 54 ms |
| Canon EOS R7 | `443A0157.CR3` | CR3 | 6960 × 4640 (full size) | 25 ms |
| Canon EOS 5D Mark IV | `B13A0729.CR2` | CR2 | 6720 × 4480 (full size) | 48 ms |
| Sony α1 (ILCE-1) | `A1_full_compressed.ARW` | compressed | 8640 × 5760 (full size) | 85 ms |

Not tested yet: Nikon High Efficiency (HE/HE*) NEF, Canon CR3 C-RAW from other bodies, Sony lossless-compressed ARW,
older Sony bodies (which often embed only a 1616 × 1080 preview), DNG, Fujifilm RAF, Olympus ORF, Panasonic RW2.
These are expected to work wherever the camera embeds a baseline JPEG preview, but that is not verified.

## Manual testing

| Date | Device | OS / browser | Scope | Result |
|---|---|---|---|---|
| 2026-10-14 | Linux VM (dev host, not a target) | Tauri 2 dev build, WebKitGTK 2.52 | Desktop flow with the four RAW samples | pass after fixes (below) |
| 2026-10-14 | Linux VM | Chrome, desktop and 390×844 device emulation | Web flow: RAW import, view/review, zoom, shortcuts, `.fovea` export and folder import | pass |

Desktop, with the Z9 NEF, R7 CR3, 5D4 CR2 and A1 ARW samples: folder import (4 of 4, about 5 s), camera data and
overlay values match ExifTool, captions autosave, reordering, "Show on photo", presentation shortcuts, `.fovea`
export (13 MB) and import, unzipped-folder import, view mode, zoom (keys, double-click, Ctrl + wheel, drag to pan),
drag-to-swipe, Review toggle, project switcher and the shortcuts panel all worked.

Found and fixed:

- **Export image failed with "The operation is insecure."** Drawing the asset-protocol URL tainted the canvas. Export
  now renders from the stored bytes through a `blob:` URL. Re-tested: a 4096 × 2731 JPEG was written.
- **`.fovea` import appeared to do nothing.** It was run against a stale debug binary started without its dev
  server. On a fresh `pnpm dev:desktop` it imported "Sal Forest Test (imported)" with 4 photos.
- **Picking the `assets` folder gave a confusing error.** The message now says to choose the folder one level up.

### Focus points and the folder viewer (2026-10-17, macOS, web build in Chromium)

Automated: core 116 passed (focus areas per brand, DX crop, orientations 6 and 8, Nikon maker-note parsing,
orientation header), ui 31 passed (viewer navigation, preloading, recents, the `A` toggle, adding to a project in
the right order). Desktop TypeScript typechecks. `cargo test` and a desktop run were not possible locally: this
machine has Rust 1.88 and the locked Tauri 2.12 needs 1.90.

Manually, in the web viewer with Nikon Z8 and Z9 NEFs and a Canon JPEG: photos dropped on the projects screen open
in Finder order; NEF embedded previews show upright for orientations 1, 6 and 8 without re-encoding; with `A` on,
the focus brackets sit on the bee-eater (Z8, landscape), the langur's head (Z8, orientation 8) and between the
tiger's eyes (Z9, DX crop, orientation 6), matching ExifTool's AF values exactly; `O` shows camera data; "New project
from all 3 photos" and "Add to project" import with focus data kept.

Found and fixed:

- **NEFs showed "could not be displayed".** Chromium's `img.decode()` rejected large previews that load fine. The
  viewer now falls back to `onload` and drops failed entries so they can be retried.
- **Photos added from the viewer were blank in the project.** Loading the project after the import garbage-collected
  the new files. The project is now loaded first; a UI test pins the order.

Not yet tested: real macOS and Windows machines, Android Chrome, iOS Safari (iPhone and iPad), offline use after
first load on a phone, memory with 100-image projects. Performance targets (cold start, navigation latency, import
throughput, peak memory) have not been measured yet.
