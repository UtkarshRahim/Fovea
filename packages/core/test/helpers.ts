import { strToU8, zipSync, type Zippable } from "fflate";
import {
  buildImageEntry,
  createManifest,
  newImageId,
  sha256Hex,
  appendImages,
  type Manifest,
} from "../src";

/** Minimal structurally valid JPEG (not decodable pixels, but correct marker structure). */
export function fakeJpeg(width: number, height: number, sof = 0xc0, entropy = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]): Uint8Array {
  const sofSeg = [0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    ...sofSeg,
    0xff, 0xda, 0x00, 0x0c, 0x03, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0,
    ...entropy,
    0xff, 0xd9,
  ]);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function sampleAssignment(count = 3): Promise<{ manifest: Manifest; assets: Map<string, Uint8Array> }> {
  let manifest = createManifest({ title: "Sal Forest Assignment", platform: "desktop", appVersion: "0.1.0" });
  const assets = new Map<string, Uint8Array>();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const id = newImageId();
    const asset = fakeJpeg(1200 + i, 800);
    const thumb = fakeJpeg(512, 341);
    assets.set(`assets/images/${id}.jpg`, asset);
    assets.set(`assets/thumbnails/${id}.jpg`, thumb);
    entries.push(
      buildImageEntry(
        {
          id,
          originalFilename: `Z9_0${i}.NEF`,
          assetSource: "embedded-preview",
          assetSha256: await sha256Hex(asset),
          thumbnailSha256: await sha256Hex(thumb),
          assetWidth: 1200 + i,
          assetHeight: 800,
          metadata: {
            camera: { make: "NIKON CORPORATION", model: "NIKON Z 9" },
            exposure: { aperture: 5.6, shutterSpeedSeconds: 0.000625, iso: 800, focalLengthMm: 600 },
            gps: { latitude: 23.7, longitude: 81.0 },
          },
        },
        i,
      ),
    );
  }
  manifest = appendImages(manifest, entries);
  return { manifest, assets };
}

export function rawZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const z: Zippable = {};
  for (const [k, v] of Object.entries(files)) z[k] = typeof v === "string" ? strToU8(v) : v;
  return zipSync(z);
}
