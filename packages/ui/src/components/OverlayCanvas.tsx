import { useEffect, useRef, useState } from "react";
import type { ImageEntry, OverlaySettings } from "@fovea/core";
import { computeLayout, contentFor, drawLayout, ensureFontsLoaded } from "../lib/draw";

/** Live overlay. Drawn with the same layout and draw code as exports so the two always match. */
export function OverlayCanvas({
  image,
  settings,
  width,
  height,
  minScale = 0,
}: {
  image: ImageEntry;
  settings: OverlaySettings;
  width: number;
  height: number;
  minScale?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let alive = true;
    ensureFontsLoaded().then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!settings.visible) return;
    drawLayout(ctx, computeLayout(image, settings, width, height, minScale), width);
  }, [image, settings, width, height, minScale, fontsReady]);

  const content = contentFor(image, settings);
  const text = [content.title, content.values.map((v) => `${v.label} ${v.value}`).join(", "), settings.showCaption ? content.caption : undefined]
    .filter(Boolean)
    .join(". ");

  return (
    <>
      <canvas ref={ref} className="overlay-canvas" style={{ width, height }} aria-hidden="true" data-testid="overlay-canvas" />
      {settings.visible && text ? (
        <p className="sr-only" aria-live="polite">
          {text}
        </p>
      ) : null}
    </>
  );
}
