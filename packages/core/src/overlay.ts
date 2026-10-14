import type { FieldValue } from "./format";
import type { OverlaySettings } from "./manifest";

export type FontFamily = "mono" | "sans" | "serif";

export interface FontSpec {
  family: FontFamily;
  size: number;
  weight: number;
  italic: boolean;
  /** Letter spacing in px. */
  tracking: number;
}

export const FONT_STACKS: Record<FontFamily, string> = {
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  sans: '"IBM Plex Sans", system-ui, sans-serif',
  serif: '"Newsreader", Georgia, serif',
};

export function cssFont(f: FontSpec): string {
  return `${f.italic ? "italic " : ""}${f.weight} ${f.size}px ${FONT_STACKS[f.family]}`;
}

export type MeasureText = (text: string, font: FontSpec) => number;

export interface TextRun {
  text: string;
  x: number;
  /** Alphabetic baseline. */
  y: number;
  font: FontSpec;
  color: string;
}

export interface OverlayLayout {
  scale: number;
  runs: TextRun[];
  scrim: { top: number; bottom: number; color: string; opacity: number; fadeTo: "top" | "bottom" };
}

export interface OverlayContent {
  title?: string;
  values: FieldValue[];
  caption?: string;
}

export const REFERENCE_LONG_EDGE = 1920;

const THEMES = {
  dark: { text: "#ECE9E3", muted: "#BDB8AE", scrim: "#0B0B0B" },
  light: { text: "#151515", muted: "#45423C", scrim: "#F4F1EA" },
};

/** Overlay metrics are defined for a 1920px long edge and scale with the image; `minScale` keeps small screens legible. */
export function overlayScale(width: number, height: number, minScale = 0): number {
  return Math.max(minScale, Math.max(width, height) / REFERENCE_LONG_EDGE);
}

function wrap(text: string, font: FontSpec, maxWidth: number, measure: MeasureText, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, font) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 1 && measure(`${last}…`, font) > maxWidth) last = last.slice(0, -1).trimEnd();
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

const lineHeight = (f: FontSpec) => f.size * 1.3;
const ascent = (f: FontSpec) => f.size * 0.95;

/**
 * Computes text runs and the scrim for an overlay drawn over an image of `width` × `height`.
 * Used by both the live presentation canvas and exported images, so they match exactly.
 */
