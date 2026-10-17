// Offscreen compositing for layers with effects and for adjustment layers.
//
// All targets are drawing-buffer sized (screen space), so cost follows the screen, not layer size.
// Contents are premultiplied linear colour. The accumulation target and layer targets use MSAA
// so geometry edges look the same as when drawing straight to the canvas.
import * as THREE from 'three/webgpu';
import type { Color, ResolvedEffect } from '@/doc';
import { createFxMaterials, fxFrame, type FxMaterials } from './fxMaterials';
import { ASCII_CUSTOM_CHARSET } from '@/doc';
import { ASCII_CELL, ASCII_COLS, ASCII_MAX_LOD, asciiAtlas, CHARSETS, LUT_SIZE, type AsciiAtlas } from './asciiAtlas';
import { asciiFont } from './asciiFonts';

const DEG = Math.PI / 180;
const tmpColor = new THREE.Color();

function setLinear(target: THREE.Vector4, c: Color) {
  tmpColor.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  target.set(tmpColor.r, tmpColor.g, tmpColor.b, c[3]);
}

/** Render targets reused across frames, keyed by size and sample count. */
class TargetPool {
  private free = new Map<string, THREE.RenderTarget[]>();
  private keys = new WeakMap<THREE.RenderTarget, string>();
  private lastUsed = new Map<THREE.RenderTarget, number>();
  private frame = 0;
  /** Targets handed out this frame and not yet released (a leak would show up here). */
  live = 0;

  acquire(w: number, h: number, msaa: boolean): THREE.RenderTarget {
    const key = `${w}x${h}x${msaa ? 4 : 0}`;
    const list = this.free.get(key);
    let rt = list?.pop();
    if (!rt) {
      rt = new THREE.RenderTarget(w, h, {
        type: THREE.HalfFloatType,
        samples: msaa ? 4 : 0,
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });
      this.keys.set(rt, key);
    }
    this.live++;
    return rt;
  }

  release(rt: THREE.RenderTarget) {
    const key = this.keys.get(rt)!;
    let list = this.free.get(key);
    if (!list) this.free.set(key, (list = []));
    list.push(rt);
    this.lastUsed.set(rt, this.frame);
    this.live--;
  }

  /** Dispose targets nobody used for a while (e.g. after a resize). */
  endFrame(maxIdle = 120) {
    this.frame++;
    for (const [key, list] of this.free) {
      const keep = list.filter((rt) => {
        if (this.frame - (this.lastUsed.get(rt) ?? 0) <= maxIdle) return true;
        rt.dispose();
        this.lastUsed.delete(rt);
        return false;
      });
      if (keep.length) this.free.set(key, keep);
      else this.free.delete(key);
    }
  }

  dispose() {
    this.free.forEach((l) => l.forEach((rt) => rt.dispose()));
    this.free.clear();
    this.lastUsed.clear();
  }
}

export interface CompositeFrame {
  /** Drawing buffer size. */
  width: number;
  height: number;
  pxPerUnit: number;
  /** Buffer px of comp (0,0), y down. */
  originX: number;
  originY: number;
  compWidth: number;
  compHeight: number;
  t: number;
}

/** One step of the frame: a run of plain layers, a layer with effects, or an adjustment layer. */
export type CompositeStep =
  | { kind: 'draw'; nodes: number[] }
  | { kind: 'layer'; node: number; effects: ResolvedEffect[] }
  | { kind: 'adjust'; effects: ResolvedEffect[]; opacity: number };

/** One ASCII effect's cell grid as drawn: two texels per cell (ink colour + alpha, glyph index). */
export interface AsciiCapture {
  target: THREE.RenderTarget;
  cols: number;
  rows: number;
  /** Cell size, comp px. */
  cellWidth: number;
  cellHeight: number;
  /** Glyphs by atlas index. */
  chars: string[];
}

