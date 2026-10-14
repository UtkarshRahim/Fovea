import { describe, expect, it } from "vitest";
import {
  formatAperture,
  formatCamera,
  formatCaptureDate,
  formatExposureCompensation,
  formatFocalLength,
  formatIso,
  formatShutterSpeed,
  overlayValues,
} from "../src";

describe("formatters", () => {
  it.each([
    [0.000625, "1/1600 s"],
    [1 / 1600, "1/1600 s"],
    [0.5, "1/2 s"],
    [0.3333, "1/3 s"],
    [0.0166, "1/60 s"],
    [1 / 8000, "1/8000 s"],
    [2, "2 s"],
    [1, "1 s"],
    [1.3, "1.3 s"],
    [30, "30 s"],
    [0.77, "0.77 s"],
  ])("shutter %s → %s", (v, out) => expect(formatShutterSpeed(v)).toBe(out));

  it.each([
    [5.6, "f/5.6"],
    [11, "f/11"],
    [4.0, "f/4"],
    [1.8, "f/1.8"],
    [7.1000001, "f/7.1"],
  ])("aperture %s → %s", (v, out) => expect(formatAperture(v)).toBe(out));

  it("focal length and ISO", () => {
    expect(formatFocalLength(600)).toBe("600 mm");
    expect(formatFocalLength(4.5)).toBe("4.5 mm");
    expect(formatIso(800)).toBe("ISO 800");
  });

  it.each([
    [0.7, "+0.7 EV"],
    [-1, "-1 EV"],
    [0, "0 EV"],
    [0.6666667, "+0.7 EV"],
    [-0.333, "-0.3 EV"],
  ])("exposure comp %s → %s", (v, out) => expect(formatExposureCompensation(v)).toBe(out));

  it("omits missing or invalid values", () => {
    expect(formatShutterSpeed(undefined)).toBeUndefined();
    expect(formatShutterSpeed(0)).toBeUndefined();
    expect(formatAperture(Number.NaN)).toBeUndefined();
    expect(formatIso(undefined)).toBeUndefined();
    expect(formatExposureCompensation(undefined)).toBeUndefined();
  });

  it("formats capture date without shifting time zones", () => {
    expect(formatCaptureDate("2026-03-14T06:42:11", "en-GB")).toMatch(/14 Mar 2026.*06:42/);
    expect(formatCaptureDate("garbage")).toBeUndefined();
  });

  it("avoids duplicated brand names in camera", () => {
    expect(formatCamera({ camera: { make: "NIKON CORPORATION", model: "NIKON Z 9" } })).toBe("NIKON Z 9");
    expect(formatCamera({ camera: { make: "SONY", model: "ILCE-1" } })).toBe("SONY ILCE-1");
    expect(formatCamera({ camera: { make: "Canon", model: "Canon EOS R5" } })).toBe("Canon EOS R5");
  });

  it("overlayValues skips missing fields", () => {
    const v = overlayValues(["focalLength", "aperture", "shutterSpeed", "iso", "lens"], {
      exposure: { focalLengthMm: 600, iso: 800 },
    });
    expect(v.map((x) => x.value)).toEqual(["600 mm", "ISO 800"]);
  });
});
