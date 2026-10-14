import { describe, expect, it } from "vitest";
import { exifDateToIso, normalizeTags } from "../src";

describe("normalizeTags", () => {
  it("normalises ExifTool -n output", () => {
    const meta = normalizeTags({
      Make: "NIKON CORPORATION",
      Model: "NIKON Z 9",
      LensModel: "NIKKOR Z 600mm f/4 TC VR S",
      LensID: "NIKKOR Z 600mm f/4 TC VR S",
      FNumber: 5.6,
      ExposureTime: 0.000625,
      ISO: 800,
      FocalLength: 600,
      ExposureCompensation: 0,
      DateTimeOriginal: "2026:03:14 06:42:11",
      ImageSize: "8256 5504",
      Orientation: 1,
      GPSLatitude: 23.7,
      GPSLongitude: 81.0,
    });
    expect(meta).toEqual({
      camera: { make: "NIKON CORPORATION", model: "NIKON Z 9" },
      lens: { model: "NIKKOR Z 600mm f/4 TC VR S" },
      exposure: { aperture: 5.6, shutterSpeedSeconds: 0.000625, iso: 800, focalLengthMm: 600, exposureCompensationEv: 0 },
      capturedAt: "2026-03-14T06:42:11",
      dimensions: { width: 8256, height: 5504 },
      orientation: 1,
      gps: { latitude: 23.7, longitude: 81.0 },
      rawMetadata: { LensID: "NIKKOR Z 600mm f/4 TC VR S" },
    });
  });

  it("does not infer a lens from lookup-only tags", () => {
    const meta = normalizeTags({ LensType: "Sony FE 200-600mm F5.6-6.3 G OSS", LensID: "Sigma or Tamron" });
    expect(meta.lens).toBeUndefined();
    expect(meta.rawMetadata).toEqual({ LensID: "Sigma or Tamron", LensType: "Sony FE 200-600mm F5.6-6.3 G OSS" });
  });

  it("handles exifr-style output", () => {
    const meta = normalizeTags({
      Make: "Canon",
      Model: "Canon EOS R5",
      FNumber: 8,
      ExposureTime: 0.004,
      ISO: 400,
      FocalLength: 500,
      ExifImageWidth: 8192,
      ExifImageHeight: 5464,
      latitude: -1.5,
      longitude: 35.1,
      DateTimeOriginal: "2025:08:01 17:03:59",
    });
    expect(meta.dimensions).toEqual({ width: 8192, height: 5464 });
    expect(meta.gps).toEqual({ latitude: -1.5, longitude: 35.1 });
  });

  it("returns an empty object when nothing is present", () => {
    expect(normalizeTags({})).toEqual({});
  });

  it("applies GPS refs to unsigned values and drops 0,0", () => {
    expect(normalizeTags({ GPSLatitude: 10, GPSLatitudeRef: "S", GPSLongitude: 20, GPSLongitudeRef: "W" }).gps).toEqual({
      latitude: -10,
      longitude: -20,
    });
    expect(normalizeTags({ GPSLatitude: 0, GPSLongitude: 0 }).gps).toBeUndefined();
  });

  it("parses fractional strings and ignores zero dates", () => {
    expect(normalizeTags({ ExposureTime: "1/250" }).exposure?.shutterSpeedSeconds).toBeCloseTo(0.004);
    expect(exifDateToIso("0000:00:00 00:00:00")).toBeUndefined();
  });
});