export class Compositor {
  private quad = new THREE.QuadMesh(new THREE.NodeMaterial());
  private m: FxMaterials = createFxMaterials();
  private pool = new TargetPool();
  private f!: CompositeFrame;
  /** ASCII atlas + LUT textures per atlas (CPU data is shared; textures are per renderer), with the frame last used. */
  private asciiTex = new Map<AsciiAtlas, { atlas: THREE.DataTexture; lut: THREE.DataTexture; used: number }>();
  private frameNo = 0;
  /** Effect id whose ASCII cell grid the next frame keeps for reading back (text export). */
  captureId: string | null = null;
  /** The kept cell grid; release with releaseCapture(). */
  captured: AsciiCapture | null = null;

  constructor(private readonly renderer: THREE.WebGPURenderer) {}

  /**
   * Run the steps and return the finished (premultiplied) accumulation target.
   * `draw(nodes)` renders the scene with only those layer nodes visible into the current target.
   * The caller presents it with `present()` and must then call `endFrame()`.
   */
  run(frame: CompositeFrame, steps: CompositeStep[], draw: (nodes: number[]) => void): THREE.RenderTarget {
    this.f = frame;
    fxFrame.res.value.set(frame.width, frame.height);
    fxFrame.origin.value.set(frame.originX, frame.originY);
    fxFrame.pxPerUnit.value = frame.pxPerUnit;
    fxFrame.compSize.value.set(frame.compWidth, frame.compHeight);
    fxFrame.t.value = frame.t;

    const r = this.renderer;
    const autoClear = r.autoClear;
    r.autoClear = false;
    let accum = this.target(true);
    this.clear(accum);
    for (const step of steps) {
      if (step.kind === 'draw') {
        r.setRenderTarget(accum);
        draw(step.nodes);
      } else if (step.kind === 'layer') {
        const layer = this.target(true);
        this.clear(layer);
        r.setRenderTarget(layer);
        draw([step.node]);
        const out = this.applyEffects(step.effects, layer);
        this.m.over.src.value = out.texture;
        this.pass(this.m.over.mat, accum);
        if (out !== layer) this.pool.release(out);
        this.pool.release(layer);
      } else {
        const fx = this.applyEffects(step.effects, accum);
        if (fx === accum) continue;
        const next = this.target(true);
        if (step.opacity >= 1) {
          this.m.copy.src.value = fx.texture;
          this.pass(this.m.copy.mat, next);
        } else {
          this.m.mix.base.value = accum.texture;
          this.m.mix.fx.value = fx.texture;
          this.m.mix.amount.value = step.opacity;
          this.pass(this.m.mix.mat, next);
        }
        this.pool.release(fx);
        this.pool.release(accum);
        accum = next;
      }
    }
    r.autoClear = autoClear;
    return accum;
  }

  /** Draw a finished accumulation target to the current output (canvas), replacing what's there. */
  present(accum: THREE.RenderTarget) {
    this.m.copy.src.value = accum.texture;
    this.quad.material = this.m.copy.mat;
    this.renderer.setRenderTarget(null);
    this.quad.render(this.renderer);
    this.pool.release(accum);
  }

  endFrame() {
    const held = this.captured ? 1 : 0;
    if (this.pool.live !== held) console.warn('[glyphix] compositor leaked render targets', this.pool.live - held);
    this.pool.live = held;
    this.pool.endFrame();
    // Drop atlases not drawn for a while (e.g. while dragging the line height or editing a custom charset).
    this.frameNo++;
    for (const [a, t] of this.asciiTex)
      if (this.frameNo - t.used > 120) {
        t.atlas.dispose();
        t.lut.dispose();
        this.asciiTex.delete(a);
      }
  }

  releaseCapture() {
    if (this.captured) this.pool.release(this.captured.target);
    this.captured = null;
  }

