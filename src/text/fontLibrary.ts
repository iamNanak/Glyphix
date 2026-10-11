import { coverageToSDF } from './sdf';

// Bundled OFL fonts. Files live in /public/fonts with their licenses.
export const BUNDLED_FONTS: Record<string, { family: string; url: string }> = {
  inter: { family: 'Inter', url: '/fonts/Inter.ttf' },
};

/** Atlas resolution: pixels per em, and SDF spread in px (also the glyph cell padding). */
export const ATLAS_EM_PX = 64;
export const ATLAS_SPREAD_PX = 12;
const ATLAS_SIZE = 2048;

export interface AtlasGlyph {
  /** Atlas texel rect. */
  ax: number;
  ay: number;
  aw: number;
  ah: number;
  /** Quad rect relative to the pen origin, in em, font y-up (left, bottom, right, top). */
  l: number;
  b: number;
  r: number;
  t: number;
}

export interface LaidOutGlyph {
  /** Pen origin in em, y-up, relative to the text block centre. */
  x: number;
  y: number;
  glyph: AtlasGlyph | null; // null = whitespace / empty outline
}

export interface TextLayout {
  glyphs: LaidOutGlyph[];
  /** Block size in em. */
  width: number;
  height: number;
}

interface LoadedFont {
  font: import('harfbuzzjs').Font;
  upem: number;
  ascender: number;
  descender: number;
  lineGap: number;
  glyphs: Map<number, AtlasGlyph | null>;
}

type HB = typeof import('harfbuzzjs');

/**
 * Owns shaping (HarfBuzz) and the shared SDF glyph atlas (CPU side).
 * Renderers upload `atlas` when `atlasVersion` changes. Reconstructible at any time (context loss).
 */
