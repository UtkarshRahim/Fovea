import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  FoveaError,
  LIMITS,
  packFovea,
  reorderImages,
  resolveImportCollision,
  sortedImages,
  unpackFovea,
  unsafePathReason,
  updateUserNotes,
} from "../src";
import { rawZip, sampleAssignment } from "./helpers";

async function pack(manifest: Parameters<typeof packFovea>[0], assets: Map<string, Uint8Array>, stripGps = false) {
  return packFovea(manifest, async (p) => assets.get(p)!, { stripGps });
}

describe(".fovea round trip", () => {
  it("preserves order, captions, metadata and presentation settings", async () => {
    let { manifest, assets } = await sampleAssignment(3);
    const ids = sortedImages(manifest).map((i) => i.id);
    manifest = reorderImages(manifest, [ids[2]!, ids[0]!, ids[1]!]);
    manifest = updateUserNotes(manifest, ids[0]!, { caption: "Waiting in the sal forest.", species: "Bengal tiger" });
    manifest.presentation.overlay.placement = "top";
    manifest.presentation.overlay.fields = ["iso", "lens"];
    manifest.presentation.fitMode = "cover";

    const bytes = await pack(manifest, assets, false);
    const out = await unpackFovea(bytes);
    expect(out.warnings).toEqual([]);
    expect(sortedImages(out.manifest).map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]]);
    const first = out.manifest.images.find((i) => i.id === ids[0])!;
    expect(first.user.caption).toBe("Waiting in the sal forest.");
    expect(first.user.species).toBe("Bengal tiger");
    expect(first.exposure).toEqual({ aperture: 5.6, shutterSpeedSeconds: 0.000625, iso: 800, focalLengthMm: 600 });
    expect(first.gps).toEqual({ latitude: 23.7, longitude: 81.0 });
    expect(out.manifest.presentation.overlay.placement).toBe("top");
    expect(out.manifest.presentation.overlay.fields).toEqual(["iso", "lens"]);
    expect(out.manifest.presentation.fitMode).toBe("cover");
    expect(out.assets.size).toBe(6);
  });

  it("stores images uncompressed and includes a README", async () => {
    const { manifest, assets } = await sampleAssignment(1);
    const bytes = await pack(manifest, assets);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("README.txt");
    const img = sortedImages(manifest)[0]!;
    const { unzipSync } = await import("fflate");
    expect(unzipSync(bytes)[img.asset]).toEqual(assets.get(img.asset));
  });

  it("strips GPS when asked", async () => {
    const { manifest, assets } = await sampleAssignment(2);
    const out = await unpackFovea(await pack(manifest, assets, true));
    expect(out.manifest.images.every((i) => i.gps === undefined)).toBe(true);
  });

  it("flags checksum mismatches as warnings", async () => {
    const { manifest, assets } = await sampleAssignment(2);
    const victim = sortedImages(manifest)[1]!;
    const tampered = new Map(assets);
    const bad = new Uint8Array(assets.get(victim.asset)!);
    bad[bad.length - 3] = 0x99;
    tampered.set(victim.asset, bad);
    const out = await unpackFovea(await pack(manifest, tampered));
    expect(out.checksumMismatches).toEqual([victim.id]);
    expect(out.warnings[0]!.message).toMatch(/checksum/);
  });

  it("creates a copy instead of overwriting an existing assignment", async () => {
    const { manifest } = await sampleAssignment(1);
    const copy = resolveImportCollision(manifest, [manifest.assignmentId]);
    expect(copy.assignmentId).not.toBe(manifest.assignmentId);
    expect(copy.title).toBe("Sal Forest Assignment (imported)");
    expect(resolveImportCollision(manifest, [])).toBe(manifest);
  });
});

