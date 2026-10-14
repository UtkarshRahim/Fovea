import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, FolderOpen, ImagePlus, MessageSquareText, MonitorPlay, Package, SlidersHorizontal } from "lucide-react";
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
import { Filmstrip, ThumbStrip } from "../components/Filmstrip";
import { PhotoStage, type PhotoStageHandle, type ZoomInfo } from "../components/PhotoStage";
import { StageControls } from "../components/StageControls";
import { ProjectSwitcher } from "../components/ProjectSwitcher";
import { CameraSection, CommentsSection, NotesSection } from "../components/InfoPanel";
import { FieldPicker } from "../components/FieldPicker";
import { ExportBundleDialog, ExportImageDialog } from "../components/ExportDialogs";
import { useToast } from "../components/Toasts";
import { ShortcutsButton, ShortcutsDialog } from "../components/ShortcutsDialog";
import { describeError, TitleDialog } from "./Library";

export function Editor({ id, imageId }: { id: string; imageId?: string }) {
  const platform = usePlatform();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    setManifest(null);
    setError(undefined);
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
        <h1>This project could not be opened</h1>
        <p className="muted">{error}</p>
        <Button onClick={() => navigate({ name: "library" })}>All projects</Button>
      </div>
    );
  }
  if (!manifest) return <div className="center-message muted" aria-busy="true">Opening project…</div>;
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
const REVIEW_KEY = "framenote.reviewMode";

