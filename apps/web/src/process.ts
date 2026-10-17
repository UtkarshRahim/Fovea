import exifr from "exifr";
import {
  buildImageEntry,
  detectSourceKind,
  extensionOf,
  largestEmbeddedJpeg,
  newImageId,
  nikonFocusTags,
  normalizeTags,
  rawImageSize,
  sha256Hex,
  type AssetSource,
  type CameraMetadata,
  type ImageEntry,
} from "@framenote/core";

export const ASSET_LONG_EDGE = 4096;
export const THUMB_LONG_EDGE = 512;

export interface ProcessedFile {
  entry: ImageEntry;
  asset: Blob;
  thumbnail: Blob;
}

export class ProcessError extends Error {}

/** `rawSize` is set for RAW files: their ImageWidth/ImageHeight usually describe a thumbnail, so it replaces them. */
export async function readMetadata(file: Blob, rawSize?: { width: number; height: number } | null): Promise<CameraMetadata> {
  try {
    const tags = await exifr.parse(file, {
      tiff: true,
      exif: true,
      gps: true,
      ifd1: false,
      interop: false,
      makerNote: false,
      translateValues: false,
      reviveValues: false,
      mergeOutput: true,
    });
    if (!tags) return {};
    if (rawSize !== undefined) {
      delete tags.ImageWidth;
      delete tags.ImageHeight;
      if (rawSize) Object.assign(tags, { ImageWidth: rawSize.width, ImageHeight: rawSize.height });
    }
    if (/^nikon/i.test(String(tags.Make ?? ""))) Object.assign(tags, await nikonMakerNoteTags(file));
    return normalizeTags(tags as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** AF-area tags from a Nikon maker note. exifr only returns the raw note when given a buffer, not a Blob. */
async function nikonMakerNoteTags(file: Blob): Promise<Record<string, unknown> | null> {
  try {
    const head = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
    const parsed = await exifr.parse(head, {
      tiff: false,
      exif: true,
      gps: false,
      ifd1: false,
      interop: false,
      makerNote: true,
      translateValues: false,
      reviveValues: false,
      mergeOutput: false,
    });
    const note: unknown = parsed?.makerNote;
    return note instanceof Uint8Array ? nikonFocusTags(note) : null;
  } catch {
    return null;
  }
}

async function decode(blob: Blob, honourEmbeddedOrientation: boolean): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: honourEmbeddedOrientation ? "from-image" : "none" });
  } catch {
    try {
      return await createImageBitmap(blob);
    } catch {
      throw new ProcessError("This browser could not decode the image data.");
    }
  }
}

/** Draws `src` upright (applying EXIF orientation 1–8) and scaled so its long edge is at most `longEdge`. */
function renderUpright(src: ImageBitmap, orientation: number, longEdge: number): HTMLCanvasElement {
  const swap = orientation >= 5 && orientation <= 8;
  const w0 = swap ? src.height : src.width;
  const h0 = swap ? src.width : src.height;
  const scale = Math.min(1, longEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ProcessError("The browser ran out of memory while preparing the image.");
  ctx.imageSmoothingQuality = "high";
  const dw = swap ? h : w;
  const dh = swap ? w : h;
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, w, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, w, h); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, h); break;
  }
  ctx.drawImage(src, 0, 0, dw, dh);
  return canvas;
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ProcessError("The image could not be encoded."))), "image/jpeg", quality),
  );
}

function downscale(canvas: HTMLCanvasElement, longEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, longEdge / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/** Turns one picked file into a presentation asset + thumbnail. RAW files use their embedded camera preview. */
export async function processFile(file: File): Promise<ProcessedFile> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const kind = detectSourceKind(file.name, head);
  let source: Blob;
  let assetSource: AssetSource;
  let honourEmbedded = true;
  const rawBytes = kind === "raw" ? new Uint8Array(await file.arrayBuffer()) : undefined;
  const metadata = await readMetadata(file, rawBytes ? rawImageSize(rawBytes) : undefined);

  switch (kind) {
    case "jpeg":
      source = file;
      assetSource = "original-jpeg";
      break;
    case "png":
      source = file;
      assetSource = "original-png";
      break;
    case "tiff":
      source = file;
      assetSource = "tiff-converted";
      break;
    case "raw": {
      const preview = largestEmbeddedJpeg(rawBytes!);
      if (!preview) {
        throw new ProcessError(
          `No usable embedded preview was found in this ${extensionOf(file.name).toUpperCase() || "RAW"} file. Open it in the Frame Note desktop app, which can decode more RAW variants.`,
        );
      }
      source = file.slice(preview.offset, preview.offset + preview.length, "image/jpeg");
      assetSource = "embedded-preview";
      honourEmbedded = false;
      break;
    }
    case "heic":
      throw new ProcessError("HEIC photos are not supported yet. On iPhone, choose “Most Compatible” in Camera settings or export as JPEG.");
    default:
      throw new ProcessError("This file type is not supported. Use JPEG, PNG, TIFF or a camera RAW file (NEF, CR2, CR3, ARW).");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(source, honourEmbedded);
  } catch (e) {
    if (kind === "tiff") throw new ProcessError("This browser cannot open TIFF files. Use the Frame Note desktop app for TIFF.");
    throw e;
  }
  const orientation = honourEmbedded ? 1 : metadata.orientation ?? 1;
  let assetCanvas: HTMLCanvasElement;
  try {
    assetCanvas = renderUpright(bitmap, orientation, ASSET_LONG_EDGE);
  } finally {
    bitmap.close();
  }
  const asset = await toJpeg(assetCanvas, 0.9);
  const thumbCanvas = downscale(assetCanvas, THUMB_LONG_EDGE);
  const thumbnail = await toJpeg(thumbCanvas, 0.8);
  const width = assetCanvas.width;
  const height = assetCanvas.height;
  assetCanvas.width = assetCanvas.height = thumbCanvas.width = thumbCanvas.height = 0;

  const [assetSha256, thumbnailSha256] = await Promise.all([
    asset.arrayBuffer().then((b) => sha256Hex(new Uint8Array(b))),
    thumbnail.arrayBuffer().then((b) => sha256Hex(new Uint8Array(b))),
  ]);

  const entry = buildImageEntry(
    {
      id: newImageId(),
      originalFilename: file.name,
      assetSource,
      assetSha256,
      thumbnailSha256,
      assetWidth: width,
      assetHeight: height,
      metadata,
    },
    0,
  );
  return { entry, asset, thumbnail };
}

export const ACCEPT_IMAGES = "image/jpeg,image/png,image/tiff,.jpg,.jpeg,.png,.tif,.tiff,.nef,.nrw,.cr2,.cr3,.arw,.dng,.raf,.orf,.rw2,.pef";
