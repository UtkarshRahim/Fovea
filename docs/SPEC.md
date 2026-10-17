> **Note:** This is the original build specification, kept for reference. The product has since been named **Fovea** and the file format uses `.fovea` (`"format": "fovea"`). Where this document says FIELDNOTE or `.fieldnote`, read Fovea / `.fovea`. Product decisions made after this spec are in `DECISIONS.md`.

# FIELDNOTE — Build Specification

A local-first photography presentation and review tool for wildlife photographers. Desktop (Tauri 2) plus a responsive, installable PWA that share one codebase and one portable file format (`.fieldnote`).

> **Instructions to the coding agent (Cursor)**
> You are a senior product engineer, desktop application engineer and UI/UX designer. Do not just produce plans or mockups. Inspect the repository, make implementation decisions, write the code, run it, test it and fix problems. Work incrementally and keep the app runnable at every step. If a dependency, native library or platform limitation blocks a feature, explain the limitation and implement the best honest fallback. Never pretend a feature works. Do not ask for confirmation on routine implementation decisions: decide, document important trade-offs in `docs/DECISIONS.md`, and proceed. Do not invent test results; only report tests that were actually run.

---

## 1. Product

### 1.1 Problem
Wildlife photographers present a small selection of photographs for workshops, assignments, mentorship and critiques. Lightroom and similar editors are too heavy for this.

### 1.2 Core workflow
1. Open a folder of photographs, including camera RAW files.
2. View photographs with original camera metadata.
3. Add a short description (caption) to each image.
4. Present images fullscreen with a clean metadata overlay.
5. Export presentation-ready images.
6. Package an assignment into a portable `.fieldnote` file.
7. Open that file on another computer, Android phone, iPhone or tablet **without installing an app** (via browser).

### 1.3 Non-goals
FIELDNOTE is a presentation and review tool. It is **not** a photo editor, DAM, cloud gallery or social network. Do not implement features that do not directly support the assignment workflow.

### 1.4 Secondary goal: fast preview alternative
Eventually FIELDNOTE should work as a fast photo previewer (open a folder, flip through images instantly). Speed is a first-class requirement, not polish. See section 12.

### 1.5 Target cameras (first workflow)
Nikon Z-series, Canon, Sony Alpha. Wildlife assignments.

### 1.6 Principles
- Local-first: photographs stay on the user's device.
- Offline-first: core features work with no internet.
- No accounts, authentication, cloud uploads, AI services or telemetry by default.
- Fast startup and fast image navigation.
- Minimal interface; photographs get most of the screen.
- Accurate metadata, never fabricated.
- Portable assignments; identical rendering on desktop and mobile.
- Never modify a source file (RAW included) to save a caption.
- Prefer established libraries over custom infrastructure.

---

## 2. Architecture

### 2.1 Stack
**Desktop (decided: Tauri 2)**
- Tauri 2, Rust backend, React + TypeScript + Vite frontend.
- Vitest + React Testing Library for frontend tests; `cargo test` for native commands.

**Web / mobile**
- Same React UI as a responsive PWA: Android Chrome, iPhone Safari, iPad Safari, desktop browsers.
- Installable where supported; installation never required.
- IndexedDB for assignments and image assets. Cache Storage + service worker for offline app shell. Never use `localStorage` for image data.
- Import/export `.fieldnote` through the browser file picker and downloads.

### 2.2 Repository layout (pnpm workspace; do not add heavier monorepo tooling)
```
fieldnote/
├── packages/
│   ├── core/        # pure TS, no DOM/Tauri imports
│   └── ui/          # React screens, components, design system
├── apps/
│   ├── web/         # Vite PWA + IndexedDB platform adapter
│   └── desktop/     # Tauri 2 app + native platform adapter
├── docs/
│   ├── FORMAT.md
│   ├── DECISIONS.md
│   ├── TESTING.md
│   └── LICENSES.md
└── fixtures/        # legally distributable sample files
```
If the repository already has a suitable structure, inspect and adapt it instead of rebuilding.

### 2.3 `packages/core` (shared business logic; no duplication anywhere else)
- Manifest types and validation (Zod; generate JSON Schema from it).
- Metadata normalisation and formatters.
- Presentation settings and overlay layout calculation (used by both DOM rendering and canvas/native export so output matches).
- Export configuration types.
- `.fieldnote` pack and unpack (ZIP) with path validation, checksum verification and version migration hooks.

