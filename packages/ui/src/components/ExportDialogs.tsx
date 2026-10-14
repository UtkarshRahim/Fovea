import { useState } from "react";
import { exportFilename, exportSize, type ImageEntry, type ImageExportOptions, type Manifest } from "@framenote/core";
import { usePlatform } from "../platform";
import { acquireAssetUrl, releaseAssetRef } from "../hooks/useAssetUrl";
import { renderExport } from "../lib/draw";
import { Button, Checkbox, Dialog, Segmented, Slider } from "./primitives";

const SIZES: { value: string; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "3840", label: "3840" },
  { value: "2048", label: "2048" },
  { value: "1600", label: "1600" },
];

export function ExportImageDialog({
  open,
  onOpenChange,
  manifest,
  image,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  manifest: Manifest;
  image: ImageEntry;
  onDone: (message: string) => void;
}) {
  const platform = usePlatform();
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [quality, setQuality] = useState(0.92);
  const [size, setSize] = useState("full");
  const [includeOverlay, setIncludeOverlay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const asset = image.assetDimensions ?? { width: 0, height: 0 };
  const longEdge = size === "full" ? null : Number(size);
  const planned = exportSize(asset, longEdge, platform.maxCanvasPixels);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    const opts: ImageExportOptions = { format, quality, longEdge, includeOverlay };
    try {
      const url = await acquireAssetUrl(platform, manifest.assignmentId, image.asset);
      try {
        const out = await renderExport(url, image, manifest.presentation.overlay, opts, platform.maxCanvasPixels);
        const saved = await platform.saveExportedImage(out.blob, exportFilename(image.originalFilename, format));
        if (saved) {
          onDone(`Exported ${out.width} × ${out.height} ${format.toUpperCase()} to ${saved.location}.`);
          onOpenChange(false);
        }
      } finally {
        releaseAssetRef(platform, manifest.assignmentId, image.asset);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export image"
      description="Saves this photograph with the overlay drawn in, exactly as it appears in the presentation."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={busy}>
            {busy ? "Exporting…" : "Export"}
          </Button>
        </>
      }
    >
      <div className="dialog-body">
        <Segmented
          label="Format"
          value={format}
          options={[
            { value: "jpeg", label: "JPEG" },
            { value: "png", label: "PNG" },
          ]}
          onChange={setFormat}
        />
        {format === "jpeg" ? (
          <Slider label="Quality" value={quality} min={0.6} max={1} step={0.01} onChange={setQuality} format={(v) => `${Math.round(v * 100)}`} />
        ) : null}
        <Segmented label="Long edge" value={size} options={SIZES} onChange={setSize} />
        <Checkbox id="exp-overlay" label="Include overlay and caption" checked={includeOverlay} onChange={setIncludeOverlay} />
        <p className="small muted">
          Output: <span className="mono">{planned.width} × {planned.height}</span>
          {planned.clampedForDevice ? " — reduced to fit this device's drawing limit." : ""}
          {longEdge && longEdge >= Math.max(asset.width, asset.height) ? " (never upscaled)" : ""}
        </p>
        {image.assetSource === "embedded-preview" ? (
          <p className="small notice">
            Source is the camera's embedded preview of the RAW file, not a full RAW conversion. Colour and detail follow the camera's JPEG.
          </p>
        ) : null}
        <p className="small muted">Exported images contain no EXIF or GPS data.</p>
        {error ? (
          <p className="small error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ExportBundleDialog({
  open,
  onOpenChange,
  manifest,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  manifest: Manifest;
  onDone: (message: string) => void;
}) {
  const platform = usePlatform();
  const [includeGps, setIncludeGps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hasGps = manifest.images.some((i) => i.gps);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await platform.exportFramenote(manifest, { stripGps: !includeGps });
      if (saved) {
        onDone(`Saved ${manifest.images.length} images to ${saved.location}.`);
        onOpenChange(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export .framenote"
      description="One portable file with every image, caption, comment and presentation setting. Opens on any computer or phone browser without the RAW files."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={busy || manifest.images.length === 0}>
            {busy ? "Packing…" : "Export"}
          </Button>
        </>
      }
    >
      <div className="dialog-body">
        {hasGps ? (
          <Checkbox id="bundle-gps" label="Include GPS locations from the camera" checked={includeGps} onChange={setIncludeGps} />
        ) : (
          <p className="small muted">None of these photographs contain GPS data.</p>
        )}
        {manifest.images.length === 0 ? <p className="small muted">Add at least one image first.</p> : null}
        {error ? (
          <p className="small error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
