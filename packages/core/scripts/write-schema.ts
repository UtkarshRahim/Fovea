import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ManifestSchema } from "../src/manifest";

const out = fileURLToPath(new URL("../../../docs/framenote.schema.json", import.meta.url));
const schema = z.toJSONSchema(ManifestSchema, { io: "input", target: "draft-2020-12" });
writeFileSync(out, `${JSON.stringify({ $id: "https://framenote.app/schema/v1.json", title: "Frame Note manifest v1", ...schema }, null, 2)}\n`);
console.log(`wrote ${out}`);