### 2.4 Platform adapter interface (`packages/ui` depends only on this)
```ts
interface Platform {
  pickFiles(opts): Promise<PickedFile[]>;        // web: file input; desktop: native dialog
  pickFolder?(): Promise<PickedFolder>;          // desktop only
  listAssignments(): Promise<AssignmentSummary[]>;
  loadAssignment(id): Promise<Assignment>;
  saveAssignment(a: Assignment): Promise<void>;
  deleteAssignment(id): Promise<void>;
  getAssetUrl(assignmentId, assetPath): Promise<string>; // object URL or asset-protocol URL
  releaseAssetUrl(url): void;
  importFieldnote(file): Promise<Assignment>;
  exportFieldnote(id, opts): Promise<SavedFile>;
  exportImage(opts): Promise<SavedFile>;
  capabilities: { rawImport: boolean; folderImport: boolean; nativeFullscreen: boolean };
}
```

---

## 3. The `.fieldnote` format (build this first)

A `.fieldnote` file is a **real ZIP archive**, not a renamed JSON file. Use a standard ZIP library (`fflate` preferred; JSZip acceptable).

### 3.1 Layout
```
assignment.fieldnote
├── manifest.json
├── assets/
│   ├── images/
│   │   ├── image-001.jpg
│   │   └── image-002.jpg
│   └── thumbnails/
│       ├── image-001.jpg
│       └── image-002.jpg
└── README.txt          # human-readable explanation of the format and how to open it
```
Images and thumbnails are stored in ZIP **without extra compression** (already compressed). `manifest.json` and `README.txt` may be deflated.

### 3.2 Manifest (version 1)
All metadata fields are optional. Missing metadata is omitted, never invented.

```json
{
  "format": "fieldnote",
  "formatVersion": 1,
  "assignmentId": "uuid-v4",
  "title": "Sal Forest Assignment",
  "notes": "Optional assignment-level notes",
  "createdAt": "2026-10-15T10:00:00Z",
  "modifiedAt": "2026-10-15T10:00:00Z",
  "generator": { "app": "fieldnote", "version": "0.1.0", "platform": "web|desktop" },
  "presentation": {
    "fitMode": "contain",
    "overlay": {
      "visible": true,
      "placement": "bottom",
      "theme": "dark",
      "fontSize": 16,
      "paddingX": 40,
      "paddingY": 22,
      "backgroundOpacity": 0.85,
      "fields": ["focalLength", "aperture", "shutterSpeed", "iso"],
      "showCaption": true,
      "showTitle": true,
      "labelledGrid": true
    }
  },
  "images": [
    {
      "id": "image-001",
      "type": "image",
      "order": 0,
      "originalFilename": "Z9_01234.NEF",
      "asset": "assets/images/image-001.jpg",
      "thumbnail": "assets/thumbnails/image-001.jpg",
      "assetSource": "embedded-preview | raw-decoded | original-jpeg | tiff-converted",
      "checksum": { "algorithm": "sha256", "asset": "hex", "thumbnail": "hex" },
      "dimensions": { "width": 8256, "height": 5504 },
      "assetDimensions": { "width": 6048, "height": 4032 },
      "orientation": 1,
      "camera": { "make": "NIKON CORPORATION", "model": "NIKON Z 9" },
      "lens": { "model": "NIKKOR Z 600mm f/4 TC VR S" },
      "exposure": {
        "aperture": 5.6,
        "shutterSpeedSeconds": 0.000625,
        "iso": 800,
        "focalLengthMm": 600,
        "exposureCompensationEv": 0
      },
      "capturedAt": "2026-03-14T06:42:11",
      "gps": { "latitude": 0, "longitude": 0 },
      "user": {
        "caption": "Waiting in the sal forest before crossing the trail.",
        "species": "Bengal tiger",
        "location": "Bandhavgarh"
      },
      "rawMetadata": { "note": "Optional original values retained where normalisation was uncertain" }
    }
  ]
}
```

**Reserved for later (add the type now, implement later):** `"type": "video"` with `duration`, `codec`, `frameRate`, `poster` (path to poster frame). Readers must reject unknown `type` values with a clear message, not crash.

Notes:
- `assetSource` records honestly how the displayed asset was produced. Never claim RAW quality when it came from an embedded preview.
- GPS is stored only if present in the source, and the export dialog should let the user strip it. Default: strip GPS from exported images; keep in bundle only if the user opts in.
- Orientation: store the original EXIF orientation. Pre-rotated assets set orientation to `1`.