export class FontLibrary {
  readonly atlas = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE);
  readonly atlasSize = ATLAS_SIZE;
  atlasVersion = 0;

  private hb: Promise<HB> | null = null;
  private hbModule: HB | null = null;
  private fonts = new Map<string, LoadedFont>();
  private loading = new Map<string, Promise<void>>();
  private layoutCache = new Map<string, TextLayout>();
  private listeners = new Set<() => void>();
  private shelfX = 0;
  private shelfY = 0;
  private shelfH = 0;
  private raster: OffscreenCanvasRenderingContext2D | null = null;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  isLoaded(fontId: string): boolean {
    return this.fonts.has(fontId);
  }

  load(fontId: string): Promise<void> {
    const existing = this.loading.get(fontId);
    if (existing) return existing;
    const spec = BUNDLED_FONTS[fontId];
    if (!spec) return Promise.reject(new Error(`Unknown font: ${fontId}`));
    const p = (async () => {
      this.hb ??= import('harfbuzzjs');
      const [hb, data] = await Promise.all([this.hb, fetch(spec.url).then((r) => r.arrayBuffer())]);
      const face = new hb.Face(new hb.Blob(data));
      const font = new hb.Font(face);
      const ext = font.hExtents();
      this.fonts.set(fontId, {
        font,
        upem: face.upem,
        ascender: ext.ascender,
        descender: ext.descender,
        lineGap: ext.lineGap,
        glyphs: new Map(),
      });
      this.hbModule = hb;
      this.listeners.forEach((l) => l());
    })();
    this.loading.set(fontId, p);
    return p;
  }

  /** Synchronous layout. Returns null (and starts loading) if the font isn't ready yet. */
  layout(fontId: string, text: string, tracking: number, align: 'left' | 'center' | 'right', lineHeight = 1.15): TextLayout | null {
    const key = `${fontId}\u0000${tracking}\u0000${align}\u0000${lineHeight}\u0000${text}`;
    const cached = this.layoutCache.get(key);
    if (cached) return cached;
    const f = this.fonts.get(fontId);
    if (!f || !this.hbModule) {
      void this.load(fontId);
      return null;
    }
    const hb = this.hbModule;
    const lines = text.split('\n');
    const shaped: { glyphs: LaidOutGlyph[]; width: number }[] = [];
    for (const line of lines) {
      const buf = new hb.Buffer();
      buf.addText(line);
      buf.guessSegmentProperties();
      hb.shape(f.font, buf);
      const infos = buf.getGlyphInfos();
      const pos = buf.getGlyphPositions();
      const glyphs: LaidOutGlyph[] = [];
      let pen = 0;
      for (let i = 0; i < infos.length; i++) {
        const gid = infos[i]!.codepoint;
        const p = pos[i]!;
        glyphs.push({ x: (pen + p.xOffset) / f.upem, y: p.yOffset / f.upem, glyph: this.glyph(f, gid) });
        pen += p.xAdvance + tracking * f.upem;
      }
      const width = Math.max(0, pen - (infos.length ? tracking * f.upem : 0)) / f.upem;
      shaped.push({ glyphs, width });
    }
    const asc = f.ascender / f.upem;
    const desc = -f.descender / f.upem;
    const lh = lineHeight * (asc + desc);
    const blockW = Math.max(0, ...shaped.map((l) => l.width));
    const blockH = asc + desc + lh * (lines.length - 1);
    const out: LaidOutGlyph[] = [];
    shaped.forEach((line, li) => {
      const dx = align === 'left' ? -blockW / 2 : align === 'right' ? blockW / 2 - line.width : -line.width / 2;
      const baseline = blockH / 2 - asc - li * lh;
      for (const g of line.glyphs) out.push({ x: g.x + dx, y: g.y + baseline, glyph: g.glyph });
    });
    const result: TextLayout = { glyphs: out, width: blockW, height: blockH };
    this.layoutCache.set(key, result);
    return result;
  }

  private glyph(f: LoadedFont, gid: number): AtlasGlyph | null {
    if (f.glyphs.has(gid)) return f.glyphs.get(gid)!;
    const ext = f.font.glyphExtents(gid);
    const path = f.font.glyphToPath(gid);
    if (!ext || !path || ext.width === 0) {
      f.glyphs.set(gid, null);
      return null;
    }
    const s = ATLAS_EM_PX / f.upem;
    const pad = ATLAS_SPREAD_PX;
    // Glyph bbox in font units (y-up): x ∈ [xBearing, xBearing+width], y ∈ [yBearing+height, yBearing].
    const x0 = ext.xBearing;
    const y1 = ext.yBearing;
    const w = Math.ceil(ext.width * s) + 2 * pad;
    const h = Math.ceil(-ext.height * s) + 2 * pad;
    const slot = this.allocate(w, h);
    if (!slot) {
      f.glyphs.set(gid, null);
      return null;
    }

    const ctx = this.rasterCtx(w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // font units → cell px, flipping y.
    ctx.setTransform(s, 0, 0, -s, pad - x0 * s, pad + y1 * s);
    ctx.fillStyle = '#fff';
    ctx.fill(new Path2D(path));
    const img = ctx.getImageData(0, 0, w, h).data;
    const sdf = coverageToSDF(img.subarray(3), w, h, ATLAS_SPREAD_PX, 4);
    for (let row = 0; row < h; row++) {
      this.atlas.set(sdf.subarray(row * w, row * w + w), (slot.y + row) * ATLAS_SIZE + slot.x);
    }
    this.atlasVersion++;

    const g: AtlasGlyph = {
      ax: slot.x,
      ay: slot.y,
      aw: w,
      ah: h,
      l: x0 / f.upem - pad / ATLAS_EM_PX,
      t: y1 / f.upem + pad / ATLAS_EM_PX,
      r: x0 / f.upem - pad / ATLAS_EM_PX + w / ATLAS_EM_PX,
      b: y1 / f.upem + pad / ATLAS_EM_PX - h / ATLAS_EM_PX,
    };
    f.glyphs.set(gid, g);
    return g;
  }

  private rasterCtx(w: number, h: number): OffscreenCanvasRenderingContext2D {
    if (!this.raster || this.raster.canvas.width < w || this.raster.canvas.height < h) {
      const c = new OffscreenCanvas(Math.max(w, 256), Math.max(h, 256));
      this.raster = c.getContext('2d', { willReadFrequently: true })!;
    }
    return this.raster;
  }

  /** Shelf packer. */
  private allocate(w: number, h: number): { x: number; y: number } | null {
    if (this.shelfX + w > ATLAS_SIZE) {
      this.shelfX = 0;
      this.shelfY += this.shelfH + 1;
      this.shelfH = 0;
    }
    if (this.shelfY + h > ATLAS_SIZE) {
      console.warn('[glyphix] glyph atlas full');
      return null;
    }
    const slot = { x: this.shelfX, y: this.shelfY };
    this.shelfX += w + 1;
    this.shelfH = Math.max(this.shelfH, h);
    return slot;
  }
}

export const fontLibrary = new FontLibrary();
