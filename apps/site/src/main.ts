import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";

const REPO = "UtkarshRahim/Fovea";
const APP_URL = import.meta.env.VITE_APP_URL ?? (import.meta.env.DEV ? "https://utkarshrahim.github.io/Fovea/" : "/app/");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/* Links to the web app */
for (const a of $$<HTMLAnchorElement>("[data-app-link]")) a.href = APP_URL;

/* Nav border once the page scrolls */
const nav = $(".nav");
const onScroll = () => nav?.classList.toggle("is-scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

/* Platform: highlight the matching download card and label the hero button */
type OS = "mac" | "windows" | "mobile" | "other";
function detectOS(): OS {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "mobile";
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  return "other";
}
const os = detectOS();
$(`.dl-card[data-os="${os}"]`)?.classList.add("is-mine");
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
type Release = { tag_name: string; name: string; published_at: string; assets: { name: string; browser_download_url: string; size: number }[] };
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
      label.textContent = `Latest release ${rel.tag_name} · ${date}`;
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

/* Hero: the headline types itself while an autofocus point hunts for each word and locks on. */
const stage = $("[data-stage]");
const headline = $("[data-headline]");
const box = $("[data-focus-box]");
const grid = $("[data-af-grid]");

const exposures = [
  { lens: "35mm", aperture: "f/2", shutter: "1/500", iso: "ISO 200" },
  { lens: "85mm", aperture: "f/1.8", shutter: "1/1000", iso: "ISO 100" },
  { lens: "24mm", aperture: "f/8", shutter: "1/250", iso: "ISO 100" },
  { lens: "50mm", aperture: "f/1.4", shutter: "1/60", iso: "ISO 1600" },
  { lens: "135mm", aperture: "f/2.8", shutter: "1/2000", iso: "ISO 400" },
  { lens: "400mm", aperture: "f/5.6", shutter: "1/3200", iso: "ISO 1250" },
];

type Word = { el: HTMLElement; chars: HTMLElement[] };
type Exposure = (typeof exposures)[number];

function splitHeadline(h: HTMLElement) {
  h.setAttribute("aria-label", h.textContent!.replace(/\s+/g, " ").trim());
  const words: Word[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent!.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.append(" ");
            continue;
          }
          const el = document.createElement("span");
          el.className = "word";
          const chars = Array.from(part, (c) => {
            const ch = document.createElement("span");
            ch.className = "ch";
            ch.textContent = c;
            return ch;
          });
          el.append(...chars);
          words.push({ el, chars });
          frag.append(el);
        }
        child.replaceWith(frag);
      } else walk(child);
    }
  };
  walk(h);
  for (const el of Array.from(h.children)) el.setAttribute("aria-hidden", "true");
  return words;
}

function buildGrid() {
  if (!grid || !stage) return [] as HTMLElement[];
  grid.replaceChildren();
  const { width, height } = stage.getBoundingClientRect();
  const cols = Math.max(5, Math.round(width / 92));
  const rows = Math.max(5, Math.round(height / 84));
  const points: HTMLElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = document.createElement("i");
      p.className = "af-point";
      p.style.left = `${8 + (84 * c) / (cols - 1)}%`;
      p.style.top = `${10 + (80 * r) / (rows - 1)}%`;
      grid.append(p);
      points.push(p);
    }
  }
  return points;
}

type Rect = { x: number; y: number; w: number; h: number };

