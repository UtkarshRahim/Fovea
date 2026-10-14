import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize, SlidersHorizontal, Type, X } from "lucide-react";
import { sortedImages, type Manifest } from "@framenote/core";
import { usePlatform } from "../platform";
import { useAutosave } from "../hooks/useAutosave";
import { acquireAssetUrl, releaseAssetRef } from "../hooks/useAssetUrl";
import { navigate } from "../lib/router";
import { hasModifier, isTypingTarget } from "../lib/keys";
import { PhotoStage, zoomLabel, type PhotoStageHandle, type ZoomInfo } from "../components/PhotoStage";
import { FieldPicker } from "../components/FieldPicker";
import { Button, IconButton } from "../components/primitives";
import { ShortcutsButton, ShortcutsDialog } from "../components/ShortcutsDialog";
import { describeError } from "./Library";

const HINT_KEY = "framenote.presentHintSeen";
const IDLE_MS = 2500;

export function Present({ id, index, mode }: { id: string; index: number; mode: "present" | "preview" }) {
  const platform = usePlatform();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    platform
      .loadAssignment(id)
      .then((m) => alive && setManifest(m))
      .catch((e) => alive && setError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [platform, id]);
  if (error)
    return (
      <div className="center-message">
        <p>{error}</p>
        <Button onClick={() => navigate({ name: "library" })}>All projects</Button>
      </div>
    );
  if (!manifest) return <div className="present present-loading" aria-busy="true" />;
  return <PresentInner initial={manifest} index={index} mode={mode} />;
}

