import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  APP_VERSION,
  buildImageEntry,
  createManifest,
  normalizeTags,
  packFramenote,
  parseManifest,
  resolveImportCollision,
  safeBundleFilename,
  summarize,
  unpackFolder,
  unpackFramenote,
  type AssetSource,
  type Manifest,
  type UnpackedFramenote,
} from "@framenote/core";
import type { AddImagesResult, ImportProgress, Platform } from "@framenote/ui";

interface NativeProcessed {
  id: string;
  originalFilename: string;
  assetSource: AssetSource;
  assetSha256: string;
  thumbnailSha256: string;
  assetWidth: number;
  assetHeight: number;
  tags: Record<string, unknown>;
  metadataWarning: string | null;
}

interface NativeImportResult {
  processed: NativeProcessed[];
  failures: { file: string; message: string }[];
  cancelled: boolean;
}

const RAW_AND_IMAGES = ["nef", "nrw", "cr2", "cr3", "arw", "dng", "raf", "orf", "rw2", "pef", "jpg", "jpeg", "png", "tif", "tiff"];
const enc = encodeURIComponent;

function bytes(buf: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (Array.isArray(buf)) return new Uint8Array(buf);
  return new Uint8Array(buf);
}

export class DesktopPlatform implements Platform {
  kind = "desktop" as const;
  capabilities = { rawImport: true, folderImport: true, projectFolderImport: true, nativeFullscreen: true };
  maxCanvasPixels = 120_000_000;
  private dirs = new Map<string, string>();

  private async dir(id: string): Promise<string> {
    let d = this.dirs.get(id);
    if (!d) {
      d = await invoke<string>("assignment_dir", { id });
      this.dirs.set(id, d);
    }
    return d;
  }

  async listAssignments() {
    const raw = await invoke<string[]>("list_manifests");
    const out = [];
    for (const json of raw) {
      try {
        out.push(summarize(parseManifest(JSON.parse(json))));
      } catch {
        /* unreadable project folders are skipped */
      }
    }
    return out;
  }

  async createAssignment(title: string) {
    const m = createManifest({ title, platform: "desktop", appVersion: APP_VERSION });
    await this.saveAssignment(m);
    return m;
  }

  async loadAssignment(id: string) {
    const m = parseManifest(JSON.parse(await invoke<string>("read_manifest", { id })));
    void invoke("gc_assets", { id, keep: m.images.flatMap((i) => [i.asset, i.thumbnail]) }).catch(() => {});
    return m;
  }

  async saveAssignment(m: Manifest) {
    await invoke("write_manifest", { id: m.assignmentId, json: JSON.stringify(m, null, 2) });
  }

  async deleteAssignment(id: string) {
    await invoke("delete_assignment", { id });
    this.dirs.delete(id);
  }

  async getAssetUrl(assignmentId: string, path: string) {
    const dir = await this.dir(assignmentId);
    const sep = dir.includes("\\") ? "\\" : "/";
    return convertFileSrc(`${dir}${sep}${path.split("/").join(sep)}`);
  }

  releaseAssetUrl() {}

  async readAsset(assignmentId: string, path: string) {
    return bytes(await invoke<ArrayBuffer>("read_asset", { id: assignmentId, path }));
  }

  private async writeAsset(id: string, path: string, data: Uint8Array) {
    await invoke("write_asset", data, { headers: { "x-assignment-id": enc(id), "x-asset-path": enc(path) } });
  }

