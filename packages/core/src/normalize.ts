import type { CameraMetadata } from "./manifest";

type Tags = Record<string, unknown>;

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const frac = /^\s*(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(v);
    if (frac) {
      const d = Number(frac[2]);
      return d === 0 ? undefined : Number(frac[1]) / d;
    }
    const n = Number(v.trim());
    if (v.trim() !== "" && Number.isFinite(n)) return n;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\0/g, "").trim();
  return t ? t : undefined;
}

function first(tags: Tags, keys: string[]): unknown {
  for (const k of keys) if (tags[k] !== undefined && tags[k] !== null && tags[k] !== "") return tags[k];
  return undefined;
}

/** EXIF "2026:03:14 06:42:11" (+ optional sub-seconds) → "2026-03-14T06:42:11". Zone is not invented. */
export function exifDateToIso(v: unknown): string | undefined {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}T${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const s = str(v);
  if (!s) return undefined;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  if (m[1] === "0000") return undefined;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

function parseSize(v: unknown): { width: number; height: number } | undefined {
  const s = typeof v === "string" ? v : undefined;
  if (!s) return undefined;
  const m = /^(\d+)\s*[x ]\s*(\d+)$/i.exec(s.trim());
  if (!m) return undefined;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * Normalises tags from ExifTool (`-json -n`) or exifr (`translateValues: false, reviveValues: false`)
 * into the manifest schema. Missing values stay missing. Lens names are only taken from tags
 * that state the lens model directly; lookup-derived names are kept in rawMetadata only.
 */
export function normalizeTags(tags: Tags): CameraMetadata {
  const meta: CameraMetadata = {};
  const make = str(tags.Make);
  const model = str(tags.Model);
  if (make || model) meta.camera = { ...(make && { make }), ...(model && { model }) };

  const lensModel = str(tags.LensModel);
  const lensMake = str(tags.LensMake);
  if (lensModel) meta.lens = { model: lensModel, ...(lensMake && { make: lensMake }) };

  const exposure: NonNullable<CameraMetadata["exposure"]> = {};
  const aperture = num(tags.FNumber);
  if (aperture && aperture > 0) exposure.aperture = aperture;
  const shutter = num(first(tags, ["ExposureTime", "ShutterSpeed"]));
  if (shutter && shutter > 0) exposure.shutterSpeedSeconds = shutter;
  const iso = num(first(tags, ["ISO", "ISOSpeedRatings", "PhotographicSensitivity", "RecommendedExposureIndex"]));
  const isoValue = Array.isArray(tags.ISO) ? num(tags.ISO[0]) : iso;
  if (isoValue && isoValue > 0) exposure.iso = isoValue;
  const focal = num(tags.FocalLength);
  if (focal && focal > 0) exposure.focalLengthMm = focal;
  const ev = num(first(tags, ["ExposureCompensation", "ExposureBiasValue"]));
  if (ev !== undefined) exposure.exposureCompensationEv = ev;
  if (Object.keys(exposure).length) meta.exposure = exposure;

  const captured = exifDateToIso(first(tags, ["DateTimeOriginal", "CreateDate", "DateTimeDigitized"]));
  if (captured) meta.capturedAt = captured;

  const size =
    parseSize(tags.ImageSize) ??
    (() => {
      const w = num(first(tags, ["ExifImageWidth", "PixelXDimension", "ImageWidth"]));
      const h = num(first(tags, ["ExifImageHeight", "PixelYDimension", "ImageHeight"]));
      return w && h ? { width: Math.round(w), height: Math.round(h) } : undefined;
    })();
  if (size) meta.dimensions = size;

  const orientation = num(tags.Orientation);
  if (orientation && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8) meta.orientation = orientation;

  const lat = num(first(tags, ["latitude", "GPSLatitude"]));
  const lon = num(first(tags, ["longitude", "GPSLongitude"]));
  if (lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    const latRef = str(tags.GPSLatitudeRef);
    const lonRef = str(tags.GPSLongitudeRef);
    const signedLat = latRef === "S" && lat > 0 ? -lat : lat;
    const signedLon = lonRef === "W" && lon > 0 ? -lon : lon;
    if (!(signedLat === 0 && signedLon === 0)) meta.gps = { latitude: signedLat, longitude: signedLon };
  }

  const raw: Record<string, unknown> = {};
  for (const k of ["LensID", "LensType", "Lens", "LensInfo", "SerialNumber", "Software"]) {
    const v = tags[k];
    if (v !== undefined && v !== null && v !== "" && (typeof v === "string" || typeof v === "number")) raw[k] = v;
  }
  if (Object.keys(raw).length) meta.rawMetadata = raw;
  return meta;
}

export const EXIFTOOL_TAGS = [
  "Make",
  "Model",
  "LensModel",
  "LensMake",
  "LensID",
  "LensType",
  "Lens",
  "LensInfo",
  "FNumber",
  "ExposureTime",
  "ISO",
  "FocalLength",
  "ExposureCompensation",
  "DateTimeOriginal",
  "CreateDate",
  "ImageSize",
  "Orientation",
  "GPSLatitude",
  "GPSLongitude",
  "GPSLatitudeRef",
  "GPSLongitudeRef",
  "SerialNumber",
  "Software",
  "MIMEType",
];
