/**
 * Reads the few Nikon maker-note fields that place the AF area, for environments without ExifTool (the web app).
 * Covers the mirrorless bodies that record AF-area coordinates: AFInfo2 versions 0300 (Z6/Z7 family, Z5, Z50, Z fc, Z30)
 * and 0400–0402 (Z8, Z9, Z f, Z6III, Z50II, Z5II). Output uses ExifTool tag names so `focusAreasFromTags` can read it.
 */

const AF_LAYOUT: Record<string, number> = { "0300": 0x2a, "0400": 0x3e, "0401": 0x3e, "0402": 0x3e };

export function nikonFocusTags(makerNote: Uint8Array): Record<string, unknown> | null {
  const ascii = (o: number, n: number) => String.fromCharCode(...makerNote.subarray(o, o + n));
  if (makerNote.length < 18 || ascii(0, 6) !== "Nikon\0") return null;
  const base = 10;
  const order = ascii(base, 2);
  if (order !== "MM" && order !== "II") return null;
  const view = new DataView(makerNote.buffer, makerNote.byteOffset, makerNote.byteLength);
  const le = order === "II";
  const u16 = (o: number) => (o + 2 <= view.byteLength ? view.getUint16(o, le) : undefined);
  const u32 = (o: number) => (o + 4 <= view.byteLength ? view.getUint32(o, le) : undefined);

  const ifd = u32(base + 4);
  const count = ifd === undefined ? undefined : u16(base + ifd);
  if (ifd === undefined || count === undefined || count > 1000) return null;

  const out: Record<string, unknown> = {};
  for (let i = 0; i < count; i++) {
    const e = base + ifd + 2 + i * 12;
    const tag = u16(e);
    const n = u32(e + 4);
    const ptr = u32(e + 8);
    if (tag === undefined || n === undefined || ptr === undefined) break;
    const at = n > 4 ? base + ptr : e + 8;
    if (tag === 0x001b && n === 7 && u16(e + 2) === 3) {
      const v = Array.from({ length: 7 }, (_, k) => u16(at + k * 2));
      if (v.every((x) => x !== undefined)) out.CropHiSpeed = v.join(" ");
    } else if (tag === 0x00b7 && at + n <= makerNote.length) {
      const version = ascii(at, 4);
      const off = AF_LAYOUT[version];
      if (off === undefined || makerNote[at + 7] !== 1 || off + 12 > n) continue;
      const af = new DataView(makerNote.buffer, makerNote.byteOffset + at, n);
      const [w, h, x, y, aw, ah] = [0, 2, 4, 6, 8, 10].map((k) => af.getUint16(off + k, le));
      if (w && h) Object.assign(out, { AFImageWidth: w, AFImageHeight: h, AFAreaXPosition: x, AFAreaYPosition: y, AFAreaWidth: aw, AFAreaHeight: ah });
    }
  }
  return Object.keys(out).length ? out : null;
}