  async addImages(assignmentId: string, opts: { folder: boolean }, onProgress: (p: ImportProgress) => void): Promise<AddImagesResult | null> {
    let paths: string[];
    if (opts.folder) {
      const folder = await open({ directory: true, multiple: false, title: "Choose a folder of photographs" });
      if (!folder || Array.isArray(folder)) return null;
      paths = await invoke<string[]>("scan_folder", { path: folder });
      if (!paths.length) return { entries: [], failures: [{ file: folder, message: "No supported photographs in this folder." }], cancelled: false };
    } else {
      const picked = await open({
        multiple: true,
        title: "Add photographs",
        filters: [{ name: "Photographs (RAW, JPEG, TIFF, PNG)", extensions: [...RAW_AND_IMAGES, ...RAW_AND_IMAGES.map((e) => e.toUpperCase())] }],
      });
      if (!picked) return null;
      paths = Array.isArray(picked) ? picked : [picked];
      if (!paths.length) return null;
    }
    const unlisten = await listen<ImportProgress>("import-progress", (e) => onProgress(e.payload));
    try {
      const res = await invoke<NativeImportResult>("import_images", { id: assignmentId, paths });
      const entries = res.processed.map((p) =>
        buildImageEntry(
          {
            id: p.id,
            originalFilename: p.originalFilename,
            assetSource: p.assetSource,
            assetSha256: p.assetSha256,
            thumbnailSha256: p.thumbnailSha256,
            assetWidth: p.assetWidth,
            assetHeight: p.assetHeight,
            metadata: normalizeTags(p.tags),
          },
          0,
        ),
      );
      const warnings = res.processed.flatMap((p) => (p.metadataWarning ? [p.metadataWarning] : []));
      return { entries, failures: res.failures, cancelled: res.cancelled, warnings };
    } finally {
      unlisten();
    }
  }

  cancelAddImages() {
    void invoke("cancel_import");
  }

  async importFramenote() {
    const path = await open({ multiple: false, title: "Open a .framenote file", filters: [{ name: "Frame Note project", extensions: ["framenote"] }] });
    if (!path || Array.isArray(path)) return null;
    const data = bytes(await invoke<ArrayBuffer>("read_file", { path }));
    return this.storeUnpacked(await unpackFramenote(data));
  }

  async importProjectFolder() {
    const root = await open({ directory: true, multiple: false, title: "Choose an unzipped Frame Note project folder" });
    if (!root || Array.isArray(root)) return null;
    const listed = await invoke<{ path: string; size: number }[]>("list_folder", { path: root });
    const unpacked = await unpackFolder(
      listed.map((f) => ({
        path: f.path,
        size: f.size,
        read: async () => bytes(await invoke<ArrayBuffer>("read_folder_file", { root, path: f.path })),
      })),
    );
    return this.storeUnpacked(unpacked);
  }

  private async storeUnpacked(unpacked: UnpackedFramenote) {
    const existing = (await this.listAssignments()).map((a) => a.id);
    const manifest = resolveImportCollision(unpacked.manifest, existing);
    await this.dir(manifest.assignmentId);
    for (const [p, b] of unpacked.assets) await this.writeAsset(manifest.assignmentId, p, b);
    await this.saveAssignment(manifest);
    return { manifest, warnings: unpacked.warnings };
  }

  async exportFramenote(m: Manifest, opts: { stripGps: boolean }) {
    const path = await save({ defaultPath: safeBundleFilename(m.title), filters: [{ name: "Frame Note project", extensions: ["framenote"] }] });
    if (!path) return null;
    const target = path.toLowerCase().endsWith(".framenote") ? path : `${path}.framenote`;
    const data = await packFramenote(m, (p) => this.readAsset(m.assignmentId, p), { stripGps: opts.stripGps, appVersion: APP_VERSION, platform: "desktop" });
    await invoke("write_file", data, { headers: { "x-path": enc(target) } });
    return { location: target };
  }

  async saveExportedImage(blob: Blob, filename: string) {
    const ext = filename.endsWith(".png") ? "png" : "jpg";
    const path = await save({ defaultPath: filename, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    await invoke("write_file", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-path": enc(path) } });
    return { location: path };
  }

  async setFullscreen(on: boolean) {
    await getCurrentWindow().setFullscreen(on);
  }

  async isFullscreen() {
    return getCurrentWindow().isFullscreen();
  }
}
