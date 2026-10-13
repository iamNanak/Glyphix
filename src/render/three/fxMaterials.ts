// Full-screen effect passes (TSL → WGSL and GLSL). Every texture here holds premultiplied, linear
// colour in screen (drawing-buffer) space; QuadMesh uv is y-down, (0,0) = top-left.
//
// Coordinates: `px = uv·res` is the buffer pixel; `comp = (px − origin) / pxPerUnit` is the comp pixel.
// Effect parameters are in comp px so preview (any zoom) and export agree.
import * as THREE from 'three/webgpu';
import {
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  Fn,
  fract,
  length,
  max,
  mix,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { blankTexture } from './materials';

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;
type V4 = THREE.Node<'vec4'>;

/** Shared by every pass; set once per frame (and per target for `res`). */
export const fxFrame = {
  res: uniform(new THREE.Vector2(1, 1)), // full drawing-buffer size, px
  origin: uniform(new THREE.Vector2(0, 0)), // buffer px of comp (0,0), y down
  pxPerUnit: uniform(1),
  compSize: uniform(new THREE.Vector2(1920, 1080)),
  t: uniform(0),
};

const compPos = (): V2 => uv().mul(fxFrame.res).sub(fxFrame.origin).div(fxFrame.pxPerUnit);
/** Comp px → uv offset. */
const compToUV = (d: V2): V2 => d.mul(fxFrame.pxPerUnit).div(fxFrame.res);

// "Hash without sine" (D. Hoskins): pure arithmetic, so WebGPU and WebGL2 agree.
const hash12 = (p: V2): F => {
  let p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  p3 = p3.add(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
};

/** Smooth value noise, 0..1. */
const vnoise = (p: V2): F => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash12(i);
  const b = hash12(i.add(vec2(1, 0)));
  const c = hash12(i.add(vec2(0, 1)));
  const d = hash12(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};

const fbm2 = (p: V2): F => vnoise(p).mul(0.65).add(vnoise(p.mul(2.03).add(17.1)).mul(0.35));

const luma = (c: V3): F => dot(c, vec3(0.2126, 0.7152, 0.0722));

const unpremul = (c: V4): V3 => c.rgb.div(max(c.a, 1e-5));

function passMaterial(fragment: () => V4, blending: THREE.Blending = THREE.NoBlending) {
  const mat = new THREE.NodeMaterial();
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = blending;
  mat.fragmentNode = Fn(fragment)();
  return mat;
}

/** Premultiplied "over": dst = src + dst·(1 − src.a). */
function premultipliedOver(mat: THREE.Material) {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.transparent = true;
  return mat;
}

// ---------------------------------------------------------------------------
// Utility passes

export function createCopyMaterial(over = false) {
  const src = texture(blankTexture);
  const mat = passMaterial(() => src.sample(uv()));
  if (over) premultipliedOver(mat);
  return { mat, src };
}

/** dst = mix(base, fx, amount) — adjustment-layer opacity. */
export function createMixMaterial() {
  const base = texture(blankTexture);
  const fx = texture(blankTexture);
  const amount = uniform(1);
  const mat = passMaterial(() => mix(base.sample(uv()), fx.sample(uv()), amount));
  return { mat, base, fx, amount };
}

export const BLUR_TAPS = 12; // each side; σ ≤ 4 texels → 3σ fits

/** One direction of a separable Gaussian. `step` = one texel in uv along the blur axis. */
export function createBlurMaterial() {
  const src = texture(blankTexture);
  const step = uniform(new THREE.Vector2(0, 0));
  const sigma = uniform(1);
  const mat = passMaterial(() => {
    const inv = float(-0.5).div(max(sigma.mul(sigma), 1e-4));
    let sum: V4 = src.sample(uv());
    let wsum: F = float(1);
    for (let i = 1; i <= BLUR_TAPS; i++) {
      const w = exp(inv.mul(i * i));
      const o = step.mul(i);
      sum = sum.add(src.sample(uv().add(o)).add(src.sample(uv().sub(o))).mul(w));
      wsum = wsum.add(w.mul(2));
    }
    return sum.div(wsum);
  });
  return { mat, src, step, sigma };
}

// ---------------------------------------------------------------------------
// Effects. Each takes `src` (and sometimes a blurred `aux`) and writes the processed layer.

const linearColor = () => uniform(new THREE.Vector4(1, 1, 1, 1));

/** Linear → approximately perceptual (and back), for tone controls that should feel even. */
const toGamma = (c: V3): V3 => pow(max(c, vec3(0)), vec3(1 / 2.2));
const fromGamma = (c: V3): V3 => pow(max(c, vec3(0)), vec3(2.2));

function glowMaterials() {
  // Pass 1: keep what's bright enough.
  const bright = (() => {
    const src = texture(blankTexture);
    const threshold = uniform(0);
    const mat = passMaterial(() => {
      const c = src.sample(uv());
      const l = luma(unpremul(c));
      const keep = select(threshold.lessThanEqual(0), float(1), smoothstep(threshold.sub(0.05), threshold.add(0.05), l));
      return c.mul(keep);
    });
    return { mat, src, threshold };
  })();
  // Pass 2: add the blurred, tinted light.
  const combine = (() => {
    const src = texture(blankTexture);
    const aux = texture(blankTexture);
    const intensity = uniform(1);
    const color = linearColor();
    const mat = passMaterial(() => {
      const c = src.sample(uv());
      const g = aux.sample(uv());
      const rgb = g.rgb.mul(color.xyz).mul(intensity);
      const a = clamp(g.a.mul(intensity), 0, 1);
      const out = c.rgb.add(rgb);
      // Light is added, but alpha must cover it: premultiplied colour above alpha turns into a hard-edged
      // white blob on transparent exports. Over an opaque background alpha is 1 either way.
      const alpha = max(c.a.add(a.mul(float(1).sub(c.a))), clamp(max(max(out.r, out.g), out.b), 0, 1));
      return vec4(out, alpha);
    });
    return { mat, src, aux, intensity, color };
  })();
  return { bright, combine };
}

function shadowMaterial() {
  const src = texture(blankTexture);
  const aux = texture(blankTexture); // blurred layer
  const offset = uniform(new THREE.Vector2(0, 0)); // comp px, y down
  const opacity = uniform(0.5);
  const color = linearColor();
  const mat = passMaterial(() => {
    const c = src.sample(uv());
    const a = aux.sample(uv().sub(compToUV(offset))).a.mul(opacity).mul(color.w);
    return c.add(vec4(color.xyz.mul(a), a).mul(float(1).sub(c.a)));
  });
  return { mat, src, aux, offset, opacity, color };
}

function grainMaterial() {
  const src = texture(blankTexture);
  const amount = uniform(0.15);
  const size = uniform(1.5);
  const animated = uniform(1);
  const mat = passMaterial(() => {
    const c = src.sample(uv());
    const frame = floor(fxFrame.t.mul(24)).mul(animated);
    const cell = floor(compPos().div(max(size, 0.5)));
    const n = hash12(cell.add(frame.mul(vec2(37.17, 11.03)))).sub(0.5);
    // In gamma space, so the grain is as visible in shadows as in highlights.
    const g = clamp(toGamma(unpremul(c)).add(n.mul(amount)), 0, 1);
    return vec4(fromGamma(g).mul(c.a), c.a);
  });
  return { mat, src, amount, size, animated };
}

function displaceMaterial() {
  const src = texture(blankTexture);
  const amount = uniform(20);
  const scale = uniform(220);
  const speed = uniform(0.5);
  const mat = passMaterial(() => {
    const p = compPos().div(max(scale, 1)).add(fxFrame.t.mul(speed));
    const d = vec2(vnoise(p), vnoise(p.add(vec2(19.7, 7.3)))).sub(0.5).mul(amount.mul(2));
    return src.sample(uv().add(compToUV(d)));
  });
  return { mat, src, amount, scale, speed };
}

function glitchMaterial() {
  const src = texture(blankTexture);
  const amount = uniform(0.5);
  const block = uniform(36);
  const speed = uniform(8);
  const split = uniform(10);
  const mat = passMaterial(() => {
    const p = compPos();
    const k = floor(fxFrame.t.mul(speed));
    const row = floor(p.y.div(max(block, 1)));
    const r1 = hash12(vec2(row, k));
    const r2 = hash12(vec2(row.add(91.7), k.add(3.1)));
    // Coarser blocks (3 rows × 6 columns of blocks) for chunky tears.
    const big = floor(p.div(max(block, 1).mul(vec2(6, 3))));
    const r3 = hash12(big.add(k.mul(1.37)));
    const on = step(r1, amount.mul(0.6)).add(step(r3, amount.mul(0.2))).min(1);
    const shift = r2.sub(0.5).mul(block).mul(6).mul(on);
    const s = split.mul(on.mul(0.7).add(0.3)).mul(amount);
    const base = uv().add(compToUV(vec2(shift, 0)));
    const cr = src.sample(base.add(compToUV(vec2(s, 0))));
    const cg = src.sample(base);
    const cb = src.sample(base.sub(compToUV(vec2(s, 0))));
    return vec4(cr.r, cg.g, cb.b, max(max(cr.a, cg.a), cb.a));
  });
  return { mat, src, amount, block, speed, split };
}

function rgbSplitMaterial() {
  const src = texture(blankTexture);
  const amount = uniform(6);
  const angle = uniform(0); // radians, y down
  const mat = passMaterial(() => {
    const d = compToUV(vec2(cos(angle), sin(angle)).mul(amount));
    const cr = src.sample(uv().add(d));
    const cg = src.sample(uv());
    const cb = src.sample(uv().sub(d));
    return vec4(cr.r, cg.g, cb.b, max(max(cr.a, cg.a), cb.a));
  });
  return { mat, src, amount, angle };
}

function gradientMapMaterial() {
  const src = texture(blankTexture);
  const amount = uniform(1);
  const dark = linearColor();
  const light = linearColor();
  const mat = passMaterial(() => {
    const c = src.sample(uv());
    const rgb = unpremul(c);
    const l = luma(toGamma(rgb));
    const mapped = fromGamma(mix(toGamma(dark.xyz), toGamma(light.xyz), l));
    return vec4(mix(rgb, mapped, amount).mul(c.a), c.a);
  });
  return { mat, src, amount, dark, light };
}

function dissolveMaterial() {
  const src = texture(blankTexture);
  const progress = uniform(0.4);
  const scale = uniform(40);
  const edge = uniform(0.08);
  const color = linearColor();
  const mat = passMaterial(() => {
    const c = src.sample(uv());
    const n = fbm2(compPos().div(max(scale, 1)));
    const th = progress.mul(1.04).sub(0.02);
    const aa = float(0.004);
    const keep = smoothstep(th.sub(aa), th.add(aa), n);
    const burn = float(1).sub(smoothstep(th, th.add(max(edge, 1e-4)), n)).mul(step(1e-4, edge));
    const rgb = mix(c.rgb, color.xyz.mul(c.a), burn);
    return vec4(rgb, c.a).mul(keep);
  });
  return { mat, src, progress, scale, edge, color };
}

function pixelateMaterial() {
  const src = texture(blankTexture);
  const size = uniform(16);
  const mat = passMaterial(() => {
    const cell = max(size, 1);
    const centre = floor(compPos().div(cell)).add(0.5).mul(cell);
    return src.sample(centre.mul(fxFrame.pxPerUnit).add(fxFrame.origin).div(fxFrame.res));
  });
  return { mat, src, size };
}

function vignetteMaterial() {
  const src = texture(blankTexture);
  const amount = uniform(0.5);
  const size = uniform(0.55);
  const softness = uniform(0.5);
  const color = linearColor();
  const mat = passMaterial(() => {
    const c = src.sample(uv());
    const q = compPos().div(fxFrame.compSize).sub(0.5).mul(2);
    const d = length(q).div(Math.SQRT2);
    const v = smoothstep(size, size.add(softness), d).mul(amount).mul(color.w);
    return vec4(mix(c.rgb, color.xyz.mul(c.a), v), c.a);
  });
  return { mat, src, amount, size, softness, color };
}

function colorAdjustMaterial() {
  const src = texture(blankTexture);
  const brightness = uniform(0);
  const contrast = uniform(0);
  const saturation = uniform(0);
  const hue = uniform(0); // radians
  const mat = passMaterial(() => {
    const c = src.sample(uv());
    let g = toGamma(unpremul(c));
    g = g.add(brightness);
    g = g.sub(0.5).mul(contrast.add(1)).add(0.5);
    // Hue rotation in YIQ.
    const y = dot(g, vec3(0.299, 0.587, 0.114));
    const i = dot(g, vec3(0.596, -0.274, -0.322));
    const qq = dot(g, vec3(0.211, -0.523, 0.312));
    const ch = cos(hue);
    const sh = sin(hue);
    const i2 = i.mul(ch).sub(qq.mul(sh));
    const q2 = i.mul(sh).add(qq.mul(ch));
    g = vec3(
      y.add(i2.mul(0.956)).add(q2.mul(0.621)),
      y.sub(i2.mul(0.272)).sub(q2.mul(0.647)),
      y.sub(i2.mul(1.106)).add(q2.mul(1.703)),
    );
    g = mix(vec3(dot(g, vec3(0.299, 0.587, 0.114))), g, saturation.add(1));
    return vec4(fromGamma(clamp(g, 0, 1)).mul(c.a), c.a);
  });
  return { mat, src, brightness, contrast, saturation, hue };
}

/** Every effect material, created once per backend (passes are drawn one after another). */
export function createFxMaterials() {
  return {
    copy: createCopyMaterial(),
    over: createCopyMaterial(true),
    mix: createMixMaterial(),
    blur: createBlurMaterial(),
    glow: glowMaterials(),
    shadow: shadowMaterial(),
    grain: grainMaterial(),
    displace: displaceMaterial(),
    glitch: glitchMaterial(),
    rgbSplit: rgbSplitMaterial(),
    gradientMap: gradientMapMaterial(),
    dissolve: dissolveMaterial(),
    pixelate: pixelateMaterial(),
    vignette: vignetteMaterial(),
    colorAdjust: colorAdjustMaterial(),
  };
}
export type FxMaterials = ReturnType<typeof createFxMaterials>;
