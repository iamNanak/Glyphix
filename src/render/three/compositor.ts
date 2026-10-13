// Offscreen compositing for layers with effects and for adjustment layers.
//
// All targets are drawing-buffer sized (screen space), so cost follows the screen, not layer size.
// Contents are premultiplied linear colour. The accumulation target and layer targets use MSAA
// so geometry edges look the same as when drawing straight to the canvas.
import * as THREE from 'three/webgpu';
import type { Color, ResolvedEffect } from '@/doc';
import { createFxMaterials, fxFrame, type FxMaterials } from './fxMaterials';

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

export class Compositor {
  private quad = new THREE.QuadMesh(new THREE.NodeMaterial());
  private m: FxMaterials = createFxMaterials();
  private pool = new TargetPool();
  private f!: CompositeFrame;

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
    if (this.pool.live !== 0) console.warn('[glyphix] compositor leaked render targets', this.pool.live);
    this.pool.live = 0;
    this.pool.endFrame();
  }

  dispose() {
    this.pool.dispose();
    const m = this.m;
    [m.copy, m.over, m.mix, m.blur, m.glow.bright, m.glow.combine, m.shadow, m.grain, m.displace, m.glitch, m.rgbSplit, m.gradientMap, m.dissolve, m.pixelate, m.vignette, m.colorAdjust].forEach((x) => x.mat.dispose());
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

  private simple<U extends { mat: THREE.Material; src: { value: THREE.Texture } }>(u: U, src: THREE.RenderTarget, set: (u: U) => void) {
    u.src.value = src.texture;
    set(u);
    const out = this.out();
    this.pass(u.mat, out);
    return out;
  }
}
