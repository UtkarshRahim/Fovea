import exifr from "exifr";
import { detectSourceKind, extensionOf, largestEmbeddedJpeg, orientationHeader, rawImageSize } from "@framenote/core";
import type { FolderPhoto, FolderViewer, ImportProgress, AddImagesResult, PhotoFolder, RecentFolder, ViewablePhoto } from "@framenote/ui";
import { readMetadata } from "./process";

/** The parts of the File System Access API used here (Chromium only; not in TypeScript's DOM lib). */
interface DirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string }>;
  queryPermission(opts: { mode: "read" }): Promise<PermissionState>;
  requestPermission(opts: { mode: "read" }): Promise<PermissionState>;
}
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
type ShowDirectoryPicker = (opts: { id?: string; mode?: "read" }) => Promise<DirectoryHandle>;

/** A folder the user granted access to. Only the browser's handle is stored, never the photos. */
export interface FolderRecord {
  id: string;
  name: string;
  handle: unknown;
  lastPhoto?: string;
  openedAt: string;
}

export interface FolderStore {
  all(): Promise<FolderRecord[]>;
  get(id: string): Promise<FolderRecord | undefined>;
  put(r: FolderRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

const VIEWABLE = new Set(["jpg", "jpeg", "jpe", "png", "gif", "webp", "avif", "bmp", "tif", "tiff", "heic", "heif", "nef", "nrw", "cr2", "cr3", "arw", "srf", "sr2", "dng", "raf", "orf", "rw2", "pef"]);
export const ACCEPT_VIEWABLE = ["image/*", ...[...VIEWABLE].map((e) => `.${e}`)].join(",");
const MAX_RECENTS = 20;
const MAX_FILES = 20_000;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export const isViewable = (name: string) => !name.startsWith(".") && VIEWABLE.has(extensionOf(name));
const showDirectoryPicker = () => (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker;
export const supportsReopenableFolders = () => typeof window !== "undefined" && typeof showDirectoryPicker() === "function";

type Source = File | FileHandle;

export class WebViewer implements FolderViewer {
  private sources = new Map<string, Map<string, Source>>();
  private session = 0;

  constructor(
    private store: FolderStore,
    private pick: (accept: string, mode: "files" | "folder") => Promise<File[]>,
    private importFiles: (assignmentId: string, files: File[], onProgress: (p: ImportProgress) => void) => Promise<AddImagesResult>,
    canPickFolder: boolean,
  ) {
    if (supportsReopenableFolders() || canPickFolder) this.pickFolder = () => this.chooseFolder();
  }

  pickFolder?: () => Promise<PhotoFolder | null>;

  private register(id: string, name: string, sources: Map<string, Source>, start: number, reopenable: boolean): PhotoFolder {
    this.sources.set(id, sources);
    const photos: FolderPhoto[] = [...sources.values()].map((s) => (s instanceof File ? { name: s.name, size: s.size, modifiedMs: s.lastModified } : { name: s.name, size: 0, modifiedMs: 0 }));
    return { id, name, photos, start: Math.min(Math.max(0, start), Math.max(0, photos.length - 1)), reopenable };
  }

  private fromFiles(files: File[], name: string): PhotoFolder | null {
    const viewable = files.filter((f) => isViewable(f.name)).sort((a, b) => collator.compare(a.name, b.name)).slice(0, MAX_FILES);
    if (!viewable.length) return null;
    const map = new Map<string, Source>();
    for (const f of viewable) if (!map.has(f.name)) map.set(f.name, f);
    return this.register(`session-${++this.session}`, name, map, 0, false);
  }

  private async fromHandle(id: string, dir: DirectoryHandle, lastPhoto?: string): Promise<PhotoFolder> {
    const handles: FileHandle[] = [];
    for await (const h of dir.values()) {
      if (h.kind === "file" && isViewable(h.name)) handles.push(h as FileHandle);
      if (handles.length >= MAX_FILES) break;
    }
    handles.sort((a, b) => collator.compare(a.name, b.name));
    const start = lastPhoto ? handles.findIndex((h) => h.name === lastPhoto) : 0;
    return this.register(id, dir.name, new Map(handles.map((h) => [h.name, h])), start, true);
  }

  async pickPhotos() {
    const files = await this.pick(ACCEPT_VIEWABLE, "files");
    return this.fromFiles(files, files.length === 1 ? files[0]!.name : `${files.length} photos`);
  }

  private async chooseFolder(): Promise<PhotoFolder | null> {
    const picker = showDirectoryPicker();
    if (picker) {
      let dir: DirectoryHandle;
      try {
        dir = await picker({ id: "framenote-photos", mode: "read" });
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return null;
        throw e;
      }
      const id = `folder-${crypto.randomUUID()}`;
      await this.store.put({ id, name: dir.name, handle: dir, openedAt: new Date().toISOString() });
      await this.prune();
      return this.fromHandle(id, dir);
    }
    const files = await this.pick(ACCEPT_VIEWABLE, "folder");
    const top = files[0]?.webkitRelativePath.split("/")[0] || "Folder";
    return this.fromFiles(
      files.filter((f) => f.webkitRelativePath.split("/").length <= 2),
      top,
    );
  }

  async openFiles(files: File[]) {
    return this.fromFiles(files, files.length === 1 ? files[0]!.name : `${files.length} photos`);
  }

  async openRecent(r: RecentFolder) {
    const rec = await this.store.get(r.id);
    if (!rec) return null;
    const dir = rec.handle as DirectoryHandle;
    try {
      let perm = await dir.queryPermission({ mode: "read" });
      if (perm !== "granted") perm = await dir.requestPermission({ mode: "read" });
      if (perm !== "granted") return null;
      return await this.fromHandle(rec.id, dir, rec.lastPhoto);
    } catch {
      return null;
    }
  }

  async recents(): Promise<RecentFolder[]> {
    const all = await this.store.all();
    return all
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .map((r) => ({ id: r.id, name: r.name, lastPhoto: r.lastPhoto, openedAt: r.openedAt }));
  }

  async remember(folder: PhotoFolder, photo: string) {
    const rec = await this.store.get(folder.id);
    if (rec) await this.store.put({ ...rec, lastPhoto: photo, openedAt: new Date().toISOString() });
  }

  async forget(id: string) {
    await this.store.delete(id);
  }

  private async prune() {
    const all = (await this.store.all()).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    for (const r of all.slice(MAX_RECENTS)) await this.store.delete(r.id);
  }

  private async file(folder: PhotoFolder, photo: FolderPhoto): Promise<File> {
    const src = this.sources.get(folder.id)?.get(photo.name);
    if (!src) throw new Error("This photo is no longer available. Open the folder again.");
    return src instanceof File ? src : src.getFile();
  }

  async loadPhoto(folder: PhotoFolder, photo: FolderPhoto): Promise<ViewablePhoto> {
    const file = await this.file(folder, photo);
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (detectSourceKind(file.name, head) !== "raw") return { blob: file, source: "original" };
    const preview = largestEmbeddedJpeg(new Uint8Array(await file.arrayBuffer()));
    if (!preview) throw new Error(`No embedded preview was found in this ${extensionOf(file.name).toUpperCase() || "RAW"} file.`);
    const orientation = (await exifr.orientation(file).catch(() => undefined)) ?? 1;
    const jpeg = file.slice(preview.offset, preview.offset + preview.length);
    const blob =
      orientation >= 2 && orientation <= 8
        ? new Blob([orientationHeader(orientation) as Uint8Array<ArrayBuffer>, jpeg.slice(2)], { type: "image/jpeg" })
        : new Blob([jpeg], { type: "image/jpeg" });
    return { blob, source: "embedded-preview" };
  }

  async loadMetadata(folder: PhotoFolder, photo: FolderPhoto) {
    const file = await this.file(folder, photo);
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    if (detectSourceKind(file.name, head) !== "raw") return readMetadata(file);
    return readMetadata(file, rawImageSize(new Uint8Array(await file.slice(0, 8 * 1024 * 1024).arrayBuffer())));
  }

  async addToProject(assignmentId: string, folder: PhotoFolder, photos: FolderPhoto[], onProgress: (p: ImportProgress) => void) {
    const files = await Promise.all(photos.map((p) => this.file(folder, p)));
    return this.importFiles(assignmentId, files, onProgress);
  }
}
