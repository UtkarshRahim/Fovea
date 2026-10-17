import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { FocusArea, ImageEntry, OverlaySettings } from "@fovea/core";
import { useAssetUrl } from "../hooks/useAssetUrl";
import { OverlayCanvas } from "./OverlayCanvas";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitRect(container: { width: number; height: number }, image: { width: number; height: number }, mode: "contain" | "cover"): Rect {
  if (!container.width || !container.height || !image.width || !image.height) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = mode === "contain" ? Math.min(container.width / image.width, container.height / image.height) : Math.max(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (container.width - width) / 2, y: (container.height - height) / 2, width, height };
}

/** Zoom is a scale over the fitted rect plus a translation, both in container pixels. */
export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: Zoom = { scale: 1, x: 0, y: 0 };
const MAX_ZOOM = 16;

/** Keeps the zoomed image covering the stage, or centred on an axis where it is smaller than the stage. */
export function clampZoom(z: Zoom, base: Rect, size: { width: number; height: number }, max = MAX_ZOOM): Zoom {
  const scale = Math.min(max, Math.max(1, z.scale));
  const axis = (t: number, start: number, len: number, view: number) => {
    const scaled = len * scale;
    if (scaled <= view) return (view - scaled) / 2 - start * scale;
    return Math.min(-start * scale, Math.max(view - (start + len) * scale, t));
  };
  return { scale, x: axis(z.x, base.x, base.width, size.width), y: axis(z.y, base.y, base.height, size.height) };
}

/** Zooms to `scale` keeping the point (px, py) of the stage under the same spot. */
export function zoomAt(z: Zoom, scale: number, px: number, py: number): Zoom {
  const k = scale / z.scale;
  return { scale, x: px - (px - z.x) * k, y: py - (py - z.y) * k };
}

export interface PhotoStageHandle {
  zoomBy(factor: number): void;
  resetZoom(): void;
}

