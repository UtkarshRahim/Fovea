import { describe, expect, it } from "vitest";
import { FoveaError, ManifestSchema, createManifest, migrations, parseManifest } from "../src";
import { sampleAssignment } from "./helpers";

describe("manifest validation", () => {
  it("accepts a valid manifest", async () => {
    const { manifest } = await sampleAssignment(2);
    expect(parseManifest(JSON.parse(JSON.stringify(manifest))).images).toHaveLength(2);
  });

  it("fills defaults when optional fields are missing", () => {
    const m = createManifest({ title: "T", platform: "web", appVersion: "0.1.0" });
    const { presentation: _p, ...rest } = m;
    const parsed = parseManifest(JSON.parse(JSON.stringify(rest)));
    expect(parsed.presentation.overlay.fields).toEqual(["focalLength", "aperture", "shutterSpeed", "iso"]);
    expect(parsed.presentation.fitMode).toBe("contain");
  });

  it("never invents missing metadata", async () => {
    const { manifest } = await sampleAssignment(1);
    const m = JSON.parse(JSON.stringify(manifest));
    delete m.images[0].exposure;
    delete m.images[0].camera;
    const parsed = parseManifest(m);
    expect(parsed.images[0]!.exposure).toBeUndefined();
    expect(parsed.images[0]!.camera).toBeUndefined();
  });

  it("strips unknown extra fields", async () => {
    const { manifest } = await sampleAssignment(1);
    const parsed = parseManifest({ ...JSON.parse(JSON.stringify(manifest)), surprise: 1 });
    expect("surprise" in parsed).toBe(false);
  });

  it("rejects wrong format names", () => {
    expect(() => parseManifest({ format: "fieldnote", formatVersion: 1 })).toThrow(/not a Fovea file/);
  });

  it("reports field-level issues", async () => {
    const { manifest } = await sampleAssignment(1);
    const m = JSON.parse(JSON.stringify(manifest));
    m.images[0].asset = "/abs/path.jpg";
    try {
      parseManifest(m);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FoveaError);
      expect((e as FoveaError).details?.join("\n")).toMatch(/images\.0\.asset/);
    }
  });

  it("rejects duplicate image ids", async () => {
    const { manifest } = await sampleAssignment(2);
    const m = JSON.parse(JSON.stringify(manifest));
    m.images[1].id = m.images[0].id;
    expect(() => parseManifest(m)).toThrow(/Duplicate image id/);
  });

  it("has a migration registry", () => {
    expect(typeof migrations).toBe("object");
  });

  it("generates JSON Schema", () => {
    expect(ManifestSchema).toBeDefined();
  });
});
