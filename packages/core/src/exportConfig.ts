import { z } from "zod";

/** iOS Safari refuses canvases larger than ~16.7 megapixels. */
export const SAFE_CANVAS_PIXELS = 16_777_216;

export const ImageExportSchema = z.object({
  format: z.enum(["jpeg", "png"]).default("jpeg"),
  quality: z.number().min(0.4).max(1).default(0.92),
  /** Long edge in px; null keeps the asset size. Never upscales. */
  longEdge: z.number().int().min(320).max(16384).nullable().default(null),
  includeOverlay: z.boolean().default(true),
});
export type ImageExportOptions = z.infer<typeof ImageExportSchema>;

export interface ExportSize {
  width: number;
  height: number;
  /** True when the size was reduced to stay under the canvas limit. */
  clampedForDevice: boolean;
}

export function exportSize(
  asset: { width: number; height: number },
  longEdge: number | null,
  maxPixels = Number.POSITIVE_INFINITY,
): ExportSize {
  const srcLong = Math.max(asset.width, asset.height);
  let scale = longEdge && longEdge < srcLong ? longEdge / srcLong : 1;
  let clampedForDevice = false;
  if (asset.width * asset.height * scale * scale > maxPixels) {
    scale = Math.sqrt(maxPixels / (asset.width * asset.height));
    clampedForDevice = true;
  }
  return { width: Math.max(1, Math.floor(asset.width * scale)), height: Math.max(1, Math.floor(asset.height * scale)), clampedForDevice };
}

export function exportFilename(originalFilename: string, format: "jpeg" | "png"): string {
  const base = originalFilename.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._ -]+/g, "_") || "image";
  return `${base}-framenote.${format === "jpeg" ? "jpg" : "png"}`;
}

export function safeBundleFilename(title: string): string {
  const base = title.replace(/[^A-Za-z0-9._ -]+/g, "_").trim().slice(0, 80) || "assignment";
  return `${base}.framenote`;
}
