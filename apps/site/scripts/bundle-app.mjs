// Builds the web app for <site base>app/ and copies it into the site's dist, so one deploy serves both.
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const appDist = resolve(root, "apps/web/dist");
const target = resolve(here, "../dist/app");
const siteBase = process.env.BASE_PATH ?? "/";

execSync("pnpm --filter @fovea/web build", { cwd: root, stdio: "inherit", env: { ...process.env, BASE_PATH: `${siteBase}app/` } });
if (!existsSync(appDist)) throw new Error(`Web app build not found at ${appDist}`);
rmSync(target, { recursive: true, force: true });
cpSync(appDist, target, { recursive: true });
console.log(`Copied the web app into ${target}`);
