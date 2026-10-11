// TSL materials. TSL compiles to both WGSL (WebGPU) and GLSL (WebGL2), so each effect is written once.
import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  cos,
  dot,
  float,
  Fn,
  fwidth,
  length,
  max,
  min,
  mix,
  positionGeometry,
  saturate,
  sin,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;

/** Rounded-rect signed distance (negative inside). p, halfSize in px. */
const sdRoundRect = (p: V2, halfSize: V2, r: F): F => {
  const q = abs(p).sub(halfSize).add(r);
  return length(max(q, 0)).add(min(max(q.x, q.y), 0)).sub(r);
};

const aaCoverage = (d: F) => saturate(float(0.5).sub(d.div(max(fwidth(d), 1e-4))));

// ---------------------------------------------------------------------------

export function createGradientMaterial() {
  const u = {
    size: uniform(new THREE.Vector2(1920, 1080)),
    angle: uniform(0),
    opacity: uniform(1),
    offsets: uniform(new THREE.Vector4(0, 0.5, 1, 1)),
    c0: uniform(new THREE.Vector3()),
    c1: uniform(new THREE.Vector3()),
    c2: uniform(new THREE.Vector3()),
    c3: uniform(new THREE.Vector3()),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  mat.colorNode = Fn(() => {
    // Comp-space pixel position, y down.
    const p = vec2(uv().x, float(1).sub(uv().y)).mul(u.size);
    const dir = vec2(cos(u.angle), sin(u.angle));
    const extent = abs(u.size.x.mul(dir.x)).add(abs(u.size.y.mul(dir.y)));
    const g = dot(p.sub(u.size.mul(0.5)), dir).div(extent).add(0.5);
    const o = u.offsets;
    const seg = (a: F, b: F) => saturate(g.sub(a).div(max(b.sub(a), 1e-5)));
    let c = mix(u.c0, u.c1, seg(o.x, o.y));
    c = mix(c, u.c2, seg(o.y, o.z));
    c = mix(c, u.c3, seg(o.z, o.w));
    return vec4(c, u.opacity);
  })();
  return { mat, u };
}

// ---------------------------------------------------------------------------

export function createImageMaterial(map: THREE.Texture) {
  const u = {
    size: uniform(new THREE.Vector2(1, 1)),
    radius: uniform(0),
    opacity: uniform(1),
    crop: uniform(new THREE.Vector4(0, 0, 1, 1)),
    map: texture(map),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  mat.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(u.size);
    const d = sdRoundRect(p, u.size.mul(0.5), u.radius);
    // Textures are uploaded with flipY=false on both backends: v=0 is the first (top) row.
    const st = vec2(uv().x, float(1).sub(uv().y));
    const c = u.map.sample(u.crop.xy.add(st.mul(u.crop.zw)));
    return vec4(c.rgb, c.a.mul(aaCoverage(d)).mul(u.opacity));
  })();
  return { mat, u };
}

export function createShadowMaterial() {
  const u = {
    planeSize: uniform(new THREE.Vector2(1, 1)),
    size: uniform(new THREE.Vector2(1, 1)),
    radius: uniform(0),
    blur: uniform(1),
    color: uniform(new THREE.Vector3()),
    alpha: uniform(0.5),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  mat.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(u.planeSize);
    const d = sdRoundRect(p, u.size.mul(0.5), u.radius);
    const a = float(1).sub(smoothstep(u.blur.mul(-0.5), u.blur.mul(0.5), d));
    return vec4(u.color, a.mul(a).mul(u.alpha));
  })();
  return { mat, u };
}

// ---------------------------------------------------------------------------

export const GLYPH_LUT_SIZE = 64;

/**
 * Instanced SDF glyphs. Per-glyph animation is computed in the vertex shader from
 * (rank, t) — one animator template, no per-glyph tracks, ~zero CPU per frame.
 */
export function createGlyphMaterial(atlas: THREE.Texture) {
  const u = {
    t: uniform(0),
    start: uniform(0),
    duration: uniform(1),
    stagger: uniform(0),
    fromOffset: uniform(new THREE.Vector2(0, 0)),
    fromScale: uniform(1),
    fromRotation: uniform(0),
    fromOpacity: uniform(1),
    lut: uniformArray(new Array<number>(GLYPH_LUT_SIZE).fill(0).map((_, i) => i / (GLYPH_LUT_SIZE - 1)), 'float'),
    fontSize: uniform(96),
    color: uniform(new THREE.Vector3(1, 1, 1)),
    alpha: uniform(1),
    glow: uniform(0),
    glowColor: uniform(new THREE.Vector3(1, 1, 1)),
    glowAlpha: uniform(1),
    atlas: texture(atlas),
  };

  const aQuad = attribute('aQuad', 'vec4'); // l, b, r, t in em (pen-relative, y-up)
  const aUV = attribute('aUV', 'vec4'); // x, y, w, h in atlas uv
  const aRank = attribute('aRank', 'float');

  const progress = clamp(u.t.sub(u.start).sub(u.stagger.mul(aRank)).div(max(u.duration, 1e-5)), 0, 1);
  const eased = Fn(() => {
    const x = progress.mul(GLYPH_LUT_SIZE - 1);
    const f0 = x.floor();
    const i0 = f0.toInt();
    const i1 = min(f0.add(1), float(GLYPH_LUT_SIZE - 1)).toInt();
    // @types/three types array elements loosely; they are floats here.
    const a = u.lut.element(i0) as unknown as F;
    const b = u.lut.element(i1) as unknown as F;
    return mix(a, b, x.fract());
  })();

  const corner = positionGeometry.xy.add(0.5); // 0..1, y-up

  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  mat.positionNode = Fn(() => {
    const lb = aQuad.xy.mul(u.fontSize);
    const rt = aQuad.zw.mul(u.fontSize);
    const center = lb.add(rt).mul(0.5);
    const local = mix(lb, rt, corner).sub(center);
    const s = mix(u.fromScale, 1, eased);
    const rot = mix(u.fromRotation, 0, eased);
    const c = cos(rot);
    const sn = sin(rot);
    const scaled = local.mul(s);
    const rotated = vec2(scaled.x.mul(c).sub(scaled.y.mul(sn)), scaled.x.mul(sn).add(scaled.y.mul(c)));
    const offset = mix(u.fromOffset, vec2(0, 0), eased);
    return vec3(center.add(rotated).add(offset), 0);
  })();

  const vAtlasUV = vec2(aUV.x.add(corner.x.mul(aUV.z)), aUV.y.add(float(1).sub(corner.y).mul(aUV.w))).toVarying('vAtlasUV');
  const vGlyphAlpha = mix(u.fromOpacity, 1, saturate(eased)).toVarying('vGlyphAlpha');

  mat.colorNode = Fn(() => {
    const d = u.atlas.sample(vAtlasUV).r;
    const w = max(fwidth(d), 1e-4).mul(0.7);
    const fill = smoothstep(float(0.5).sub(w), float(0.5).add(w), d);
    const halo = smoothstep(0.0, 0.5, d);
    const glowA = halo.mul(halo).mul(u.glow).mul(u.glowAlpha);
    const rgb = mix(u.glowColor, u.color, fill);
    const a = max(fill.mul(u.alpha), glowA);
    return vec4(rgb, a.mul(vGlyphAlpha));
  })();

  return { mat, u };
}
