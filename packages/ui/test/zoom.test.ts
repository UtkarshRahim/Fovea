import { describe, expect, it } from "vitest";
import { clampZoom, fitRect, zoomAt, zoomLabel } from "../src/components/PhotoStage";

const size = { width: 1000, height: 500 };
const base = fitRect(size, { width: 3000, height: 2000 }, "contain");

describe("zoom", () => {
  it("keeps the point under the cursor fixed", () => {
    const z = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 400, 200);
    expect(2 * 400 + z.x).toBe(400);
    expect(2 * 200 + z.y).toBe(200);
    const again = zoomAt(z, 6, 100, 50);
    const contentX = (100 - z.x) / z.scale;
    expect(contentX * 6 + again.x).toBeCloseTo(100);
  });

  it("never zooms out past fit and centres the image when it is smaller than the stage", () => {
    const z = clampZoom({ scale: 0.5, x: 99, y: 99 }, base, size);
    expect(z).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("stops panning at the image edges", () => {
    const z = clampZoom({ scale: 4, x: 10_000, y: -10_000 }, base, size);
    const left = base.x * z.scale + z.x;
    const bottom = (base.y + base.height) * z.scale + z.y;
    expect(left).toBeCloseTo(0);
    expect(bottom).toBeCloseTo(size.height);
  });

  it("labels zoom relative to the stored image's pixels", () => {
    expect(zoomLabel({ scale: 1, actualSize: 4 })).toBe("Fit");
    expect(zoomLabel({ scale: 4, actualSize: 4 })).toBe("100%");
    expect(zoomLabel({ scale: 2, actualSize: 4 })).toBe("50%");
  });
});
