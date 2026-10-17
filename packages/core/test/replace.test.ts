import { describe, expect, it } from "vitest";
import { addComment, packFovea, replaceImage, sortedImages, unpackFovea, updateUserNotes } from "../src";
import { sampleAssignment } from "./helpers";

describe("replaceImage", () => {
  it("swaps the image and camera data but keeps notes, comments and order", async () => {
    let { manifest, assets } = await sampleAssignment(3);
    const target = sortedImages(manifest)[1]!;
    manifest = updateUserNotes(manifest, target.id, { caption: "Reviewed caption", species: "Bengal tiger" });
    manifest = addComment(manifest, target.id, "Crop the bottom a little", "Ratish");

    const fresh = await sampleAssignment(1);
    const replacement = { ...fresh.manifest.images[0]!, originalFilename: "DSC_0412-Edit.jpg", assetSource: "original-jpeg" as const };
    delete replacement.gps;
    const out = replaceImage(manifest, target.id, replacement, new Date("2026-10-15T08:00:00Z"));

    const img = out.images.find((i) => i.id === target.id)!;
    expect(img.order).toBe(1);
    expect(img.user).toMatchObject({ caption: "Reviewed caption", species: "Bengal tiger" });
    expect(img.comments.map((c) => c.text)).toEqual(["Crop the bottom a little"]);
    expect(img.originalFilename).toBe("DSC_0412-Edit.jpg");
    expect(img.asset).toBe(replacement.asset);
    expect(img.checksum).toEqual(replacement.checksum);
    expect(img.gps).toBeUndefined();
    expect(out.modifiedAt).toBe("2026-10-15T08:00:00.000Z");
    expect(out.images.filter((i) => i.id !== target.id)).toEqual(manifest.images.filter((i) => i.id !== target.id));

    const allAssets = new Map([...assets, ...fresh.assets]);
    const back = await unpackFovea(await packFovea(out, async (p) => allAssets.get(p)!));
    expect(back.warnings).toEqual([]);
    expect(back.manifest.images.find((i) => i.id === target.id)!.asset).toBe(replacement.asset);
  });
});
