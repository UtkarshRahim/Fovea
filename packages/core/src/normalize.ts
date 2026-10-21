import { FOCUS_EXIFTOOL_TAGS, focusAreasFromTags } from "./focus";
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

function normalizeMeteringMode(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower.includes("spot")) return "Spot";
  if (lower.includes("center") || lower.includes("centre")) return "Center-weighted";
  if (lower.includes("matrix") || lower.includes("evaluative") || lower.includes("multi")) return "Matrix/Evaluative";
  if (lower.includes("partial")) return "Partial";
  if (lower.includes("average")) return "Average";
  return s;
}

function normalizeExposureProgram(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower.includes("manual")) return "Manual";
  if (lower.includes("aperture") || lower.includes("av")) return "Aperture priority";
  if (lower.includes("shutter") || lower.includes("tv")) return "Shutter priority";
  if (lower.includes("program")) return "Program";
  if (lower.includes("portrait")) return "Portrait";
  if (lower.includes("landscape")) return "Landscape";
  if (lower.includes("sports") || lower.includes("action")) return "Sports/Action";
  return s;
}

function normalizeWhiteBalance(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower.includes("auto")) return "Auto";
  if (lower.includes("daylight") || lower.includes("sunny")) return "Daylight";
  if (lower.includes("cloudy") || lower.includes("overcast")) return "Cloudy";
  if (lower.includes("shade")) return "Shade";
  if (lower.includes("tungsten") || lower.includes("incandescent")) return "Tungsten";
  if (lower.includes("fluorescent")) return "Fluorescent";
  if (lower.includes("flash")) return "Flash";
  if (lower.includes("custom") || lower.includes("preset")) return "Custom";
  return s;
}

function normalizeFlash(tags: Tags): { fired: boolean; mode?: string } | undefined {
  const flashValue = tags.Flash;
  if (flashValue === undefined || flashValue === null) return undefined;
  
  let fired = false;
  let mode: string | undefined;
  
  if (typeof flashValue === "number") {
    // Flash values are bit flags: 0x01 = fired, etc.
    fired = !!(flashValue & 0x01);
    if (flashValue & 0x08) mode = "Auto";
    if (flashValue & 0x10) mode = "No flash";
    if (flashValue & 0x18) mode = "Auto, fired";
    if (flashValue & 0x20) mode = "Red-eye reduction";
  } else if (typeof flashValue === "string") {
    const lower = flashValue.toLowerCase();
    fired = lower.includes("fired") || lower.includes("on");
    if (lower.includes("auto")) mode = "Auto";
    if (lower.includes("red-eye")) mode = "Red-eye reduction";
    if (lower.includes("slow")) mode = "Slow sync";
  }
  
  return { fired, ...(mode && { mode }) };
}

function normalizeFocusMode(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (lower.includes("af-s") || lower.includes("single")) return "AF-S (Single)";
  if (lower.includes("af-c") || lower.includes("continuous")) return "AF-C (Continuous)";
  if (lower.includes("af-a") || lower.includes("auto")) return "AF-A (Auto)";
  if (lower.includes("manual") || lower === "mf") return "Manual";
  return s;
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
  const meteringMode = normalizeMeteringMode(tags.MeteringMode);
  if (meteringMode) exposure.meteringMode = meteringMode;
  const exposureProgram = normalizeExposureProgram(first(tags, ["ExposureProgram", "ExposureMode"]));
  if (exposureProgram) exposure.exposureProgram = exposureProgram;
  if (Object.keys(exposure).length) meta.exposure = exposure;
  
  const whiteBalance = normalizeWhiteBalance(first(tags, ["WhiteBalance", "WhiteBalanceMode"]));
  if (whiteBalance) meta.whiteBalance = whiteBalance;
  
  const flash = normalizeFlash(tags);
  if (flash) meta.flash = flash;
  
  const focusMode = normalizeFocusMode(first(tags, ["FocusMode", "FocusMode2", "AFMode"]));
  if (focusMode) meta.focusMode = focusMode;

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

  const focusAreas = focusAreasFromTags(tags);
  if (focusAreas.length) meta.focusAreas = focusAreas;

  // Store all remaining tags in rawMetadata, excluding binary data, empty values, and already-extracted fields
  const extractedKeys = new Set([
    "Make", "Model", "LensModel", "LensMake", "FNumber", "ExposureTime", "ShutterSpeed",
    "ISO", "ISOSpeedRatings", "PhotographicSensitivity", "RecommendedExposureIndex",
    "FocalLength", "ExposureCompensation", "ExposureBiasValue",
    "MeteringMode", "ExposureProgram", "ExposureMode", "WhiteBalance", "WhiteBalanceMode",
    "Flash", "FocusMode", "FocusMode2", "AFMode",
    "DateTimeOriginal", "CreateDate", "DateTimeDigitized",
    "ImageSize", "ExifImageWidth", "PixelXDimension", "ImageWidth",
    "ExifImageHeight", "PixelYDimension", "ImageHeight",
    "Orientation", "latitude", "GPSLatitude", "longitude", "GPSLongitude",
    "GPSLatitudeRef", "GPSLongitudeRef",
    ...FOCUS_EXIFTOOL_TAGS,
  ]);
  
  // Fields to exclude from rawMetadata (binary data, thumbnails, etc.)
  const excludePatterns = [
    /thumbnail/i, /preview/i, /^image$/i, /binary/i, /rawdata/i,
    /jpgfrom/i, /previewimage/i, /maker.*unknown/i,
  ];
  
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tags)) {
    // Skip if already extracted
    if (extractedKeys.has(key)) continue;
    
    // Skip if null, undefined, or empty string
    if (value === null || value === undefined || value === "") continue;
    
    // Skip binary data and excluded patterns
    if (typeof value === "object" && value instanceof Uint8Array) continue;
    if (excludePatterns.some(pattern => pattern.test(key))) continue;
    
    // Include strings, numbers, booleans, and simple arrays
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      raw[key] = value;
    } else if (Array.isArray(value) && value.length > 0 && value.length < 100) {
      // Include small arrays of primitive types
      if (value.every(v => typeof v === "string" || typeof v === "number")) {
        raw[key] = value;
      }
    } else if (typeof value === "object" && value !== null) {
      // Include simple objects (but not complex nested structures)
      try {
        const str = JSON.stringify(value);
        if (str.length < 1000) raw[key] = value;
      } catch {
        // Skip if can't stringify
      }
    }
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
  ...FOCUS_EXIFTOOL_TAGS,
];
