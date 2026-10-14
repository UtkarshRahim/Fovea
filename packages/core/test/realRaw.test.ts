import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { largestEmbeddedJpeg } from "../src";

// Point FRAMENOTE_RAW_SAMPLES at a folder of real camera files (see docs/TESTING.md). Skipped otherwise.
const dir = process.env.FRAMENOTE_RAW_SAMPLES;
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => /\.(nef|cr2|cr3|arw)$/i.test(f)) : [];

describe.skipIf(!files.length)("real RAW samples", () => {
  it.each(files)("%s has a full-size embedded preview", (f) => {
    const preview = largestEmbeddedJpeg(new Uint8Array(readFileSync(join(dir!, f))));
    expect(preview).not.toBeNull();
    expect(Math.max(preview!.width, preview!.height)).toBeGreaterThanOrEqual(1600);
  });
});
