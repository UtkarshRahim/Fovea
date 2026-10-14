import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, FolderOpen, ImagePlus, MonitorPlay, Package, SlidersHorizontal, Zap } from "lucide-react";
import {
  addComment,
  appendImages,
  deleteComment,
  removeImage,
  reorderImages,
  sortedImages,
  updateUserNotes,
  type Manifest,
} from "@framenote/core";
import { usePlatform, type AddImagesResult, type ImportProgress } from "../platform";
import { useAutosave, type SaveStatus } from "../hooks/useAutosave";
import { navigate } from "../lib/router";
import { hasModifier, isTypingTarget } from "../lib/keys";
import { Button, ConfirmDialog, IconButton } from "../components/primitives";
import { Filmstrip } from "../components/Filmstrip";
import { PhotoStage } from "../components/PhotoStage";
import { CameraSection, CommentsSection, NotesSection } from "../components/InfoPanel";
import { FieldPicker } from "../components/FieldPicker";
import { ExportBundleDialog, ExportImageDialog } from "../components/ExportDialogs";
import { useToast } from "../components/Toasts";
import { describeError } from "./Library";

export function Editor({ id, imageId }: { id: string; imageId?: string }) {
  const platform = usePlatform();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    setManifest(null);
    platform
      .loadAssignment(id)
      .then((m) => alive && setManifest(m))
      .catch((e) => alive && setError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [platform, id]);

  if (error) {
    return (
      <div className="center-message">
        <h1>This assignment could not be opened</h1>
        <p className="muted">{error}</p>
        <Button onClick={() => navigate({ name: "library" })}>Back to library</Button>
      </div>
    );
  }
  if (!manifest) return <div className="center-message muted" aria-busy="true">Opening assignment…</div>;
  return <EditorInner key={manifest.assignmentId} initial={manifest} imageId={imageId} />;
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const text =
    status.state === "saved" ? "Saved locally" : status.state === "error" ? `Not saved: ${status.message}` : "Saving…";
  return (
    <span className={`save-status ${status.state === "error" ? "error" : "muted"}`} role="status" aria-live="polite">
      {text}
    </span>
  );
}

const AUTHOR_KEY = "framenote.commentAuthor";

