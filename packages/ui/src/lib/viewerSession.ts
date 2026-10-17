import { useSyncExternalStore } from "react";
import type { PhotoFolder } from "../platform";
import { navigate } from "./router";

export interface ViewerSession {
  folder: PhotoFolder;
  /** Changes on every open, so reopening the same folder starts fresh. */
  token: number;
}

let session: ViewerSession | null = null;
let counter = 0;
const listeners = new Set<() => void>();

/** Shows a folder in the viewer. Folders are held in memory only; recents store a reference, never the photos. */
export function openInViewer(folder: PhotoFolder) {
  session = { folder, token: ++counter };
  listeners.forEach((l) => l());
  if (!location.hash.startsWith("#/view")) navigate({ name: "viewer" });
}

export function useViewerSession(): ViewerSession | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
  );
}
