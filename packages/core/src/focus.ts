import type { FocusArea } from "./manifest";

type Tags = Record<string, unknown>;

/** A box in the camera's stored (unrotated) frame, as fractions of the image. Points have zero width and height. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function nums(v: unknown): number[] {
  if (typeof v === "number") return Number.isFinite(v) ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(nums);
  if (typeof v === "string") {
    return v
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
  }
  return [];
}

const one = (v: unknown) => nums(v)[0];

/** Canon stores AF point flags as 16-bit words, lowest bit first. */
function bitIndexes(v: unknown, count: number): number[] {
  const out: number[] = [];
  nums(v).forEach((word, w) => {
    const bits = word & 0xffff;
    for (let b = 0; b < 16; b++) if (bits & (1 << b) && w * 16 + b < count) out.push(w * 16 + b);
  });
  return out;
}

function centred(cx: number, cy: number, w: number, h: number, frameW: number, frameH: number, ox = 0, oy = 0): Box {
  return { x: (cx - w / 2 - ox) / frameW, y: (cy - h / 2 - oy) / frameH, width: w / frameW, height: h / frameH };
}

/** Z and recent DSLR bodies: one AF area, centre and size in AFImage pixels. CropHiSpeed maps DX and aspect crops. */
function nikon(t: Tags): Box[] {
  const afw = one(t.AFImageWidth);
  const afh = one(t.AFImageHeight);
  const cx = one(t.AFAreaXPosition);
  const cy = one(t.AFAreaYPosition);
  if (!afw || !afh || cx === undefined || cy === undefined || (cx === 0 && cy === 0)) return [];
  const w = one(t.AFAreaWidth) ?? 0;
  const h = one(t.AFAreaHeight) ?? 0;
  const [, sensorW, sensorH, cropW, cropH, cropX, cropY] = nums(t.CropHiSpeed);
  if (sensorW && sensorH && cropW && cropH && cropX !== undefined && cropY !== undefined) {
    const sx = afw / sensorW;
    const sy = afh / sensorH;
    return [centred(cx, cy, w, h, cropW * sx, cropH * sy, cropX * sx, cropY * sy)];
  }
  return [centred(cx, cy, w, h, afw, afh)];
}

/** AFInfo2: positions relative to the centre of the AF image. Y points up on EOS bodies and down on compacts. */
function canon(t: Tags): Box[] {
  const afw = one(t.AFImageWidth);
  const afh = one(t.AFImageHeight);
  const xs = nums(t.AFAreaXPositions);
  const ys = nums(t.AFAreaYPositions);
  if (!afw || !afh || !xs.length || xs.length !== ys.length) return [];
  const ws = nums(t.AFAreaWidths ?? t.AFAreaWidth);
  const hs = nums(t.AFAreaHeights ?? t.AFAreaHeight);
  let picked = bitIndexes(t.AFPointsInFocus, xs.length);
  if (!picked.length) picked = bitIndexes(t.AFPointsSelected, xs.length);
  const yDir = one(t.CameraType) === 250 ? 1 : -1;
  return picked.map((i) => {
    const w = ws[i] ?? ws[0] ?? 0;
    const h = hs[i] ?? hs[0] ?? 0;
    return centred(afw / 2 + xs[i]!, afh / 2 + yDir * ys[i]!, w, h, afw, afh);
  });
}

/** FocusLocation: "imageWidth imageHeight x y", the point used for playback zoom. */
function sony(t: Tags): Box[] {
  const [w, h, x, y] = nums(t.FocusLocation);
  if (!w || !h || x === undefined || y === undefined) return [];
  return [{ x: x / w, y: y / h, width: 0, height: 0 }];
}

function fujifilm(t: Tags): Box[] {
  const [x, y] = nums(t.FocusPixel);
  const w = one(t.ExifImageWidth);
  const h = one(t.ExifImageHeight);
  if (!w || !h || x === undefined || y === undefined) return [];
  return [{ x: x / w, y: y / h, width: 0, height: 0 }];
}

/** AFPointSelected: two corners as fractions of the frame. */
function olympus(t: Tags): Box[] {
  const [x1, y1, x2, y2] = nums(t.AFPointSelected);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return [];
  if (!x1 && !y1 && !x2 && !y2) return [];
  return [{ x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }];
}

