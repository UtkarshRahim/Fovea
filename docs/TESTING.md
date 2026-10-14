# Testing

Automated coverage and manual testing are recorded separately. Only tests that were actually run are listed.

## Automated tests

Run on 2026-10-14 on the Linux development VM (Node 22.14, Rust 1.99).

| Suite | Command | Result |
|---|---|---|
| core (Vitest) | `pnpm --filter @framenote/core test` | 80 passed (+4 real-RAW tests when `FRAMENOTE_RAW_SAMPLES` is set: 4 passed) |
| ui (Vitest + RTL, jsdom) | `pnpm --filter @framenote/ui test` | 14 passed |
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
them into a folder and set `FRAMENOTE_RAW_SAMPLES` to run the fixture test.

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
| 2026-10-14 | Linux VM (dev host, not a target) | Tauri 2 dev build, WebKitGTK 2.52 | Desktop flow with the four RAW samples | see below |

Not yet tested: real macOS and Windows machines, Android Chrome, iOS Safari (iPhone and iPad), offline use after
first load on a phone, memory with 100-image assignments. Performance targets (cold start, navigation latency, import
throughput, peak memory) have not been measured yet.
