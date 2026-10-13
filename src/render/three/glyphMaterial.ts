// Instanced SDF glyphs with two GPU animators (enter + exit), an emphasis loop, and SDF styling
// (outline, soft shadow, gradient, glow). Everything per glyph is computed in the vertex shader
// from instance attributes + uniforms: no per-frame CPU work proportional to glyph count.
//
// Instance attributes (all em units are relative to the text block centre, y up):
//   aQuad  = l, b, r, t of the glyph quad (em)        aUV    = atlas rect (page + uv x, y, w, h)
//   aPen   = pen x, pen y, advance (em), glyph index   aDelay = enter delay, exit delay (s), enter rand, exit rand
//   aPivot = enter pivot xy, exit pivot xy (em) — the centre of the glyph / word / line being animated
import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  Fn,
  fwidth,
  hash,
  int,
  ivec2,
  max,
  min,
  mix,
  positionGeometry,
  saturate,
  select,
  sin,
  smoothstep,
  step,
  tan,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

/** Columns of the per-layer params texture. Rows: 0 enter LUT, 1 exit LUT, 2 scramble uv rects, 3 scramble quads. */
export const PARAMS_WIDTH = 128;
export const LUT_SIZE = PARAMS_WIDTH;
export const SCRAMBLE_MAX = PARAMS_WIDTH;
export const PARAMS_ROWS = 4;

export const LOOP_KIND = { none: 0, wave: 1, bounce: 2, swing: 3, breathe: 4, jitter: 5, flicker: 6, rainbow: 7 } as const;

function poseUniforms() {
  return {
    start: uniform(0),
    duration: uniform(1),
    offset: uniform(new THREE.Vector2()), // px, y up
    scale: uniform(new THREE.Vector2(1, 1)),
    rotation: uniform(0), // radians, counter-clockwise (y up)
    rotateX: uniform(0),
    rotateY: uniform(0),
    skew: uniform(0), // radians
    opacity: uniform(1),
    blur: uniform(0), // SDF units
    spread: uniform(1),
    tint: uniform(new THREE.Vector4(0, 0, 0, 0)), // rgb (linear) + amount
    randomOffset: uniform(0),
    randomRotation: uniform(0),
    scramble: uniform(0),
  };
}
export type PoseUniforms = ReturnType<typeof poseUniforms>;

export function createGlyphUniforms(atlas: THREE.Texture, params: THREE.DataTexture) {
  return {
    t: uniform(0),
    fontSize: uniform(96),
    blockSize: uniform(new THREE.Vector2(1, 1)), // em
    color: uniform(new THREE.Vector3(1, 1, 1)),
    alpha: uniform(1), // colour alpha × layer opacity
    opacity: uniform(1), // layer opacity
    glow: uniform(0),
    glowColor: uniform(new THREE.Vector3(1, 1, 1)),
    glowAlpha: uniform(1),
    gradient: uniform(0),
    gradAngle: uniform(0),
    gradFrom: uniform(new THREE.Vector4(1, 1, 1, 1)),
    gradTo: uniform(new THREE.Vector4(1, 1, 1, 1)),
    outline: uniform(0), // SDF units
    outlineColor: uniform(new THREE.Vector4(0, 0, 0, 1)),
    shadowOffset: uniform(new THREE.Vector2()), // px, y up
    shadowBlur: uniform(0), // SDF units
    shadowColor: uniform(new THREE.Vector4(0, 0, 0, 0.5)),
    loopKind: uniform(0),
    loopAmp: uniform(0),
    loopPeriod: uniform(1),
    loopSpread: uniform(0),
    scrambleCount: uniform(0),
    enter: poseUniforms(),
    exit: poseUniforms(),
    atlas: texture(atlas),
    params,
  };
}
export type GlyphUniforms = ReturnType<typeof createGlyphUniforms>;

const TAU = Math.PI * 2;

/** Rotate a 2D vector by angle a (radians, counter-clockwise). */
const rot2 = (q: V2, a: F) => {
  const c = cos(a);
  const s = sin(a);
  return vec2(q.x.mul(c).sub(q.y.mul(s)), q.x.mul(s).add(q.y.mul(c)));
};

/**
 * Builds the fill material and the shadow material. They share uniforms and the vertex logic;
 * the shadow is offset and drawn first (lower render order).
 */