/** AFPointPosition: centre of the primary AF area as fractions of the frame. */
function panasonic(t: Tags): Box[] {
  const [x, y] = nums(t.AFPointPosition);
  if (x === undefined || y === undefined || x > 1 || y > 1) return [];
  return [{ x, y, width: 0, height: 0 }];
}

/** EXIF SubjectArea (phones and some compacts): point, circle or rectangle in pixels of the stored image. */
function subjectArea(t: Tags): Box[] {
  const v = nums(t.SubjectArea);
  const w = one(t.ExifImageWidth) ?? one(t.ImageWidth);
  const h = one(t.ExifImageHeight) ?? one(t.ImageHeight);
  if (!w || !h || v.length < 2) return [];
  const [x, y, a = 0, b] = v as [number, number, number?, number?];
  if (v.length === 3) return [centred(x, y, a, a, w, h)];
  if (v.length >= 4) return [centred(x, y, a, b ?? a, w, h)];
  return [{ x: x / w, y: y / h, width: 0, height: 0 }];
}

function byMake(t: Tags): Box[] {
  const make = typeof t.Make === "string" ? t.Make.toLowerCase() : "";
  if (make.includes("nikon")) return nikon(t);
  if (make.includes("canon")) return canon(t);
  if (make.includes("sony")) return sony(t);
  if (make.includes("fujifilm")) return fujifilm(t);
  if (make.includes("olympus") || make.includes("om digital")) return olympus(t);
  if (make.includes("panasonic") || make.includes("leica")) return panasonic(t);
  return [];
}

/** Maps a box in the stored frame onto the upright image, following EXIF orientation 1–8. */
export function orientBox<T extends Box>(b: T, orientation: number): T {
  const { x, y, width: w, height: h } = b;
  switch (orientation) {
    case 2:
      return { ...b, x: 1 - x - w };
    case 3:
      return { ...b, x: 1 - x - w, y: 1 - y - h };
    case 4:
      return { ...b, y: 1 - y - h };
    case 5:
      return { ...b, x: y, y: x, width: h, height: w };
    case 6:
      return { ...b, x: 1 - y - h, y: x, width: h, height: w };
    case 7:
      return { ...b, x: 1 - y - h, y: 1 - x - w, width: h, height: w };
    case 8:
      return { ...b, x: y, y: 1 - x - w, width: h, height: w };
    default:
      return b;
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Where the camera focused, as boxes on the upright image (fractions of its width and height).
 * Reads the maker-note tags ExifTool reports for Nikon, Canon, Sony, Fujifilm, OM System/Olympus and Panasonic,
 * then EXIF SubjectArea. Areas whose centre falls outside the frame (e.g. outside a crop) are dropped.
 */
export function focusAreasFromTags(tags: Tags): FocusArea[] {
  let boxes = byMake(tags);
  if (!boxes.length) boxes = subjectArea(tags);
  const orientation = one(tags.Orientation) ?? 1;
  const out: FocusArea[] = [];
  for (const raw of boxes.slice(0, 32)) {
    if (![raw.x, raw.y, raw.width, raw.height].every(Number.isFinite)) continue;
    const b = orientBox(raw, orientation);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) continue;
    const x = clamp01(b.x);
    const y = clamp01(b.y);
    out.push({ x: round(x), y: round(y), width: round(clamp01(b.x + b.width) - x), height: round(clamp01(b.y + b.height) - y) });
  }
  return out;
}

/** ExifTool tags needed by focusAreasFromTags, in addition to Make and Orientation. */
export const FOCUS_EXIFTOOL_TAGS = [
  "AFImageWidth",
  "AFImageHeight",
  "AFAreaXPosition",
  "AFAreaYPosition",
  "AFAreaWidth",
  "AFAreaHeight",
  "AFAreaXPositions",
  "AFAreaYPositions",
  "AFAreaWidths",
  "AFAreaHeights",
  "AFPointsInFocus",
  "AFPointsSelected",
  "CameraType",
  "CropHiSpeed",
  "FocusLocation",
  "FocusPixel",
  "AFPointSelected",
  "AFPointPosition",
  "SubjectArea",
  "ExifImageWidth",
  "ExifImageHeight",
];