  dispose() {
    this.pool.dispose();
    const m = this.m;
    [m.copy, m.over, m.mix, m.blur, m.glow.bright, m.glow.combine, m.shadow, m.grain, m.displace, m.glitch, m.rgbSplit, m.gradientMap, m.dissolve, m.pixelate, m.ascii.cells, m.ascii.draw, m.vignette, m.colorAdjust].forEach((x) => x.mat.dispose());
    this.asciiTex.forEach((t) => (t.atlas.dispose(), t.lut.dispose()));
    this.asciiTex.clear();
  }

  // -------------------------------------------------------------------------

  private target(msaa: boolean, w = this.f.width, h = this.f.height) {
    return this.pool.acquire(Math.max(1, w), Math.max(1, h), msaa);
  }

  private clear(rt: THREE.RenderTarget) {
    this.renderer.setRenderTarget(rt);
    this.renderer.clear();
  }

  /** Full-screen pass into `target`. Opaque passes overwrite every pixel, so nothing is cleared. */
  private pass(mat: THREE.Material, target: THREE.RenderTarget) {
    const r = this.renderer;
    r.setRenderTarget(target);
    this.quad.material = mat;
    this.quad.render(r);
  }

  /** Effects in order; returns `input` untouched when there is nothing to do. Caller owns `input`. */
  private applyEffects(effects: ResolvedEffect[], input: THREE.RenderTarget): THREE.RenderTarget {
    let cur = input;
    for (const e of effects) {
      const next = this.applyEffect(e, cur);
      if (cur !== input) this.pool.release(cur);
      cur = next;
    }
    return cur;
  }

  private out() {
    return this.target(false);
  }

  /** Gaussian blur with σ in buffer px: halve the resolution until σ ≤ 4, then a separable 25-tap pass. */
  private blur(src: THREE.RenderTarget, sigma: number): THREE.RenderTarget {
    const levels = sigma > 4 ? Math.min(6, Math.ceil(Math.log2(sigma / 4))) : 0;
    let w = this.f.width;
    let h = this.f.height;
    let cur = src;
    for (let i = 0; i < levels; i++) {
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
      const next = this.target(false, w, h);
      this.m.copy.src.value = cur.texture;
      this.pass(this.m.copy.mat, next);
      if (cur !== src) this.pool.release(cur);
      cur = next;
    }
    const s = sigma / 2 ** levels;
    const b = this.m.blur;
    b.sigma.value = s;
    const hPass = this.target(false, w, h);
    b.src.value = cur.texture;
    b.step.value.set(1 / w, 0);
    this.pass(b.mat, hPass);
    if (cur !== src) this.pool.release(cur);
    const vPass = this.target(false, w, h);
    b.src.value = hPass.texture;
    b.step.value.set(0, 1 / h);
    this.pass(b.mat, vPass);
    this.pool.release(hPass);
    return vPass;
  }

