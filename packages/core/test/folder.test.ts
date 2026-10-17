import { describe, expect, it } from "vitest";
import { strToU8, unzipSync } from "fflate";
import { FoveaError, findProjectRoot, packFovea, sortedImages, unpackFolder, updateUserNotes, type FolderFile } from "../src";
import { sampleAssignment } from "./helpers";

async function unzippedFolder(prefix = "", count = 3) {
  let { manifest, assets } = await sampleAssignment(count);
  const first = sortedImages(manifest)[0]!;
  manifest = updateUserNotes(manifest, first.id, { caption: "Dawn at the waterhole." });
  const zip = await packFovea(manifest, async (p) => assets.get(p)!);
  const files = Object.entries(unzipSync(zip)).map(([path, data]) => toFile(prefix + path, data));
  return { manifest, files };
}

function toFile(path: string, data: Uint8Array): FolderFile {
  return { path, size: data.length, read: async () => data };
}

describe("unpackFolder", () => {
  it("imports an unzipped .fovea folder with captions and order intact", async () => {
    const { manifest, files } = await unzippedFolder("Sal Forest/");
    const out = await unpackFolder(files);
    expect(out.warnings).toEqual([]);
    expect(sortedImages(out.manifest).map((i) => i.id)).toEqual(sortedImages(manifest).map((i) => i.id));
    expect(sortedImages(out.manifest)[0]!.user.caption).toBe("Dawn at the waterhole.");
    expect(out.assets.size).toBe(6);
  });

  it("accepts Windows separators and ignores Finder and Explorer junk", async () => {
    const { files } = await unzippedFolder("Trip\\");
    const winFiles = files.map((f) => ({ ...f, path: f.path.replace(/\//g, "\\") }));
    winFiles.push(toFile("Trip\\.DS_Store", strToU8("x")), toFile("Trip\\Thumbs.db", strToU8("x")), toFile("__MACOSX/Trip/._manifest.json", strToU8("x")));
    const out = await unpackFolder(winFiles);
    expect(out.warnings).toEqual([]);
    expect(out.manifest.images).toHaveLength(3);
  });

  it("drops images whose files are missing and warns about extra files", async () => {
    const { manifest, files } = await unzippedFolder();
    const victim = sortedImages(manifest)[1]!;
    const trimmed = files.filter((f) => f.path !== victim.asset);
    trimmed.push(toFile("assets/images/holiday.jpg", strToU8("not ours")));
    const out = await unpackFolder(trimmed);
    expect(out.manifest.images.map((i) => i.id)).not.toContain(victim.id);
    expect(out.manifest.images).toHaveLength(2);
    expect(out.warnings.map((w) => w.message).join(" ")).toMatch(/left out/);
    expect(out.warnings.map((w) => w.message).join(" ")).toMatch(/1 other file in the folder was ignored/);
  });

  it("flags damaged images by checksum", async () => {
    const { manifest, files } = await unzippedFolder();
    const victim = sortedImages(manifest)[0]!;
    const tampered = files.map((f) => (f.path === victim.asset ? toFile(f.path, strToU8("tampered")) : f));
    const out = await unpackFolder(tampered);
    expect(out.checksumMismatches).toEqual([victim.id]);
  });

  it("rejects folders without a manifest and folders with several projects", async () => {
    await expect(unpackFolder([toFile("photo.jpg", strToU8("x"))])).rejects.toBeInstanceOf(FoveaError);
    expect(() => findProjectRoot(["a/manifest.json", "b/manifest.json"])).toThrow(/more than one project/);
    expect(findProjectRoot(["a/manifest.json", "a/old/manifest.json"])).toBe("a/");
  });

  it("explains when the assets folder was picked instead of the project folder", async () => {
    const { files } = await unzippedFolder("Trip/");
    const inner = files.filter((f) => f.path.startsWith("Trip/assets/images/")).map((f) => ({ ...f, path: f.path.slice("Trip/assets/".length) }));
    await expect(unpackFolder(inner)).rejects.toThrow(/assets folder inside a project/);
  });

  it("rejects unsafe paths", async () => {
    const { files } = await unzippedFolder();
    files.push(toFile("assets/../../etc/passwd", strToU8("x")));
    await expect(unpackFolder(files)).rejects.toThrow(/unsafe/);
  });
});
