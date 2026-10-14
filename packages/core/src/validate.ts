import type { z } from "zod";
import {
  CURRENT_FORMAT_VERSION,
  FORMAT_NAME,
  ManifestSchema,
  SUPPORTED_FORMAT_VERSIONS,
  type Manifest,
} from "./manifest";

export class FramenoteError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not-a-framenote"
      | "unsupported-version"
      | "invalid-manifest"
      | "unsupported-entry-type"
      | "unsafe-path"
      | "limits-exceeded"
      | "corrupt-archive"
      | "missing-asset",
    readonly details?: string[],
  ) {
    super(message);
    this.name = "FramenoteError";
  }
}

type Migration = (manifest: Record<string, unknown>) => Record<string, unknown>;

/** Key = version being migrated from. Each step returns a manifest one version newer. */
export const migrations: Record<number, Migration> = {};

export function migrate(manifest: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = manifest;
  for (let v = fromVersion; v < CURRENT_FORMAT_VERSION; v++) {
    const step = migrations[v];
    if (!step) {
      throw new FramenoteError(
        `No migration path from format version ${v} to ${v + 1}.`,
        "unsupported-version",
      );
    }
    current = { ...step(current), formatVersion: v + 1 };
  }
  return current;
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Validates an untrusted manifest object, migrating older versions. */
export function parseManifest(input: unknown): Manifest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new FramenoteError("manifest.json is not a JSON object.", "invalid-manifest");
  }
  const raw = input as Record<string, unknown>;
  if (raw.format !== FORMAT_NAME) {
    throw new FramenoteError(
      `This is not a Frame Note file (format field is ${JSON.stringify(raw.format ?? null)}, expected "${FORMAT_NAME}").`,
      "not-a-framenote",
    );
  }
  const version = raw.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new FramenoteError(
      `The file has an invalid formatVersion (${JSON.stringify(version ?? null)}). Supported: ${SUPPORTED_FORMAT_VERSIONS.join(", ")}.`,
      "unsupported-version",
    );
  }
  if (version > CURRENT_FORMAT_VERSION) {
    throw new FramenoteError(
      `This file uses format version ${version}, but this app supports up to version ${CURRENT_FORMAT_VERSION}. Update Frame Note to open it.`,
      "unsupported-version",
    );
  }
  const migrated = version < CURRENT_FORMAT_VERSION ? migrate(raw, version) : raw;

  const images = migrated.images;
  if (Array.isArray(images)) {
    images.forEach((img, i) => {
      const type = (img as { type?: unknown } | null)?.type;
      if (type === "video") {
        throw new FramenoteError(
          `Item ${i + 1} is a video. Video is reserved for a later version of Frame Note and cannot be opened yet.`,
          "unsupported-entry-type",
        );
      }
      if (type !== "image") {
        throw new FramenoteError(
          `Item ${i + 1} has an unknown type ${JSON.stringify(type ?? null)}. Only "image" is supported.`,
          "unsupported-entry-type",
        );
      }
    });
  }

  const result = ManifestSchema.safeParse(migrated);
  if (!result.success) {
    throw new FramenoteError("manifest.json does not match the Frame Note format.", "invalid-manifest", formatIssues(result.error));
  }
  const ids = new Set<string>();
  for (const img of result.data.images) {
    if (ids.has(img.id)) {
      throw new FramenoteError(`Duplicate image id "${img.id}" in manifest.`, "invalid-manifest");
    }
    ids.add(img.id);
  }
  return result.data;
}