describe("archive safety", () => {
  it.each([
    ["../evil.jpg", /\.\./],
    ["assets/../../evil", /\.\./],
    ["/etc/passwd", /absolute/],
    ["assets\\images\\a.jpg", /backslash/],
    ["C:/windows/a.jpg", /drive letter/],
    ["assets/a\0.jpg", /null byte/],
  ])("rejects %s", (path, reason) => {
    expect(unsafePathReason(path)).toMatch(reason);
  });

  it("accepts normal asset paths", () => {
    expect(unsafePathReason("assets/images/img-1.jpg")).toBeNull();
  });

  async function expectCode(data: Uint8Array, code: FoveaError["code"]) {
    const err = await unpackFovea(data).catch((e) => e);
    expect(err).toBeInstanceOf(FoveaError);
    expect(err.code).toBe(code);
    return err as FoveaError;
  }

  it("rejects traversal entries inside a real archive", async () => {
    await expectCode(rawZip({ "manifest.json": "{}", "../escape.txt": "x" }), "unsafe-path");
  });

  it("rejects files outside assets/", async () => {
    const { manifest, assets } = await sampleAssignment(1);
    const files: Record<string, Uint8Array | string> = { "manifest.json": JSON.stringify(manifest), "run.sh": "echo" };
    for (const [k, v] of assets) files[k] = v;
    await expectCode(rawZip(files), "unsafe-path");
  });

  it("rejects unreferenced assets", async () => {
    const { manifest, assets } = await sampleAssignment(1);
    const files: Record<string, Uint8Array | string> = { "manifest.json": JSON.stringify(manifest), "assets/extra.jpg": "x" };
    for (const [k, v] of assets) files[k] = v;
    await expectCode(rawZip(files), "unsafe-path");
  });

  it("rejects duplicate normalised paths", async () => {
    const { manifest, assets } = await sampleAssignment(1);
    const img = manifest.images[0]!;
    const files: Record<string, Uint8Array | string> = { "manifest.json": JSON.stringify(manifest) };
    for (const [k, v] of assets) files[k] = v;
    files[img.asset.toUpperCase().replace("ASSETS", "assets")] = "dup";
    await expectCode(rawZip(files), "unsafe-path");
  });

  it("rejects archives that expand past the limit (zip bomb)", async () => {
    const big = new Uint8Array(4 * 1024 * 1024);
    const data = zipSync({ "manifest.json": strToU8("{}"), "assets/a.bin": [big, { level: 9 }] });
    expect(data.length).toBeLessThan(64 * 1024);
    const err = await unpackFovea(data, { ...LIMITS, maxTotalUncompressedBytes: 1024 * 1024 }).catch((e) => e);
    expect(err.code).toBe("limits-exceeded");
  });

  it("rejects archives whose headers lie about size", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const data = zipSync({ "manifest.json": strToU8("{}"), "assets/a.bin": [big, { level: 9 }] });
    const view = new DataView(data.buffer);
    for (let i = 0; i < data.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 10, true);
    }
    const err = await unpackFovea(data, { ...LIMITS, maxTotalUncompressedBytes: 1024 * 1024 }).catch((e) => e);
    expect(err).toBeInstanceOf(FoveaError);
    expect(["limits-exceeded", "corrupt-archive"]).toContain(err.code);
  });

  it("rejects non-zip data", async () => {
    await expectCode(strToU8("this is just json {}"), "corrupt-archive");
  });

  it("rejects a zip without a manifest", async () => {
    await expectCode(rawZip({ "assets/a.jpg": "x" }), "not-a-fovea");
  });

  it("explains newer format versions", async () => {
    const { manifest } = await sampleAssignment(0);
    const err = await expectCode(rawZip({ "manifest.json": JSON.stringify({ ...manifest, formatVersion: 7 }) }), "unsupported-version");
    expect(err.message).toMatch(/version 7/);
    expect(err.message).toMatch(/supports up to version 1/);
    expect(err.message).toMatch(/Update Fovea/);
  });

  it("rejects video entries with a clear message", async () => {
    const { manifest } = await sampleAssignment(1);
    const m = JSON.parse(JSON.stringify(manifest));
    m.images[0].type = "video";
    const err = await expectCode(rawZip({ "manifest.json": JSON.stringify(m) }), "unsupported-entry-type");
    expect(err.message).toMatch(/video/i);
  });

  it("rejects invalid JSON", async () => {
    await expectCode(rawZip({ "manifest.json": "{not json" }), "invalid-manifest");
  });
});