### 3.3 Rules
- Bundles are self-contained: no absolute paths; all asset paths are relative.
- Opening a bundle never requires the original RAW files.
- Image order, captions and presentation settings survive export and import.
- Invalid or unsupported `formatVersion` produces a useful error (what was found, what is supported, what to do). Include a migration registry (`migrate(manifest, fromVersion)`) even if only v1 exists.
- Validate every archive entry path: reject `..`, absolute paths, backslashes, drive letters, null bytes and duplicate normalised paths. Reject entries not referenced by the manifest or outside `assets/`.
- Impose limits: max manifest size, max entry count, max total uncompressed size (zip-bomb protection).
- Verify checksums on import; report mismatches as warnings with the affected image flagged.
- Importing never overwrites an existing assignment. If the `assignmentId` already exists, create a new copy with a new ID and a "(imported)" title suffix, or offer the choice.
- Document the format in `docs/FORMAT.md` and ship a JSON Schema file.

---

## 4. Metadata handling

### 4.1 Extraction
- **ExifTool** is the primary extractor on desktop. Run a single long-lived process with `-stay_open True -@ -` rather than spawning per file. Bundle as a Tauri sidecar and document platform specifics (Perl runtime on Windows/Unix distributions).
- Read: camera make/model, lens make/model, aperture, shutter speed, ISO, focal length, exposure compensation, capture date/time, dimensions, orientation, GPS (when present), maker-note lens info.
- Normalise into the internal schema while retaining useful original values when normalisation is uncertain.
- **Never infer** a lens model or any missing value.

### 4.2 Web extraction
Parse EXIF from JPEGs in the browser (e.g. `exifr`). If unavailable, allow missing fields and explain that some camera metadata may not be available.

### 4.3 Formatting (in `core`, unit tested)
| Field | Format | Examples |
|---|---|---|
| Focal length | `{n} mm` | `600 mm` |
| Aperture | `f/{n}` | `f/5.6`, `f/11` |
| Shutter speed | `1/{n} s` if < 1 s, else `{n} s` | `1/1600 s`, `2 s`, `0.5 s` → `1/2 s` |
| ISO | `ISO {n}` | `ISO 800` |
| Exposure comp. | signed EV | `+0.7 EV`, `-1 EV`, `0 EV` |
| Date | locale-aware, ISO in manifest | |

Handle edge cases: shutter `1/3` rounding (e.g. 0.3333 → `1/3 s`), long exposures, aperture with one decimal only when needed, missing values (omit, do not show a placeholder dash unless the labelled grid needs alignment).

---

## 5. RAW support

### 5.1 Formats
Nikon NEF, Canon CR2/CR3, Sony ARW, plus JPEG and TIFF. Add others only when reliably supported. **Do not claim universal RAW compatibility.** Document the actually tested camera models in `docs/TESTING.md`.

### 5.2 Progressive rendering strategy
1. Extract the largest usable embedded JPEG preview via ExifTool (`JpgFromRaw`, `PreviewImage`, `OtherImage`; tag availability varies by camera). Do not assume all RAWs share tags.
2. Show the preview immediately.
3. Fall back to a supported decoder (LibRaw via bindings, or the pure-Rust `rawler`; evaluate licensing and CR3/HEIF-based "high efficiency" variants) when no usable preview exists.
4. If neither works, show a clear, human explanation (camera, format, what failed) and let the user skip the file.

Rules: do not write a RAW decoder; do not claim embedded previews match a fully developed RAW's quality or colour; check compressed and high-efficiency variants; record `assetSource` per image.

### 5.3 Licensing
Check and record in `docs/LICENSES.md` the licences of ExifTool (Perl Artistic/GPL), LibRaw (LGPL/CDDL), any Rust RAW crates, and ffmpeg when added. Document any native dependency that is not bundled. Do not silently require ExifTool to be preinstalled.

### 5.4 Desktop import pipeline
```
select folder/files → scan (async) → for each file:
  stat (path, size, mtime) → cache hit? reuse
  else: ExifTool metadata → preview extraction → decode fallback
        → resize to presentation asset (long edge configurable, default 4096) 
        → thumbnail (long edge 512) → sha256
→ progress events to UI → partial failures reported per file, never abort the batch
```
- Run in Rust worker threads; never block the UI thread.
- Support cancellation.
- Handle: corrupt files, unsupported variants, missing EXIF, duplicate filenames, very large images, partial failures.
- Cache keyed by `(absolute path, size, mtime)`. Do not re-parse unchanged files.
- Keep original files untouched. Handle moved/missing source files gracefully (assignment already holds its own assets).

