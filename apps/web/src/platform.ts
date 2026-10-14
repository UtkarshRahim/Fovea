import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  APP_VERSION,
  createManifest,
  packFramenote,
  parseManifest,
  resolveImportCollision,
  safeBundleFilename,
  SAFE_CANVAS_PIXELS,
  summarize,
  unpackFolder,
  unpackFramenote,
  type Manifest,
  type UnpackedFramenote,
} from "@framenote/core";
import type { AddImagesResult, ImportProgress, Platform, SavedFile } from "@framenote/ui";
import { ACCEPT_IMAGES, processFile } from "./process";

interface FramenoteDB extends DBSchema {
  assignments: { key: string; value: Manifest };
  assets: { key: string; value: Blob };
}

const assetKey = (assignmentId: string, path: string) => `${assignmentId}/${path}`;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
const isMobile = () => isIOS() || /Android/i.test(navigator.userAgent);

/** Opens a file picker. Resolves [] if the user dismisses it (where the browser reports that). */
function pickFiles(accept: string | undefined, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    if (accept && !isIOS()) input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => done([]), { once: true });
    input.click();
  });
}

export const supportsFolderPicker = () =>
  typeof HTMLInputElement !== "undefined" && "webkitdirectory" in HTMLInputElement.prototype && !isIOS();

function pickFolder(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.style.display = "none";
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => done([]), { once: true });
    input.click();
  });
}

async function deliverFile(blob: Blob, filename: string): Promise<SavedFile | null> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (isMobile() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return { location: "the share sheet" };
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { location: `your downloads (${filename})` };
}

export class WebPlatform implements Platform {
  kind = "web" as const;
  capabilities = { rawImport: false, folderImport: false, projectFolderImport: supportsFolderPicker(), nativeFullscreen: typeof document !== "undefined" && !!document.fullscreenEnabled };
  maxCanvasPixels = isMobile() ? SAFE_CANVAS_PIXELS : 64_000_000;
  private db: Promise<IDBPDatabase<FramenoteDB>>;
  private cancelled = false;

  constructor(dbName = "framenote") {
    this.db = openDB<FramenoteDB>(dbName, 1, {
      upgrade(db) {
        db.createObjectStore("assignments");
        db.createObjectStore("assets");
      },
    });
  }

  private async requestPersistence() {
    try {
      if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist?.();
    } catch {
      /* best effort */
    }
  }

  async listAssignments() {
    const db = await this.db;
    return (await db.getAll("assignments")).map(summarize);
  }

  async createAssignment(title: string) {
    const m = createManifest({ title, platform: "web", appVersion: APP_VERSION });
    await (await this.db).put("assignments", m, m.assignmentId);
    void this.requestPersistence();
    return m;
  }

  async loadAssignment(id: string) {
    const db = await this.db;
    const m = await db.get("assignments", id);
    if (!m) throw new Error("This project no longer exists on this device.");
    const manifest = parseManifest(m);
    void this.collectGarbage(manifest);
    return manifest;
  }

  /** Removes stored blobs for images that were removed from the project. */
  private async collectGarbage(m: Manifest) {
    const db = await this.db;
    const keep = new Set(m.images.flatMap((i) => [assetKey(m.assignmentId, i.asset), assetKey(m.assignmentId, i.thumbnail)]));
    const range = IDBKeyRange.bound(`${m.assignmentId}/`, `${m.assignmentId}/\uffff`);
    const tx = db.transaction("assets", "readwrite");
    for (const key of await tx.store.getAllKeys(range)) if (!keep.has(key)) await tx.store.delete(key);
    await tx.done;
  }

  async saveAssignment(m: Manifest) {
    await (await this.db).put("assignments", m, m.assignmentId);
  }

  async deleteAssignment(id: string) {
    const db = await this.db;
    const tx = db.transaction(["assignments", "assets"], "readwrite");
    await tx.objectStore("assignments").delete(id);
    await tx.objectStore("assets").delete(IDBKeyRange.bound(`${id}/`, `${id}/\uffff`));
    await tx.done;
  }

  async getAssetUrl(assignmentId: string, path: string) {
    const blob = await (await this.db).get("assets", assetKey(assignmentId, path));
    if (!blob) throw new Error(`Missing stored image ${path}`);
    return URL.createObjectURL(blob);
  }

