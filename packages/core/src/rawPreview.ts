export interface EmbeddedJpeg {
  offset: number;
  length: number;
  width: number;
  height: number;
  progressive: boolean;
}

const SOF_DECODABLE = new Set([0xc0, 0xc1, 0xc2]);
const SOF_UNSUPPORTED = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Parses a JPEG starting at `start` (which must point at FF D8). Returns null if it is not a complete, browser-decodable JPEG. */
export function parseJpegAt(data: Uint8Array, start: number): EmbeddedJpeg | null {
  const n = data.length;
  if (start + 4 > n || data[start] !== 0xff || data[start + 1] !== 0xd8 || data[start + 2] !== 0xff) return null;
  let p = start + 2;
  let width = 0;
  let height = 0;
  let progressive = false;
  let sawSof = false;
  while (p < n) {
    if (data[p] !== 0xff) return null;
    while (p < n && data[p] === 0xff) p++;
    if (p >= n) return null;
    const marker = data[p]!;
    p++;
    if (marker === 0xd9) {
      if (!sawSof) return null;
      return { offset: start, length: p - start, width, height, progressive };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd8 || marker === 0x00) return null;
    if (p + 2 > n) return null;
    const len = (data[p]! << 8) | data[p + 1]!;
    if (len < 2 || p + len > n) return null;
    if (SOF_UNSUPPORTED.has(marker)) return null;
    if (SOF_DECODABLE.has(marker)) {
      if (len < 8) return null;
      height = (data[p + 3]! << 8) | data[p + 4]!;
      width = (data[p + 5]! << 8) | data[p + 6]!;
      if (!width || !height) return null;
      progressive = marker === 0xc2;
      sawSof = true;
    }
    p += len;
    if (marker === 0xda) {
      if (!sawSof) return null;
      // Entropy-coded data: FF is followed by 00 (stuffing) or RSTn inside the scan.
      for (;;) {
        const ff = data.indexOf(0xff, p);
        if (ff < 0 || ff + 1 >= n) return null;
        const next = data[ff + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
          p = ff + (next === 0xff ? 1 : 2);
          continue;
        }
        p = ff;
        break;
      }
    }
  }
  return null;
}

/** Finds every complete, decodable JPEG embedded in the buffer (RAW previews, CR3 tracks, TIFF strips). */
export function findEmbeddedJpegs(data: Uint8Array, maxCandidates = 16): EmbeddedJpeg[] {
  const found: EmbeddedJpeg[] = [];
  let i = 0;
  while (i < data.length - 3 && found.length < maxCandidates) {
    const ff = data.indexOf(0xff, i);
    if (ff < 0 || ff + 2 >= data.length) break;
    if (data[ff + 1] === 0xd8 && data[ff + 2] === 0xff) {
      const jpeg = parseJpegAt(data, ff);
      if (jpeg) {
        found.push(jpeg);
        i = ff + jpeg.length;
        continue;
      }
    }
    i = ff + 1;
  }
  return found;
}

export function largestEmbeddedJpeg(data: Uint8Array): EmbeddedJpeg | null {
  let best: EmbeddedJpeg | null = null;
  for (const j of findEmbeddedJpegs(data)) {
    if (!best || j.width * j.height > best.width * best.height) best = j;
  }
  return best;
}

export type SourceKind = "jpeg" | "png" | "tiff" | "raw" | "heic" | "unknown";

export const RAW_EXTENSIONS = ["nef", "nrw", "cr2", "cr3", "arw", "srf", "sr2", "dng", "raf", "orf", "rw2", "pef"];
export const TESTED_RAW_EXTENSIONS = ["nef", "cr2", "cr3", "arw"];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function detectSourceKind(name: string, head: Uint8Array): SourceKind {
  const ext = extensionOf(name);
  if (RAW_EXTENSIONS.includes(ext)) return "raw";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
  const ftyp = String.fromCharCode(...head.subarray(4, 12));
  if (ftyp.startsWith("ftypcrx")) return "raw";
  if (/^ftyp(heic|heix|mif1|hevc)/.test(ftyp)) return "heic";
  const tiffLE = head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00;
  const tiffBE = head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a;
  if (tiffLE || tiffBE) return ext === "tif" || ext === "tiff" ? "tiff" : "raw";
  if (ext === "jpg" || ext === "jpeg") return "jpeg";
  return "unknown";
}