function heroAnimation() {
  if (!stage || !headline || !box) return;
  const words = splitHeadline(headline);
  const lastWord = words.at(-1);
  if (!lastWord) return;
  let points = buildGrid();
  let target: { word: Word; upTo: number } | null = null;
  const reveals = $$(".lede, .cta", stage);

  const rectFor = (word: Word, upTo: number): Rect => {
    const s = stage.getBoundingClientRect();
    const first = word.chars[0]!.getBoundingClientRect();
    const last = word.chars[Math.max(0, Math.min(upTo, word.chars.length - 1))]!.getBoundingClientRect();
    const padX = Math.max(10, first.height * 0.12);
    const padY = Math.max(6, first.height * 0.04);
    return { x: first.left - s.left - padX, y: first.top - s.top - padY, w: last.right - first.left + padX * 2, h: first.height + padY * 2 };
  };
  const place = (r: Rect) => {
    box.style.transform = `translate(${r.x}px, ${r.y}px)`;
    box.style.width = `${r.w}px`;
    box.style.height = `${r.h}px`;
  };
  const track = () => target && place(rectFor(target.word, target.upTo));

  const lightPoints = (r: Rect) => {
    const s = stage.getBoundingClientRect();
    for (const p of points) {
      const pr = p.getBoundingClientRect();
      const px = pr.left + pr.width / 2 - s.left;
      const py = pr.top + pr.height / 2 - s.top;
      const inside = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
      const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
      const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
      p.classList.toggle("is-on", inside);
      p.classList.toggle("is-near", !inside && Math.hypot(dx, dy) < 110);
    }
  };

  let exposure: Exposure = exposures[0]!;
  const dot = $("[data-hud-dot]");
  const updateHud = () => {
    const others = exposures.filter((e) => e !== exposure);
    exposure = others[Math.floor(Math.random() * others.length)] ?? exposure;
    for (const [key, value] of Object.entries(exposure)) {
      const el = $(`[data-hud="${key}"]`);
      if (!el || el.textContent === value) continue;
      el.classList.add("is-changing");
      setTimeout(() => {
        el.textContent = value;
        el.classList.remove("is-changing");
      }, 140);
    }
    dot?.classList.add("is-on");
    setTimeout(() => dot?.classList.remove("is-on"), 700);
  };

  const hunt = async (word: Word, upTo: number) => {
    target = { word, upTo };
    box.classList.remove("is-locked");
    box.classList.add("is-visible", "is-hunting");
    const r = rectFor(word, upTo);
    place({ x: r.x + rand(-24, 24), y: r.y + rand(-14, 14), w: r.w * 1.18, h: r.h * 1.18 });
    await sleep(240);
    place(r);
    await sleep(300);
  };
  const lock = (word: Word) => {
    box.classList.remove("is-hunting", "is-locked");
    void box.offsetWidth;
    box.classList.add("is-locked");
    lightPoints(rectFor(word, word.chars.length - 1));
    updateHud();
  };
  const setFocus = (focused: Word | null, soft: string) => {
    headline.style.setProperty("--soft", soft);
    for (const w of words) w.el.classList.toggle("is-soft", focused !== null && w !== focused);
  };

  new ResizeObserver(() => {
    points = buildGrid();
    track();
    if (target) lightPoints(rectFor(target.word, target.upTo));
  }).observe(stage);

  if (reducedMotion) {
    for (const w of words) for (const c of w.chars) c.classList.add("is-typed");
    target = { word: lastWord, upTo: lastWord.chars.length - 1 };
    box.classList.add("is-visible", "is-locked");
    track();
    lightPoints(rectFor(lastWord, target.upTo));
    return;
  }

  for (const el of reveals) el.classList.add("reveal");

  let visible = true;
  new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting))).observe(stage);
  const waitUntilVisible = async () => {
    while (!visible || document.hidden) await sleep(400);
  };

  void (async () => {
    await document.fonts.ready;
    await sleep(350);
    for (const w of words) {
      setFocus(w, "0.6px");
      w.el.classList.add("is-soft");
      w.chars[0]!.classList.add("is-typed");
      await hunt(w, 0);
      for (let c = 1; c < w.chars.length; c++) {
        await sleep(rand(45, 85));
        w.chars[c]!.classList.add("is-typed");
        target = { word: w, upTo: c };
        track();
      }
      w.el.classList.remove("is-soft");
      lock(w);
      await sleep(260);
    }
    setFocus(null, "0px");
    reveals.forEach((el, n) => setTimeout(() => el.classList.add("is-in"), 120 + n * 140));

    /* Idle: rack focus between words now and then, like a photographer checking the frame. */
    let current = lastWord;
    for (;;) {
      await sleep(rand(2600, 4200));
      await waitUntilVisible();
      const others = words.filter((w) => w !== current);
      current = others[Math.floor(Math.random() * others.length)] ?? current;
      setFocus(current, "0.9px");
      await hunt(current, current.chars.length - 1);
      lock(current);
      await sleep(1500);
      setFocus(null, "0px");
    }
  })();
}

heroAnimation();
