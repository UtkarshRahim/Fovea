# Frame Notes

A local-first photography presentation and review tool for wildlife photographers.
Desktop app for macOS and Windows (Tauri 2) plus an installable, responsive web app (PWA)
for Android, iPhone and iPad. Both share one codebase and one portable assignment file format.

> Working title in the spec is **FIELDNOTE** (`.fieldnote` files). Final product name and
> file extension are pending confirmation.

## Status

Specification stage. No application code yet.

- [`docs/SPEC.md`](docs/SPEC.md) — full build specification (product, format, screens, testing, phases)
- [`docs/SYNC.md`](docs/SYNC.md) — proposed phone ↔ desktop sync design

## Planned stack

- Desktop: Tauri 2 (Rust) + React + TypeScript + Vite
- Web / mobile: same React UI as a PWA, IndexedDB storage, offline service worker
- Shared logic: `packages/core` (pure TypeScript, Zod schemas, ZIP pack/unpack via `fflate`)
- Metadata: ExifTool sidecar on desktop, `exifr` in the browser
- Tooling: pnpm workspace, Vitest, React Testing Library, `cargo test`

## Running locally

Instructions will be added with the first runnable slice (Phase 2: shared format + web MVP).