  private applyEffect(e: ResolvedEffect, src: THREE.RenderTarget): THREE.RenderTarget {
    const q = e.params;
    const m = this.m;
    const k = this.f.pxPerUnit;
    switch (e.kind) {
      case 'blur':
        // radius ≈ 2σ reads like CSS blur().
        return this.blur(src, (q.radius! * k) / 2);
      case 'glow': {
        m.glow.bright.src.value = src.texture;
        m.glow.bright.threshold.value = q.threshold!;
        const bright = this.out();
        this.pass(m.glow.bright.mat, bright);
        const blurred = this.blur(bright, (q.radius! * k) / 2);
        this.pool.release(bright);
        const c = m.glow.combine;
        c.src.value = src.texture;
        c.aux.value = blurred.texture;
        c.intensity.value = q.intensity!;
        setLinear(c.color.value, e.colors.color!);
        const out = this.out();
        this.pass(c.mat, out);
        this.pool.release(blurred);
        return out;
      }
      case 'shadow': {
        const blurred = this.blur(src, Math.max(0.01, (q.blur! * k) / 2));
        const s = m.shadow;
        s.src.value = src.texture;
        s.aux.value = blurred.texture;
        s.offset.value.set(q.offsetX!, q.offsetY!);
        s.opacity.value = q.opacity!;
        setLinear(s.color.value, e.colors.color!);
        const out = this.out();
        this.pass(s.mat, out);
        this.pool.release(blurred);
        return out;
      }
      case 'grain':
        return this.simple(m.grain, src, (u) => {
          u.amount.value = q.amount!;
          u.size.value = q.size!;
          u.animated.value = q.animated! >= 0.5 ? 1 : 0;
        });
      case 'displace':
        return this.simple(m.displace, src, (u) => {
          u.amount.value = q.amount!;
          u.scale.value = q.scale!;
          u.speed.value = q.speed!;
        });
      case 'glitch':
        return this.simple(m.glitch, src, (u) => {
          u.amount.value = q.amount!;
          u.block.value = q.blockSize!;
          u.speed.value = q.speed!;
          u.split.value = q.split!;
        });
      case 'rgbSplit':
        return this.simple(m.rgbSplit, src, (u) => {
          u.amount.value = q.amount!;
          u.angle.value = q.angle! * DEG;
        });
      case 'gradientMap':
        return this.simple(m.gradientMap, src, (u) => {
          u.amount.value = q.mix!;
          setLinear(u.dark.value, e.colors.dark!);
          setLinear(u.light.value, e.colors.light!);
        });
      case 'dissolve':
        return this.simple(m.dissolve, src, (u) => {
          u.progress.value = q.progress!;
          u.scale.value = q.scale!;
          u.edge.value = q.edge!;
          setLinear(u.color.value, e.colors.color!);
        });
      case 'pixelate':
        return this.simple(m.pixelate, src, (u) => {
          u.size.value = q.size!;
        });
      case 'ascii':
        return this.ascii(e, src);
      case 'vignette':
        return this.simple(m.vignette, src, (u) => {
          u.amount.value = q.amount!;
          u.size.value = q.size!;
          u.softness.value = q.softness!;
          setLinear(u.color.value, e.colors.color!);
        });
      case 'colorAdjust':
        return this.simple(m.colorAdjust, src, (u) => {
          u.brightness.value = q.brightness!;
          u.contrast.value = q.contrast!;
          u.saturation.value = q.saturation!;
          u.hue.value = q.hue! * DEG;
        });
    }
  }

  private asciiTextures(a: AsciiAtlas) {
    let t = this.asciiTex.get(a);
    if (t) {
      t.used = this.frameNo;
      return t;
    }
    // Our own box-filtered mips (not GPU-generated), so both backends sample identical levels.
    const atlas = new THREE.DataTexture(a.mips[0]!.data, a.width, a.height, THREE.RedFormat, THREE.UnsignedByteType);
    atlas.mipmaps = a.mips;
    atlas.minFilter = THREE.LinearMipmapLinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    const lut = new THREE.DataTexture(a.lut, LUT_SIZE, 1, THREE.RedFormat, THREE.UnsignedByteType);
    for (const tex of [atlas, lut]) {
      tex.generateMipmaps = false;
      tex.unpackAlignment = 1;
      tex.colorSpace = THREE.NoColorSpace;
      tex.flipY = false;
      tex.needsUpdate = true;
    }
    t = { atlas, lut, used: this.frameNo };
    this.asciiTex.set(a, t);
    return t;
  }

