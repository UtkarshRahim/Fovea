import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { ArrowLeft, ChevronDown, FolderPlus, ImagePlus, Maximize, Minimize, Plus, Type } from "lucide-react";
import {
  appendImages,
  extensionOf,
  OverlaySettingsSchema,
  type AssignmentSummary,
  type CameraMetadata,
  type ImageEntry,
  type Manifest,
  type OverlaySettings,
} from "@framenote/core";
import { usePlatform, type FolderPhoto, type FolderViewer, type ImportProgress, type PhotoFolder, type ViewablePhoto } from "../platform";
import { navigate } from "../lib/router";
import { hasModifier, isTypingTarget } from "../lib/keys";
import { useViewerSession } from "../lib/viewerSession";
import { Button, IconButton } from "../components/primitives";
import { ImageStage, type PhotoStageHandle, type ZoomInfo } from "../components/PhotoStage";
import { StageControls } from "../components/StageControls";
import { OverlayCanvas } from "../components/OverlayCanvas";
import { OpenPhotosButton, RecentFolders } from "../components/RecentFolders";
import { ShortcutsButton, ShortcutsDialog } from "../components/ShortcutsDialog";
import { useToast } from "../components/Toasts";
import { useFocusPoints } from "../hooks/useFocusPoints";
import { describeError, TitleDialog } from "./Library";

export function Viewer() {
  const platform = usePlatform();
  const session = useViewerSession();
  const viewer = platform.viewer;
  if (!viewer) {
    return (
      <div className="center-message">
        <p className="muted">Viewing folders is not available here.</p>
        <Button onClick={() => navigate({ name: "library" })}>All projects</Button>
      </div>
    );
  }
  if (!session) return <ViewerEmpty />;
  return <ViewerInner key={session.token} viewer={viewer} folder={session.folder} />;
}

function ViewerEmpty() {
  return (
    <div className="viewer">
      <header className="topbar">
        <IconButton label="All projects" onClick={() => navigate({ name: "library" })}>
          <ArrowLeft size={18} />
        </IconButton>
        <h1 className="viewer-title">View photos</h1>
      </header>
      <div className="center-message">
        <p>Open a photo to look through every photo in its folder. Nothing is copied or changed.</p>
        <OpenPhotosButton variant="primary" />
        <div className="viewer-recents">
          <RecentFolders />
        </div>
      </div>
    </div>
  );
}

interface Ready {
  url: string;
  width: number;
  height: number;
  source: ViewablePhoto["source"];
}

type Shown = ({ name: string } & Ready) | { name: string; error: string };

const CACHE_SIZE = 8;
const OVERLAY_KEY = "framenote.viewerOverlay";
const DIRECTION_KEY = "framenote.viewerOverlayDirection";

function sourceLabel(name: string, source: ViewablePhoto["source"]) {
  const ext = extensionOf(name).toUpperCase();
  if (source === "embedded-preview") return `${ext} · camera's embedded preview`;
  if (source === "converted") return `${ext} · converted for display`;
  return ext;
}

/** Decodes ahead of display. Chromium's decode() can reject very large images it still loads, so fall back to onload. */
async function measure(url: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("decode failed"));
  });
  loaded.catch(() => {});
  img.src = url;
  try {
    await img.decode();
  } catch {
    if (!img.complete) await loaded;
  }
  if (!img.naturalWidth) throw new Error("decode failed");
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/** Overlay rendering needs an image entry; this one only carries camera data, nothing is stored. */
function entryFor(name: string, metadata: CameraMetadata): ImageEntry {
  return {
    ...metadata,
    id: "viewer",
    type: "image",
    order: 0,
    originalFilename: name,
    asset: "assets/images/viewer.jpg",
    thumbnail: "assets/thumbnails/viewer.jpg",
    assetSource: "original-jpeg",
    checksum: { algorithm: "sha256", asset: "0".repeat(64), thumbnail: "0".repeat(64) },
    user: {},
    comments: [],
  };
}

