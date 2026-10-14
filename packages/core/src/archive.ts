import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync, type Unzipped, type Zippable } from "fflate";
import { sortedImages, type Manifest } from "./manifest";
import { FramenoteError, parseManifest } from "./validate";
import { sha256Hex } from "./checksum";

export const LIMITS = {
  maxManifestBytes: 8 * 1024 * 1024,
  maxEntries: 4002,
  maxTotalUncompressedBytes: 4 * 1024 * 1024 * 1024,
  maxEntryBytes: 512 * 1024 * 1024,
};
export type Limits = typeof LIMITS;

const ROOT_FILES = new Set(["manifest.json", "README.txt"]);

/** Returns a reason string if the archive entry path is unsafe, otherwise null. */
export function unsafePathReason(path: string): string | null {
  if (path.length === 0) return "empty path";
  if (path.includes("\0")) return "contains a null byte";
  if (path.includes("\\")) return "contains a backslash";
  if (path.startsWith("/")) return "is an absolute path";
  if (/^[A-Za-z]:/.test(path)) return "contains a drive letter";
  const parts = path.split("/");
  if (parts.some((p) => p === ".." || p === ".")) return "contains . or .. segments";
  if (parts.slice(0, -1).some((p) => p === "")) return "contains empty segments";
  return null;
}

function normalise(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export interface ImportWarning {
  imageId?: string;
  message: string;
}

export interface UnpackedFramenote {
  manifest: Manifest;
  /** Relative asset path → bytes. */
  assets: Map<string, Uint8Array>;
  warnings: ImportWarning[];
  /** Image ids whose checksum did not match. */
  checksumMismatches: string[];
}

interface CentralEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

/** Reads the ZIP central directory without inflating anything, so limits are checked before decompression. */
export function readCentralDirectory(data: Uint8Array): CentralEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const minEocd = 22;
  if (data.length < minEocd) throw new FramenoteError("The file is too small to be a ZIP archive.", "corrupt-archive");
  let eocd = -1;
  const stop = Math.max(0, data.length - minEocd - 65535);
  for (let i = data.length - minEocd; i >= stop; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FramenoteError("This file is not a valid ZIP archive.", "corrupt-archive");
  let count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) {
      throw new FramenoteError("ZIP64 archive is missing its locator record.", "corrupt-archive");
    }
    const z64 = Number(view.getBigUint64(locator + 8, true));
    if (z64 < 0 || z64 + 56 > data.length || view.getUint32(z64, true) !== 0x06064b50) {
      throw new FramenoteError("ZIP64 end record is invalid.", "corrupt-archive");
    }
    count = Number(view.getBigUint64(z64 + 32, true));
    cdOffset = Number(view.getBigUint64(z64 + 48, true));
  }
  if (count > LIMITS.maxEntries) {
    throw new FramenoteError(`The archive has ${count} entries; the limit is ${LIMITS.maxEntries}.`, "limits-exceeded");
  }
  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || view.getUint32(p, true) !== 0x02014b50) {
      throw new FramenoteError("The ZIP central directory is corrupt.", "corrupt-archive");
    }
    let compressedSize = view.getUint32(p + 20, true);
    let uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = new TextDecoder().decode(data.subarray(p + 46, p + 46 + nameLen));
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = view.getUint16(e, true);
        const size = view.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(view.getBigUint64(q, true));
            q += 8;
          }
          if (compressedSize === 0xffffffff) compressedSize = Number(view.getBigUint64(q, true));
        }
        e += 4 + size;
      }
    }
    entries.push({ name, compressedSize, uncompressedSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Streams the archive and counts real inflated bytes, so lying size headers cannot cause a zip bomb. */
function unzipLimited(data: Uint8Array, limits: Limits): Unzipped {
  const out: Unzipped = {};
  let total = 0;
  let failure: Error | null = null;
  const uz = new Unzip((file) => {
    if (failure) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = new FramenoteError(`The archive could not be read: ${err.message}`, "corrupt-archive");
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > limits.maxEntryBytes || total > limits.maxTotalUncompressedBytes) {
        failure = new FramenoteError("The archive expands beyond the size limit and was rejected.", "limits-exceeded");
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) {
        const buf = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          buf.set(c, o);
          o += c.length;
        }
        out[file.name] = buf;
      }
    };
    file.start();
  });
  uz.register(UnzipInflate);
  try {
    uz.push(data, true);
  } catch (e) {
    failure ??= new FramenoteError(`The archive could not be read: ${(e as Error).message}`, "corrupt-archive");
  }
  if (failure) throw failure;
  return out;
}

