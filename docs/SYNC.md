# Phone ↔ Desktop Sync (proposal)

Status: proposal, not implemented. For now sync is by hand: move `.framenote` files between devices (Tier 0 without patch files). Constraints come from `SPEC.md`: local-first, offline-first,
no accounts, no cloud uploads, no telemetry, phone used through a browser (PWA) without
installing a native app.

## 1. Division of roles

| | Desktop (Tauri) | Phone (PWA) |
|---|---|---|
| Folder import, ExifTool metadata | yes | no |
| Produces presentation assets + thumbnails | yes | yes (JPEG, and RAW via embedded preview) |
| Edits captions, species, location, notes | yes | yes |
| Reorders images, presentation settings | yes | yes |
| Presents fullscreen | yes | yes |

Assets are produced on desktop and never change after import. The phone mostly edits
small text fields. Because of that, sync is mostly about moving **small manifest changes**.
Large image files move once and are never merged.

## 2. Data model changes needed before format v1 is frozen

1. **Content-addressed assets.** Asset identity = sha256 (already in `checksum`). A device only
   requests hashes it does not have. Images are never transferred twice.
2. **Per-field edit clocks.** Each user-editable field gets a timestamp and the device id that
   last changed it:
   ```json
   "user": {
     "caption": "Waiting in the sal forest…",
     "species": "Bengal tiger"
   },
   "userMeta": {
     "caption": { "updatedAt": "2026-10-15T10:02:11Z", "by": "device-7f3a" },
     "species": { "updatedAt": "2026-10-14T18:40:00Z", "by": "device-1c22" }
   }
   ```
   Same idea for `order`, `presentation.overlay.*` and assignment `title`/`notes`.
3. **Tombstones** for removed images (`removedAt`), so a deletion on one device is not
   undone by the other device's older copy.
4. **`deviceId`** generated once per install and stored locally. It is not an account.

Merge rule: **per-field last-writer-wins**, using a hybrid logical clock so device clock skew
cannot reorder edits. Captions are short single-author text, so a full CRDT (Yjs/Automerge) is
not justified for v1. If both sides changed the same caption since the last sync, keep the newer
one and store the older one in `rawMetadata.conflicts[]`, then show a small "edited on another
device" notice the user can resolve.

## 3. Transports (ship in this order)

### Tier 0: file hand-off (already in spec, always works)
Desktop exports `.framenote`. User sends it via AirDrop, Nearby Share, USB, email, or a cloud
drive. The phone imports it through the file picker.
Going back: the phone exports a **notes patch** (`.framenote-patch`, a few KB containing only
changed fields and clocks), not the full bundle. Desktop merges it with the rules above.
This needs no network code at all and is the guaranteed fallback.

### Tier 1: LAN pairing via QR code (recommended main path)
1. Desktop → "Send to phone". Tauri starts a local HTTP server on the LAN interface
   (random port, only while the panel is open) and shows a QR code containing
   `http://<lan-ip>:<port>/#pair=<one-time-token>`.
2. Phone camera → opens the URL. **The desktop serves the web app itself**, so the page and the
   API share the same origin. This avoids the mixed-content / Private Network Access blocks you
   would hit when a hosted HTTPS PWA tries to call `http://192.168.x.x`.
3. The token (single use, expires after a few minutes) is exchanged for a session key. The phone
   shows the assignments the user chose to share.
4. Pull: the phone fetches the manifest, then missing assets by hash, thumbnails first.
   Push: caption edits go to the desktop as patches. During a live session the phone can also act
   as a **remote control / second screen** for presentations.
5. "Keep on this phone": the phone downloads the bundle as `.framenote` and imports it into the
   installed PWA, which runs on a secure origin and therefore has offline support and persistent
   storage.

Honest limitations:
- A plain-HTTP LAN origin is not a secure context. Service workers, `navigator.storage.persist()`
  and PWA install are not available on it. That is why long-term storage happens in the installed
  PWA (step 5), not in the LAN session.
- Self-signed HTTPS would fix this but triggers full-page certificate warnings on iOS and Android,
  so it is not the default.
- Guest Wi-Fi with client isolation blocks the connection. The fallback is Tier 0.
- Traffic is plain HTTP on the LAN. Mitigations: one-time token, session-scoped key, server bound
  only while the panel is open, explicit list of shared assignments, optional patch-level
  encryption using the key from the QR code.

### Tier 2: user-owned folder sync (optional)
Desktop can mirror selected assignments as `.framenote` files plus patch files into a folder
the user picks (iCloud Drive, Dropbox, OneDrive, Google Drive, Syncthing). The phone opens them
from the Files app. Frame Notes never talks to those services. The OS client does the sync, so
the no-accounts and no-cloud principles still hold.

### Tier 3: native mobile app (later, only if needed)
Tauri 2 also targets iOS and Android. A native build would add mDNS discovery, pinned TLS
(certificate fingerprint in the QR code), background transfer, and direct share-sheet import.
That removes the Tier 1 limitations. Build it only if the PWA path proves insufficient,
because it brings App Store / Play Store distribution.

## 4. Sync protocol sketch (Tier 1 and patch files share it)

```
GET  /api/assignments                     -> [{id, title, revisionClock}]
GET  /api/assignments/:id/manifest        -> manifest + per-field clocks
GET  /api/assets/:sha256                  -> image bytes (immutable, cacheable)
POST /api/assignments/:id/patch           <- {deviceId, baseClock, ops:[{path, value, clock}]}
                                          -> {merged manifest clocks, conflicts[]}
```
The same `ops` structure is written into `.framenote-patch` files. The merge function lives in
`packages/core` and is unit tested once. Desktop, web, the LAN server and the patch importer all
use it.

## 5. Implementation order

1. Add the data-model fields (section 2) to the v1 schema before any bundle ships.
2. Build the `core` merge function and patch format with tests: concurrent edits, clock skew,
   tombstones, idempotent re-apply.
3. Ship Tier 0 patch export/import on the phone and on desktop.
4. Add the Tier 1 LAN server in Tauri (e.g. `axum`), QR code, and pairing.
5. Add Tier 2 folder mirroring if users need it.
