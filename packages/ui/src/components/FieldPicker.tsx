import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { FIELD_LABELS, OVERLAY_FIELDS, type OverlayField, type Presentation } from "@framenote/core";
import { Checkbox, IconButton, Segmented, Slider } from "./primitives";

const FIELD_NAMES: Record<OverlayField, string> = {
  ...FIELD_LABELS,
  shutterSpeed: "Shutter speed",
  camera: "Camera body",
  exposureCompensation: "Exposure compensation",
  capturedAt: "Capture date",
};

export function toggleDirection(p: Presentation): Presentation {
  return { ...p, overlay: { ...p.overlay, direction: p.overlay.direction === "vertical" ? "horizontal" : "vertical" } };
}

/** Non-modal panel so the photo stays visible while settings change. Bottom sheet on phones. */
export function FieldPicker({
  presentation,
  onChange,
  onClose,
}: {
  presentation: Presentation;
  onChange: (p: Presentation) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const o = presentation.overlay;
  const set = (patch: Partial<typeof o>) => onChange({ ...presentation, overlay: { ...o, ...patch } });

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button, [role=checkbox]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const toggle = (f: OverlayField, on: boolean) => {
    const next = on ? OVERLAY_FIELDS.filter((x) => x === f || o.fields.includes(x)) : o.fields.filter((x) => x !== f);
    set({ fields: next });
  };

  return (
    <section ref={panel} className="field-picker" role="dialog" aria-label="Show on photo" onPointerDown={(e) => e.stopPropagation()}>
      <div className="field-picker-head">
        <h2>Show on photo</h2>
        <IconButton label="Close panel" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="field-picker-body">
        <fieldset>
          <legend>Camera data</legend>
          {OVERLAY_FIELDS.map((f) => (
            <Checkbox key={f} id={`field-${f}`} label={FIELD_NAMES[f]} checked={o.fields.includes(f)} onChange={(v) => toggle(f, v)} />
          ))}
        </fieldset>
        <fieldset>
          <legend>Text</legend>
          <Checkbox id="opt-overlay" label="Show overlay" checked={o.visible} onChange={(v) => set({ visible: v })} />
          <Checkbox id="opt-title" label="Species · Location line" checked={o.showTitle} onChange={(v) => set({ showTitle: v })} />
          <Checkbox id="opt-caption" label="Caption" checked={o.showCaption} onChange={(v) => set({ showCaption: v })} />
          <Checkbox id="opt-grid" label="Labelled grid" checked={o.labelledGrid} onChange={(v) => set({ labelledGrid: v })} />
        </fieldset>
        <fieldset>
          <legend>Layout</legend>
          <Segmented
            label="Camera data (V)"
            value={o.direction}
            options={[
              { value: "horizontal", label: "Horizontal" },
              { value: "vertical", label: "Vertical" },
            ]}
            onChange={(direction) => set({ direction })}
          />
          <Segmented
            label="Placement"
            value={o.placement}
            options={[
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
            ]}
            onChange={(placement) => set({ placement })}
          />
          <Segmented
            label="Treatment"
            value={o.theme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={(theme) => set({ theme })}
          />
          <Segmented
            label="Fit"
            value={presentation.fitMode}
            options={[
              { value: "contain", label: "Whole photo" },
              { value: "cover", label: "Fill screen" },
            ]}
            onChange={(fitMode) => onChange({ ...presentation, fitMode })}
          />
          <Slider label="Font size" value={o.fontSize} min={10} max={40} step={1} onChange={(fontSize) => set({ fontSize })} format={(v) => `${v}`} />
          <Slider label="Side padding" value={o.paddingX} min={0} max={160} step={2} onChange={(paddingX) => set({ paddingX })} />
          <Slider label="Edge padding" value={o.paddingY} min={0} max={160} step={2} onChange={(paddingY) => set({ paddingY })} />
          <Slider
            label="Background"
            value={o.backgroundOpacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(backgroundOpacity) => set({ backgroundOpacity })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </fieldset>
      </div>
    </section>
  );
}
