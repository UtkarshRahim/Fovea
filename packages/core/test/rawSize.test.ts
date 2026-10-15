import { describe, expect, it } from "vitest";
import { formatOriginalSize, rawImageSize } from "../src";

type Entry = [tag: number, type: 3 | 4, values: number[]];

/** Little-endian TIFF with IFDs laid out in order. Values are written inline, so each entry holds one value. */
function tiff(ifds: Entry[][], opts: { next?: Record<number, number>; subIfds?: Record<number, number[]> } = {}): Uint8Array {
  const sizes = ifds.map((e, i) => 2 + (e.length + (opts.subIfds?.[i] ? 1 : 0)) * 12 + 4);
  const offsets: number[] = [];
  let o = 8;
  for (const s of sizes) {
    offsets.push(o);
    o += s;
  }
  const buf = new Uint8Array(o + 64);
  const v = new DataView(buf.buffer);
  buf.set([0x49, 0x49]);
  v.setUint16(2, 42, true);
  v.setUint32(4, offsets[0]!, true);
  ifds.forEach((entries, i) => {
    const all: Entry[] = [...entries];
    const subs = opts.subIfds?.[i];
    if (subs) all.push([0x014a, 4, subs.map((s) => offsets[s]!)]);
    let p = offsets[i]!;
    v.setUint16(p, all.length, true);
    p += 2;
    for (const [tag, type, values] of all) {
      v.setUint16(p, tag, true);
      v.setUint16(p + 2, type, true);
      v.setUint32(p + 4, values.length, true);
      if (type === 3) v.setUint16(p + 8, values[0]!, true);
      else v.setUint32(p + 8, values[0]!, true);
      p += 12;
    }
    const next = opts.next?.[i];
    v.setUint32(p, next === undefined ? 0 : offsets[next]!, true);
  });
  return buf;
}

const size = (w: number, h: number, subfile?: number): Entry[] => [
  ...(subfile === undefined ? [] : [[0x00fe, 4, [subfile]] as Entry]),
  [0x0100, 4, [w]],
  [0x0101, 3, [h]],
];

describe("rawImageSize", () => {
  it("skips the IFD0 thumbnail and finds the full-resolution SubIFD, like a Nikon NEF", () => {
    const nef = tiff([size(160, 120, 1), size(6064, 4040, 0), size(1520, 1010, 1)], { subIfds: { 0: [1] }, next: { 1: 2 } });
    expect(rawImageSize(nef)).toEqual({ width: 6064, height: 4040 });
  });

  it("follows the IFD chain and survives loops", () => {
    const looped = tiff([size(160, 120, 1), size(8288, 5520)], { next: { 0: 1, 1: 0 } });
    expect(rawImageSize(looped)).toEqual({ width: 8288, height: 5520 });
  });

  it("returns null when there is no full-resolution image or the file is not TIFF", () => {
    expect(rawImageSize(tiff([size(160, 120, 1)]))).toBeNull();
    expect(rawImageSize(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x63, 0x72, 0x78, 0x20]))).toBeNull();
    expect(rawImageSize(new Uint8Array(4))).toBeNull();
  });

  it("ignores offsets that point outside the file", () => {
    const bad = tiff([size(160, 120, 1)]);
    new DataView(bad.buffer).setUint32(4, 0xfffffff0, true);
    expect(rawImageSize(bad)).toBeNull();
  });
});

describe("formatOriginalSize", () => {
  it("shows the recorded size", () => {
    expect(formatOriginalSize({ dimensions: { width: 8288, height: 5520 }, assetDimensions: { width: 4096, height: 2728 } })).toBe("8288 × 5520");
  });

  it("hides a size smaller than the stored image, such as an old 160 × 120 thumbnail value", () => {
    expect(formatOriginalSize({ dimensions: { width: 160, height: 120 }, assetDimensions: { width: 4096, height: 2728 } })).toBeUndefined();
    expect(formatOriginalSize({})).toBeUndefined();
  });
});
