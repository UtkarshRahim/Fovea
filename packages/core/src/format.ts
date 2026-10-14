import type { CameraMetadata, OverlayField } from "./manifest";

function trimNumber(n: number, maxDecimals: number): string {
  return Number(n.toFixed(maxDecimals)).toString();
}

export function formatFocalLength(mm: number | undefined): string | undefined {
  if (mm === undefined || !Number.isFinite(mm) || mm <= 0) return undefined;
  return `${trimNumber(mm, mm < 10 ? 1 : 0)} mm`;
}

export function formatAperture(f: number | undefined): string | undefined {
  if (f === undefined || !Number.isFinite(f) || f <= 0) return undefined;
  return `f/${trimNumber(f, 1)}`;
}

/**
 * Standard camera shutter values, used to snap rounding noise like 0.3333 → 1/3
 * or 0.0166 → 1/60. Only snaps when within 3%, so unusual values stay exact.
 */
const STANDARD_DENOMINATORS = [
  2, 3, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30, 40, 45, 50, 60, 80, 90, 100, 125, 160, 180, 200, 250, 320, 350, 400,
  500, 640, 750, 800, 1000, 1250, 1500, 1600, 2000, 2500, 3000, 3200, 4000, 5000, 6000, 6400, 8000, 10000, 12800,
  16000, 20000, 25600, 32000,
];

export function formatShutterSpeed(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  if (seconds >= 1) {
    return `${trimNumber(seconds, seconds < 10 ? 1 : 0)} s`;
  }
  const denom = 1 / seconds;
  const snapped = STANDARD_DENOMINATORS.find((d) => Math.abs(d - denom) / d < 0.03);
  if (snapped) return `1/${snapped} s`;
  if (Math.abs(denom - Math.round(denom)) < 0.05 || denom >= 10) return `1/${Math.round(denom)} s`;
  return `${trimNumber(seconds, 2)} s`;
}

export function formatIso(iso: number | undefined): string | undefined {
  if (iso === undefined || !Number.isFinite(iso) || iso <= 0) return undefined;
  return `ISO ${Math.round(iso)}`;
}

export function formatExposureCompensation(ev: number | undefined): string | undefined {
  if (ev === undefined || !Number.isFinite(ev)) return undefined;
  const rounded = Math.round(ev * 10) / 10;
  if (rounded === 0) return "0 EV";
  return `${rounded > 0 ? "+" : "-"}${trimNumber(Math.abs(rounded), 1)} EV`;
}

/** Manifest stores capture time as camera-local ISO without zone; render it without shifting zones. */
export function formatCaptureDate(iso: string | undefined, locale?: string): string | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(iso);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Date.UTC(+y!, +mo! - 1, +d!, h ? +h : 0, mi ? +mi : 0, s ? +s : 0));
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    ...(h ? { timeStyle: "short" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function formatCamera(meta: CameraMetadata): string | undefined {
  const make = meta.camera?.make?.trim();
  const model = meta.camera?.model?.trim();
  if (!model) return make || undefined;
  if (!make) return model;
  const brand = make.split(/\s+/)[0]!.toLowerCase();
  return model.toLowerCase().startsWith(brand) ? model : `${make.replace(/\s+corporation$/i, "")} ${model}`;
}

export function formatLens(meta: CameraMetadata): string | undefined {
  return meta.lens?.model?.trim() || undefined;
}

export const FIELD_LABELS: Record<OverlayField, string> = {
  focalLength: "Focal length",
  aperture: "Aperture",
  shutterSpeed: "Shutter",
  iso: "ISO",
  camera: "Camera",
  lens: "Lens",
  exposureCompensation: "Exp. comp.",
  capturedAt: "Captured",
};

export function formatField(field: OverlayField, meta: CameraMetadata, locale?: string): string | undefined {
  const e = meta.exposure;
  switch (field) {
    case "focalLength":
      return formatFocalLength(e?.focalLengthMm);
    case "aperture":
      return formatAperture(e?.aperture);
    case "shutterSpeed":
      return formatShutterSpeed(e?.shutterSpeedSeconds);
    case "iso":
      return formatIso(e?.iso);
    case "camera":
      return formatCamera(meta);
    case "lens":
      return formatLens(meta);
    case "exposureCompensation":
      return formatExposureCompensation(e?.exposureCompensationEv);
    case "capturedAt":
      return formatCaptureDate(meta.capturedAt, locale);
  }
}

export interface FieldValue {
  field: OverlayField;
  label: string;
  value: string;
}

/** Only fields that actually have a value are returned; nothing is invented. */
export function overlayValues(fields: OverlayField[], meta: CameraMetadata, locale?: string): FieldValue[] {
  const out: FieldValue[] = [];
  for (const field of fields) {
    const value = formatField(field, meta, locale);
    if (value) out.push({ field, label: FIELD_LABELS[field], value });
  }
  return out;
}
