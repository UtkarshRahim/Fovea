# The `.framenote` format (version 1)

A `.framenote` file is a standard ZIP archive. Any unzip tool can open it.

```
assignment.framenote
├── manifest.json            deflated
├── README.txt               deflated, plain-text explanation for humans
└── assets/
    ├── images/<id>.jpg      stored (no extra compression), upright, ≤ 4096 px long edge
    └── thumbnails/<id>.jpg  stored, ≤ 512 px long edge
```

The JSON Schema is in [`framenote.schema.json`](framenote.schema.json). It is generated from the Zod schema in
`packages/core/src/manifest.ts` with `pnpm schema`.

## Manifest

```json
{
  "format": "framenote",
  "formatVersion": 1,
  "assignmentId": "8a3c3b0e-6f0e-4e7b-9b1c-3c0f8f4b2d11",
  "title": "Sal Forest Assignment",
  "notes": "Optional assignment-level notes",
  "createdAt": "2026-10-15T10:00:00.000Z",
  "modifiedAt": "2026-10-15T10:00:00.000Z",
  "generator": { "app": "framenote", "version": "0.1.0", "platform": "desktop" },
  "presentation": {
    "fitMode": "contain",
    "overlay": {
      "visible": true, "placement": "bottom", "theme": "dark",
      "fontSize": 16, "paddingX": 40, "paddingY": 22, "backgroundOpacity": 0.85,
      "fields": ["focalLength", "aperture", "shutterSpeed", "iso"],
      "showCaption": true, "showTitle": true, "labelledGrid": true
    }
  },
  "images": [
    {
      "id": "img-3f9a1c2b7d4e5f60",
      "type": "image",
      "order": 0,
      "originalFilename": "Z9_01234.NEF",
      "asset": "assets/images/img-3f9a1c2b7d4e5f60.jpg",
      "thumbnail": "assets/thumbnails/img-3f9a1c2b7d4e5f60.jpg",
      "assetSource": "embedded-preview",
      "checksum": { "algorithm": "sha256", "asset": "<64 hex>", "thumbnail": "<64 hex>" },
      "dimensions": { "width": 8280, "height": 5520 },
      "assetDimensions": { "width": 4096, "height": 2731 },
      "orientation": 1,
      "camera": { "make": "NIKON CORPORATION", "model": "NIKON Z 9" },
      "lens": { "model": "NIKKOR Z 600mm f/4 TC VR S" },
      "exposure": { "aperture": 5.6, "shutterSpeedSeconds": 0.000625, "iso": 800, "focalLengthMm": 600, "exposureCompensationEv": 0 },
      "capturedAt": "2026-03-14T06:42:11",
      "user": { "caption": "Waiting in the sal forest before crossing the trail.", "species": "Bengal tiger", "location": "Bandhavgarh", "updatedAt": "2026-10-15T10:02:11.000Z" },
      "comments": [{ "id": "uuid", "author": "Asha", "text": "Lovely timing.", "createdAt": "2026-10-15T11:00:00.000Z" }],
      "rawMetadata": { "LensID": "…", "sourceOrientation": 6 }
    }
  ]
}
```

### Field notes

- **Missing camera metadata is omitted.** Readers must not invent values.
- `capturedAt` is the camera's local time without a zone, as recorded in EXIF.
- `assetSource` is one of `embedded-preview`, `raw-decoded`, `original-jpeg`, `original-png`, `tiff-converted`. It
  states honestly how the displayed asset was produced.
- `orientation` is `1` because stored assets are already upright. The source value is kept in
  `rawMetadata.sourceOrientation`.
- `gps` appears only if the source had it and the exporter chose to include it. GPS is stripped by default.
- `comments` can be written by anyone using the app. `author` is optional free text, not an identity.
- `"type": "video"` is reserved (`duration`, `codec`, `frameRate`, `poster`). Version-1 readers reject it with a
  clear message.

## Reader rules

A reader **must**:

1. Reject archives with entries that are absolute, contain `..`, `.`, backslashes, drive letters, null bytes, or
   duplicate case-insensitive names.
2. Reject entries other than `manifest.json` and `README.txt` that are outside `assets/` or not referenced by the
   manifest.
3. Enforce limits before and during decompression: 8 MB manifest, 4002 entries, 512 MB per entry, 4 GB total. Count
   real inflated bytes, not declared sizes.
4. Refuse `formatVersion` newer than it supports, with a message naming both versions. Migrate older versions
   through `migrate()`.
5. Verify SHA-256 checksums and flag mismatching images as warnings rather than failing the import.
6. Never overwrite an existing assignment. If `assignmentId` exists, import a copy with a new id and the title suffix
   " (imported)".

## Versioning

`formatVersion` is an integer. A change that existing readers cannot ignore bumps it and adds an entry to
`migrations` in `packages/core/src/validate.ts`.
