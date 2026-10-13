// ASCII effect charsets: glyph atlas (coverage bitmaps with box-filtered mips) and the calibrated
// brightness → glyph LUT. Pure data (no GPU), so it can be unit-tested and is built synchronously.
//
// Glyphs are rasterised from embedded JetBrains Mono outlines with a small scanline rasteriser
// (4×4 supersampling, nonzero winding) in plain JS arithmetic, so every browser and both GPU backends
// get byte-identical atlases. Each glyph's ink coverage is measured from its bitmap; the LUT picks,
// for each brightness, the glyph whose coverage is nearest to brightness × (densest coverage), so
// on-screen ink density follows brightness linearly.
import { ASCII_FONT, ASCII_GLYPHS } from './asciiGlyphs';

/** Charset glyphs by the effect's `charset` param value (labels: ASCII_CHARSETS in doc/effects.ts). */
export const CHARSETS = [' .:-=+*#%@', ' ░▒▓█', " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$", ' 01'] as const;

/** Edge glyphs, appended after every charset; index = edge bin − 1 (vertical, horizontal, rising, falling). */
export const EDGE_CHARS = '|-/\\';

/** Atlas cell size (px) and glyph cells per atlas row. */
export const ASCII_CELL = 64;
export const ASCII_COLS = 16;
export const ASCII_MAX_LOD = Math.log2(ASCII_CELL);
export const LUT_SIZE = 256;
const SS = 4; // supersampling per axis

export interface AsciiAtlas {
  /** Glyphs in atlas order: the charset sorted by coverage, then EDGE_CHARS. */
  chars: string[];
  /** Ink coverage (0..1) per glyph, same order. */
  coverage: number[];
  /** Number of charset glyphs (before the edge glyphs). */
  count: number;
  width: number;
  height: number;
  /** R8 mip chain, level 0 first (box-filtered, so every level keeps each glyph's coverage). */
  mips: { data: Uint8Array; width: number; height: number }[];
  /** Brightness (k / (LUT_SIZE − 1)) → glyph index. */
  lut: Uint8Array;
}

/**
 * Font-unit box mapped onto the square cell: x spans the advance (600) plus a little room, y spans
 * descender-ish to ascender-ish. Text glyphs get a mild horizontal stretch (square cells, 0.6-em glyphs);
 * block elements fill the whole line box so they tile seamlessly.
 */
function cellBox(ch: string) {
  const { advance, ascender, descender } = ASCII_FONT;
  if (/[░▒▓█]/.test(ch)) return { x0: 0, x1: advance, y0: descender, y1: ascender };
  return { x0: -80, x1: advance + 80, y0: -175, y1: 905 };
}

type Edge = [x0: number, y0: number, x1: number, y1: number];

/** Outline (harfbuzz path string, font units y up) → line segments in supersampled cell px (y down). */
function flatten(path: string, ch: string): Edge[] {
  const b = cellBox(ch);
  const r = ASCII_CELL * SS;
  const sx = r / (b.x1 - b.x0);
  const sy = r / (b.y1 - b.y0);
  const X = (x: number) => (x - b.x0) * sx;
  const Y = (y: number) => (b.y1 - y) * sy;
  const edges: Edge[] = [];
  let cx = 0;
  let cy = 0;
  let mx = 0;
  let my = 0;
  const line = (x: number, y: number) => {
    if (y !== cy) edges.push([cx, cy, x, y]); // horizontal edges never cross a scanline
    cx = x;
    cy = y;
  };
  for (const m of path.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const n = (m[2]!.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    switch (m[1]) {
      case 'M':
        if (cx !== mx || cy !== my) line(mx, my);
        cx = mx = X(n[0]!);
        cy = my = Y(n[1]!);
        break;
      case 'L':
        line(X(n[0]!), Y(n[1]!));
        break;
      case 'Q': {
        const [x0, y0, x1, y1, x2, y2] = [cx, cy, X(n[0]!), Y(n[1]!), X(n[2]!), Y(n[3]!)];
        for (let i = 1; i <= 8; i++) {
          const t = i / 8;
          const u = 1 - t;
          line(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
        }
        break;
      }
      case 'C': {
        const [x0, y0, x1, y1, x2, y2, x3, y3] = [cx, cy, X(n[0]!), Y(n[1]!), X(n[2]!), Y(n[3]!), X(n[4]!), Y(n[5]!)];
        for (let i = 1; i <= 12; i++) {
          const t = i / 12;
          const u = 1 - t;
          line(
            u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          );
        }
        break;
      }
      case 'Z':
        line(mx, my);
        break;
    }
  }
  if (cx !== mx || cy !== my) line(mx, my);
  return edges;
}

/** One glyph → ASCII_CELL² coverage (0..255). Scanlines at sample centres, nonzero winding. */
export function rasterizeGlyph(ch: string): Uint8Array {
  const out = new Uint8Array(ASCII_CELL * ASCII_CELL);
  const path = ASCII_GLYPHS[ch];
  if (!path) return out;
  const edges = flatten(path, ch);
  const r = ASCII_CELL * SS;
  const counts = new Uint16Array(ASCII_CELL * ASCII_CELL);
  const xs: { x: number; w: number }[] = [];
  for (let j = 0; j < r; j++) {
    const y = j + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      // Half-open in y so a vertex shared by two edges counts once.
      if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) xs.push({ x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), w: y1 > y0 ? 1 : -1 });
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a.x - b.x);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k]!.w;
      if (wind === 0) continue;
      // Samples whose centre lies in [xs[k], xs[k+1]).
      const i0 = Math.max(0, Math.ceil(xs[k]!.x - 0.5));
      const i1 = Math.min(r - 1, Math.ceil(xs[k + 1]!.x - 0.5) - 1);
      const row = (j / SS) | 0;
      for (let i = i0; i <= i1; i++) counts[row * ASCII_CELL + ((i / SS) | 0)]!++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.round((counts[i]! * 255) / (SS * SS));
  return out;
}

