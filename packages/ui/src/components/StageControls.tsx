import { ChevronLeft, ChevronRight, Focus, ZoomIn, ZoomOut } from "lucide-react";
import { zoomLabel, type ZoomInfo } from "./PhotoStage";
import { IconButton } from "./primitives";

export interface FocusToggle {
  on: boolean;
  /** Whether the current photo recorded a focus point. */
  available: boolean;
  onToggle: () => void;
}

export function focusLabel(f: FocusToggle): string {
  if (f.on && !f.available) return "Hide focus point (A). None recorded for this photo";
  return f.on ? "Hide focus point (A)" : "Show focus point (A)";
}

export function StageControls({
  index,
  count,
  onGo,
  zoom,
  onZoomBy,
  onResetZoom,
  focus,
}: {
  index: number;
  count: number;
  onGo: (index: number) => void;
  zoom: ZoomInfo;
  onZoomBy: (factor: number) => void;
  onResetZoom: () => void;
  focus?: FocusToggle;
}) {
  const zoomed = zoom.scale > 1.01;
  return (
    <div className="stage-controls" role="toolbar" aria-label="Photo controls">
      <IconButton label="Previous image (←)" disabled={index <= 0} onClick={() => onGo(index - 1)}>
        <ChevronLeft size={18} />
      </IconButton>
      <span className="stage-count mono" aria-live="polite">
        {index + 1} / {count}
      </span>
      <IconButton label="Next image (→)" disabled={index >= count - 1} onClick={() => onGo(index + 1)}>
        <ChevronRight size={18} />
      </IconButton>
      <span className="stage-controls-sep" aria-hidden="true" />
      <IconButton label="Zoom out (−)" disabled={!zoomed} onClick={() => onZoomBy(1 / 1.5)}>
        <ZoomOut size={17} />
      </IconButton>
      <button type="button" className="stage-zoom-label mono" onClick={onResetZoom} disabled={!zoomed} title="Fit to screen (0)">
        {zoomLabel(zoom)}
      </button>
      <IconButton label="Zoom in (+)" onClick={() => onZoomBy(1.5)}>
        <ZoomIn size={17} />
      </IconButton>
      {focus ? (
        <>
          <span className="stage-controls-sep" aria-hidden="true" />
          <IconButton
            label={focusLabel(focus)}
            aria-pressed={focus.on}
            className={`focus-toggle ${focus.on && !focus.available ? "is-unavailable" : ""}`}
            onClick={focus.onToggle}
          >
            <Focus size={17} />
          </IconButton>
        </>
      ) : null}
    </div>
  );
}