function EditorInner({ initial, imageId }: { initial: Manifest; imageId?: string }) {
  const platform = usePlatform();
  const toast = useToast();
  const { manifest, update, status, flush } = useAutosave(initial, (m) => platform.saveAssignment(m));
  const images = useMemo(() => sortedImages(manifest), [manifest]);
  const [selectedId, setSelectedId] = useState(imageId ?? images[0]?.id);
  const selected = images.find((i) => i.id === selectedId) ?? images[0];
  const selectedIndex = selected ? images.indexOf(selected) : -1;
  const [review, setReview] = useState(() => localStorage.getItem(REVIEW_KEY) === "1");
  const [picker, setPicker] = useState(false);
  const [exportImage, setExportImage] = useState(false);
  const [exportBundle, setExportBundle] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failures, setFailures] = useState<AddImagesResult["failures"]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [author, setAuthor] = useState(() => localStorage.getItem(AUTHOR_KEY) ?? "");
  const [zoom, setZoom] = useState<ZoomInfo>({ scale: 1, actualSize: 1 });
  const stage = useRef<PhotoStageHandle>(null);
  const aid = manifest.assignmentId;
  const commentCount = useMemo(() => images.reduce((n, i) => n + i.comments.length, 0), [images]);

  useEffect(() => {
    localStorage.setItem(AUTHOR_KEY, author);
  }, [author]);
  useEffect(() => {
    localStorage.setItem(REVIEW_KEY, review ? "1" : "0");
  }, [review]);

  const goTo = useCallback(
    (index: number) => {
      const next = images[Math.max(0, Math.min(images.length - 1, index))];
      if (next) setSelectedId(next.id);
    },
    [images],
  );

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

  const present = useCallback(async () => {
    await flush();
    navigate({ name: "present", id: aid, index: Math.max(0, selectedIndex), mode: "present" });
  }, [aid, flush, selectedIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || hasModifier(e) || picker || shortcuts) return;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowDown" || e.key === "ArrowRight") goTo(selectedIndex + 1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") goTo(selectedIndex - 1);
      else if (key === "r") setReview((v) => !v);
      else if (key === "i") setPicker(true);
      else if (key === "p" && images.length) void present();
      else if (e.key === "+" || e.key === "=") stage.current?.zoomBy(1.5);
      else if (e.key === "-" || e.key === "_") stage.current?.zoomBy(1 / 1.5);
      else if (e.key === "0") stage.current?.resetZoom();
      else if (e.key === "?") setShortcuts(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, images.length, selectedIndex, picker, shortcuts, present]);

  const addButtons = (
    <>
      <Button onClick={() => void add(false)} disabled={!!progress} title="Add photos">
        <ImagePlus size={16} /> <span className="hide-sm">Add photos</span>
      </Button>
      {platform.capabilities.folderImport ? (
        <Button variant="ghost" onClick={() => void add(true)} disabled={!!progress} title="Add a folder of photos">
          <FolderOpen size={16} /> <span className="hide-sm">Folder</span>
        </Button>
      ) : null}
    </>
  );

  return (
    <div className={`editor ${review ? "is-review" : "is-view"}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="topbar editor-topbar">
        <IconButton
          label="All projects"
          onClick={async () => {
            await flush();
            navigate({ name: "library" });
          }}
        >
          <ArrowLeft size={18} />
        </IconButton>
        <ProjectSwitcher currentId={aid} title={manifest.title} beforeLeave={flush} onRename={() => setRenaming(true)} />
        {review || status.state === "error" ? <SaveIndicator status={status} /> : null}
        <div className="topbar-actions">
          {addButtons}
          {review ? (
            <>
              <Button variant="ghost" onClick={() => setPicker((v) => !v)} aria-pressed={picker} title="Show on photo (I)">
                <SlidersHorizontal size={16} /> <span className="hide-sm">Show on photo</span>
              </Button>
              <Button variant="ghost" disabled={!selected} onClick={() => setExportImage(true)} title="Export image">
                <Download size={16} /> <span className="hide-sm">Export image</span>
              </Button>
              <Button variant="ghost" disabled={!images.length} onClick={() => setExportBundle(true)} title="Export .framenote">
                <Package size={16} /> <span className="hide-sm">Export .framenote</span>
              </Button>
            </>
          ) : null}
          <Button aria-pressed={review} className="review-toggle" onClick={() => setReview((v) => !v)} title="Review mode: notes, comments and camera data (R)">
            <MessageSquareText size={16} /> Review
            {commentCount ? <span className="count-badge mono">{commentCount}</span> : null}
          </Button>
          <ShortcutsButton onClick={() => setShortcuts(true)} />
          <Button variant="primary" disabled={!images.length} onClick={() => void present()} title="Present fullscreen (P)">
            <MonitorPlay size={16} /> <span className="hide-xs">Present</span>
          </Button>
        </div>
      </header>

      <div className="editor-body">
        {review ? (
          <aside className="editor-left" aria-label="Images">
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
              <p className="small muted filmstrip-empty">No images yet.</p>
            )}
          </aside>
        ) : null}

        <section className="editor-center" aria-label="Selected image">
          {selected ? (
            <>
              <PhotoStage
                ref={stage}
                assignmentId={aid}
                image={selected}
                fitMode="contain"
                overlay={manifest.presentation.overlay}
                showOverlay={manifest.presentation.overlay.visible}
                minOverlayScale={0.5}
                onSwipe={(d) => goTo(selectedIndex + d)}
                onZoomChange={setZoom}
                allowPageScroll={review}
              />
              <StageControls
                index={selectedIndex}
                count={images.length}
                onGo={goTo}
                zoom={zoom}
                onZoomBy={(f) => stage.current?.zoomBy(f)}
                onResetZoom={() => stage.current?.resetZoom()}
              />
            </>
          ) : (
            <div className="center-message muted">
              <p>No photos in this project yet.</p>
              <p className="small">
                {platform.capabilities.rawImport
                  ? "Add RAW (NEF, CR2, CR3, ARW), JPEG or TIFF files, or drop them here. Originals are never modified."
                  : "Add photos from this device. JPEG works everywhere; RAW files show the camera's embedded preview."}
              </p>
              <div className="empty-actions">{addButtons}</div>
            </div>
          )}
          <ImportStatus progress={progress} failures={failures} onCancel={() => platform.cancelAddImages()} onDismiss={() => setFailures([])} />
          {picker ? (
            <FieldPicker
              presentation={manifest.presentation}
              onChange={(presentation) => update((m) => ({ ...m, presentation, modifiedAt: new Date().toISOString() }))}
              onClose={() => setPicker(false)}
            />
          ) : null}
        </section>

        {review ? (
          <aside className="editor-right" aria-label="Notes and metadata">
            {selected ? (
              <>
                <NotesSection image={selected} onChange={(patch) => update((m) => updateUserNotes(m, selected.id, patch))} />
                <CommentsSection
                  comments={selected.comments}
                  authorName={author}
                  onAuthorName={setAuthor}
                  onAdd={(text) => update((m) => addComment(m, selected.id, text, author))}
                  onDelete={(cid) => update((m) => deleteComment(m, selected.id, cid))}
                />
                <CameraSection image={selected} />
              </>
            ) : null}
            <section className="panel-section" aria-labelledby="project-notes-h">
              <h2 id="project-notes-h" className="section-title">
                Project notes
              </h2>
              <label className="field">
                <span className="sr-only">Project notes</span>
                <textarea
                  rows={4}
                  value={manifest.notes ?? ""}
                  placeholder="Brief, goals, what reviewers should focus on…"
                  onChange={(e) => update((m) => ({ ...m, notes: e.target.value || undefined, modifiedAt: new Date().toISOString() }))}
                />
              </label>
            </section>
          </aside>
        ) : null}
      </div>

      {!review && images.length > 1 ? <ThumbStrip assignmentId={aid} images={images} selectedId={selected?.id} onSelect={setSelectedId} /> : null}

      {selected ? <ExportImageDialog open={exportImage} onOpenChange={setExportImage} manifest={manifest} image={selected} onDone={(m) => toast(m)} /> : null}
      <ExportBundleDialog open={exportBundle} onOpenChange={setExportBundle} manifest={manifest} onDone={(m) => toast(m)} />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      <TitleDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename project"
        submitLabel="Rename"
        initial={manifest.title}
        onSubmit={async (title) => update((m) => ({ ...m, title, modifiedAt: new Date().toISOString() }))}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this image from the project?"
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

function ImportStatus({
  progress,
  failures,
  onCancel,
  onDismiss,
}: {
  progress: ImportProgress | null;
  failures: AddImagesResult["failures"];
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (!progress && !failures.length) return null;
  return (
    <div className="import-status">
      {progress ? (
        <div className="progress" role="status">
          <div className="progress-bar">
            <span style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "8%" }} />
          </div>
          <p className="small muted">
            {progress.total ? `Adding ${progress.done} / ${progress.total}` : "Waiting for files…"} {progress.current ? `· ${progress.current}` : ""}
          </p>
          {progress.total ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
      {failures.length ? (
        <div className="failures">
          <p className="small">
            {failures.length} {failures.length === 1 ? "file" : "files"} skipped.{" "}
            <button type="button" className="link" onClick={onDismiss}>
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
    </div>
  );
}
