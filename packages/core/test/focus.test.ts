import { describe, expect, it } from "vitest";
import { focusAreasFromTags, normalizeTags, orientBox, parseManifest } from "../src";

const close = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
  for (const k of ["x", "y", "width", "height"] as const) expect(a[k]).toBeCloseTo(b[k], 3);
};

// Values below are ExifTool -n output from real Nikon Z 8 / Z 9 NEFs.
const z8 = {
  Make: "NIKON CORPORATION",
  Model: "NIKON Z 8",
  AFImageWidth: 8256,
  AFImageHeight: 5504,
  AFAreaXPosition: 4646,
  AFAreaYPosition: 2752,
  AFAreaWidth: 291,
  AFAreaHeight: 323,
  CropHiSpeed: "11 8280 5520 8280 5520 0 0",
};

describe("focusAreasFromTags", () => {
  it("reads a Nikon Z AF area (centre and size in AF image pixels)", () => {
    const [a] = focusAreasFromTags({ ...z8, Orientation: 1 });
    close(a!, { x: (4646 - 145.5) / 8256, y: (2752 - 161.5) / 5504, width: 291 / 8256, height: 323 / 5504 });
  });

  it("maps a Nikon DX crop through CropHiSpeed", () => {
    const [a] = focusAreasFromTags({
      ...z8,
      Model: "NIKON Z 9",
      AFAreaXPosition: 4654,
      AFAreaYPosition: 3241,
      AFAreaWidth: 152,
      AFAreaHeight: 152,
      CropHiSpeed: "2 8280 5520 5408 3608 1436 956",
      Orientation: 1,
    });
    const s = 8256 / 8280;
    close(a!, {
      x: (4654 - 76 - 1436 * s) / (5408 * s),
      y: (3241 - 76 - 956 * s) / (3608 * s),
      width: 152 / (5408 * s),
      height: 152 / (3608 * s),
    });
  });

  it("drops areas that fall outside a crop", () => {
    expect(focusAreasFromTags({ ...z8, AFAreaXPosition: 300, CropHiSpeed: "2 8280 5520 5408 3608 1436 956" })).toEqual([]);
  });

  it("rotates areas for portrait frames", () => {
    const flat = focusAreasFromTags({ ...z8, Orientation: 1 })[0]!;
    close(focusAreasFromTags({ ...z8, Orientation: 6 })[0]!, { x: 1 - flat.y - flat.height, y: flat.x, width: flat.height, height: flat.width });
    close(focusAreasFromTags({ ...z8, Orientation: 8 })[0]!, { x: flat.y, y: 1 - flat.x - flat.width, width: flat.height, height: flat.width });
  });

  it("ignores Nikon files without AF coordinates", () => {
    expect(focusAreasFromTags({ Make: "NIKON CORPORATION", AFImageWidth: 8256, AFImageHeight: 5504, AFAreaXPosition: 0, AFAreaYPosition: 0 })).toEqual([]);
  });

  it("reads the Canon AF points that were in focus (Y up from the centre)", () => {
    const areas = focusAreasFromTags({
      Make: "Canon",
      AFImageWidth: 6000,
      AFImageHeight: 4000,
      AFAreaWidths: "200 200 200",
      AFAreaHeights: "100 100 100",
      AFAreaXPositions: "0 -1000 1000",
      AFAreaYPositions: "0 500 -500",
      AFPointsInFocus: "4",
      CameraType: 248,
    });
    expect(areas).toHaveLength(1);
    close(areas[0]!, { x: (4000 - 100) / 6000, y: (2500 - 50) / 4000, width: 200 / 6000, height: 100 / 4000 });
  });

  it("falls back to the selected Canon points and decodes negative int16 words", () => {
    const xs = Array.from({ length: 16 }, (_, i) => i * 10 - 80).join(" ");
    const ys = Array.from({ length: 16 }, () => 0).join(" ");
    const areas = focusAreasFromTags({
      Make: "Canon",
      AFImageWidth: 1000,
      AFImageHeight: 1000,
      AFAreaWidth: 10,
      AFAreaHeight: 10,
      AFAreaXPositions: xs,
      AFAreaYPositions: ys,
      AFPointsInFocus: "0",
      AFPointsSelected: "-32768",
    });
    expect(areas).toHaveLength(1);
    expect(areas[0]!.x).toBeCloseTo((500 + 70 - 5) / 1000, 4);
  });

  it("reads Sony FocusLocation as a point", () => {
    expect(focusAreasFromTags({ Make: "SONY", FocusLocation: "6000 4000 1500 1000" })).toEqual([{ x: 0.25, y: 0.25, width: 0, height: 0 }]);
  });

  it("reads OM System, Panasonic and Fujifilm positions", () => {
    expect(focusAreasFromTags({ Make: "OM Digital Solutions", AFPointSelected: "0.4 0.3 0.6 0.5" })).toEqual([{ x: 0.4, y: 0.3, width: 0.2, height: 0.2 }]);
    expect(focusAreasFromTags({ Make: "Panasonic", AFPointPosition: "0.5 0.25" })).toEqual([{ x: 0.5, y: 0.25, width: 0, height: 0 }]);
    expect(focusAreasFromTags({ Make: "Panasonic", AFPointPosition: "16777216 16777216" })).toEqual([]);
    expect(focusAreasFromTags({ Make: "FUJIFILM", FocusPixel: "3120 2080", ExifImageWidth: 6240, ExifImageHeight: 4160 })).toEqual([
      { x: 0.5, y: 0.5, width: 0, height: 0 },
    ]);
  });

  it("uses EXIF SubjectArea when there is no maker-note data", () => {
    expect(focusAreasFromTags({ Make: "Apple", SubjectArea: "2000 1500 400 300", ExifImageWidth: 4000, ExifImageHeight: 3000 })).toEqual([
      { x: 0.45, y: 0.45, width: 0.1, height: 0.1 },
    ]);
  });

  it("returns nothing without tags", () => {
    expect(focusAreasFromTags({})).toEqual([]);
  });
});

describe("orientBox", () => {
  it("round-trips through all eight orientations", () => {
    const b = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
    const inverse: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 7, 8: 6 };
    for (let o = 1; o <= 8; o++) close(orientBox(orientBox(b, o), inverse[o]!), b);
  });
});

describe("focus areas in the manifest", () => {
  it("are part of normalised metadata and survive manifest parsing", () => {
    const meta = normalizeTags({ ...z8, Orientation: 1 });
    expect(meta.focusAreas).toHaveLength(1);
    const m = parseManifest({
      format: "framenote",
      formatVersion: 1,
      assignmentId: crypto.randomUUID(),
      title: "t",
      createdAt: "x",
      modifiedAt: "x",
      generator: { app: "framenote", version: "0.1.0", platform: "desktop" },
      images: [
        {
          id: "img-1",
          type: "image",
          order: 0,
          originalFilename: "a.NEF",
          asset: "assets/images/img-1.jpg",
          thumbnail: "assets/thumbnails/img-1.jpg",
          assetSource: "embedded-preview",
          checksum: { algorithm: "sha256", asset: "a".repeat(64), thumbnail: "b".repeat(64) },
          focusAreas: meta.focusAreas,
        },
      ],
    });
    expect(m.images[0]!.focusAreas).toEqual(meta.focusAreas);
  });
});
