# Licences

Frame Note itself is MIT licensed (see `LICENSE`).

## Bundled with the desktop app

| Component | Licence | Notes |
|---|---|---|
| ExifTool (Phil Harvey) | Perl Artistic License or GPL (same terms as Perl) | Bundled unmodified as a separate program and run as a child process, not linked. macOS: Perl distribution run by the system Perl. Windows: official standalone build, which includes a Perl runtime under the same terms. Source: https://exiftool.org |
| Tauri 2 and plugins | MIT / Apache-2.0 | |
| image, fast_image_resize, rayon, sha2, serde, uuid | MIT / Apache-2.0 | Rust crates |

## Bundled with the web and desktop UI

| Component | Licence |
|---|---|
| React, Radix UI, dnd-kit, lucide-react | MIT (lucide: ISC) |
| fflate, zod, idb, exifr | MIT |
| IBM Plex Sans, IBM Plex Mono | SIL Open Font License 1.1 |
| Newsreader | SIL Open Font License 1.1 |
| Workbox (via vite-plugin-pwa) | MIT |

## Not bundled yet

| Component | Licence | Status |
|---|---|---|
| rawler (pure-Rust RAW decoder) | LGPL-2.1 | Candidate fallback for RAW files without a usable embedded preview. Would need dynamic linking or source availability for LGPL compliance. |
| LibRaw | LGPL-2.1 or CDDL-1.0 | Alternative to rawler. |
| ffmpeg | LGPL or GPL depending on build | Only for the future video feature. Must use an LGPL build. |

## Test fixtures

The RAW samples used in testing come from [raw.pixls.us](https://raw.pixls.us/), which publishes them under CC0. They
are not committed to this repository because of their size (≈60 MB each). See `docs/TESTING.md`.
