import { describe, expect, it } from "vitest";
import { detectSourceKind, findEmbeddedJpegs, largestEmbeddedJpeg, orientationHeader, parseJpegAt } from "../src";
import { concat, fakeJpeg } from "./helpers";

const tiffHeader = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0, 0xff, 0xd8, 0x00, 0x13]);
const noise = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = s & 0xff;
  }
  return out;
};

describe("embedded JPEG extraction", () => {
  it("parses a JPEG and its dimensions", () => {
    const j = fakeJpeg(6048, 4032);
    expect(parseJpegAt(j, 0)).toMatchObject({ offset: 0, length: j.length, width: 6048, height: 4032, progressive: false });
  });

  it("picks the largest preview inside a RAW-like container", () => {
    const thumb = fakeJpeg(160, 120);
    const mid = fakeJpeg(1620, 1080);
    const full = fakeJpeg(8256, 5504);
    const raw = concat(tiffHeader, noise(500), thumb, noise(300), full, noise(1000, 3), mid, noise(200, 9));
    const all = findEmbeddedJpegs(raw);
    expect(all.map((j) => j.width)).toEqual([160, 8256, 1620]);
    const best = largestEmbeddedJpeg(raw)!;
    expect(best.width).toBe(8256);
    expect(raw.subarray(best.offset, best.offset + best.length)).toEqual(full);
  });

  it("ignores lossless JPEG (raw sensor data in CR2)", () => {
    const lossless = fakeJpeg(8000, 6000, 0xc3);
    const preview = fakeJpeg(1620, 1080);
    expect(largestEmbeddedJpeg(concat(tiffHeader, lossless, noise(100), preview))!.width).toBe(1620);
  });

  it("ignores truncated JPEGs", () => {
    const j = fakeJpeg(4000, 3000);
    expect(largestEmbeddedJpeg(concat(tiffHeader, j.subarray(0, j.length - 4)))).toBeNull();
  });

  it("returns null when nothing usable is present", () => {
    expect(largestEmbeddedJpeg(noise(10000))).toBeNull();
  });

  it("detects source kinds", () => {
    expect(detectSourceKind("a.NEF", tiffHeader)).toBe("raw");
    expect(detectSourceKind("a.jpg", fakeJpeg(1, 1))).toBe("jpeg");
    expect(detectSourceKind("a.tif", tiffHeader)).toBe("tiff");
    const cr3 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypcrx ")]);
    expect(detectSourceKind("IMG_1.dat", cr3)).toBe("raw");
    const heic = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]);
    expect(detectSourceKind("IMG_1.HEIC", heic)).toBe("heic");
  });
});

describe("orientationHeader", () => {
  it("is a valid APP1 segment holding one Orientation tag", () => {
    const jpeg = fakeJpeg(64, 48);
    for (const o of [3, 6, 8]) {
      const header = orientationHeader(o);
      const view = new DataView(header.buffer);
      expect(view.getUint16(4)).toBe(header.length - 4);
      expect(new TextDecoder().decode(header.subarray(6, 10))).toBe("Exif");
      const tiff = 12;
      expect(view.getUint16(tiff)).toBe(0x4d4d);
      expect(view.getUint16(tiff + view.getUint32(tiff + 4))).toBe(1);
      const entry = tiff + view.getUint32(tiff + 4) + 2;
      expect(view.getUint16(entry)).toBe(0x0112);
      expect(view.getUint16(entry + 8)).toBe(o);
      expect(parseJpegAt(concat(header, jpeg.subarray(2)), 0)).not.toBeNull();
    }
  });
});
