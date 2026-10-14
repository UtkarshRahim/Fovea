import type { AssetSource, CameraMetadata, Comment, ImageEntry, Manifest, UserNotes } from "./manifest";
import { sortedImages } from "./manifest";

export function newImageId(): string {
  return `img-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function assetPathsFor(id: string): { asset: string; thumbnail: string } {
  return { asset: `assets/images/${id}.jpg`, thumbnail: `assets/thumbnails/${id}.jpg` };
}

export interface ProcessedImage {
  id: string;
  originalFilename: string;
  assetSource: AssetSource;
  assetSha256: string;
  thumbnailSha256: string;
  assetWidth: number;
  assetHeight: number;
  metadata: CameraMetadata;
}

/** Pixels in the stored asset are already rotated upright, so orientation is recorded as 1 and the original kept in rawMetadata. */
export function buildImageEntry(p: ProcessedImage, order: number): ImageEntry {
  const { orientation, rawMetadata, ...meta } = p.metadata;
  const raw = { ...(rawMetadata ?? {}), ...(orientation && orientation !== 1 ? { sourceOrientation: orientation } : {}) };
  return {
    ...meta,
    ...(Object.keys(raw).length ? { rawMetadata: raw } : {}),
    orientation: 1,
    id: p.id,
    type: "image",
    order,
    originalFilename: p.originalFilename,
    ...assetPathsFor(p.id),
    assetSource: p.assetSource,
    checksum: { algorithm: "sha256", asset: p.assetSha256, thumbnail: p.thumbnailSha256 },
    assetDimensions: { width: p.assetWidth, height: p.assetHeight },
    user: {},
    comments: [],
  };
}

export function appendImages(m: Manifest, entries: ImageEntry[], now = new Date()): Manifest {
  const existing = sortedImages(m);
  const added = entries.map((e, i) => ({ ...e, order: existing.length + i }));
  return { ...m, images: [...existing, ...added], modifiedAt: now.toISOString() };
}

export function removeImage(m: Manifest, imageId: string, now = new Date()): Manifest {
  const images = sortedImages(m)
    .filter((i) => i.id !== imageId)
    .map((img, order) => ({ ...img, order }));
  return { ...m, images, modifiedAt: now.toISOString() };
}

export function updateUserNotes(m: Manifest, imageId: string, patch: Partial<UserNotes>, now = new Date()): Manifest {
  const ts = now.toISOString();
  return {
    ...m,
    modifiedAt: ts,
    images: m.images.map((img) => {
      if (img.id !== imageId) return img;
      const user: UserNotes = { ...img.user, ...patch, updatedAt: ts };
      for (const k of ["caption", "species", "location"] as const) if (user[k] === "") delete user[k];
      return { ...img, user };
    }),
  };
}

export function addComment(m: Manifest, imageId: string, text: string, author?: string, now = new Date()): Manifest {
  const comment: Comment = {
    id: crypto.randomUUID(),
    text: text.trim(),
    createdAt: now.toISOString(),
    ...(author?.trim() ? { author: author.trim() } : {}),
  };
  return {
    ...m,
    modifiedAt: comment.createdAt,
    images: m.images.map((img) => (img.id === imageId ? { ...img, comments: [...img.comments, comment] } : img)),
  };
}

export function deleteComment(m: Manifest, imageId: string, commentId: string, now = new Date()): Manifest {
  return {
    ...m,
    modifiedAt: now.toISOString(),
    images: m.images.map((img) => (img.id === imageId ? { ...img, comments: img.comments.filter((c) => c.id !== commentId) } : img)),
  };
}

/** Importing never overwrites: an existing id produces a copy with a fresh id and an "(imported)" suffix. */
export function resolveImportCollision(m: Manifest, existingIds: Iterable<string>): Manifest {
  const ids = new Set(existingIds);
  if (!ids.has(m.assignmentId)) return m;
  return { ...m, assignmentId: crypto.randomUUID(), title: `${m.title} (imported)`.slice(0, 200) };
}

export interface AssignmentSummary {
  id: string;
  title: string;
  imageCount: number;
  modifiedAt: string;
  coverThumbnail?: string;
}

export function summarize(m: Manifest): AssignmentSummary {
  const cover = sortedImages(m)[0];
  return {
    id: m.assignmentId,
    title: m.title,
    imageCount: m.images.length,
    modifiedAt: m.modifiedAt,
    ...(cover ? { coverThumbnail: cover.thumbnail } : {}),
  };
}