  releaseAssetUrl(url: string) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  async readAsset(assignmentId: string, path: string) {
    const blob = await (await this.db).get("assets", assetKey(assignmentId, path));
    if (!blob) throw new Error(`Missing stored image ${path}`);
    return new Uint8Array(await blob.arrayBuffer());
  }

  async addImages(assignmentId: string, _opts: { folder: boolean }, onProgress: (p: ImportProgress) => void) {
    const files = await pickFiles(ACCEPT_IMAGES, true);
    if (!files.length) return null;
    return this.addDroppedFiles(assignmentId, files, onProgress);
  }

  async addDroppedFiles(assignmentId: string, files: File[], onProgress: (p: ImportProgress) => void): Promise<AddImagesResult> {
    this.cancelled = false;
    const db = await this.db;
    const result: AddImagesResult = { entries: [], failures: [], cancelled: false };
    const seen = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      if (this.cancelled) {
        result.cancelled = true;
        break;
      }
      const file = files[i]!;
      onProgress({ done: i, total: files.length, current: file.name });
      const dupKey = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(dupKey)) {
        result.failures.push({ file: file.name, message: "Skipped: the same file was selected twice." });
        continue;
      }
      seen.add(dupKey);
      try {
        const p = await processFile(file);
        const tx = db.transaction("assets", "readwrite");
        await tx.store.put(p.asset, assetKey(assignmentId, p.entry.asset));
        await tx.store.put(p.thumbnail, assetKey(assignmentId, p.entry.thumbnail));
        await tx.done;
        result.entries.push(p.entry);
      } catch (e) {
        const message =
          e instanceof DOMException && e.name === "QuotaExceededError"
            ? "Browser storage is full. Export and delete older projects to free space."
            : e instanceof Error
              ? e.message
              : String(e);
        result.failures.push({ file: file.name, message });
        if (e instanceof DOMException && e.name === "QuotaExceededError") break;
      }
    }
    onProgress({ done: files.length, total: files.length });
    void this.requestPersistence();
    return result;
  }

  cancelAddImages() {
    this.cancelled = true;
  }

  async importFramenote(file?: File) {
    const picked = file ?? (await pickFiles(".framenote,application/zip", false))[0];
    if (!picked) return null;
    return this.storeUnpacked(await unpackFramenote(new Uint8Array(await picked.arrayBuffer())));
  }

  async importProjectFolder() {
    const files = await pickFolder();
    if (!files.length) return null;
    const unpacked = await unpackFolder(
      files.map((f) => ({
        path: f.webkitRelativePath || f.name,
        size: f.size,
        read: async () => new Uint8Array(await f.arrayBuffer()),
      })),
    );
    return this.storeUnpacked(unpacked);
  }

  private async storeUnpacked(unpacked: UnpackedFramenote) {
    const db = await this.db;
    const existing = await db.getAllKeys("assignments");
    const manifest = resolveImportCollision(unpacked.manifest, existing);
    const tx = db.transaction(["assignments", "assets"], "readwrite");
    for (const [path, bytes] of unpacked.assets) {
      await tx.objectStore("assets").put(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }), assetKey(manifest.assignmentId, path));
    }
    await tx.objectStore("assignments").put(manifest, manifest.assignmentId);
    await tx.done;
    void this.requestPersistence();
    return { manifest, warnings: unpacked.warnings };
  }

  async exportFramenote(m: Manifest, opts: { stripGps: boolean }) {
    const bytes = await packFramenote(m, (p) => this.readAsset(m.assignmentId, p), {
      stripGps: opts.stripGps,
      appVersion: APP_VERSION,
      platform: "web",
    });
    return deliverFile(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), safeBundleFilename(m.title));
  }

  saveExportedImage(data: Blob, filename: string) {
    return deliverFile(data, filename);
  }

  async setFullscreen(on: boolean) {
    if (!document.fullscreenEnabled) return;
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  }

  async isFullscreen() {
    return !!document.fullscreenElement;
  }

  async storageInfo() {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return {
      usageBytes: est.usage ?? 0,
      quotaBytes: est.quota ?? 0,
      persisted: (await navigator.storage.persisted?.()) ?? false,
    };
  }
}