export function createGlyphMaterials(u: GlyphUniforms) {
  const aQuad = attribute('aQuad', 'vec4');
  const aUV = attribute('aUV', 'vec4');
  const aPen = attribute('aPen', 'vec4');
  const aDelay = attribute('aDelay', 'vec4');
  const aPivot = attribute('aPivot', 'vec4');
  const index = aPen.w;
  const fs = u.fontSize;

  /** Eased progress from a LUT row (linear interpolation between entries). */
  const lut = (row: number, p: F): F => {
    const x = p.mul(LUT_SIZE - 1);
    const f0 = floor(x);
    const i0 = f0.toInt();
    const i1 = min(f0.add(1), float(LUT_SIZE - 1)).toInt();
    const a = textureLoad(u.params, ivec2(i0, int(row))).x;
    const b = textureLoad(u.params, ivec2(i1, int(row))).x;
    return mix(a, b, fract(x));
  };

  const progress = (P: PoseUniforms, delay: F) => clamp(u.t.sub(P.start).sub(delay).div(max(P.duration, 1e-5)), 0, 1);
  const kEnter = float(1).sub(lut(0, progress(u.enter, aDelay.x)));
  const kExit = lut(1, progress(u.exit, aDelay.y));

  /** Move point p (px) by a pose at awayness k around pivot (px). */
  const applyPose = (p: V2, pivot: V2, k: F, P: PoseUniforms, rand: F): V2 => {
    let q: V2 = p.sub(pivot).mul(mix(vec2(1, 1), P.scale, k));
    q = vec2(q.x.add(q.y.mul(tan(P.skew.mul(k)))), q.y);
    const rand2 = fract(rand.mul(7.31).add(0.17));
    q = rot2(q, P.rotation.mul(k).add(P.randomRotation.mul(k).mul(rand2.mul(2).sub(1))));
    // 3D flip around the pivot with a mild perspective.
    const ry = P.rotateY.mul(k);
    const rx = P.rotateX.mul(k);
    const x1 = q.x.mul(cos(ry));
    const z1 = q.x.mul(sin(ry)).negate();
    const y2 = q.y.mul(cos(rx));
    const z2 = z1.mul(cos(rx)).sub(q.y.mul(sin(rx)));
    const persp = fs.mul(5);
    q = vec2(x1, y2).mul(persp.div(max(persp.sub(z2), 1)));
    const spreadShift = vec2(pivot.x.mul(mix(float(1), P.spread, k).sub(1)), 0);
    const dir = vec2(cos(rand.mul(TAU)), sin(rand.mul(TAU)));
    return pivot.add(q).add(spreadShift).add(P.offset.mul(k)).add(dir.mul(P.randomOffset.mul(k)));
  };

  // Scramble: while a unit is away, show a random glyph from the charset (changes ~12×/s).
  const scrambling = max(step(1e-3, kEnter).mul(u.enter.scramble), step(1e-3, kExit).mul(u.exit.scramble)).mul(step(0.5, u.scrambleCount));
  const pick = floor(hash(index.mul(131).add(floor(u.t.mul(12)))).mul(u.scrambleCount)).toInt();
  const altUV = textureLoad(u.params, ivec2(pick, int(2)));
  const altQuadRaw = textureLoad(u.params, ivec2(pick, int(3)));
  // Alternate glyphs sit on the same baseline, centred where the original glyph's box is.
  const altShift = aQuad.x.add(aQuad.z).sub(altQuadRaw.x.add(altQuadRaw.z)).mul(0.5);
  const altQuad = vec4(altQuadRaw.x.add(altShift), altQuadRaw.y.add(aPen.y), altQuadRaw.z.add(altShift), altQuadRaw.w.add(aPen.y));
  const quad = mix(aQuad, altQuad, scrambling);
  const uvRect = mix(aUV, altUV, scrambling);

  const corner = positionGeometry.xy.add(0.5); // 0..1, y up
  const lb = quad.xy.mul(fs);
  const rt = quad.zw.mul(fs);
  const restP = mix(lb, rt, corner);
  const glyphCenter = lb.add(rt).mul(0.5);

  // Emphasis loop.
  const phase = u.t.div(max(u.loopPeriod, 1e-3)).sub(index.mul(u.loopSpread));
  const kind = u.loopKind;
  const is = (k: number) => step(k - 0.5, kind).mul(step(kind, k + 0.5));
  const jitterStep = floor(fract(u.t.div(max(u.loopPeriod, 1e-3))).mul(12));
  const jx = hash(index.mul(17.0).add(jitterStep.mul(3)).add(1)).sub(0.5);
  const jy = hash(index.mul(29.0).add(jitterStep.mul(5)).add(2)).sub(0.5);

  const position = (withShadow: boolean) =>
    Fn(() => {
      let p: V2 = restP;
      // Loops that act around the glyph itself go first (before the animators move it).
      const swingA = u.loopAmp.mul(Math.PI / 180).mul(sin(phase.mul(TAU))).mul(is(LOOP_KIND.swing));
      const swingPivot = vec2(glyphCenter.x, lb.y);
      p = swingPivot.add(rot2(p.sub(swingPivot), swingA));
      const breathe = float(1).add(u.loopAmp.mul(float(0.5).sub(cos(phase.mul(TAU)).mul(0.5))).mul(is(LOOP_KIND.breathe)));
      p = glyphCenter.add(p.sub(glyphCenter).mul(breathe));

      p = applyPose(p, aPivot.xy.mul(fs), kEnter, u.enter, aDelay.z);
      p = applyPose(p, aPivot.zw.mul(fs), kExit, u.exit, aDelay.w);

      const wave = u.loopAmp.mul(sin(phase.mul(TAU))).mul(is(LOOP_KIND.wave));
      const bounce = u.loopAmp.mul(abs(sin(phase.mul(Math.PI)))).mul(is(LOOP_KIND.bounce));
      const jitter = vec2(jx, jy).mul(u.loopAmp.mul(2)).mul(is(LOOP_KIND.jitter));
      p = p.add(vec2(0, wave.add(bounce))).add(jitter);
      if (withShadow) p = p.add(u.shadowOffset);
      return vec3(p, 0);
    })();

  // Varyings.
  // The atlas page rides in the integer part of the rect's x (pages are layers of an array texture).
  const page = floor(uvRect.x);
  const vAtlasUV = vec2(uvRect.x.sub(page).add(corner.x.mul(uvRect.z)), uvRect.y.add(float(1).sub(corner.y).mul(uvRect.w))).toVarying('vAtlasUV');
  const vPage = page.toVarying('vPage');
  const sdf = () => u.atlas.sample(vAtlasUV).depth(floor(vPage.add(0.5))).r;
  const flicker = mix(float(1), step(u.loopAmp, hash(index.mul(53).add(jitterStep.mul(7)).add(3))), is(LOOP_KIND.flicker));
  const vGlyphAlpha = saturate(mix(float(1), u.enter.opacity, kEnter))
    .mul(saturate(mix(float(1), u.exit.opacity, kExit)))
    .mul(flicker)
    .toVarying('vGlyphAlpha');
  const vBlur = max(u.enter.blur.mul(kEnter), float(0)).add(max(u.exit.blur.mul(kExit), float(0))).toVarying('vBlur');
  const wE = saturate(kEnter).mul(u.enter.tint.w);
  const wX = saturate(kExit).mul(u.exit.tint.w);
  const tintRGB = u.enter.tint.xyz.mul(wE).add(u.exit.tint.xyz.mul(wX)).div(max(wE.add(wX), 1e-4));
  const vTint = vec4(tintRGB, max(wE, wX)).toVarying('vTint');
  const vRainbow = vec2(phase, u.loopAmp.mul(is(LOOP_KIND.rainbow))).toVarying('vRainbow');
  // Gradient coordinate from the rest position, so each glyph keeps its colour while it moves.
  const gradDir = vec2(cos(u.gradAngle), sin(u.gradAngle).negate());
  const blockPx = u.blockSize.mul(fs);
  const extent = abs(blockPx.x.mul(gradDir.x)).add(abs(blockPx.y.mul(gradDir.y)));
  const vGrad = dot(restP, gradDir).div(max(extent, 1e-3)).add(0.5).toVarying('vGrad');

  const fill = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  fill.positionNode = position(false);
  fill.colorNode = Fn(() => {
    const d = sdf();
    const w = max(fwidth(d), 1e-4).mul(0.7).add(vBlur);
    const core = smoothstep(float(0.5).sub(w), float(0.5).add(w), d);
    const edge = float(0.5).sub(u.outline);
    const cov = max(smoothstep(edge.sub(w), edge.add(w), d).mul(step(1e-4, u.outline)), core);

    const grad = mix(u.gradFrom, u.gradTo, saturate(vGrad));
    const base = select(u.gradient.greaterThan(0.5), grad, vec4(u.color, 1));
    let rgb: V3 = mix(base.xyz, vTint.xyz, vTint.w);
    // Rainbow: blend towards a cycling cosine palette (works on white text too), in linear light.
    const pal = vec3(0.5).add(cos(vec3(0, 1 / 3, 2 / 3).add(vRainbow.x).mul(TAU)).mul(0.5));
    rgb = mix(rgb, pal.mul(pal), vRainbow.y);
    const baseA = base.w.mul(u.alpha);
    const inner = core.div(max(cov, 1e-4)); // share of the coverage that is fill (vs outline)
    rgb = mix(u.outlineColor.xyz, rgb, inner);
    const a = cov.mul(mix(u.outlineColor.w.mul(u.opacity), baseA, inner));

    const halo = smoothstep(0.0, 0.5, d);
    const glowA = halo.mul(halo).mul(u.glow).mul(u.glowAlpha);
    const outRGB = mix(u.glowColor, rgb, cov);
    return vec4(outRGB, max(a, glowA).mul(vGlyphAlpha));
  })();

  const shadow = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  shadow.positionNode = position(true);
  shadow.colorNode = Fn(() => {
    const d = sdf();
    const w = max(fwidth(d), 1e-4).mul(0.7).add(vBlur);
    const edge = float(0.5).sub(u.outline);
    const a = smoothstep(edge.sub(w).sub(u.shadowBlur), edge.add(w), d);
    return vec4(u.shadowColor.xyz, a.mul(u.shadowColor.w).mul(u.opacity).mul(vGlyphAlpha));
  })();

  return { fill, shadow };
}
