import { createContext, useContext } from "react";
import type { AssignmentSummary, ImageEntry, ImportWarning, Manifest } from "@framenote/core";

export interface ImportProgress {
  done: number;
  total: number;
  current?: string;
}

export interface FileFailure {
  file: string;
  message: string;
}

export interface AddImagesResult {
  entries: ImageEntry[];
  failures: FileFailure[];
  cancelled: boolean;
  /** Non-fatal problems, e.g. metadata could not be read but the image was added. */
  warnings?: string[];
}

export interface SavedFile {
  /** Human-readable location (path on desktop, "Downloads" or "Share sheet" on web). */
  location: string;
}

export interface StorageInfo {
  usageBytes: number;
  quotaBytes: number;
  persisted: boolean;
}

export interface ImportedFramenote {
  manifest: Manifest;
  warnings: ImportWarning[];
}

/** The UI depends only on this interface. Web uses IndexedDB, desktop uses Tauri commands. */
export interface Platform {
  kind: "web" | "desktop";
  capabilities: { rawImport: boolean; folderImport: boolean; nativeFullscreen: boolean };

  listAssignments(): Promise<AssignmentSummary[]>;
  createAssignment(title: string): Promise<Manifest>;
  loadAssignment(id: string): Promise<Manifest>;
  saveAssignment(m: Manifest): Promise<void>;
  deleteAssignment(id: string): Promise<void>;

  getAssetUrl(assignmentId: string, assetPath: string): Promise<string>;
  releaseAssetUrl(url: string): void;
  readAsset(assignmentId: string, assetPath: string): Promise<Uint8Array>;

  /** Picks files (or a folder) and turns them into stored presentation assets. Returns null if the user cancelled the picker. */
  addImages(
    assignmentId: string,
    opts: { folder: boolean },
    onProgress: (p: ImportProgress) => void,
  ): Promise<AddImagesResult | null>;
  /** Same as addImages but for files the user dropped onto the window. */
  addDroppedFiles?(assignmentId: string, files: File[], onProgress: (p: ImportProgress) => void): Promise<AddImagesResult>;
  cancelAddImages(): void;

  /** Picks a .framenote file, validates and stores it. Returns null if cancelled. */
  importFramenote(file?: File): Promise<ImportedFramenote | null>;
  exportFramenote(m: Manifest, opts: { stripGps: boolean }): Promise<SavedFile | null>;
  saveExportedImage(data: Blob, filename: string): Promise<SavedFile | null>;

  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  storageInfo?(): Promise<StorageInfo | null>;
  /** Maximum canvas pixels this device can safely render. */
  maxCanvasPixels: number;
}

const PlatformContext = createContext<Platform | null>(null);
export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): Platform {
  const p = useContext(PlatformContext);
  if (!p) throw new Error("PlatformProvider missing");
  return p;
}
