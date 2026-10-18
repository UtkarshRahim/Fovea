import "@fontsource/libre-franklin/400.css";
import "@fontsource/libre-franklin/500.css";
import "@fontsource/libre-franklin/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";

const REPO = "UtkarshRahim/Fovea";
const APP_URL = import.meta.env.VITE_APP_URL ?? (import.meta.env.DEV ? "https://fovea-483.pages.dev/app/" : `${import.meta.env.BASE_URL}app/`);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

/* Links to the web app */
for (const a of $$<HTMLAnchorElement>("[data-app-link]")) a.href = APP_URL;

/* Platform: highlight the matching download row and label the main button */
type OS = "mac" | "windows" | "mobile" | "other";
function detectOS(): OS {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "mobile";
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  return "other";
}
const os = detectOS();
$(`.dl-row[data-os="${os}"]`)?.classList.add("is-mine");
const osLabel = $("[data-os-label]");
const osCta = $<HTMLAnchorElement>("[data-os-cta]");
if (osLabel && osCta) {
  if (os === "mac") osLabel.textContent = "Download for Mac";
  else if (os === "windows") osLabel.textContent = "Download for Windows";
  else if (os === "mobile") {
    osLabel.textContent = "Open the web app";
    osCta.href = APP_URL;
  }
}

/* Download links from the latest GitHub release, matched by file suffix so renames don't break them */
const assetPatterns: Record<string, RegExp> = {
  macArm: /_aarch64\.dmg$/,
  macIntel: /_x64\.dmg$/,
  win64: /_x64-setup\.exe$/,
  win32: /_x86-setup\.exe$/,
};
type Release = { tag_name: string; published_at: string; assets: { name: string; browser_download_url: string; size: number }[] };
fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
  .then((r) => (r.ok ? (r.json() as Promise<Release>) : Promise.reject(r.status)))
  .then((rel) => {
    for (const a of $$<HTMLAnchorElement>("[data-asset]")) {
      const asset = rel.assets.find((x) => assetPatterns[a.dataset.asset!]?.test(x.name));
      if (!asset) continue;
      a.href = asset.browser_download_url;
      a.title = `${asset.name} · ${Math.round(asset.size / 1024 / 1024)} MB`;
    }
    const label = $("[data-release]");
    if (label) {
      const date = new Date(rel.published_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      label.textContent = `Version ${rel.tag_name.replace(/^v/, "")}, released ${date}.`;
    }
  })
  .catch(() => {});

/* Copy the Terminal command */
for (const btn of $$<HTMLButtonElement>("[data-copy]")) {
  btn.addEventListener("click", async () => {
    const text = $("[data-cmd]", btn.parentElement!)?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select it";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  });
}

/* Hero: one autofocus point finds the tiger's eyes and locks, once the photograph is on screen. */
const frame = $("[data-frame]");
const af = $("[data-af]");
if (frame && af) {
  const img = $<HTMLImageElement>("img", frame)!;
  const lock = () => {
    af.classList.remove("is-hunting");
    af.classList.add("is-locked");
  };
  const start = () => {
    if (reducedMotion) return lock();
    af.classList.add("is-hunting");
    af.addEventListener("animationend", lock, { once: true });
  };
  const ready = img.complete ? Promise.resolve() : new Promise((r) => img.addEventListener("load", r, { once: true }));
  const seen = new Promise<void>((r) => {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.intersectionRatio >= 0.5)) {
        io.disconnect();
        r();
      }
    }, { threshold: 0.5 });
    io.observe(frame);
  });
  void Promise.all([ready, seen]).then(() => setTimeout(start, 400));
}