export interface ZoomInfo {
  /** 1 means fitted. */
  scale: number;
  /** Scale at which one stored image pixel covers one device pixel. */
  actualSize: number;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const SWIPE_PX = 50;
const TAP_PX = 10;
const TAP_MS = 400;
const DOUBLE_TAP_MS = 300;

interface StageCommon {
  fitMode: "contain" | "cover";
  className?: string;
  /** Called with +1 (next) or -1 (previous) on a horizontal swipe while not zoomed. */
  onSwipe?: (direction: 1 | -1) => void;
  /** Single tap or click that was not part of a double tap. */
  onTap?: () => void;
  onZoomChange?: (info: ZoomInfo) => void;
  /** Leave vertical touch scrolling to the page while not zoomed (for stages inside scrolling layouts). */
  allowPageScroll?: boolean;
  /** Where the camera focused; drawn when showFocus is on. */
  focusAreas?: FocusArea[];
  showFocus?: boolean;
}

/** A project photo: URLs come from the project's stored assets and the overlay from its presentation settings. */
export const PhotoStage = forwardRef<
  PhotoStageHandle,
  StageCommon & {
    assignmentId: string;
    image: ImageEntry;
    overlay: OverlaySettings;
    showOverlay: boolean;
    minOverlayScale?: number;
  }
>(function PhotoStage({ assignmentId, image, overlay, showOverlay, minOverlayScale = 0.55, ...rest }, handle) {
  const thumbUrl = useAssetUrl(assignmentId, image.thumbnail);
  const fullUrl = useAssetUrl(assignmentId, image.asset);
  return (
    <ImageStage
      ref={handle}
      {...rest}
      imageKey={image.id}
      fullUrl={fullUrl}
      thumbUrl={thumbUrl}
      dims={image.assetDimensions ?? image.dimensions ?? { width: 3, height: 2 }}
      alt={image.user.caption || image.originalFilename}
      focusAreas={image.focusAreas}
      overlay={
        showOverlay
          ? (w, h) => <OverlayCanvas image={image} settings={overlay} width={w} height={h} minScale={minOverlayScale} />
          : undefined
      }
    />
  );
});

/** Zoom, pan, swipe and tap handling around one image. */
export const ImageStage = forwardRef<
  PhotoStageHandle,
  StageCommon & {
    /** Zoom resets when this changes. */
    imageKey: string;
    fullUrl?: string;
    /** Shown until the full image has loaded. */
    thumbUrl?: string;
    dims: { width: number; height: number };
    alt: string;
    /** Drawn over the fitted image (the whole stage in cover mode) while not zoomed. */
    overlay?: (width: number, height: number) => ReactNode;
    errorMessage?: string;
  }
>(function ImageStage(
  {
    imageKey,
    fullUrl,
    thumbUrl,
    dims,
    alt,
    overlay,
    errorMessage = "This image could not be displayed. The stored file may be damaged.",
    fitMode,
    className = "",
    onSwipe,
    onTap,
    onZoomChange,
    allowPageScroll,
    focusAreas,
    showFocus,
  },
  handle,
) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [failedUrl, setFailedUrl] = useState<string>();
  const [zoom, setZoom] = useState<Zoom>(IDENTITY);
  const base = fitRect(size, dims, fitMode);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const actualSize = base.width ? dims.width / (base.width * dpr) : 1;
  const maxZoom = Math.min(MAX_ZOOM, Math.max(4, actualSize * 2));
  const zoomed = zoom.scale > 1.01;

  const geometry = useRef({ base, size, maxZoom, actualSize });
  geometry.current = { base, size, maxZoom, actualSize };
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const apply = useCallback((next: Zoom | ((z: Zoom) => Zoom)) => {
    setZoom((cur) => {
      const g = geometry.current;
      return clampZoom(typeof next === "function" ? next(cur) : next, g.base, g.size, g.maxZoom);
    });
  }, []);

  useEffect(() => setZoom(IDENTITY), [imageKey, fitMode]);
  useEffect(() => apply((z) => z), [apply, size.width, size.height]);
  useEffect(() => onZoomChange?.({ scale: zoom.scale, actualSize }), [onZoomChange, zoom.scale, actualSize]);

  const zoomBy = useCallback(
    (factor: number, px?: number, py?: number) => {
      const g = geometry.current;
      apply((z) => zoomAt(z, Math.min(g.maxZoom, Math.max(1, z.scale * factor)), px ?? g.size.width / 2, py ?? g.size.height / 2));
    },
    [apply],
  );
  useImperativeHandle(handle, () => ({ zoomBy: (f) => zoomBy(f), resetZoom: () => setZoom(IDENTITY) }), [zoomBy]);

  const toggleZoom = useCallback(
    (px: number, py: number) => {
      const g = geometry.current;
      apply((z) => (z.scale > 1.01 ? IDENTITY : zoomAt(z, Math.min(g.maxZoom, Math.max(2.5, g.actualSize)), px, py)));
    },
    [apply],
  );

  // Wheel needs a non-passive listener so pinch-to-zoom on trackpads doesn't zoom the whole page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else if (zoomRef.current.scale > 1.01) {
        e.preventDefault();
        apply((z) => ({ ...z, x: z.x - e.deltaX, y: z.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, ref, zoomBy]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    startT: number;
    zoom: Zoom;
    pinch?: { dist: number; midX: number; midY: number; zoom: Zoom };
    multi: boolean;
  } | null>(null);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (tapTimer.current && clearTimeout(tapTimer.current)), []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 1) {
      gesture.current = { startX: p.x, startY: p.y, startT: performance.now(), zoom: zoomRef.current, multi: false };
    } else if (gesture.current) {
      const ps = pinchState();
      gesture.current.multi = true;
      if (ps) gesture.current.pinch = { ...ps, zoom: zoomRef.current };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    if (g.pinch && pointers.current.size >= 2) {
      const ps = pinchState();
      if (!ps) return;
      const target = Math.min(geometry.current.maxZoom, Math.max(1, g.pinch.zoom.scale * (ps.dist / g.pinch.dist)));
      const z = zoomAt(g.pinch.zoom, target, g.pinch.midX, g.pinch.midY);
      apply({ ...z, x: z.x + ps.midX - g.pinch.midX, y: z.y + ps.midY - g.pinch.midY });
    } else if (pointers.current.size === 1 && g.zoom.scale > 1.01) {
      const p = local(e);
      apply({ ...g.zoom, x: g.zoom.x + p.x - g.startX, y: g.zoom.y + p.y - g.startY });
    }
  };

  const endPointer = (e: React.PointerEvent, cancelled: boolean) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // A finger lifted mid-pinch: continue as a pan from here.
      if (g) {
        const [rest] = [...pointers.current.values()];
        if (rest) Object.assign(g, { startX: rest.x, startY: rest.y, zoom: zoomRef.current, pinch: undefined });
      }
      return;
    }
    gesture.current = null;
    if (!g || cancelled || g.multi) return;
    const p = local(e);
    const dx = p.x - g.startX;
    const dy = p.y - g.startY;
    if (g.zoom.scale <= 1.01 && onSwipe && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
      onSwipe(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < TAP_PX && Math.abs(dy) < TAP_PX && performance.now() - g.startT < TAP_MS) {
      const now = performance.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        if (tapTimer.current) clearTimeout(tapTimer.current);
        lastTap.current = 0;
        toggleZoom(p.x, p.y);
        return;
      }
      lastTap.current = now;
      if (onTap) tapTimer.current = setTimeout(onTap, DOUBLE_TAP_MS - 40);
    }
  };

  const rect: Rect = { x: base.x * zoom.scale + zoom.x, y: base.y * zoom.scale + zoom.y, width: base.width * zoom.scale, height: base.height * zoom.scale };
  const overlayRect: Rect = fitMode === "cover" ? { x: 0, y: 0, width: size.width, height: size.height } : base;
  const full = fullUrl && loadedUrl === fullUrl;
  const touchAction = zoomed || !allowPageScroll ? "none" : "pan-y";

  return (
    <div
      ref={ref}
      className={`stage ${zoomed ? "is-zoomed" : ""} ${className}`}
      style={{ touchAction }}
      data-testid="photo-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
    >
      {thumbUrl && !full ? (
        <img className="stage-img stage-thumb" src={thumbUrl} alt="" aria-hidden="true" draggable={false} style={rectStyle(rect)} />
      ) : null}
      {fullUrl ? (
        <img
          key={fullUrl}
          className={`stage-img ${full ? "" : "stage-loading"}`}
          src={fullUrl}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={() => setLoadedUrl(fullUrl)}
          onError={() => setFailedUrl(fullUrl)}
          style={rectStyle(rect)}
        />
      ) : null}
      {fullUrl && failedUrl === fullUrl ? <p className="stage-error">{errorMessage}</p> : null}
      {showFocus && focusAreas?.length && rect.width > 0 ? <FocusLayer areas={focusAreas} rect={rect} /> : null}
      {overlay && !zoomed && overlayRect.width > 0 ? (
        <div className="overlay-host" style={rectStyle(overlayRect)}>
          {overlay(overlayRect.width, overlayRect.height)}
        </div>
      ) : null}
    </div>
  );
});

/** Corner brackets where the camera focused. Lives in image coordinates, so it follows zoom and pan. */
function FocusLayer({ areas, rect }: { areas: FocusArea[]; rect: Rect }) {
  return (
    <div className="focus-layer" style={rectStyle(rect)} aria-hidden="true" data-testid="focus-layer">
      {areas.map((a, i) => (
        <span
          key={i}
          className="focus-box"
          style={{
            left: `${(a.x + a.width / 2) * 100}%`,
            top: `${(a.y + a.height / 2) * 100}%`,
            width: `max(${a.width * 100}%, 18px)`,
            height: `max(${a.height * 100}%, 18px)`,
          }}
        />
      ))}
    </div>
  );
}

function rectStyle(r: Rect) {
  return { left: r.x, top: r.y, width: r.width, height: r.height };
}

/** "Fit" when not zoomed, otherwise the zoom relative to the stored image's actual pixels. */
export function zoomLabel(info: ZoomInfo): string {
  if (info.scale <= 1.01) return "Fit";
  return `${Math.round((info.scale / info.actualSize) * 100)}%`;
}
