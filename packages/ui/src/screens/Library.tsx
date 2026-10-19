import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronDown, FileArchive, FileUp, FolderInput, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { FoveaError, type AssignmentSummary } from "@fovea/core";
import type { ImportedFovea } from "../platform";
import { usePlatform, type StorageInfo } from "../platform";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { navigate } from "../lib/router";
import { Button, ConfirmDialog, Dialog, IconButton } from "../components/primitives";
import { BrandMark } from "../components/BrandMark";
import { useToast } from "../components/Toasts";
import { ShortcutsButton, ShortcutsDialog } from "../components/ShortcutsDialog";
import { OpenPhotosButton, RecentFolders } from "../components/RecentFolders";
import { isTypingTarget } from "../lib/keys";
import { openInViewer } from "../lib/viewerSession";

export function describeError(e: unknown): string {
  if (e instanceof FoveaError) return e.details?.length ? `${e.message} (${e.details.slice(0, 3).join("; ")})` : e.message;
  if (e instanceof DOMException && e.name === "QuotaExceededError") {
    return "This device is out of browser storage. Export projects as .fovea files and delete ones you no longer need.";
  }
  return e instanceof Error ? e.message : String(e);
}

function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function Library() {
  const platform = usePlatform();
  const toast = useToast();
  const [items, setItems] = useState<AssignmentSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<AssignmentSummary | null>(null);
  const [deleting, setDeleting] = useState<AssignmentSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [shortcuts, setShortcuts] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target)) setShortcuts(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await platform.listAssignments();
      setItems(list.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)));
      setLoadError(undefined);
    } catch (e) {
      setLoadError(describeError(e));
      setItems([]);
    }
    platform.storageInfo?.().then(setStorage).catch(() => {});
  }, [platform]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runImport = async (pick: () => Promise<ImportedFovea | null>) => {
    setImporting(true);
    try {
      const res = await pick();
      if (!res) return;
      for (const w of res.warnings) toast(w.message, "error");
      toast(`Imported “${res.manifest.title}” with ${res.manifest.images.length} ${res.manifest.images.length === 1 ? "image" : "images"}.`);
      navigate({ name: "editor", id: res.manifest.assignmentId });
    } catch (e) {
      toast(`Could not import: ${describeError(e)}`, "error");
    } finally {
      setImporting(false);
    }
  };
  const doImport = (file?: File) => runImport(() => platform.importFovea(file));
  const importFolder = () => runImport(() => platform.importProjectFolder());

  const importButton = (
    <ImportMenu importing={importing} folder={platform.capabilities.projectFolderImport} onFile={() => void doImport()} onFolder={() => void importFolder()} />
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const file = files.find((f) => f.name.toLowerCase().endsWith(".fovea"));
    if (file) void doImport(file);
    else if (files.length && platform.viewer?.openFiles) {
      platform.viewer
        .openFiles(files)
        .then((folder) => folder && openInViewer(folder))
        .catch((err) => toast(describeError(err), "error"));
    }
  };

  return (
    <div className="library" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <h1>Fovea</h1>
        </div>
        <div className="topbar-actions">
          <ShortcutsButton onClick={() => setShortcuts(true)} />
          <OpenPhotosButton compact />
          {importButton}
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New project
          </Button>
        </div>
      </header>

      <main className="library-main">
        {loadError ? (
          <p className="error" role="alert">
            Projects could not be loaded: {loadError}
          </p>
        ) : null}
        {items === null ? (
          <p className="muted" aria-busy="true">
            Loading projects…
          </p>
        ) : items.length === 0 ? (
          <div className="welcome">
            <section className="welcome-hero" aria-labelledby="welcome-h">
              <h2 id="welcome-h">Welcome to Fovea</h2>
              <p className="welcome-lede">
                Fovea shows your photographs with the camera data that made them. Put a set of photographs in a project, write a
                caption for each one, and present them fullscreen. You can send the whole project to someone as a single file.
              </p>
            </section>
            <div className="empty">
              <h3>No projects yet</h3>
              <p>
                Create a project and add photographs. Fovea reads
                {platform.capabilities.rawImport ? " RAW files (NEF, CR2, CR3, ARW), JPEG and TIFF" : " JPEG, TIFF and PNG, and RAW files through their embedded preview"}.
                Or import a <span className="mono">.fovea</span> file someone shared with you
                {platform.capabilities.projectFolderImport ? ", or a folder you unzipped from one" : ""}.
              </p>
              <div className="empty-actions">
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> New project
                </Button>
                {importButton}
              </div>
            </div>
          </div>
        ) : (
          <section className="projects" aria-labelledby="projects-h">
            <div className="library-hero">
              <h2 id="projects-h">Projects</h2>
              <p className="muted">
                {items.length} {items.length === 1 ? "project" : "projects"}, {items.reduce((n, a) => n + a.imageCount, 0)} photographs
              </p>
            </div>
            <ul className="project-grid" aria-label="Projects">
              {items.map((a) => (
                <AssignmentCard key={a.id} item={a} onRename={() => setRenaming(a)} onDelete={() => setDeleting(a)} />
              ))}
            </ul>
          </section>
        )}
        <RecentFolders />
        <footer className="library-foot small muted">
          Photographs stay on this {platform.kind === "web" ? "device, in this browser" : "computer"}. Nothing is uploaded.
          {platform.kind === "web" ? " Browsers sometimes clear stored data, so export a .fovea file as a backup." : ""}
          {storage ? (
            <>
              {" "}
              Using {formatBytes(storage.usageBytes)} of {formatBytes(storage.quotaBytes)}
              {storage.persisted ? " (persistent)." : "."}
            </>
          ) : null}
        </footer>
      </main>

      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      <TitleDialog
        open={creating}
        onOpenChange={setCreating}
        title="New project"
        submitLabel="Create"
        initial=""
        onSubmit={async (title) => {
          try {
            const m = await platform.createAssignment(title);
            navigate({ name: "editor", id: m.assignmentId });
          } catch (e) {
            toast(describeError(e), "error");
          }
        }}
      />
      <TitleDialog
        open={!!renaming}
        onOpenChange={(o) => !o && setRenaming(null)}
        title="Rename project"
        submitLabel="Rename"
        initial={renaming?.title ?? ""}
        onSubmit={async (title) => {
          if (!renaming) return;
          try {
            const m = await platform.loadAssignment(renaming.id);
            await platform.saveAssignment({ ...m, title, modifiedAt: new Date().toISOString() });
            await refresh();
          } catch (e) {
            toast(describeError(e), "error");
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title ?? ""}”?`}
        description="This removes the project and its stored images from this device. Your original photo files are not touched. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await platform.deleteAssignment(deleting.id);
            await refresh();
          } catch (e) {
            toast(describeError(e), "error");
          }
        }}
      />
    </div>
  );
}

function AssignmentCard({ item, onRename, onDelete }: { item: AssignmentSummary; onRename: () => void; onDelete: () => void }) {
  const cover = useAssetUrl(item.id, item.coverThumbnail);
  const open = () => navigate({ name: "editor", id: item.id });
  return (
    <li className="project-card">
      <button type="button" className="project-cover" onClick={open} aria-label={`Open ${item.title}`}>
        {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="cover-empty" />}
      </button>
      <div className="project-info">
        <div className="project-text">
          <button type="button" className="project-title" onClick={open}>
            {item.title}
          </button>
          <p className="small muted mono">
            {item.imageCount} {item.imageCount === 1 ? "image" : "images"} ·{" "}
            {new Date(item.modifiedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label={`More actions for ${item.title}`}>
              <MoreHorizontal size={18} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu menu-compact" align="end" sideOffset={4} collisionPadding={8}>
              <DropdownMenu.Item className="menu-item" onSelect={open}>
                <span className="menu-check" aria-hidden="true">
                  <FolderOpen size={14} />
                </span>
                <span className="menu-text">Open</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={onRename}>
                <span className="menu-check" aria-hidden="true">
                  <Pencil size={14} />
                </span>
                <span className="menu-text">Rename</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-sep" />
              <DropdownMenu.Item className="menu-item menu-item-danger" onSelect={onDelete}>
                <span className="menu-check" aria-hidden="true">
                  <Trash2 size={14} />
                </span>
                <span className="menu-text">Delete</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </li>
  );
}

export function TitleDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  submitLabel: string;
  initial: string;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    await onSubmit(value.trim());
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className="dialog-body">
        <label className="field">
          <span>Title</span>
          <input autoFocus value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Sal Forest, March" />
        </label>
        <div className="dialog-foot">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportMenu({ importing, folder, onFile, onFolder }: { importing: boolean; folder: boolean; onFile: () => void; onFolder: () => void }) {
  if (!folder) {
    return (
      <Button onClick={onFile} disabled={importing}>
        <FileUp size={16} /> {importing ? "Importing…" : "Import .fovea"}
      </Button>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button disabled={importing}>
          <FileUp size={16} /> {importing ? "Importing…" : "Import"} <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.Item className="menu-item" onSelect={onFile}>
            <span className="menu-check" aria-hidden="true">
              <FileArchive size={14} />
            </span>
            <span className="menu-text">
              .fovea file
              <span className="menu-sub">A project someone shared with you</span>
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={onFolder}>
            <span className="menu-check" aria-hidden="true">
              <FolderInput size={14} />
            </span>
            <span className="menu-text">
              Unzipped project folder
              <span className="menu-sub">The folder with manifest.json and assets/</span>
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