  /**
   * ASCII: pass 1 reduces each visible cell to two texels (ink colour + alpha, glyph index), pass 2 draws
   * the glyphs. The cell grid covers the visible part of the comp; its target is rounded up so it is
   * reused while the cell size animates or the view pans.
   */
  private ascii(e: ResolvedEffect, src: THREE.RenderTarget): THREE.RenderTarget {
    const q = e.params;
    const f = this.f;
    const k = f.pxPerUnit;
    const preset = Math.min(CHARSETS.length, Math.max(0, Math.round(q.charset!)));
    const charset = preset === ASCII_CUSTOM_CHARSET ? e.text.charset! : CHARSETS[preset]!;
    const font = asciiFont(e.text.fontId!, q.weight!, charset);
    // The font is still loading (preview only: export prepare()s first): show the input for now.
    if (!font) return src;
    const a = asciiAtlas(font, { charset, lineHeight: q.lineHeight!, spacing: q.spacing!, square: q.square! >= 0.5 });
    // Cell size (comp px): `size` is the height, or `columns` sets the width; the font sets the shape.
    const cols0 = Math.round(q.columns!);
    const cw = cols0 > 0 ? f.compWidth / cols0 : Math.max(1, q.size!) * a.aspect;
    const ch = cols0 > 0 ? cw / a.aspect : Math.max(1, q.size!);
    const compRange = (bufMax: number, origin: number, compMax: number, size: number) => {
      const lo = Math.max(0, -origin / k);
      const hi = Math.min(compMax, (bufMax - origin) / k);
      const c0 = Math.floor(lo / size);
      return [c0, Math.max(c0, Math.ceil(hi / size) - 1)] as const;
    };
    const [cx0, cx1] = compRange(f.width, f.originX, f.compWidth, cw);
    const [cy0, cy1] = compRange(f.height, f.originY, f.compHeight, ch);
    const cols = cx1 - cx0 + 1;
    const rows = cy1 - cy0 + 1;
    const cells = this.target(false, Math.ceil(cols / 32) * 64, Math.ceil(rows / 32) * 32);

    const tex = this.asciiTextures(a);
    const { cells: c, draw: d } = this.m.ascii;
    c.src.value = src.texture;
    c.lut.value = tex.lut;
    c.size.value.set(cw, ch);
    c.cellOrigin.value.set(cx0, cy0);
    c.targetSize.value.set(cells.width, cells.height);
    c.edges.value = q.edges! >= 0.5 ? 1 : 0;
    c.threshold.value = q.edgeThreshold!;
    c.count.value = a.count;
    c.density.value = q.threshold!;
    c.mode.value = Math.round(q.colorMode!);
    c.invert.value = q.invert! >= 0.5 ? 1 : 0;
    c.contrast.value = q.contrast!;
    c.gamma.value = Math.max(0.05, q.gamma!);
    setLinear(c.ink.value, e.colors.ink!);
    setLinear(c.ink2.value, e.colors.ink2!);
    this.pass(c.mat, cells);

    d.src.value = src.texture;
    d.cells.value = cells.texture;
    d.atlas.value = tex.atlas;
    d.size.value.set(cw, ch);
    d.cellOrigin.value.set(cx0, cy0);
    d.gridMax.value.set(cols - 1, rows - 1);
    d.atlasCells.value.set(ASCII_COLS, a.height / ASCII_CELL);
    const lod = Math.min(ASCII_MAX_LOD, Math.max(0, Math.log2(ASCII_CELL / (Math.min(cw, ch) * k))));
    d.lod.value = lod;
    d.inset.value = (0.5 * 2 ** Math.ceil(lod)) / ASCII_CELL;
    d.background.value = q.background!;
    d.amount.value = q.mix!;
    setLinear(d.bg.value, e.colors.bg!);
    const out = this.out();
    this.pass(d.mat, out);
    if (e.id === this.captureId && !this.captured) this.captured = { target: cells, cols, rows, cellWidth: cw, cellHeight: ch, chars: a.chars };
    else this.pool.release(cells);
    return out;
  }

  private simple<U extends { mat: THREE.Material; src: { value: THREE.Texture } }>(u: U, src: THREE.RenderTarget, set: (u: U) => void) {
    u.src.value = src.texture;
    set(u);
    const out = this.out();
    this.pass(u.mat, out);
    return out;
  }
}
