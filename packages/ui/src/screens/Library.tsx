import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronDown, FileArchive, FileUp, FolderInput, Plus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { FramenoteError, type AssignmentSummary } from "@framenote/core";
import type { ImportedFramenote } from "../platform";
import { usePlatform, type StorageInfo } from "../platform";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { navigate } from "../lib/router";
import { Button, ConfirmDialog, Dialog } from "../components/primitives";
import { useToast } from "../components/Toasts";

export function describeError(e: unknown): string {
  if (e instanceof FramenoteError) return e.details?.length ? `${e.message} (${e.details.slice(0, 3).join("; ")})` : e.message;
  if (e instanceof DOMException && e.name === "QuotaExceededError") {
    return "This device is out of browser storage. Export projects as .framenote files and delete ones you no longer need.";
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

  const runImport = async (pick: () => Promise<ImportedFramenote | null>) => {
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
  const doImport = (file?: File) => runImport(() => platform.importFramenote(file));
  const importFolder = () => runImport(() => platform.importProjectFolder());

  const importButton = (
    <ImportMenu importing={importing} folder={platform.capabilities.projectFolderImport} onFile={() => void doImport()} onFolder={() => void importFolder()} />
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find((f) => f.name.toLowerCase().endsWith(".framenote"));
    if (file) void doImport(file);
  };

  return (
    <div className="library" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>Frame Note</h1>
        </div>
        <div className="topbar-actions">
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
          <div className="empty">
            <h2>No projects yet</h2>
            <p>
              Create a project and add photographs
              {platform.capabilities.rawImport ? " — RAW files (NEF, CR2, CR3, ARW), JPEG or TIFF" : " — JPEG, or RAW files using their embedded preview"}.
              Or import a <span className="mono">.framenote</span> file someone shared with you
              {platform.capabilities.projectFolderImport ? ", or a folder you unzipped from one" : ""}.
            </p>
            <div className="empty-actions">
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> New project
              </Button>
              {importButton}
            </div>
          </div>
        ) : (
          <ul className="assignment-list" aria-label="Projects">
            {items.map((a) => (
              <AssignmentRow key={a.id} item={a} onRename={() => setRenaming(a)} onDelete={() => setDeleting(a)} />
            ))}
          </ul>
        )}
        <footer className="library-foot small muted">
          Photographs stay on this {platform.kind === "web" ? "device, in this browser" : "computer"}. Nothing is uploaded.
          {platform.kind === "web" ? " Browsers can clear stored data — export a .framenote as your backup." : ""}
          {storage ? (
            <>
              {" "}
              Using {formatBytes(storage.usageBytes)} of {formatBytes(storage.quotaBytes)}
              {storage.persisted ? " (persistent)." : "."}
            </>
          ) : null}
        </footer>
      </main>

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

function AssignmentRow({ item, onRename, onDelete }: { item: AssignmentSummary; onRename: () => void; onDelete: () => void }) {
  const cover = useAssetUrl(item.id, item.coverThumbnail);
  const open = () => navigate({ name: "editor", id: item.id });
  return (
    <li className="assignment-row">
      <button type="button" className="assignment-cover" onClick={open} aria-label={`Open ${item.title}`}>
        {cover ? <img src={cover} alt="" loading="lazy" /> : <span className="cover-empty" />}
      </button>
      <div className="assignment-info">
        <button type="button" className="assignment-title" onClick={open}>
          {item.title}
        </button>
        <p className="small muted mono">
          {item.imageCount} {item.imageCount === 1 ? "image" : "images"} ·{" "}
          {new Date(item.modifiedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
      <div className="assignment-actions">
        <Button size="sm" variant="ghost" onClick={onRename}>
          Rename
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
        <Button size="sm" onClick={open}>
          Open
        </Button>
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
        <FileUp size={16} /> {importing ? "Importing…" : "Import .framenote"}
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
              .framenote file
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