---

## 6. Screens

### 6.1 Design system
- Dark charcoal ground (`~#151515`), neutral text (`#ECE9E3`), muted text (`#9A968E` or lighter for contrast), subtle 1px borders (`#2A2A2A`–`#3A3A3A`).
- Typography: monospace (IBM Plex Mono or similar) for exposure data; neutral sans (IBM Plex Sans) for UI; italic serif (Newsreader) for captions. Fonts must be bundled locally, not fetched from a CDN at runtime (offline-first).
- No gradients except the text-protection fade behind overlays, no glass/blur effects, no oversized headings, no decorative cards, no SaaS-dashboard look.
- Consistent spacing scale, button styles and visible keyboard focus. Touch targets at least 44 px. Text contrast at least 4.5:1.
- Real `<button>`, `<label>` and `<input>` elements; `aria-label` on icon-only buttons.

### 6.2 Screen A — Assignment library
Shows saved assignments: title, cover thumbnail, image count, last-modified date, Open. Actions: Import `.fieldnote`, Create assignment, Rename, Delete (with confirmation). Empty state explains how to import or create. Flat grid or list; no decorative cards.

### 6.3 Screen B — Assignment editor
- Top bar: title (editable), unobtrusive save status ("Saved locally"), **Export .fieldnote**, **Present**.
- Left: compact filmstrip of thumbnails with drag-to-reorder and keyboard reorder controls; **Add images**.
- Centre: selected image preview with the metadata strip as it will appear.
- Right panel:
  - **Your notes** (editable): caption, species, location, assignment notes.
  - **Camera data — read only**: body, lens, exposure compensation, capture date, plus the four core exposure values.
  - Clearly separate user-authored from camera-derived information.
- Caption editing is inline; no dialog chains. Autosave (debounced ~500 ms) with save status. Original EXIF is never altered.

### 6.4 Screen C — Fullscreen presentation (primary experience)
- Image fills the viewport preserving aspect ratio; never stretched. Fit mode configurable: `contain` or `cover`.
- Overlay shows metadata and caption, readable on bright or dark photos (use a soft fade/scrim, not a boxed card).
- Previous/next on-screen controls (touch accessible), image counter such as `3 / 12`.
- Controls auto-hide when idle but are discoverable (appear on pointer move/tap; a small hint on first open).
- Desktop fullscreen via Fullscreen API / Tauri window fullscreen. Mobile: immersive mode subject to browser limits (iOS Safari does not support the Fullscreen API on iPhone; fall back to hiding chrome and using `viewport-fit=cover` with safe-area insets).
- Use `env(safe-area-inset-*)`; avoid clipping in landscape and on narrow screens.
- Touch gestures: swipe left/right to navigate, tap to toggle controls, optional double-tap to toggle fit mode.

**Keyboard shortcuts (desktop; never hijack while a text field is focused)**
| Key | Action |
|---|---|
| ← | Previous image |
| → | Next image |
| Home / End | First / last image |
| F | Toggle fullscreen |
| Esc | Exit fullscreen, then return to editor (respect browser restrictions) |
| O | Toggle metadata overlay |
| I | Open the "Show on photo" field picker |

### 6.5 Two presentation modes
- **Preview mode** (fast flipping): image edge-to-edge, tiny counter only, overlay hidden by default, one keypress shows metadata. This is the "preview alternative" path.
- **Present mode**: full overlay with caption.
Both use the same layout code and settings.

### 6.6 Overlay design (decided direction)
Hybrid of two reviewed designs: **edge-to-edge photo** plus a **labelled metadata grid**.

- Title line above the grid: `Species · Location` (user-authored; only if present).
- Labelled four-column grid: `FOCAL LENGTH / APERTURE / SHUTTER / ISO` in small caps monospace labels over larger values (`600 mm`, `f/5.6`, `1/1600 s`, `ISO 800`).
- Compact single-line variant: `600 mm  ·  f/5.6  ·  1/1600 s  ·  ISO 800` (setting `labelledGrid: false`).
- Caption in italic serif beneath, e.g. *Waiting in the sal forest before crossing the trail.*
- **Placement: top or bottom** (user choice). A subtle dark gradient scrim behind the text keeps it legible; no boxed card, no rounded panels over the photo.
- Missing fields are skipped, never faked.

