import { useCallback, useEffect, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { ChevronDown, Folder, FolderOpen, Images, X } from "lucide-react";
import { usePlatform, type PhotoFolder, type RecentFolder } from "../platform";
import { openInViewer } from "../lib/viewerSession";
import { Button, IconButton } from "./primitives";
import { useToast } from "./Toasts";

function useOpen() {
  const toast = useToast();
  return useCallback(
    async (pick: () => Promise<PhotoFolder | null>) => {
      try {
        const folder = await pick();
        if (folder) openInViewer(folder);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [toast],
  );
}

/** Opens photos in the viewer, straight from disk. Offers a folder picker where the platform has one. */
export function OpenPhotosButton({ variant = "default", compact }: { variant?: "default" | "primary"; compact?: boolean }) {
  const platform = usePlatform();
  const viewer = platform.viewer;
  const open = useOpen();
  if (!viewer) return null;
  const photoLabel = "Open photos";
  if (!viewer.pickFolder) {
    return (
      <Button variant={variant} onClick={() => void open(() => viewer.pickPhotos())} title="View photos without adding them to a project">
        <Images size={16} /> <span className={compact ? "hide-sm" : ""}>{photoLabel}</span>
      </Button>
    );
  }
  const pickFolder = viewer.pickFolder.bind(viewer);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant={variant} title="View photos without adding them to a project">
          <Images size={16} /> <span className={compact ? "hide-sm" : ""}>{compact ? "Open" : photoLabel}</span> <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.Item className="menu-item" onSelect={() => void open(() => viewer.pickPhotos())}>
            <span className="menu-check" aria-hidden="true">
              <Images size={14} />
            </span>
            <span className="menu-text">
              Photo…
              <span className="menu-sub">
                {platform.kind === "desktop" ? "Then move through every photo in its folder" : "View the photos you pick"}
              </span>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => void open(pickFolder)}>
            <span className="menu-check" aria-hidden="true">
              <FolderOpen size={14} />
            </span>
            <span className="menu-text">
              Folder…
              <span className="menu-sub">Every photo in it, any format</span>
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Folders opened before. Only a reference (path or folder handle) is kept, never the photos. */
export function RecentFolders({ limit = 8 }: { limit?: number }) {
  const viewer = usePlatform().viewer;
  const toast = useToast();
  const open = useOpen();
  const [items, setItems] = useState<RecentFolder[] | null>(null);
  const refresh = useCallback(() => {
    viewer
      ?.recents()
      .then(setItems)
      .catch(() => setItems([]));
  }, [viewer]);
  useEffect(refresh, [refresh]);
  if (!viewer || !items?.length) return null;
  return (
    <section className="recent-folders" aria-labelledby="recent-folders-h">
      <h2 id="recent-folders-h" className="section-title">
        Recent folders
      </h2>
      <ul>
        {items.slice(0, limit).map((r) => (
          <li key={r.id} className="recent-folder">
            <button
              type="button"
              className="recent-folder-open"
              onClick={() =>
                void open(async () => {
                  const f = await viewer.openRecent(r);
                  if (!f) {
                    toast(`“${r.name}” could not be opened. It may have moved, or access was not allowed.`, "error");
                    refresh();
                  }
                  return f;
                })
              }
            >
              <Folder size={16} aria-hidden="true" />
              <span className="recent-folder-text">
                <span className="recent-folder-name">{r.name}</span>
                <span className="small muted mono recent-folder-path">{r.path ?? (r.lastPhoto ? `Last viewed ${r.lastPhoto}` : "")}</span>
              </span>
            </button>
            <IconButton
              label={`Forget ${r.name}`}
              onClick={() =>
                void viewer
                  .forget(r.id)
                  .then(refresh)
                  .catch(() => {})
              }
            >
              <X size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
