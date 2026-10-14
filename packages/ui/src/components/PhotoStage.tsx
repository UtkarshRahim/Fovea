import { useLayoutEffect, useRef, useState } from "react";
import type { ImageEntry, OverlaySettings } from "@framenote/core";
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

export function PhotoStage({
  assignmentId,
  image,
  fitMode,
  overlay,
  showOverlay,
  minOverlayScale = 0.55,
  className = "",
}: {
  assignmentId: string;
  image: ImageEntry;
  fitMode: "contain" | "cover";
  overlay: OverlaySettings;
  showOverlay: boolean;
  minOverlayScale?: number;
  className?: string;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  const thumbUrl = useAssetUrl(assignmentId, image.thumbnail);
  const fullUrl = useAssetUrl(assignmentId, image.asset);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const dims = image.assetDimensions ?? image.dimensions ?? { width: 3, height: 2 };
  const rect = fitRect(size, dims, fitMode);
  const overlayRect: Rect =
    fitMode === "cover"
      ? { x: 0, y: 0, width: size.width, height: size.height }
      : rect;
  const full = fullUrl && loadedUrl === fullUrl;

  return (
    <div ref={ref} className={`stage ${className}`}>
      {thumbUrl && !full ? (
        <img className="stage-img stage-thumb" src={thumbUrl} alt="" aria-hidden="true" draggable={false} style={rectStyle(rect)} />
      ) : null}
      {fullUrl ? (
        <img
          key={fullUrl}
          className={`stage-img ${full ? "" : "stage-loading"}`}
          src={fullUrl}
          alt={image.user.caption || image.originalFilename}
          draggable={false}
          decoding="async"
          onLoad={() => setLoadedUrl(fullUrl)}
          onError={() => setFailed(true)}
          style={rectStyle(rect)}
        />
      ) : null}
      {failed ? <p className="stage-error">This image could not be displayed. The stored file may be damaged.</p> : null}
      {showOverlay && overlayRect.width > 0 ? (
        <div className="overlay-host" style={rectStyle(overlayRect)}>
          <OverlayCanvas image={image} settings={overlay} width={overlayRect.width} height={overlayRect.height} minScale={minOverlayScale} />
        </div>
      ) : null}
    </div>
  );
}

function rectStyle(r: Rect) {
  return { left: r.x, top: r.y, width: r.width, height: r.height };
}