### 6.7 "Show on photo" field picker
A small panel (hidden by default, opened with `I` or a button; a bottom sheet on phones) with checkboxes:
- On by default: Focal length, Aperture, Shutter speed, ISO (in that order).
- Off by default: Camera body, Lens, Exposure compensation, Capture date.
Plus: placement toggle (Top / Bottom), font size, horizontal and vertical padding, background opacity, caption visibility, light/dark treatment. Only the selected EXIF fields are rendered over the image. All of this persists in `presentation.overlay` in the manifest.

### 6.8 Screen D — Caption and metadata editing
Part of the editor panel (6.3): caption, species, location, assignment notes are editable; camera metadata is read-only in the MVP.

---

## 7. Image export
Export the current photograph with the overlay and caption rendered in.

- Formats: JPEG (quality slider) and PNG.
- Resolution: configurable, including original/asset dimensions; never upscale unnecessarily; preserve aspect ratio; respect orientation.
- Text must be sharp; use the same layout function as the live overlay so the export matches the presentation.
- Embed/preload fonts before drawing to canvas.
- **Web:** Canvas (prefer `OffscreenCanvas` in a worker where supported), memory-aware, one image at a time. Respect iOS Safari canvas limits (~16 megapixels): downscale or tile and tell the user.
- **Desktop:** render natively (Rust, e.g. `image` + `ab_glyph`/`tiny-skia`) or via an offscreen webview canvas; choose the simplest approach that gives sharp text at full resolution and document the decision.
- Must produce a real downloadable/saveable file.
- Do not claim RAW quality when the source asset came from an embedded preview; show the source in the export dialog.
- GPS/EXIF: strip by default on exported images.

---

## 8. Mobile web experience (core surface)

Workflow to support end to end:
1. Open the web app.
2. Import a `.fieldnote` via the file picker.
3. Validate and unpack.
4. Show photographs and metadata.
5. Navigate with touch gestures and visible controls.
6. Read and edit captions.
7. Save locally (IndexedDB).
8. Export the updated assignment as `.fieldnote`.
9. Export an individual presentation-ready image.

Also: create assignments from JPEGs picked on the device. Extract EXIF where the browser exposes it; otherwise allow missing fields and explain why. **Do not promise HEIC or RAW on mobile** until verified on real devices. RAW is prepared on desktop and transferred as a bundle.

**iOS Safari specifics:** no free filesystem access; downloads go through the share sheet / Files; storage can be evicted (call `navigator.storage.persist()`, show quota); no Fullscreen API on iPhone; background tabs suspend long tasks; `100vh` bugs (use `dvh`/`svh`).
**Android specifics:** memory pressure with large images, so use thumbnails in lists, one full-size decode at a time, revoke object URLs.
Handle orientation changes without losing position.

---

## 9. Storage and privacy

**Desktop:** assignment data in an application-managed directory or SQLite database under the OS app-data path; assets stored as files; originals never touched; export locations explicit; moved/missing sources handled gracefully.

**Web:** IndexedDB (via `idb`) with separate stores for assignment records and asset `Blob`s. Persist edits across reloads. Handle `QuotaExceededError` with a clear message and an export suggestion. Offer delete per assignment. Avoid duplicating full-resolution assets (store once, reference by path/hash).

**Both:** never upload images automatically; never send photos to third-party APIs; no AI services; no login; no analytics or telemetry by default. Document that browser storage can be cleared or reclaimed by the browser, so exporting a `.fieldnote` is the reliable backup.

---

## 10. Service worker / PWA
Web manifest, icons, `display: standalone`, `theme-color`, offline app shell via a service worker (Workbox or hand-written). Precache the app shell and fonts. Do not precache user images (they live in IndexedDB). Verify the app loads and works offline after first load. Add a `file_handlers` / share-target entry only if verified to work.

---

## 11. Video (later; do not build now)
Keep the manifest ready (`type`, `duration`, `codec`, `poster`). When implemented: H.264/AAC MP4/MOV via `<video>`; ExifTool for video metadata; ffmpeg sidecar for poster frames and optional H.264 proxies when the codec is not broadly playable (check LGPL vs GPL build); store video in the ZIP uncompressed; no autoplay; export "current frame" rather than burned-in video overlays; warn about bundle size and iOS storage limits.

---