export function layoutOverlay(
  width: number,
  height: number,
  settings: OverlaySettings,
  content: OverlayContent,
  measure: MeasureText,
  minScale = 0,
): OverlayLayout {
  const s = overlayScale(width, height, minScale);
  const theme = THEMES[settings.theme];
  const fs = settings.fontSize * s;
  const padX = settings.paddingX * s;
  const padY = settings.paddingY * s;
  const maxWidth = Math.max(1, width - padX * 2);
  const gap = fs * 0.7;

  const titleFont: FontSpec = { family: "sans", size: fs * 0.95, weight: 500, italic: false, tracking: 0 };
  const labelFont: FontSpec = { family: "mono", size: fs * 0.62, weight: 500, italic: false, tracking: fs * 0.62 * 0.12 };
  const valueFont: FontSpec = { family: "mono", size: fs * 1.25, weight: 400, italic: false, tracking: 0 };
  const compactFont: FontSpec = { family: "mono", size: fs * 1.0, weight: 400, italic: false, tracking: 0 };
  const captionFont: FontSpec = { family: "serif", size: fs * 1.1, weight: 400, italic: true, tracking: 0 };

  type Block = { height: number; place: (top: number) => TextRun[] };
  const blocks: Block[] = [];

  if (settings.showTitle && content.title) {
    const lines = wrap(content.title, titleFont, maxWidth, measure, 2);
    blocks.push({
      height: lines.length * lineHeight(titleFont),
      place: (top) =>
        lines.map((text, i) => ({ text, x: padX, y: top + i * lineHeight(titleFont) + ascent(titleFont), font: titleFont, color: theme.text })),
    });
  }

  if (content.values.length && settings.labelledGrid) {
    const colGap = fs * 2.2;
    const minCol = fs * 5.5;
    type Cell = { label: string; value: string; w: number };
    const cells: Cell[] = content.values.map((v) => {
      const label = v.label.toUpperCase();
      const w = Math.max(minCol, measure(label, labelFont) + label.length * labelFont.tracking, measure(v.value, valueFont));
      return { label, value: v.value, w };
    });
    const rows: Cell[][] = [[]];
    let rowW = 0;
    for (const c of cells) {
      const row = rows[rows.length - 1]!;
      const needed = row.length ? rowW + colGap + c.w : c.w;
      if (row.length && needed > maxWidth) {
        rows.push([c]);
        rowW = c.w;
      } else {
        row.push(c);
        rowW = needed;
      }
    }
    const labelH = lineHeight(labelFont);
    const valueH = lineHeight(valueFont);
    const rowH = labelH + valueH * 0.95;
    const rowGap = fs * 0.6;
    blocks.push({
      height: rows.length * rowH + (rows.length - 1) * rowGap,
      place: (top) => {
        const runs: TextRun[] = [];
        rows.forEach((row, r) => {
          let x = padX;
          const rowTop = top + r * (rowH + rowGap);
          for (const c of row) {
            runs.push({ text: c.label, x, y: rowTop + ascent(labelFont), font: labelFont, color: theme.muted });
            runs.push({ text: c.value, x, y: rowTop + labelH + ascent(valueFont) * 0.95, font: valueFont, color: theme.text });
            x += c.w + colGap;
          }
        });
        return runs;
      },
    });
  } else if (content.values.length) {
    const sep = "  ·  ";
    const lines: string[] = [];
    let line = "";
    for (const v of content.values) {
      const candidate = line ? line + sep + v.value : v.value;
      if (line && measure(candidate, compactFont) > maxWidth) {
        lines.push(line);
        line = v.value;
      } else line = candidate;
    }
    if (line) lines.push(line);
    blocks.push({
      height: lines.length * lineHeight(compactFont),
      place: (top) =>
        lines.map((text, i) => ({
          text,
          x: padX,
          y: top + i * lineHeight(compactFont) + ascent(compactFont),
          font: compactFont,
          color: theme.text,
        })),
    });
  }

  if (settings.showCaption && content.caption?.trim()) {
    const lines = wrap(content.caption, captionFont, maxWidth, measure, 3);
    blocks.push({
      height: lines.length * lineHeight(captionFont),
      place: (top) =>
        lines.map((text, i) => ({
          text,
          x: padX,
          y: top + i * lineHeight(captionFont) + ascent(captionFont),
          font: captionFont,
          color: theme.text,
        })),
    });
  }

  const contentH = blocks.reduce((h, b) => h + b.height, 0) + Math.max(0, blocks.length - 1) * gap;
  const runs: TextRun[] = [];
  let y = settings.placement === "bottom" ? height - padY - contentH : padY;
  for (const b of blocks) {
    runs.push(...b.place(y));
    y += b.height + gap;
  }
  const fade = Math.max(fs * 4, contentH * 0.8);
  const scrim =
    settings.placement === "bottom"
      ? { top: Math.max(0, height - padY * 2 - contentH - fade), bottom: height, fadeTo: "top" as const }
      : { top: 0, bottom: Math.min(height, padY * 2 + contentH + fade), fadeTo: "bottom" as const };
  return {
    scale: s,
    runs: blocks.length ? runs : [],
    scrim: { ...scrim, color: theme.scrim, opacity: blocks.length ? settings.backgroundOpacity : 0 },
  };
}

/** "Species · Location" title line built only from what the user typed. */
export function overlayTitle(user: { species?: string; location?: string }): string | undefined {
  const parts = [user.species?.trim(), user.location?.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}
