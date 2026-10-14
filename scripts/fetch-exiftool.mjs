#!/usr/bin/env node
// Downloads ExifTool into apps/desktop/src-tauri/resources/exiftool so it is bundled with the app.
//   macOS:   Image-ExifTool Perl distribution (runs with the system /usr/bin/perl)
//   Windows: official standalone 64-bit build (exiftool.exe + exiftool_files, Perl included)
// Usage: node scripts/fetch-exiftool.mjs [--platform=darwin|win32] [--version=13.xx]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const platform = args.platform ?? process.platform;
const root = resolve(import.meta.dirname, "..");
const dest = join(root, "apps/desktop/src-tauri/resources/exiftool");

async function get(url, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
}

const version = args.version ?? (await get("https://exiftool.org/ver.txt")).toString("utf8").trim();
if (!/^\d+\.\d+$/.test(version)) throw new Error(`Unexpected ExifTool version string: ${version}`);
const checksums = (await get(`https://exiftool.org/checksums-${version}.txt`)).toString("utf8");

/** Downloads a release file (exiftool.org links to SourceForge) and verifies it against the published SHA256. */
async function download(name) {
  const expected = new RegExp(`SHA2?-?256\\(${name.replace(/[.]/g, "\\.")}\\)\\s*=\\s*([0-9a-f]{64})`, "i").exec(checksums)?.[1];
  if (!expected) throw new Error(`No published SHA256 for ${name}`);
  let data;
  try {
    data = await get(`https://sourceforge.net/projects/exiftool/files/${name}/download`);
  } catch {
    data = await get(`https://exiftool.org/${name}`);
  }
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
  return data;
}

const makeWritable = (p) => {
  if (process.platform !== "win32" && existsSync(p)) execFileSync("chmod", ["-R", "u+w", p]);
};
const work = mkdtempSync(join(tmpdir(), "exiftool-"));
makeWritable(dest);
for (const entry of existsSync(dest) ? readdirSync(dest) : []) {
  if (entry !== "README.md") rmSync(join(dest, entry), { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });

if (platform === "win32") {
  const name = `exiftool-${version}_64.zip`;
  const zip = join(work, name);
  writeFileSync(zip, await download(name));
  try {
    execFileSync("tar", ["-xf", zip, "-C", work], { stdio: "ignore" });
  } catch {
    execFileSync("unzip", ["-q", zip, "-d", work]);
  }
  const folder = readdirSync(work).find((d) => d.startsWith("exiftool-") && !d.endsWith(".zip"));
  if (!folder) throw new Error("Unexpected archive layout");
  const src = join(work, folder);
  const exe = readdirSync(src).find((f) => f.toLowerCase().startsWith("exiftool") && f.toLowerCase().endsWith(".exe"));
  if (!exe) throw new Error("exiftool executable not found in archive");
  renameSync(join(src, exe), join(dest, "exiftool.exe"));
  cpSync(join(src, "exiftool_files"), join(dest, "exiftool_files"), { recursive: true });
} else {
  const name = `Image-ExifTool-${version}.tar.gz`;
  const tgz = join(work, name);
  writeFileSync(tgz, await download(name));
  execFileSync("tar", ["-xzf", tgz, "-C", work]);
  const src = join(work, `Image-ExifTool-${version}`);
  cpSync(join(src, "exiftool"), join(dest, "exiftool"));
  cpSync(join(src, "lib"), join(dest, "lib"), { recursive: true });
  cpSync(join(src, "README"), join(dest, "EXIFTOOL-README"));
}
writeFileSync(join(dest, "VERSION"), `${version}\n`);
makeWritable(dest);
makeWritable(work);
rmSync(work, { recursive: true, force: true });
console.log(`ExifTool ${version} (${platform}) → ${dest}`);