export async function unpackFramenote(data: Uint8Array, limits: Limits = LIMITS): Promise<UnpackedFramenote> {
  const entries = readCentralDirectory(data);
  const seen = new Set<string>();
  let total = 0;
  for (const e of entries) {
    if (e.name.endsWith("/")) continue;
    const reason = unsafePathReason(e.name);
    if (reason) throw new FramenoteError(`Rejected unsafe archive entry "${e.name}": ${reason}.`, "unsafe-path");
    const norm = normalise(e.name);
    if (seen.has(norm)) throw new FramenoteError(`The archive contains a duplicate entry "${e.name}".`, "unsafe-path");
    seen.add(norm);
    if (!ROOT_FILES.has(e.name) && !e.name.startsWith("assets/")) {
      throw new FramenoteError(`Unexpected file "${e.name}" outside assets/.`, "unsafe-path");
    }
    if (e.uncompressedSize > limits.maxEntryBytes) {
      throw new FramenoteError(`"${e.name}" is larger than the per-file limit.`, "limits-exceeded");
    }
    if (e.name === "manifest.json" && e.uncompressedSize > limits.maxManifestBytes) {
      throw new FramenoteError("manifest.json is larger than the 8 MB limit.", "limits-exceeded");
    }
    total += e.uncompressedSize;
  }
  if (total > limits.maxTotalUncompressedBytes) {
    throw new FramenoteError("The archive expands beyond the size limit and was rejected.", "limits-exceeded");
  }
  if (!seen.has("manifest.json")) {
    throw new FramenoteError("This archive has no manifest.json, so it is not a Frame Note file.", "not-a-framenote");
  }

  const files = unzipLimited(data, limits);
  const localSeen = new Set<string>();
  for (const name of Object.keys(files)) {
    if (name.endsWith("/")) continue;
    if (unsafePathReason(name)) throw new FramenoteError(`Rejected unsafe archive entry "${name}".`, "unsafe-path");
    if (!seen.has(normalise(name)) || localSeen.has(normalise(name))) {
      throw new FramenoteError(`The archive's file list is inconsistent ("${name}").`, "corrupt-archive");
    }
    localSeen.add(normalise(name));
  }

  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) throw new FramenoteError("manifest.json is missing.", "not-a-framenote");
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new FramenoteError("manifest.json is not valid JSON.", "invalid-manifest");
  }
  const manifest = parseManifest(json);

  const referenced = new Set<string>();
  for (const img of manifest.images) {
    referenced.add(img.asset);
    referenced.add(img.thumbnail);
  }
  for (const name of Object.keys(files)) {
    if (name.endsWith("/") || ROOT_FILES.has(name)) continue;
    if (!referenced.has(name)) {
      throw new FramenoteError(`The archive contains "${name}", which the manifest does not reference.`, "unsafe-path");
    }
  }

  const assets = new Map<string, Uint8Array>();
  const warnings: ImportWarning[] = [];
  const checksumMismatches: string[] = [];
  for (const img of manifest.images) {
    const asset = files[img.asset];
    const thumb = files[img.thumbnail];
    if (!asset || !thumb) {
      throw new FramenoteError(
        `Image "${img.originalFilename}" is missing ${!asset ? img.asset : img.thumbnail} in the archive.`,
        "missing-asset",
      );
    }
    const [a, t] = await Promise.all([sha256Hex(asset), sha256Hex(thumb)]);
    if (a !== img.checksum.asset || t !== img.checksum.thumbnail) {
      checksumMismatches.push(img.id);
      warnings.push({ imageId: img.id, message: `"${img.originalFilename}" failed its checksum check and may be damaged.` });
    }
    assets.set(img.asset, asset);
    assets.set(img.thumbnail, thumb);
  }
  return { manifest, assets, warnings, checksumMismatches };
}

export const README_TEXT = `FRAME NOTE ASSIGNMENT
=====================

This .framenote file is a standard ZIP archive created by Frame Note, a
presentation and review tool for photographers.

Contents
  manifest.json        Assignment title, notes, image order, captions,
                       camera metadata and presentation settings (JSON).
  assets/images/       Presentation-ready JPEG images.
  assets/thumbnails/   Small preview images.

How to open it
  Open the file in the Frame Note desktop app, or in the Frame Note web app
  in any modern browser (desktop, Android, iPhone, iPad). No account needed.

You can also unzip it with any ZIP tool to get at the images directly.
The original camera RAW files are not included.
`;

export interface PackOptions {
  stripGps?: boolean;
  appVersion?: string;
  platform?: "web" | "desktop";
}

/** Builds a .framenote ZIP. `getAsset` returns bytes for a relative asset path. */
export async function packFramenote(
  manifest: Manifest,
  getAsset: (path: string) => Promise<Uint8Array>,
  opts: PackOptions = {},
): Promise<Uint8Array> {
  const images = sortedImages(manifest).map((img, order) => {
    const copy = { ...img, order };
    if (opts.stripGps) delete copy.gps;
    return copy;
  });
  const out: Manifest = {
    ...manifest,
    images,
    generator: {
      ...manifest.generator,
      version: opts.appVersion ?? manifest.generator.version,
      platform: opts.platform ?? manifest.generator.platform,
    },
  };
  parseManifest(JSON.parse(JSON.stringify(out)));

  const files: Zippable = {
    "manifest.json": [strToU8(JSON.stringify(out, null, 2)), { level: 6 }],
    "README.txt": [strToU8(README_TEXT), { level: 6 }],
  };
  for (const img of images) {
    for (const p of [img.asset, img.thumbnail]) {
      files[p] = [await getAsset(p), { level: 0 }];
    }
  }
  return zipSync(files, { level: 0 });
}