function ViewerInner({ viewer, folder }: { viewer: FolderViewer; folder: PhotoFolder }) {
  const platform = usePlatform();
  const toast = useToast();
  const photos = folder.photos;
  const [index, setIndex] = useState(() => Math.min(folder.start, Math.max(0, photos.length - 1)));
  const [shown, setShown] = useState<Shown | null>(null);
  const [meta, setMeta] = useState<{ name: string; metadata: CameraMetadata } | null>(null);
  const [zoom, setZoom] = useState<ZoomInfo>({ scale: 1, actualSize: 1 });
  const [showFocus, toggleFocus] = useFocusPoints();
  const [overlayOn, setOverlayOn] = useState(() => localStorage.getItem(OVERLAY_KEY) === "1");
  const [direction, setDirection] = useState<OverlaySettings["direction"]>(() =>
    localStorage.getItem(DIRECTION_KEY) === "vertical" ? "vertical" : "horizontal",
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [naming, setNaming] = useState<null | "one" | "all">(null);
  const stage = useRef<PhotoStageHandle>(null);
  const cache = useRef(new Map<string, { promise: Promise<Ready>; url?: string }>());
  const metaCache = useRef(new Map<string, Promise<CameraMetadata>>());
  const photo = photos[index];

  useEffect(() => localStorage.setItem(OVERLAY_KEY, overlayOn ? "1" : "0"), [overlayOn]);
  useEffect(() => localStorage.setItem(DIRECTION_KEY, direction), [direction]);

  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const e of c.values()) if (e.url) URL.revokeObjectURL(e.url);
      c.clear();
    };
  }, []);

  const load = useCallback(
    (p: FolderPhoto): Promise<Ready> => {
      const c = cache.current;
      const hit = c.get(p.name);
      if (hit) {
        c.delete(p.name);
        c.set(p.name, hit);
        return hit.promise;
      }
      const entry: { promise: Promise<Ready>; url?: string } = { promise: Promise.resolve() as unknown as Promise<Ready> };
      entry.promise = (async () => {
        const v = await viewer.loadPhoto(folder, p);
        const url = URL.createObjectURL(v.blob);
        entry.url = url;
        const { width, height } = await measure(url).catch(() => {
          throw new Error(`This ${extensionOf(p.name).toUpperCase() || "file"} could not be displayed.`);
        });
        return { url, width, height, source: v.source };
      })();
      entry.promise.catch(() => {
        if (c.get(p.name) === entry) c.delete(p.name);
        if (entry.url) URL.revokeObjectURL(entry.url);
      });
      c.set(p.name, entry);
      while (c.size > CACHE_SIZE) {
        const [oldest, e] = c.entries().next().value!;
        c.delete(oldest);
        if (e.url) URL.revokeObjectURL(e.url);
      }
      return entry.promise;
    },
    [viewer, folder],
  );

  const loadMeta = useCallback(
    (p: FolderPhoto) => {
      let m = metaCache.current.get(p.name);
      if (!m) {
        m = viewer.loadMetadata(folder, p).catch(() => ({}));
        metaCache.current.set(p.name, m);
      }
      return m;
    },
    [viewer, folder],
  );

  useEffect(() => {
    if (!photo) return;
    let alive = true;
    load(photo)
      .then((r) => alive && setShown({ name: photo.name, ...r }))
      .catch((e) => alive && setShown({ name: photo.name, error: describeError(e) }));
    void loadMeta(photo).then((metadata) => alive && setMeta({ name: photo.name, metadata }));
    for (const n of [index + 1, index - 1, index + 2]) {
      const p = photos[n];
      if (p) load(p).catch(() => {});
    }
    const t = folder.reopenable ? setTimeout(() => void viewer.remember(folder, photo.name).catch(() => {}), 600) : undefined;
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [photo, index, photos, load, loadMeta, viewer, folder]);

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(photos.length - 1, i))), [photos.length]);

  const toggleFullscreen = useCallback(async () => {
    const next = !(await platform.isFullscreen());
    await platform.setFullscreen(next).catch(() => {});
    setFullscreen(await platform.isFullscreen());
  }, [platform]);

  useEffect(() => {
    const on = () => void platform.isFullscreen().then(setFullscreen);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, [platform]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || hasModifier(e) || shortcuts || naming) return;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") go(index + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(index - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(photos.length - 1);
      else if (e.key === "+" || e.key === "=") stage.current?.zoomBy(1.5);
      else if (e.key === "-" || e.key === "_") stage.current?.zoomBy(1 / 1.5);
      else if (e.key === "0") stage.current?.resetZoom();
      else if (key === "a") toggleFocus();
      else if (key === "o") setOverlayOn((v) => !v);
      else if (key === "v") {
        setDirection((d) => (d === "vertical" ? "horizontal" : "vertical"));
        setOverlayOn(true);
      } else if (key === "f") void toggleFullscreen();
      else if (e.key === "?") setShortcuts(true);
      else if (e.key === "Escape") {
        if (zoom.scale > 1.01) stage.current?.resetZoom();
        else if (fullscreen) void platform.setFullscreen(false).then(() => setFullscreen(false));
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, photos.length, toggleFocus, toggleFullscreen, shortcuts, naming, zoom.scale, fullscreen, platform]);

  const overlay = useMemo(() => OverlaySettingsSchema.parse({ showTitle: false, showCaption: false, direction }), [direction]);
  const metadata = meta && meta.name === shown?.name ? meta.metadata : undefined;
  const focusAreas = metadata?.focusAreas;
  const entry = useMemo(() => (shown && metadata ? entryFor(shown.name, metadata) : undefined), [shown, metadata]);

  const addTo = async (target: string | Manifest, which: FolderPhoto[], openAfter: boolean) => {
    setProgress({ done: 0, total: which.length });
    try {
      // Load before importing: loading a project deletes stored files its manifest does not list yet.
      const m = typeof target === "string" ? await platform.loadAssignment(target) : target;
      const assignmentId = m.assignmentId;
      const title = m.title;
      const res = await viewer.addToProject(assignmentId, folder, which, setProgress);
      if (res.entries.length) await platform.saveAssignment(appendImages(m, res.entries));
      for (const w of new Set(res.warnings ?? [])) toast(w, "error");
      if (!res.entries.length) {
        toast(res.failures[0] ? `Could not add: ${res.failures[0].message}` : "Nothing was added.", "error");
        return;
      }
      const what = res.entries.length === 1 ? res.entries[0]!.originalFilename : `${res.entries.length} photos`;
      const skipped = res.failures.length ? `, ${res.failures.length} could not be read` : "";
      toast(`Added ${what} to “${title}”${skipped}.`, res.failures.length ? "error" : "info");
      if (openAfter) navigate({ name: "editor", id: assignmentId });
    } catch (e) {
      toast(describeError(e), "error");
    } finally {
      setProgress(null);
    }
  };

  const createAndAdd = async (title: string) => {
    const which = naming === "all" ? photos : photo ? [photo] : [];
    await addTo(await platform.createAssignment(title), which, naming === "all");
  };

  if (!photos.length) {
    return (
      <div className="viewer">
        <ViewerTopbar folder={folder} />
        <div className="center-message">
          <p className="muted">There are no photos Frame Note can show in “{folder.name}”.</p>
          <OpenPhotosButton />
        </div>
      </div>
    );
  }

  const ready = shown && "url" in shown ? shown : null;
  const loading = !shown || shown.name !== photo?.name;

  return (
    <div className={`viewer ${fullscreen ? "is-fullscreen" : ""}`}>
      <ViewerTopbar folder={folder} photo={photo} index={index} source={ready && ready.name === photo?.name ? ready.source : undefined}>
        <AddToProjectMenu disabled={!!progress} count={photos.length} onAdd={(p) => void addTo(p.id, photo ? [photo] : [], false)} onNew={setNaming} />
        <OpenPhotosButton compact />
        <ShortcutsButton onClick={() => setShortcuts(true)} />
        <IconButton label={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </IconButton>
      </ViewerTopbar>

      <section className="viewer-stage editor-center" aria-label="Photo">
        {ready ? (
          <ImageStage
            ref={stage}
            imageKey={ready.name}
            fullUrl={ready.url}
            dims={{ width: ready.width, height: ready.height }}
            alt={ready.name}
            fitMode="contain"
            onSwipe={(d) => go(index + d)}
            onZoomChange={setZoom}
            focusAreas={focusAreas}
            showFocus={showFocus}
            overlay={overlayOn && entry ? (w, h) => <OverlayCanvas image={entry} settings={overlay} width={w} height={h} minScale={0.5} /> : undefined}
          />
        ) : null}
        {shown && "error" in shown && !loading ? (
          <div className="center-message">
            <p className="mono small">{shown.name}</p>
            <p className="muted">{shown.error}</p>
          </div>
        ) : null}
        {loading ? <p className="viewer-loading small muted">Loading…</p> : null}
        <StageControls
          index={index}
          count={photos.length}
          onGo={go}
          zoom={zoom}
          onZoomBy={(f) => stage.current?.zoomBy(f)}
          onResetZoom={() => stage.current?.resetZoom()}
          focus={{ on: showFocus, available: !!focusAreas?.length, onToggle: toggleFocus }}
        />
        <div className="viewer-stage-actions">
          <IconButton label={overlayOn ? "Hide camera data (O)" : "Show camera data (O)"} aria-pressed={overlayOn} onClick={() => setOverlayOn((v) => !v)}>
            <Type size={16} />
          </IconButton>
        </div>
        {progress ? (
          <div className="import-status" role="status">
            <div className="progress-bar">
              <span style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "8%" }} />
            </div>
            <p className="small muted">
              Adding {progress.done} / {progress.total} {progress.current ? `· ${progress.current}` : ""}
            </p>
            {progress.total > 1 ? (
              <Button size="sm" variant="ghost" onClick={() => platform.cancelAddImages()}>
                Cancel
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      <TitleDialog
        open={!!naming}
        onOpenChange={(o) => !o && setNaming(null)}
        title={naming === "all" ? `New project from ${photos.length} photos` : "New project with this photo"}
        submitLabel="Create"
        initial={naming === "all" && (folder.path || folder.reopenable) ? folder.name : ""}
        onSubmit={createAndAdd}
      />
    </div>
  );
}

function ViewerTopbar({
  folder,
  photo,
  index,
  source,
  children,
}: {
  folder: PhotoFolder;
  photo?: FolderPhoto;
  index?: number;
  source?: ViewablePhoto["source"];
  children?: ReactNode;
}) {
  return (
    <header className="topbar viewer-topbar">
      <IconButton label="All projects" onClick={() => navigate({ name: "library" })}>
        <ArrowLeft size={18} />
      </IconButton>
      <div className="viewer-heading">
        <h1 className="viewer-title" title={folder.path ?? folder.name}>
          {folder.name}
        </h1>
        {photo ? (
          <p className="viewer-sub small muted mono">
            <span className="viewer-filename">{photo.name}</span>
            {index !== undefined ? ` · ${index + 1} of ${folder.photos.length}` : ""}
            {source ? ` · ${sourceLabel(photo.name, source)}` : ""}
          </p>
        ) : null}
      </div>
      <div className="topbar-actions">{children}</div>
    </header>
  );
}

function AddToProjectMenu({
  disabled,
  count,
  onAdd,
  onNew,
}: {
  disabled: boolean;
  count: number;
  onAdd: (p: AssignmentSummary) => void;
  onNew: (which: "one" | "all") => void;
}) {
  const platform = usePlatform();
  const [projects, setProjects] = useState<AssignmentSummary[] | null>(null);
  const load = async () => {
    try {
      setProjects((await platform.listAssignments()).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)));
    } catch {
      setProjects([]);
    }
  };
  return (
    <DropdownMenu.Root onOpenChange={(o) => o && void load()}>
      <DropdownMenu.Trigger asChild>
        <Button disabled={disabled} title="Add this photo to a project">
          <ImagePlus size={16} /> <span className="hide-sm">Add to project</span> <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.Label className="menu-label">Add this photo to</DropdownMenu.Label>
          <div className="menu-scroll">
            {projects === null ? (
              <p className="menu-note">Loading…</p>
            ) : projects.length ? (
              projects.map((p) => (
                <DropdownMenu.Item key={p.id} className="menu-item" onSelect={() => onAdd(p)}>
                  <span className="menu-check" aria-hidden="true" />
                  <span className="menu-text">{p.title}</span>
                  <span className="menu-meta mono">{p.imageCount}</span>
                </DropdownMenu.Item>
              ))
            ) : (
              <p className="menu-note">No projects yet.</p>
            )}
          </div>
          <DropdownMenu.Item className="menu-item" onSelect={() => onNew("one")}>
            <span className="menu-check" aria-hidden="true">
              <Plus size={14} />
            </span>
            New project…
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-sep" />
          <DropdownMenu.Item className="menu-item" onSelect={() => onNew("all")}>
            <span className="menu-check" aria-hidden="true">
              <FolderPlus size={14} />
            </span>
            <span className="menu-text">
              New project from all {count} photos…
              <span className="menu-sub">Copies previews into a project you can caption and present</span>
            </span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
