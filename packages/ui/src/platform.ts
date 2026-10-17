import { createContext, useContext } from "react";
import type { AssignmentSummary, CameraMetadata, ImageEntry, ImportWarning, Manifest } from "@framenote/core";

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

export interface FolderPhoto {
  name: string;
  size: number;
  modifiedMs: number;
}

/** Photos viewed where they are, without copying them into a project. */
export interface PhotoFolder {
  /** Stable across sessions where the platform can reopen the folder (the path on desktop). */
  id: string;
  name: string;
  /** Full folder path, where the platform has one. */
  path?: string;
  photos: FolderPhoto[];
  /** Index of the photo to show first. */
  start: number;
  /** False for a one-off selection the platform cannot reopen later (e.g. files picked in a browser without folder access). */
  reopenable: boolean;
}

/** A folder remembered by reference (a path or a browser folder handle), never by copying its photos. */
export interface RecentFolder {
  id: string;
  name: string;
  path?: string;
  lastPhoto?: string;
  openedAt: string;
}

export interface ViewablePhoto {
  /** Bytes the browser can display. */
  blob: Blob;
  /** "embedded-preview" for RAW files, "converted" when the app re-encoded the file, otherwise "original". */
  source: "original" | "embedded-preview" | "converted";
}

export type OpenRequest =
  | { kind: "folder"; folder: PhotoFolder }
  | { kind: "project"; imported: ImportedFramenote }
  | { kind: "error"; message: string };

export interface FolderViewer {
  /** Picks photos. Desktop opens the whole folder of the chosen photo; browsers show the files that were picked. */
  pickPhotos(): Promise<PhotoFolder | null>;
  /** Picks a folder and opens every photo in it. Absent where the browser cannot pick folders. */
  pickFolder?(): Promise<PhotoFolder | null>;
  /** Photos dropped onto the window (browsers only; the desktop app receives paths instead). */
  openFiles?(files: File[]): Promise<PhotoFolder | null>;
  /** Re-reads the folder; null if it is gone or access was refused. */
  openRecent(r: RecentFolder): Promise<PhotoFolder | null>;
  recents(): Promise<RecentFolder[]>;
  remember(folder: PhotoFolder, photo: string): Promise<void>;
  forget(id: string): Promise<void>;
  loadPhoto(folder: PhotoFolder, photo: FolderPhoto): Promise<ViewablePhoto>;
  loadMetadata(folder: PhotoFolder, photo: FolderPhoto): Promise<CameraMetadata>;
  /** Imports photos from the folder into a project's stored assets (the same pipeline as Add photos). */
  addToProject(assignmentId: string, folder: PhotoFolder, photos: FolderPhoto[], onProgress: (p: ImportProgress) => void): Promise<AddImagesResult>;
  /** Files the operating system asked the app to open. Returns an unsubscribe function. */
  onOpenRequest?(cb: (r: OpenRequest) => void): () => void;
}

/** The UI depends only on this interface. Web uses IndexedDB, desktop uses Tauri commands. */
export interface Platform {
  kind: "web" | "desktop";
  capabilities: { rawImport: boolean; folderImport: boolean; projectFolderImport: boolean; nativeFullscreen: boolean };

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
    opts: { folder: boolean; multiple?: boolean },
    onProgress: (p: ImportProgress) => void,
  ): Promise<AddImagesResult | null>;
  /** Same as addImages but for files the user dropped onto the window. */
  addDroppedFiles?(assignmentId: string, files: File[], onProgress: (p: ImportProgress) => void): Promise<AddImagesResult>;
  cancelAddImages(): void;

  /** Picks a .framenote file, validates and stores it. Returns null if cancelled. */
  importFramenote(file?: File): Promise<ImportedFramenote | null>;
  /** Picks an unzipped .framenote folder (manifest.json + assets/) and stores it as a project. Returns null if cancelled. */
  importProjectFolder(): Promise<ImportedFramenote | null>;
  exportFramenote(m: Manifest, opts: { stripGps: boolean }): Promise<SavedFile | null>;
  saveExportedImage(data: Blob, filename: string): Promise<SavedFile | null>;

  setFullscreen(on: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  storageInfo?(): Promise<StorageInfo | null>;
  /** Maximum canvas pixels this device can safely render. */
  maxCanvasPixels: number;
  viewer?: FolderViewer;
}

const PlatformContext = createContext<Platform | null>(null);
export const PlatformProvider = PlatformContext.Provider;

export function usePlatform(): Platform {
  const p = useContext(PlatformContext);
  if (!p) throw new Error("PlatformProvider missing");
  return p;
}
