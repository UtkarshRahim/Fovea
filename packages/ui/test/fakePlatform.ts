import { vi } from "vitest";
import { appendImages, buildImageEntry, createManifest, newImageId, summarize, type Manifest } from "@framenote/core";
import type { Platform } from "../src/platform";

export function sampleManifest(count = 3): Manifest {
  const m = createManifest({ title: "Sal Forest", platform: "web", appVersion: "0.1.0" });
  const entries = Array.from({ length: count }, (_, i) =>
    buildImageEntry(
      {
        id: newImageId(),
        originalFilename: `Z9_${i}.NEF`,
        assetSource: "embedded-preview",
        assetSha256: "a".repeat(64),
        thumbnailSha256: "b".repeat(64),
        assetWidth: 1500,
        assetHeight: 1000,
        metadata: { exposure: { focalLengthMm: 600, aperture: 5.6, shutterSpeedSeconds: 1 / 1600, iso: 800 }, lens: { model: "NIKKOR Z 600mm f/4" } },
      },
      i,
    ),
  );
  return appendImages(m, entries);
}

export function fakePlatform(initial: Manifest[] = []) {
  const store = new Map(initial.map((m) => [m.assignmentId, m]));
  const p: Platform = {
    kind: "web",
    capabilities: { rawImport: false, folderImport: false, nativeFullscreen: false },
    maxCanvasPixels: 16_000_000,
    listAssignments: vi.fn(async () => [...store.values()].map(summarize)),
    createAssignment: vi.fn(async (title: string) => {
      const m = createManifest({ title, platform: "web", appVersion: "0.1.0" });
      store.set(m.assignmentId, m);
      return m;
    }),
    loadAssignment: vi.fn(async (id: string) => {
      const m = store.get(id);
      if (!m) throw new Error("missing");
      return m;
    }),
    saveAssignment: vi.fn(async (m: Manifest) => {
      store.set(m.assignmentId, m);
    }),
    deleteAssignment: vi.fn(async (id: string) => {
      store.delete(id);
    }),
    getAssetUrl: vi.fn(async (_a: string, path: string) => `blob:${path}`),
    releaseAssetUrl: vi.fn(),
    readAsset: vi.fn(async () => new Uint8Array()),
    addImages: vi.fn(async () => null),
    cancelAddImages: vi.fn(),
    importFramenote: vi.fn(async () => null),
    exportFramenote: vi.fn(async () => ({ location: "downloads" })),
    saveExportedImage: vi.fn(async () => ({ location: "downloads" })),
    setFullscreen: vi.fn(async () => {}),
    isFullscreen: vi.fn(async () => false),
  };
  return { platform: p, store };
}
