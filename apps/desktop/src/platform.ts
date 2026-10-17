import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  APP_VERSION,
  buildImageEntry,
  createManifest,
  normalizeTags,
  packFovea,
  parseManifest,
  resolveImportCollision,
  safeBundleFilename,
  summarize,
  unpackFolder,
  unpackFovea,
  type AssetSource,
  type Manifest,
  type UnpackedFovea,
} from "@fovea/core";
import type { AddImagesResult, FolderPhoto, FolderViewer, ImportProgress, OpenRequest, PhotoFolder, Platform, RecentFolder, ViewablePhoto } from "@fovea/ui";
import { describeError } from "@fovea/ui";

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

interface NativeFolder {
  path: string;
  name: string;
  files: FolderPhoto[];
  start: number;
}

const RAW = ["nef", "nrw", "cr2", "cr3", "arw", "srf", "sr2", "dng", "raf", "orf", "rw2", "pef"];
const RAW_AND_IMAGES = ["nef", "nrw", "cr2", "cr3", "arw", "dng", "raf", "orf", "rw2", "pef", "jpg", "jpeg", "png", "tif", "tiff"];
const VIEWABLE = [...RAW, "jpg", "jpeg", "jpe", "png", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "heif"];
const MIME: Record<string, string> = { png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic", heif: "image/heif" };
const RECENTS_KEY = "fovea.recentFolders";
const MAX_RECENTS = 20;
const isMac = /Mac/.test(navigator.userAgent);
const enc = encodeURIComponent;

const extOf = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const joinPath = (dir: string, name: string) => `${dir}${dir.includes("\\") && !dir.includes("/") ? "\\" : "/"}${name}`;
const toFolder = (f: NativeFolder): PhotoFolder => ({ id: f.path, name: f.name, path: f.path, photos: f.files, start: f.start, reopenable: true });

function bytes(buf: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  if (Array.isArray(buf)) return new Uint8Array(buf);
  return new Uint8Array(buf);
}

export class DesktopPlatform implements Platform {
  kind = "desktop" as const;
  capabilities = { rawImport: true, folderImport: true, projectFolderImport: true, nativeFullscreen: true };
  maxCanvasPixels = 120_000_000;
  viewer: FolderViewer = new DesktopViewer(this);
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

  async addImages(assignmentId: string, opts: { folder: boolean; multiple?: boolean }, onProgress: (p: ImportProgress) => void): Promise<AddImagesResult | null> {
    let paths: string[];
    if (opts.folder) {
      const folder = await open({ directory: true, multiple: false, title: "Choose a folder of photographs" });
      if (!folder || Array.isArray(folder)) return null;
      paths = await invoke<string[]>("scan_folder", { path: folder });
      if (!paths.length) return { entries: [], failures: [{ file: folder, message: "No supported photographs in this folder." }], cancelled: false };
    } else {
      const picked = await open({
        multiple: opts.multiple ?? true,
        title: opts.multiple === false ? "Choose the replacement photograph" : "Add photographs",
        filters: [{ name: "Photographs (RAW, JPEG, TIFF, PNG)", extensions: [...RAW_AND_IMAGES, ...RAW_AND_IMAGES.map((e) => e.toUpperCase())] }],
      });
      if (!picked) return null;
      paths = Array.isArray(picked) ? picked : [picked];
      if (!paths.length) return null;
    }
    return this.importPaths(assignmentId, paths, onProgress);
  }

  /** Runs the native import pipeline on files already on disk. */
  async importPaths(assignmentId: string, paths: string[], onProgress: (p: ImportProgress) => void): Promise<AddImagesResult> {
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

  async importFovea() {
    const path = await open({ multiple: false, title: "Open a .fovea file", filters: [{ name: "Fovea project", extensions: ["fovea"] }] });
    if (!path || Array.isArray(path)) return null;
    return this.importFoveaAt(path);
  }

  async importFoveaAt(path: string) {
    const data = bytes(await invoke<ArrayBuffer>("read_file", { path }));
    return this.storeUnpacked(await unpackFovea(data));
  }

  async importProjectFolder() {
    const root = await open({ directory: true, multiple: false, title: "Choose an unzipped Fovea project folder" });
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

  private async storeUnpacked(unpacked: UnpackedFovea) {
    const existing = (await this.listAssignments()).map((a) => a.id);
    const manifest = resolveImportCollision(unpacked.manifest, existing);
    await this.dir(manifest.assignmentId);
    for (const [p, b] of unpacked.assets) await this.writeAsset(manifest.assignmentId, p, b);
    await this.saveAssignment(manifest);
    return { manifest, warnings: unpacked.warnings };
  }

  async exportFovea(m: Manifest, opts: { stripGps: boolean }) {
    const path = await save({ defaultPath: safeBundleFilename(m.title), filters: [{ name: "Fovea project", extensions: ["fovea"] }] });
    if (!path) return null;
    const target = path.toLowerCase().endsWith(".fovea") ? path : `${path}.fovea`;
    const data = await packFovea(m, (p) => this.readAsset(m.assignmentId, p), { stripGps: opts.stripGps, appVersion: APP_VERSION, platform: "desktop" });
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

/** Photos read straight from disk. Recent folders are remembered by path in local storage; no photo is copied. */
class DesktopViewer implements FolderViewer {
  constructor(private platform: DesktopPlatform) {}

  private async list(path: string) {
    return toFolder(await invoke<NativeFolder>("viewer_list", { path }));
  }

  /** One file opens its whole folder at that file; several files from one folder show just those, as Preview does. */
  private async openPaths(paths: string[]): Promise<PhotoFolder> {
    const folder = await this.list(paths[0]!);
    if (paths.length < 2) return folder;
    const names = new Set(paths.map(baseName));
    return { ...folder, photos: folder.photos.filter((p) => names.has(p.name)), start: 0 };
  }

  async pickPhotos() {
    const picked = await open({
      multiple: true,
      title: "Open photos",
      filters: [{ name: "Photos (RAW, JPEG, HEIC, TIFF, PNG…)", extensions: [...VIEWABLE, ...VIEWABLE.map((e) => e.toUpperCase())] }],
    });
    const paths = !picked ? [] : Array.isArray(picked) ? picked : [picked];
    return paths.length ? this.openPaths(paths) : null;
  }

  async pickFolder() {
    const dir = await open({ directory: true, multiple: false, title: "Open a folder of photos" });
    return dir && !Array.isArray(dir) ? this.list(dir) : null;
  }

  async openRecent(r: RecentFolder) {
    if (!r.path) return null;
    try {
      const folder = await this.list(r.path);
      const i = r.lastPhoto ? folder.photos.findIndex((p) => p.name === r.lastPhoto) : -1;
      return { ...folder, start: Math.max(0, i) };
    } catch {
      return null;
    }
  }

  async recents(): Promise<RecentFolder[]> {
    try {
      const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }

  async remember(folder: PhotoFolder, photo: string) {
    const rest = (await this.recents()).filter((r) => r.id !== folder.id);
    const entry: RecentFolder = { id: folder.id, name: folder.name, path: folder.path, lastPhoto: photo, openedAt: new Date().toISOString() };
    localStorage.setItem(RECENTS_KEY, JSON.stringify([entry, ...rest].slice(0, MAX_RECENTS)));
  }

  async forget(id: string) {
    localStorage.setItem(RECENTS_KEY, JSON.stringify((await this.recents()).filter((r) => r.id !== id)));
  }

  async loadPhoto(folder: PhotoFolder, photo: FolderPhoto): Promise<ViewablePhoto> {
    const data = bytes(await invoke<ArrayBuffer>("viewer_image", { folder: folder.path, name: photo.name }));
    const ext = extOf(photo.name);
    const raw = RAW.includes(ext);
    const converted = !isMac && (ext === "tif" || ext === "tiff");
    return {
      blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: raw || converted ? "image/jpeg" : (MIME[ext] ?? "image/jpeg") }),
      source: raw ? "embedded-preview" : converted ? "converted" : "original",
    };
  }

  async loadMetadata(folder: PhotoFolder, photo: FolderPhoto) {
    return normalizeTags(await invoke<Record<string, unknown>>("viewer_tags", { folder: folder.path, name: photo.name }));
  }

  addToProject(assignmentId: string, folder: PhotoFolder, photos: FolderPhoto[], onProgress: (p: ImportProgress) => void) {
    return this.platform.importPaths(
      assignmentId,
      photos.map((p) => joinPath(folder.path!, p.name)),
      onProgress,
    );
  }

  onOpenRequest(cb: (r: OpenRequest) => void) {
    const drain = async () => {
      const paths = await invoke<string[]>("take_open_requests");
      if (!paths.length) return;
      try {
        const project = paths.find((p) => p.toLowerCase().endsWith(".fovea"));
        if (project) cb({ kind: "project", imported: await this.platform.importFoveaAt(project) });
        else cb({ kind: "folder", folder: await this.openPaths(paths) });
      } catch (e) {
        cb({ kind: "error", message: `Could not open ${baseName(paths[0]!)}: ${describeError(e)}` });
      }
    };
    const unlisten = listen("open-requested", () => void drain());
    void drain();
    return () => void unlisten.then((f) => f());
  }
}
