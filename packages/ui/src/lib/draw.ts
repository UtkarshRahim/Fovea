import {
  cssFont,
  exportSize,
  layoutOverlay,
  overlayTitle,
  overlayValues,
  type FontSpec,
  type ImageEntry,
  type ImageExportOptions,
  type MeasureText,
  type OverlayLayout,
  type OverlaySettings,
} from "@fovea/core";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let measureCtx: Ctx | null = null;
function getMeasureCtx(): Ctx | null {
  if (measureCtx) return measureCtx;
  if (typeof OffscreenCanvas !== "undefined") measureCtx = new OffscreenCanvas(1, 1).getContext("2d");
  else if (typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

export const measureText: MeasureText = (text: string, font: FontSpec) => {
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * font.size * 0.6;
  ctx.font = cssFont(font);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${font.tracking}px`;
  return ctx.measureText(text).width;
};

export function contentFor(image: ImageEntry, settings: OverlaySettings, locale?: string) {
  return {
    title: overlayTitle(image.user),
    values: overlayValues(settings.fields, image, locale),
    caption: image.user.caption,
  };
}

export function computeLayout(image: ImageEntry, settings: OverlaySettings, width: number, height: number, minScale = 0) {
  return layoutOverlay(width, height, settings, contentFor(image, settings), measureText, minScale);
}

export function drawLayout(ctx: Ctx, layout: OverlayLayout, width: number) {
  const { scrim } = layout;
  if (scrim.opacity > 0 && scrim.bottom > scrim.top) {
    const g =
      scrim.fadeTo === "top"
        ? ctx.createLinearGradient(0, scrim.bottom, 0, scrim.top)
        : ctx.createLinearGradient(0, scrim.top, 0, scrim.bottom);
    const rgb = hexToRgb(scrim.color);
    g.addColorStop(0, `rgba(${rgb},${scrim.opacity})`);
    g.addColorStop(0.55, `rgba(${rgb},${scrim.opacity * 0.6})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, scrim.top, width, scrim.bottom - scrim.top);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  for (const run of layout.runs) {
    ctx.font = cssFont(run.font);
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${run.font.tracking}px`;
    ctx.fillStyle = run.color;
    ctx.fillText(run.text, run.x, run.y);
  }
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load('400 16px "IBM Plex Mono"'),
    document.fonts.load('500 16px "IBM Plex Mono"'),
    document.fonts.load('500 16px "Libre Franklin"'),
    document.fonts.load('italic 400 16px "Newsreader"'),
  ]).catch(() => undefined);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image could not be decoded for export."));
    img.src = url;
  });
}

export interface RenderedExport {
  blob: Blob;
  width: number;
  height: number;
  clampedForDevice: boolean;
}

/** Draws the asset plus overlay at export resolution, using the same layout as the live presentation. */
export async function renderExport(
  imageUrl: string,
  image: ImageEntry,
  settings: OverlaySettings,
  opts: ImageExportOptions,
  maxPixels: number,
): Promise<RenderedExport> {
  await ensureFontsLoaded();
  const img = await loadImage(imageUrl);
  const size = exportSize({ width: img.naturalWidth, height: img.naturalHeight }, opts.longEdge, maxPixels);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not create a drawing surface for export.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size.width, size.height);
  if (opts.includeOverlay && settings.visible) {
    drawLayout(ctx, computeLayout(image, settings, size.width, size.height), size.width);
  }
  const type = opts.format === "png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, opts.format === "jpeg" ? opts.quality : undefined));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("The image was too large for this device to export. Try a smaller size.");
  return { blob, ...size };
}
