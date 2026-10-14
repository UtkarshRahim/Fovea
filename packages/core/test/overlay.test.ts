import { describe, expect, it } from "vitest";
import {
  OverlaySettingsSchema,
  exportSize,
  layoutOverlay,
  overlayTitle,
  overlayValues,
  type MeasureText,
} from "../src";

const measure: MeasureText = (text, font) => text.length * font.size * 0.6;
const settings = OverlaySettingsSchema.parse({});
const values = overlayValues(settings.fields, {
  exposure: { focalLengthMm: 600, aperture: 5.6, shutterSpeedSeconds: 1 / 1600, iso: 800 },
});
const content = { title: "Bengal tiger · Bandhavgarh", values, caption: "Waiting in the sal forest before crossing the trail." };

describe("overlay layout", () => {
  it("places the overlay at the bottom inside the image", () => {
    const l = layoutOverlay(1920, 1280, settings, content, measure);
    expect(l.scale).toBe(1);
    expect(l.runs.map((r) => r.text)).toEqual([
      "Bengal tiger · Bandhavgarh",
      "FOCAL LENGTH",
      "600 mm",
      "APERTURE",
      "f/5.6",
      "SHUTTER",
      "1/1600 s",
      "ISO",
      "ISO 800",
      "Waiting in the sal forest before crossing the trail.",
    ]);
    expect(Math.max(...l.runs.map((r) => r.y))).toBeLessThanOrEqual(1280 - settings.paddingY);
    expect(Math.min(...l.runs.map((r) => r.y))).toBeGreaterThan(1280 / 2);
    expect(l.scrim.bottom).toBe(1280);
  });

  it("places the overlay at the top", () => {
    const l = layoutOverlay(1920, 1280, { ...settings, placement: "top" }, content, measure);
    expect(Math.max(...l.runs.map((r) => r.y))).toBeLessThan(1280 / 2);
    expect(l.scrim.top).toBe(0);
  });

  it("scales proportionally so export matches the live presentation", () => {
    const live = layoutOverlay(1920, 1280, settings, content, measure);
    const exported = layoutOverlay(5760, 3840, settings, content, measure);
    expect(exported.scale).toBe(3);
    live.runs.forEach((r, i) => {
      expect(exported.runs[i]!.x).toBeCloseTo(r.x * 3, 5);
      expect(exported.runs[i]!.y).toBeCloseTo(r.y * 3, 5);
      expect(exported.runs[i]!.font.size).toBeCloseTo(r.font.size * 3, 5);
    });
  });

  it("uses a single line in compact mode", () => {
    const l = layoutOverlay(1920, 1280, { ...settings, labelledGrid: false, showCaption: false, showTitle: false }, content, measure);
    expect(l.runs.map((r) => r.text)).toEqual(["600 mm  ·  f/5.6  ·  1/1600 s  ·  ISO 800"]);
  });

  it("wraps grid cells on narrow images", () => {
    const l = layoutOverlay(200, 700, settings, { values }, measure, 0.5);
    const valueRuns = l.runs.filter((r) => r.font.size > 9);
    expect(new Set(valueRuns.map((r) => Math.round(r.y))).size).toBeGreaterThan(1);
    for (const r of l.runs) expect(r.x + measure(r.text, r.font)).toBeLessThanOrEqual(200 + 1);
  });

  it("draws nothing when there is no content", () => {
    const l = layoutOverlay(1920, 1280, settings, { values: [] }, measure);
    expect(l.runs).toEqual([]);
    expect(l.scrim.opacity).toBe(0);
  });

  it("builds the title only from user fields", () => {
    expect(overlayTitle({})).toBeUndefined();
    expect(overlayTitle({ species: "Tiger" })).toBe("Tiger");
    expect(overlayTitle({ species: "Tiger", location: "Bandhavgarh" })).toBe("Tiger · Bandhavgarh");
  });
});

describe("export size", () => {
  it("never upscales", () => {
    expect(exportSize({ width: 2000, height: 1000 }, 4096)).toEqual({ width: 2000, height: 1000, clampedForDevice: false });
  });
  it("downscales to the long edge", () => {
    expect(exportSize({ width: 6000, height: 4000 }, 3000)).toEqual({ width: 3000, height: 2000, clampedForDevice: false });
  });
  it("respects the iOS canvas limit", () => {
    const s = exportSize({ width: 8256, height: 5504 }, null, 16_777_216);
    expect(s.width * s.height).toBeLessThanOrEqual(16_777_216);
    expect(s.clampedForDevice).toBe(true);
  });
});