## 12. Performance requirements
- Show a usable preview fast; thumbnails first, full asset after.
- Preload the next and previous images; keep at most ~3 decoded full-size images alive.
- Never block the UI thread: metadata and decode in Rust workers (desktop) and Web Workers (web).
- **Desktop: serve images through Tauri's asset protocol or a custom URI scheme, never as base64 over IPC.**
- Single long-lived ExifTool process; cache by `(path, size, mtime)`.
- Overlay is plain text over a gradient scrim: no blur, no heavy animation; only opacity transitions.
- Revoke object URLs when no longer needed; do not retain decoded buffers.
- Progress UI and cancellation for long imports/exports.
- Virtualise long filmstrips/grids.
- Targets to measure and record (not assumed): cold start to first image, image-to-image navigation latency, import throughput (files/sec), peak memory on a 100-image assignment.

---

## 13. Testing

### 13.1 Automated (Vitest + React Testing Library; `cargo test` for native)
- Manifest schema validation (valid, missing optional fields, extra fields).
- `.fieldnote` export → import round-trip.
- Preservation of image order, captions, metadata and presentation settings.
- Unsupported `formatVersion` error message.
- Invalid archives; path traversal (`../`, absolute, backslash, null byte); zip-bomb limits; checksum mismatch.
- Missing metadata fields (nothing invented).
- Shutter-speed and aperture formatting, including edge cases.
- Caption autosave (debounce, save status).
- Image navigation (buttons, swipe, bounds).
- Keyboard shortcuts, including *not firing while a text field is focused*.
- Overlay visibility toggle and field picker selection.
- Export configuration validation and layout parity between live overlay and export.
- Native commands integration tests where practical (metadata extraction on fixtures, preview extraction, cache hit/miss).

### 13.2 Fixtures
Use legally distributable sample files from representative camera models (e.g. public raw sample repositories with permissive licences). Record in `docs/TESTING.md` exactly which formats and camera models were tested and which were not. Include small JPEGs with and without EXIF, a corrupt file, and a duplicate-filename set.

### 13.3 Manual device testing (separate from automated coverage)
Desktop Chromium browser, Android Chrome, iOS Safari (real device where possible). Record date, device, OS/browser version and result in `docs/TESTING.md`. Clearly distinguish automated coverage from manual testing. Never claim a test passed unless it ran.

---

## 14. Development phases

**Phase 1 — Repository inspection.** Inspect repo, dependencies, runtime, build system, platform, docs. Check dev environment (Node, pnpm, Rust, Tauri prerequisites). Identify native dependency and packaging constraints. Write a short plan, then start implementing immediately.

**Phase 2 — Shared format and web MVP.** Shared types; Zod schema + JSON Schema; ZIP import/export; IndexedDB persistence; responsive library; editor; presentation view with overlay and field picker; image export. Use bundled sample photographs, clearly labelled as sample content. Do not build a fake RAW importer.

**Phase 3 — Desktop integration.** Tauri shell; native file and folder pickers; ExifTool sidecar; embedded preview extraction; RAW decode fallback where supported; thumbnail generation; assignment creation from RAW; bundle export; native image export. If a native dependency is unavailable, finish the integration boundary and document the blocker honestly. Never substitute a JPEG-only path while claiming RAW support.

**Phase 4 — Mobile polish.** Verify file-picker flow, import/export, IndexedDB persistence, caption editing, touch navigation, safe areas, orientation changes, memory with large assignments, offline use after first load.

**Phase 5 — Quality and release.** Fill test gaps, accessibility pass, performance measurements, packaging (signed installers where possible), documentation, licence audit.

---

## 15. Acceptance criteria (MVP)
1. A `.fieldnote` exported on desktop opens on Android Chrome and iPhone Safari with order, captions, metadata and settings intact, and without the RAW files.
2. A folder of mixed NEF/CR3/ARW/JPEG opens on desktop; unsupported files fail individually with clear messages.
3. Presentation view: full-bleed image, top or bottom overlay, field picker, all listed shortcuts, safe-area correct on phones.
4. Exported JPEG/PNG visually matches the presentation layout and is sharp.
5. No network requests for core features (verify with devtools offline mode).
6. Invalid, malicious or newer-version bundles are rejected with a useful error, never a crash.
7. All automated tests pass, and the manual device test log exists.

---

## 16. Working rules for the agent
- Keep the app runnable after every change; commit in small, meaningful steps.
- Put business logic in `packages/core`; keep UI free of format/parsing logic.
- Prefer established libraries; justify any custom infrastructure in `docs/DECISIONS.md`.
- Document honestly: what works, what is untested, what is blocked.
- Never fabricate metadata, test results or compatibility claims.
