import { strFromU8 } from "fflate";
import { LIMITS, unsafePathReason, type ImportWarning, type Limits, type UnpackedFramenote } from "./archive";
import { sha256Hex } from "./checksum";
import { FramenoteError, parseManifest } from "./validate";

/** One file inside a folder the user picked. `path` is relative to the picked folder, using "/" or "\". */
export interface FolderFile {
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$|(^|\/)__MACOSX(\/|$)/i;

const depth = (p: string) => p.split("/").length;
const lower = (p: string) => p.normalize("NFC").toLowerCase();

/**
 * Returns the prefix ("" or "Some Folder/") of the folder that holds manifest.json, choosing the shallowest one so
 * that picking the parent of an unzipped project works too.
 */
export function findProjectRoot(paths: string[]): string | null {
  const manifests = paths.filter((p) => p === "manifest.json" || p.endsWith("/manifest.json")).sort((a, b) => depth(a) - depth(b));
  const first = manifests[0];
  if (!first) return null;
  const tied = manifests.filter((m) => depth(m) === depth(first));
  if (tied.length > 1) {
    throw new FramenoteError(
      "This folder contains more than one project. Choose the folder of the project you want, the one that holds manifest.json.",
      "not-a-framenote",
    );
  }
  return first.slice(0, -"manifest.json".length);
}

/**
 * Imports an unzipped .framenote: a folder with manifest.json and assets/. Unlike a ZIP, a folder may have picked up
 * stray files or lost some, so unreferenced files are ignored and images whose files are missing are dropped, both
 * with a warning.
 */
export async function unpackFolder(input: FolderFile[], limits: Limits = LIMITS): Promise<UnpackedFramenote> {
  const files = input
    .map((f) => ({ ...f, path: f.path.replace(/\\/g, "/").replace(/^\/+/, "") }))
    .filter((f) => f.path && !JUNK.test(f.path));
  const root = findProjectRoot(files.map((f) => f.path));
  if (root === null) {
    throw new FramenoteError(
      "This folder has no manifest.json, so it is not an unzipped Frame Note project. Choose the folder that contains manifest.json and assets/.",
      "not-a-framenote",
    );
  }

  const byPath = new Map<string, FolderFile>();
  for (const f of files) {
    if (!f.path.startsWith(root)) continue;
    const rel = f.path.slice(root.length);
    const reason = unsafePathReason(rel);
    if (reason) throw new FramenoteError(`Rejected unsafe file "${rel}": ${reason}.`, "unsafe-path");
    byPath.set(lower(rel), { ...f, path: rel });
  }
  if (byPath.size > limits.maxEntries) {
    throw new FramenoteError(`The folder has ${byPath.size} files; the limit is ${limits.maxEntries}.`, "limits-exceeded");
  }

  const manifestFile = byPath.get("manifest.json")!;
  if (manifestFile.size > limits.maxManifestBytes) {
    throw new FramenoteError("manifest.json is larger than the 8 MB limit.", "limits-exceeded");
  }
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(await manifestFile.read()));
  } catch {
    throw new FramenoteError("manifest.json is not valid JSON.", "invalid-manifest");
  }
  const parsed = parseManifest(json);

  const warnings: ImportWarning[] = [];
  const kept = [];
  const used = new Set(["manifest.json", "readme.txt"]);
  let total = 0;
  for (const img of parsed.images) {
    const asset = byPath.get(lower(img.asset));
    const thumb = byPath.get(lower(img.thumbnail));
    if (!asset || !thumb) {
      used.add(lower(img.asset)).add(lower(img.thumbnail));
      warnings.push({ imageId: img.id, message: `"${img.originalFilename}" was left out: ${!asset ? img.asset : img.thumbnail} is missing from the folder.` });
      continue;
    }
    for (const f of [asset, thumb]) {
      if (f.size > limits.maxEntryBytes) throw new FramenoteError(`"${f.path}" is larger than the per-file limit.`, "limits-exceeded");
      total += f.size;
      used.add(lower(f.path));
    }
    kept.push({ img, asset, thumb });
  }
  if (total > limits.maxTotalUncompressedBytes) {
    throw new FramenoteError("The project is larger than the import size limit.", "limits-exceeded");
  }
  const ignored = [...byPath.keys()].filter((k) => !used.has(k)).length;
  if (ignored) warnings.push({ message: `${ignored} other ${ignored === 1 ? "file" : "files"} in the folder ${ignored === 1 ? "was" : "were"} ignored.` });

  const assets = new Map<string, Uint8Array>();
  const checksumMismatches: string[] = [];
  for (const { img, asset, thumb } of kept) {
    const [a, t] = await Promise.all([asset.read(), thumb.read()]);
    const [ha, ht] = await Promise.all([sha256Hex(a), sha256Hex(t)]);
    if (ha !== img.checksum.asset || ht !== img.checksum.thumbnail) {
      checksumMismatches.push(img.id);
      warnings.push({ imageId: img.id, message: `"${img.originalFilename}" failed its checksum check and may be damaged.` });
    }
    assets.set(img.asset, a);
    assets.set(img.thumbnail, t);
  }

  const manifest = kept.length === parsed.images.length ? parsed : { ...parsed, images: kept.map((k) => k.img) };
  return { manifest, assets, warnings, checksumMismatches };
}