export function PresentInner({ initial, index, mode }: { initial: Manifest; index: number; mode: "present" | "preview" }) {
  const platform = usePlatform();
  const { manifest, update, flush } = useAutosave(initial, (m) => platform.saveAssignment(m));
  const images = useMemo(() => sortedImages(manifest), [manifest]);
  const count = images.length;
  const [i, setI] = useState(() => Math.min(index, Math.max(0, count - 1)));
  const [overlayOn, setOverlayOn] = useState(mode === "present" ? manifest.presentation.overlay.visible : false);
  const fit = manifest.presentation.fitMode;
  const [picker, setPicker] = useState(false);
  const [controls, setControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [hint, setHint] = useState(() => !localStorage.getItem(HINT_KEY));
  const [shortcuts, setShortcuts] = useState(false);
  const [zoom, setZoom] = useState<ZoomInfo>({ scale: 1, actualSize: 1 });
  const stage = useRef<PhotoStageHandle>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const image = images[i];
  const aid = manifest.assignmentId;

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(count - 1, next));
      setI(clamped);
      navigate({ name: "present", id: aid, index: clamped, mode }, true);
    },
    [aid, count, mode],
  );

  const poke = useCallback(() => {
    setControls(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setControls(false), IDLE_MS);
  }, []);

  useEffect(() => {
    poke();
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [poke]);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => {
      setHint(false);
      localStorage.setItem(HINT_KEY, "1");
    }, 5000);
    return () => clearTimeout(t);
  }, [hint]);

  // Keep the neighbours decoded so flipping is instant; at most three full-size images live at once.
  useEffect(() => {
    const neighbours = [images[i - 1], images[i + 1]].filter((x): x is NonNullable<typeof x> => !!x);
    const held: string[] = [];
    let alive = true;
    for (const n of neighbours) {
      held.push(n.asset);
      acquireAssetUrl(platform, aid, n.asset)
        .then((url) => {
          if (!alive) return;
          const img = new Image();
          img.decoding = "async";
          img.src = url;
          img.decode?.().catch(() => {});
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
      for (const p of held) releaseAssetRef(platform, aid, p);
    };
  }, [platform, aid, images, i]);

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

  const exit = useCallback(async () => {
    await flush();
    if (await platform.isFullscreen()) await platform.setFullscreen(false).catch(() => {});
    navigate({ name: "editor", id: aid, ...(image ? { image: image.id } : {}) }, true);
  }, [aid, flush, image, platform]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || hasModifier(e) || shortcuts) return;
      switch (e.key) {
        case "ArrowLeft":
          go(i - 1);
          break;
        case "ArrowRight":
          go(i + 1);
          break;
        case "Home":
          go(0);
          break;
        case "End":
          go(count - 1);
          break;
        case "f":
        case "F":
          void toggleFullscreen();
          break;
        case "o":
        case "O":
          setOverlayOn((v) => !v);
          break;
        case "i":
        case "I":
          setPicker((v) => !v);
          break;
        case "+":
        case "=":
          stage.current?.zoomBy(1.5);
          break;
        case "-":
        case "_":
          stage.current?.zoomBy(1 / 1.5);
          break;
        case "0":
          stage.current?.resetZoom();
          break;
        case "?":
          setShortcuts(true);
          break;
        case "Escape":
          if (picker) setPicker(false);
          else if (zoom.scale > 1.01) stage.current?.resetZoom();
          else
            void platform.isFullscreen().then((fs) => (fs ? platform.setFullscreen(false).then(() => setFullscreen(false)) : exit()));
          break;
        default:
          return;
      }
      e.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, exit, go, i, picker, platform, poke, toggleFullscreen, zoom.scale, shortcuts]);

  const toggleControls = useCallback(() => {
    setControls((c) => {
      if (!c) poke();
      return !c;
    });
  }, [poke]);
  const swipe = useCallback((d: 1 | -1) => go(i + d), [go, i]);

  if (!image) {
    return (
      <div className="present center-message">
        <p>This project has no images yet.</p>
        <Button onClick={() => void exit()}>Back to editor</Button>
      </div>
    );
  }

  return (
    <div
      className={`present ${controls ? "controls-on" : "controls-off"}`}
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
      role="region"
      aria-label={`Presentation, image ${i + 1} of ${count}`}
    >
      <PhotoStage
        ref={stage}
        assignmentId={aid}
        image={image}
        fitMode={fit}
        overlay={manifest.presentation.overlay}
        showOverlay={overlayOn}
        className="present-stage"
        onSwipe={swipe}
        onTap={toggleControls}
        onZoomChange={setZoom}
      />

      <div className="present-counter mono" aria-live="polite">
        {i + 1} / {count}
      </div>
      {zoom.scale > 1.01 ? (
        <button type="button" className="present-zoom mono on-photo" onClick={() => stage.current?.resetZoom()} title="Fit to screen (0)">
          {zoomLabel(zoom)}
        </button>
      ) : null}

      <div className="present-controls" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <div className="present-top">
          <IconButton label="Exit presentation (Esc)" onClick={() => void exit()} className="on-photo">
            <X size={20} />
          </IconButton>
          <div className="present-top-right">
            <IconButton label={overlayOn ? "Hide overlay (O)" : "Show overlay (O)"} onClick={() => setOverlayOn((v) => !v)} className="on-photo" aria-pressed={overlayOn}>
              <Type size={18} />
            </IconButton>
            <IconButton label="Show on photo (I)" onClick={() => setPicker((v) => !v)} className="on-photo" aria-pressed={picker}>
              <SlidersHorizontal size={18} />
            </IconButton>
            <ShortcutsButton onClick={() => setShortcuts(true)} className="on-photo" />
            <IconButton label={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"} onClick={() => void toggleFullscreen()} className="on-photo">
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </IconButton>
          </div>
        </div>
        <IconButton label="Previous image (←)" className="present-nav present-prev on-photo" disabled={i === 0} onClick={() => go(i - 1)}>
          <ChevronLeft size={28} />
        </IconButton>
        <IconButton label="Next image (→)" className="present-nav present-next on-photo" disabled={i === count - 1} onClick={() => go(i + 1)}>
          <ChevronRight size={28} />
        </IconButton>
      </div>

      {hint ? (
        <p className="present-hint small">
          {mode === "preview" ? "Preview mode. " : ""}← → or swipe to move · pinch, double-tap or + − to zoom · ? all shortcuts · Esc to leave
        </p>
      ) : null}

      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      {picker ? (
        <FieldPicker
          presentation={manifest.presentation}
          onChange={(presentation) => {
            update((m) => ({ ...m, presentation, modifiedAt: new Date().toISOString() }));
            setOverlayOn(true);
          }}
          onClose={() => setPicker(false)}
        />
      ) : null}
    </div>
  );
}