/** 2×2 box filter with rounding (deterministic integer maths). */
function downsample(src: Uint8Array, w: number, h: number) {
  const W = Math.max(1, w >> 1);
  const H = Math.max(1, h >> 1);
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const x0 = Math.min(w - 1, 2 * x);
      const x1 = Math.min(w - 1, 2 * x + 1);
      const y0 = Math.min(h - 1, 2 * y) * w;
      const y1 = Math.min(h - 1, 2 * y + 1) * w;
      data[y * W + x] = (src[y0 + x0]! + src[y0 + x1]! + src[y1 + x0]! + src[y1 + x1]! + 2) >> 2;
    }
  return { data, width: W, height: H };
}

const glyphCache = new Map<string, { bitmap: Uint8Array; coverage: number }>();

function glyph(ch: string) {
  let g = glyphCache.get(ch);
  if (!g) {
    const bitmap = rasterizeGlyph(ch);
    let sum = 0;
    for (const v of bitmap) sum += v;
    g = { bitmap, coverage: sum / (255 * bitmap.length) };
    glyphCache.set(ch, g);
  }
  return g;
}

const atlasCache = new Map<number, AsciiAtlas>();

/** The atlas for one charset (built on first use, then cached). */
export function asciiAtlas(charset: number): AsciiAtlas {
  const id = Math.min(CHARSETS.length - 1, Math.max(0, Math.round(charset)));
  const cached = atlasCache.get(id);
  if (cached) return cached;

  const set = [...new Set(CHARSETS[id]!)].map((ch) => ({ ch, ...glyph(ch) }));
  // Stable sort: equal coverage keeps the charset's order.
  set.sort((a, b) => a.coverage - b.coverage);
  const all = [...set, ...[...EDGE_CHARS].map((ch) => ({ ch, ...glyph(ch) }))];

  const width = ASCII_COLS * ASCII_CELL;
  const height = Math.ceil(all.length / ASCII_COLS) * ASCII_CELL;
  const base = new Uint8Array(width * height);
  all.forEach((g, i) => {
    const ox = (i % ASCII_COLS) * ASCII_CELL;
    const oy = Math.floor(i / ASCII_COLS) * ASCII_CELL;
    for (let y = 0; y < ASCII_CELL; y++) base.set(g.bitmap.subarray(y * ASCII_CELL, (y + 1) * ASCII_CELL), (oy + y) * width + ox);
  });
  const mips = [{ data: base, width, height }];
  while (mips.at(-1)!.width > 1 || mips.at(-1)!.height > 1) {
    const m = mips.at(-1)!;
    mips.push(downsample(m.data, m.width, m.height));
  }

  // Calibrated LUT: brightness b → glyph with coverage nearest b × densest coverage.
  const maxCov = set.at(-1)!.coverage || 1;
  const lut = new Uint8Array(LUT_SIZE);
  for (let k = 0; k < LUT_SIZE; k++) {
    const target = (k / (LUT_SIZE - 1)) * maxCov;
    let best = 0;
    for (let i = 1; i < set.length; i++) if (Math.abs(set[i]!.coverage - target) < Math.abs(set[best]!.coverage - target)) best = i;
    lut[k] = best;
  }

  const atlas: AsciiAtlas = {
    chars: all.map((g) => g.ch),
    coverage: all.map((g) => g.coverage),
    count: set.length,
    width,
    height,
    mips,
    lut,
  };
  atlasCache.set(id, atlas);
  return atlas;
}
