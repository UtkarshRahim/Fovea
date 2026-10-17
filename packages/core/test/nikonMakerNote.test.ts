import { describe, expect, it } from "vitest";
import { nikonFocusTags } from "../src";

/** A type-3 Nikon maker note ("Nikon\0" + TIFF header) holding CropHiSpeed and an AFInfo2 block. */
function makerNote(opts: { version?: string; coords?: 0 | 1; little?: boolean; crop?: number[]; af?: number[] }) {
  const { version = "0400", coords = 1, little = false, crop = [2, 8280, 5520, 5408, 3608, 1436, 956], af = [8256, 5504, 4654, 3241, 152, 152] } = opts;
  const afOffset = version === "0300" ? 0x2a : 0x3e;
  const afLen = afOffset + 16;
  const ifd = 8;
  const cropAt = ifd + 2 + 2 * 12 + 4;
  const afAt = cropAt + 14;
  const tiff = new DataView(new ArrayBuffer(afAt + afLen));
  const le = little;
  tiff.setUint8(0, little ? 0x49 : 0x4d);
  tiff.setUint8(1, little ? 0x49 : 0x4d);
  tiff.setUint16(2, 42, le);
  tiff.setUint32(4, ifd, le);
  tiff.setUint16(ifd, 2, le);
  const entry = (i: number, tag: number, type: number, count: number, offset: number) => {
    const e = ifd + 2 + i * 12;
    tiff.setUint16(e, tag, le);
    tiff.setUint16(e + 2, type, le);
    tiff.setUint32(e + 4, count, le);
    tiff.setUint32(e + 8, offset, le);
  };
  entry(0, 0x001b, 3, 7, cropAt);
  entry(1, 0x00b7, 7, afLen, afAt);
  crop.forEach((v, k) => tiff.setUint16(cropAt + k * 2, v, le));
  [...version].forEach((c, k) => tiff.setUint8(afAt + k, c.charCodeAt(0)));
  tiff.setUint8(afAt + 7, coords);
  af.forEach((v, k) => tiff.setUint16(afAt + afOffset + k * 2, v, le));
  const head = new Uint8Array([0x4e, 0x69, 0x6b, 0x6f, 0x6e, 0x00, 0x02, 0x11, 0x00, 0x00]);
  const out = new Uint8Array(head.length + tiff.byteLength);
  out.set(head);
  out.set(new Uint8Array(tiff.buffer), head.length);
  return out;
}

describe("nikonFocusTags", () => {
  it("reads the Z9 AF area and DX crop with the values ExifTool reports", () => {
    expect(nikonFocusTags(makerNote({}))).toEqual({
      CropHiSpeed: "2 8280 5520 5408 3608 1436 956",
      AFImageWidth: 8256,
      AFImageHeight: 5504,
      AFAreaXPosition: 4654,
      AFAreaYPosition: 3241,
      AFAreaWidth: 152,
      AFAreaHeight: 152,
    });
  });

  it("reads the Z6/Z7 layout and little-endian notes", () => {
    expect(nikonFocusTags(makerNote({ version: "0300", little: true, af: [6048, 4032, 3000, 2000, 300, 300] }))).toMatchObject({
      AFImageWidth: 6048,
      AFAreaXPosition: 3000,
      AFAreaHeight: 300,
    });
  });

  it("skips the AF area when the camera recorded points instead of coordinates", () => {
    expect(nikonFocusTags(makerNote({ coords: 0 }))).toEqual({ CropHiSpeed: "2 8280 5520 5408 3608 1436 956" });
  });

  it("ignores unknown AFInfo2 versions and non-Nikon data", () => {
    expect(nikonFocusTags(makerNote({ version: "0101" }))).toEqual({ CropHiSpeed: "2 8280 5520 5408 3608 1436 956" });
    expect(nikonFocusTags(new Uint8Array(40))).toBeNull();
    expect(nikonFocusTags(makerNote({}).subarray(0, 30))).toBeNull();
  });
});
