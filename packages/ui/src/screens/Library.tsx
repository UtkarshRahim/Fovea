import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileUp, Plus } from "lucide-react";
import { FramenoteError, type AssignmentSummary } from "@framenote/core";
import { usePlatform, type StorageInfo } from "../platform";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { navigate } from "../lib/router";
import { Button, ConfirmDialog, Dialog } from "../components/primitives";
import { useToast } from "../components/Toasts";

export function describeError(e: unknown): string {
  if (e instanceof FramenoteError) return e.details?.length ? `${e.message} (${e.details.slice(0, 3).join("; ")})` : e.message;
  if (e instanceof DOMException && e.name === "QuotaExceededError") {
    return "This device is out of browser storage. Export assignments as .framenote files and delete ones you no longer need.";
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

  const doImport = async (file?: File) => {
    setImporting(true);
    try {
      const res = await platform.importFramenote(file);
      if (!res) return;
      for (const w of res.warnings) toast(w.message, "error");
      toast(`Imported “${res.manifest.title}” with ${res.manifest.images.length} images.`);
      await refresh();
    } catch (e) {
      toast(`Could not import: ${describeError(e)}`, "error");
    } finally {
      setImporting(false);
    }
  };

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
          <Button onClick={() => void doImport()} disabled={importing}>
            <FileUp size={16} /> {importing ? "Importing…" : "Import .framenote"}
          </Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New assignment
          </Button>
        </div>
      </header>

      <main className="library-main">
        {loadError ? (
          <p className="error" role="alert">
            Assignments could not be loaded: {loadError}
          </p>
        ) : null}
        {items === null ? (
          <p className="muted" aria-busy="true">
            Loading assignments…
          </p>
        ) : items.length === 0 ? (
          <div className="empty">
            <h2>No assignments yet</h2>
            <p>
              Create an assignment and add photographs
              {platform.capabilities.rawImport ? " — RAW files (NEF, CR2, CR3, ARW), JPEG or TIFF" : " — JPEG, or RAW files using their embedded preview"}.
              Or import a <span className="mono">.framenote</span> file someone shared with you.
            </p>
            <div className="empty-actions">
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> New assignment
              </Button>
              <Button onClick={() => void doImport()}>
                <FileUp size={16} /> Import .framenote
              </Button>
            </div>
          </div>
        ) : (
          <ul className="assignment-list" aria-label="Assignments">
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
        title="New assignment"
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
        title="Rename assignment"
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
        description="This removes the assignment and its stored images from this device. Your original photo files are not touched. This cannot be undone."
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

function TitleDialog({
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
          <input autoFocus value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Sal Forest Assignment" />
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
