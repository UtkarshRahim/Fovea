import { z } from "zod";

export const FORMAT_NAME = "fovea";
export const FILE_EXTENSION = ".fovea";
export const CURRENT_FORMAT_VERSION = 1;
export const SUPPORTED_FORMAT_VERSIONS = [1] as const;

export const OVERLAY_FIELDS = [
  "focalLength",
  "aperture",
  "shutterSpeed",
  "iso",
  "camera",
  "lens",
  "exposureCompensation",
  "capturedAt",
] as const;
export type OverlayField = (typeof OVERLAY_FIELDS)[number];
export const DEFAULT_OVERLAY_FIELDS: OverlayField[] = ["focalLength", "aperture", "shutterSpeed", "iso"];

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase sha256 hex digest");
const relAssetPath = z
  .string()
  .regex(/^assets\/[A-Za-z0-9._\-/]+$/, "asset paths must be relative and start with assets/");

export const OverlaySettingsSchema = z.object({
  visible: z.boolean().default(true),
  placement: z.enum(["top", "bottom"]).default("bottom"),
  theme: z.enum(["dark", "light"]).default("dark"),
  fontSize: z.number().min(8).max(64).default(16),
  paddingX: z.number().min(0).max(400).default(40),
  paddingY: z.number().min(0).max(400).default(22),
  backgroundOpacity: z.number().min(0).max(1).default(0.85),
  fields: z.array(z.enum(OVERLAY_FIELDS)).default([...DEFAULT_OVERLAY_FIELDS]),
  showCaption: z.boolean().default(true),
  showTitle: z.boolean().default(true),
  labelledGrid: z.boolean().default(true),
  /** Camera data side by side in rows, or one field per line in a column. */
  direction: z.enum(["horizontal", "vertical"]).default("horizontal"),
});
export type OverlaySettings = z.infer<typeof OverlaySettingsSchema>;

export const PresentationSchema = z.object({
  fitMode: z.enum(["contain", "cover"]).default("contain"),
  overlay: OverlaySettingsSchema.prefault({}),
});
export type Presentation = z.infer<typeof PresentationSchema>;

const Dimensions = z.object({ width: z.number().int().positive(), height: z.number().int().positive() });

export const CommentSchema = z.object({
  id: z.string().min(1),
  author: z.string().max(80).optional(),
  text: z.string().min(1).max(4000),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const UserNotesSchema = z.object({
  caption: z.string().max(2000).optional(),
  species: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  updatedAt: z.string().optional(),
});
export type UserNotes = z.infer<typeof UserNotesSchema>;

const fraction = z.number().min(0).max(1);

/** Where the camera focused, on the upright image, as fractions of its width and height. Points have zero size. */
export const FocusAreaSchema = z.object({ x: fraction, y: fraction, width: fraction, height: fraction });
export type FocusArea = z.infer<typeof FocusAreaSchema>;

export const CameraMetadataSchema = z.object({
  camera: z.object({ make: z.string().optional(), model: z.string().optional() }).optional(),
  lens: z.object({ make: z.string().optional(), model: z.string().optional() }).optional(),
  exposure: z
    .object({
      aperture: z.number().positive().optional(),
      shutterSpeedSeconds: z.number().positive().optional(),
      iso: z.number().positive().optional(),
      focalLengthMm: z.number().positive().optional(),
      exposureCompensationEv: z.number().optional(),
      meteringMode: z.string().optional(),
      exposureProgram: z.string().optional(),
    })
    .optional(),
  whiteBalance: z.string().optional(),
  flash: z.object({ fired: z.boolean().optional(), mode: z.string().optional() }).optional(),
  focusMode: z.string().optional(),
  capturedAt: z.string().optional(),
  dimensions: Dimensions.optional(),
  orientation: z.number().int().min(1).max(8).optional(),
  gps: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional(),
  focusAreas: z.array(FocusAreaSchema).max(32).optional(),
  rawMetadata: z.record(z.string(), z.unknown()).optional(),
});
export type CameraMetadata = z.infer<typeof CameraMetadataSchema>;

export const ASSET_SOURCES = ["embedded-preview", "raw-decoded", "original-jpeg", "tiff-converted", "original-png"] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

export const ImageEntrySchema = CameraMetadataSchema.extend({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  type: z.literal("image"),
  order: z.number().int().min(0),
  originalFilename: z.string().max(512),
  asset: relAssetPath,
  thumbnail: relAssetPath,
  assetSource: z.enum(ASSET_SOURCES),
  checksum: z.object({ algorithm: z.literal("sha256"), asset: hex64, thumbnail: hex64 }),
  assetDimensions: Dimensions.optional(),
  user: UserNotesSchema.prefault({}),
  comments: z.array(CommentSchema).default([]),
});
export type ImageEntry = z.infer<typeof ImageEntrySchema>;

/** Reserved for a later release. Readers reject it with a clear message. */
export const VideoEntrySchema = ImageEntrySchema.omit({ type: true, assetSource: true }).extend({
  type: z.literal("video"),
  duration: z.number().positive().optional(),
  codec: z.string().optional(),
  frameRate: z.number().positive().optional(),
  poster: relAssetPath.optional(),
});

export const ManifestSchema = z.object({
  format: z.literal(FORMAT_NAME),
  formatVersion: z.literal(CURRENT_FORMAT_VERSION),
  assignmentId: z.uuid(),
  title: z.string().min(1).max(200),
  notes: z.string().max(10000).optional(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  generator: z.object({
    app: z.literal(FORMAT_NAME),
    version: z.string(),
    platform: z.enum(["web", "desktop"]),
  }),
  presentation: PresentationSchema.prefault({}),
  images: z.array(ImageEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestInput = z.input<typeof ManifestSchema>;

export type Assignment = Manifest;

export function defaultPresentation(): Presentation {
  return PresentationSchema.parse({});
}

export function createManifest(opts: {
  title: string;
  platform: "web" | "desktop";
  appVersion: string;
  id?: string;
  now?: Date;
}): Manifest {
  const now = (opts.now ?? new Date()).toISOString();
  return {
    format: FORMAT_NAME,
    formatVersion: CURRENT_FORMAT_VERSION,
    assignmentId: opts.id ?? crypto.randomUUID(),
    title: opts.title,
    createdAt: now,
    modifiedAt: now,
    generator: { app: FORMAT_NAME, version: opts.appVersion, platform: opts.platform },
    presentation: defaultPresentation(),
    images: [],
  };
}

export function sortedImages(m: Pick<Manifest, "images">): ImageEntry[] {
  return [...m.images].sort((a, b) => a.order - b.order);
}

/** Rewrites `order` to 0..n-1 following the given id sequence. */
export function reorderImages(m: Manifest, orderedIds: string[]): Manifest {
  const pos = new Map(orderedIds.map((id, i) => [id, i]));
  const images = sortedImages(m)
    .sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity))
    .map((img, i) => ({ ...img, order: i }));
  return { ...m, images };
}