function EditorInner({ initial, imageId }: { initial: Manifest; imageId?: string }) {
  const platform = usePlatform();
  const toast = useToast();
  const { manifest, update, status, flush } = useAutosave(initial, (m) => platform.saveAssignment(m));
  const images = useMemo(() => sortedImages(manifest), [manifest]);
  const [selectedId, setSelectedId] = useState(imageId ?? images[0]?.id);
  const selected = images.find((i) => i.id === selectedId) ?? images[0];
  const selectedIndex = selected ? images.indexOf(selected) : -1;
  const [picker, setPicker] = useState(false);
  const [exportImage, setExportImage] = useState(false);
  const [exportBundle, setExportBundle] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failures, setFailures] = useState<AddImagesResult["failures"]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [author, setAuthor] = useState(() => localStorage.getItem(AUTHOR_KEY) ?? "");
  const aid = manifest.assignmentId;

  useEffect(() => {
    localStorage.setItem(AUTHOR_KEY, author);
  }, [author]);

  const handleResult = useCallback(
    (res: AddImagesResult | null) => {
      if (!res) return;
      if (res.entries.length) {
        update((m) => appendImages(m, res.entries));
        setSelectedId((cur) => cur ?? res.entries[0]?.id);
      }
      setFailures(res.failures);
      for (const w of new Set(res.warnings ?? [])) toast(w, "error");
      const parts = [`Added ${res.entries.length} ${res.entries.length === 1 ? "image" : "images"}`];
      if (res.failures.length) parts.push(`${res.failures.length} could not be read`);
      if (res.cancelled) parts.push("import cancelled");
      toast(`${parts.join(", ")}.`, res.failures.length && !res.entries.length ? "error" : "info");
    },
    [toast, update],
  );

  const add = async (folder: boolean) => {
    setProgress({ done: 0, total: 0 });
    try {
      handleResult(await platform.addImages(aid, { folder }, setProgress));
    } catch (e) {
      toast(describeError(e), "error");
    } finally {
      setProgress(null);
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!platform.addDroppedFiles || !e.dataTransfer.files.length) return;
    setProgress({ done: 0, total: e.dataTransfer.files.length });
    try {
      handleResult(await platform.addDroppedFiles(aid, Array.from(e.dataTransfer.files), setProgress));
    } catch (err) {
      toast(describeError(err), "error");
    } finally {
      setProgress(null);
    }
  };

  const present = useCallback(
    async (mode: "present" | "preview") => {
      await flush();
      navigate({ name: "present", id: aid, index: Math.max(0, selectedIndex), mode });
    },
    [aid, flush, selectedIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || hasModifier(e) || picker) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        const next = images[Math.min(images.length - 1, selectedIndex + 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        const prev = images[Math.max(0, selectedIndex - 1)];
        if (prev) setSelectedId(prev.id);
      } else if (e.key.toLowerCase() === "i") {
        setPicker(true);
      } else if (e.key.toLowerCase() === "p" && images.length) {
        void present("present");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images, selectedIndex, picker, present]);

  return (
    <div className="editor" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar editor-topbar">
        <IconButton
          label="Back to library"
          onClick={async () => {
            await flush();
            navigate({ name: "library" });
          }}
        >
          <ArrowLeft size={18} />
        </IconButton>
        <input
          className="title-input"
          aria-label="Assignment title"
          value={manifest.title}
          maxLength={200}
          onChange={(e) => update((m) => ({ ...m, title: e.target.value || "Untitled", modifiedAt: new Date().toISOString() }))}
        />
        <SaveIndicator status={status} />
        <div className="topbar-actions">
          <Button variant="ghost" onClick={() => setPicker((v) => !v)} aria-pressed={picker} title="Show on photo (I)">
            <SlidersHorizontal size={16} /> <span className="hide-sm">Show on photo</span>
          </Button>
          <Button variant="ghost" disabled={!selected} onClick={() => setExportImage(true)}>
            <Download size={16} /> <span className="hide-sm">Export image</span>
          </Button>
          <Button disabled={!images.length} onClick={() => setExportBundle(true)}>
            <Package size={16} /> <span className="hide-sm">Export .framenote</span>
          </Button>
          <Button variant="ghost" disabled={!images.length} onClick={() => void present("preview")} title="Fast preview">
            <Zap size={16} /> <span className="hide-sm">Preview</span>
          </Button>
          <Button variant="primary" disabled={!images.length} onClick={() => void present("present")} title="Present (P)">
            <MonitorPlay size={16} /> Present
          </Button>
        </div>
      </header>

      <div className="editor-body">
        <aside className="editor-left" aria-label="Images">
          <div className="add-row">
            <Button size="sm" onClick={() => void add(false)} disabled={!!progress}>
              <ImagePlus size={15} /> Add images
            </Button>
            {platform.capabilities.folderImport ? (
              <Button size="sm" variant="ghost" onClick={() => void add(true)} disabled={!!progress}>
                <FolderOpen size={15} /> Folder
              </Button>
            ) : null}
          </div>
          {progress ? (
            <div className="progress" role="status">
              <div className="progress-bar">
                <span style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "8%" }} />
              </div>
              <p className="small muted">
                {progress.total ? `${progress.done} / ${progress.total}` : "Waiting for files…"} {progress.current ? `· ${progress.current}` : ""}
              </p>
              {progress.total ? (
                <Button size="sm" variant="ghost" onClick={() => platform.cancelAddImages()}>
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : null}
          {failures.length ? (
            <div className="failures">
              <p className="small">
                {failures.length} {failures.length === 1 ? "file" : "files"} skipped.{" "}
                <button type="button" className="link" onClick={() => setFailures([])}>
                  Dismiss
                </button>
              </p>
              <ul className="small muted">
                {failures.slice(0, 20).map((f, i) => (
                  <li key={i}>
                    <span className="mono">{f.file}</span>: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {images.length ? (
            <Filmstrip
              assignmentId={aid}
              images={images}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              onReorder={(ids) => update((m) => ({ ...reorderImages(m, ids), modifiedAt: new Date().toISOString() }))}
              onRemove={setRemoving}
            />
          ) : (
            <p className="small muted filmstrip-empty">
              {platform.capabilities.rawImport
                ? "Add RAW (NEF, CR2, CR3, ARW), JPEG or TIFF files. Originals are never modified."
                : "Add photos from this device. JPEG works everywhere; RAW files show the camera's embedded preview."}
            </p>
          )}
        </aside>

        <section className="editor-center" aria-label="Selected image">
          {selected ? (
            <PhotoStage
              assignmentId={aid}
              image={selected}
              fitMode="contain"
              overlay={manifest.presentation.overlay}
              showOverlay={manifest.presentation.overlay.visible}
              minOverlayScale={0.5}
            />
          ) : (
            <div className="center-message muted">
              <p>No images yet.</p>
              <Button onClick={() => void add(false)}>
                <ImagePlus size={16} /> Add images
              </Button>
            </div>
          )}
          {picker ? (
            <FieldPicker
              presentation={manifest.presentation}
              onChange={(presentation) => update((m) => ({ ...m, presentation, modifiedAt: new Date().toISOString() }))}
              onClose={() => setPicker(false)}
            />
          ) : null}
        </section>

        <aside className="editor-right" aria-label="Notes and metadata">
          {selected ? (
            <>
              <NotesSection image={selected} onChange={(patch) => update((m) => updateUserNotes(m, selected.id, patch))} />
              <CameraSection image={selected} />
              <CommentsSection
                comments={selected.comments}
                authorName={author}
                onAuthorName={setAuthor}
                onAdd={(text) => update((m) => addComment(m, selected.id, text, author))}
                onDelete={(cid) => update((m) => deleteComment(m, selected.id, cid))}
              />
            </>
          ) : null}
          <section className="panel-section" aria-labelledby="assign-notes-h">
            <h2 id="assign-notes-h" className="section-title">
              Assignment notes
            </h2>
            <label className="field">
              <span className="sr-only">Assignment notes</span>
              <textarea
                rows={4}
                value={manifest.notes ?? ""}
                placeholder="Brief, goals, what reviewers should focus on…"
                onChange={(e) => update((m) => ({ ...m, notes: e.target.value || undefined, modifiedAt: new Date().toISOString() }))}
              />
            </label>
          </section>
        </aside>
      </div>

      {selected ? <ExportImageDialog open={exportImage} onOpenChange={setExportImage} manifest={manifest} image={selected} onDone={(m) => toast(m)} /> : null}
      <ExportBundleDialog open={exportBundle} onOpenChange={setExportBundle} manifest={manifest} onDone={(m) => toast(m)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this image from the assignment?"
        description="The original file on your device is not touched."
        confirmLabel="Remove"
        onConfirm={() => {
          if (!removing) return;
          const idx = images.findIndex((i) => i.id === removing);
          update((m) => removeImage(m, removing));
          if (removing === selected?.id) setSelectedId(images[idx + 1]?.id ?? images[idx - 1]?.id);
        }}
      />
    </div>
  );
}
