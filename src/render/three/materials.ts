// TSL materials. TSL compiles to both WGSL (WebGPU) and GLSL (WebGL2), so each effect is written once.
import * as THREE from 'three/webgpu';
import {
  abs,
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
  select,
  step,
  sin,
  smoothstep,
  texture,
  uniform,
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

/** 1×1 placeholder so texture nodes always have something bound. */
export const blankTexture = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export const BG_MODE = { solid: 0, linear: 1, mesh: 2, image: 3 } as const;

/** Background: solid | linear gradient | mesh gradient | image (cover, blurred, dimmed). */
export function createBackgroundMaterial() {
  const u = {
    mode: uniform(0),
    size: uniform(new THREE.Vector2(1920, 1080)),
    opacity: uniform(1),
    // linear
    angle: uniform(0),
    offsets: uniform(new THREE.Vector4(0, 0.5, 1, 1)),
    c0: uniform(new THREE.Vector3()),
    c1: uniform(new THREE.Vector3()),
    c2: uniform(new THREE.Vector3()),
    c3: uniform(new THREE.Vector3()),
    // mesh: xy position (0..1), plus per-point enable in w of the colour vec4
    p0: uniform(new THREE.Vector2()),
    p1: uniform(new THREE.Vector2()),
    p2: uniform(new THREE.Vector2()),
    p3: uniform(new THREE.Vector2()),
    m0: uniform(new THREE.Vector4()),
    m1: uniform(new THREE.Vector4()),
    m2: uniform(new THREE.Vector4()),
    m3: uniform(new THREE.Vector4()),
    // image
    map: texture(blankTexture),
    coverScale: uniform(new THREE.Vector2(1, 1)),
    lod: uniform(0),
    blurRadius: uniform(0),
    dim: uniform(0),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  mat.colorNode = Fn(() => {
    const st = vec2(uv().x, float(1).sub(uv().y)); // 0..1, y down
    const p = st.mul(u.size);

    // Linear gradient.
    const dir = vec2(cos(u.angle), sin(u.angle));
    const extent = abs(u.size.x.mul(dir.x)).add(abs(u.size.y.mul(dir.y)));
    const g = dot(p.sub(u.size.mul(0.5)), dir).div(extent).add(0.5);
    const o = u.offsets;
    const seg = (a: F, b: F) => saturate(g.sub(a).div(max(b.sub(a), 1e-5)));
    let lin = mix(u.c0, u.c1, seg(o.x, o.y));
    lin = mix(lin, u.c2, seg(o.y, o.z));
    lin = mix(lin, u.c3, seg(o.z, o.w));

    // Mesh gradient: inverse-distance weighting in aspect-correct space.
    const aspect = vec2(u.size.x.div(u.size.y), 1);
    const w = (pt: V2, m: THREE.Node<'vec4'>) => {
      const d = st.sub(pt).mul(aspect);
      return m.w.div(dot(d, d).add(0.015).pow(1.6));
    };
    const w0 = w(u.p0, u.m0);
    const w1 = w(u.p1, u.m1);
    const w2 = w(u.p2, u.m2);
    const w3 = w(u.p3, u.m3);
    const mesh = u.m0.xyz.mul(w0).add(u.m1.xyz.mul(w1)).add(u.m2.xyz.mul(w2)).add(u.m3.xyz.mul(w3)).div(max(w0.add(w1).add(w2).add(w3), 1e-6));

    // Image: cover-fit, 9-tap blur at a coarse mip level, then dim.
    const iuv = st.sub(0.5).mul(u.coverScale).add(0.5);
    const r = u.blurRadius;
    const tap = (dx: number, dy: number) => u.map.sample(iuv.add(vec2(dx, dy).mul(r))).level(u.lod).rgb;
    const blurred = tap(0, 0)
      .mul(0.25)
      .add(tap(1, 0).add(tap(-1, 0)).add(tap(0, 1)).add(tap(0, -1)).mul(0.125))
      .add(tap(0.7, 0.7).add(tap(-0.7, 0.7)).add(tap(0.7, -0.7)).add(tap(-0.7, -0.7)).mul(0.0625));
    const img = blurred.mul(float(1).sub(u.dim));

    const m = u.mode;
    const rgb = select(m.lessThan(0.5), u.c0, select(m.lessThan(1.5), lin, select(m.lessThan(2.5), mesh, img)));
    return vec4(rgb, u.opacity);
  })();
  return { mat, u };
}

// ---------------------------------------------------------------------------
// 3D tilt: rotate a flat layer in place and apply perspective. Planes are subdivided so the
// affine texture interpolation doesn't show a seam under strong tilt.

export const tiltPlane = new THREE.PlaneGeometry(1, 1, 24, 24);

function tiltUniforms() {
  return { rotX: uniform(0), rotY: uniform(0), persp: uniform(2400) };
}

/** Local px (y up, pivot = layer centre) → tilted + projected local px. */
const tilt = (p: V2, t: ReturnType<typeof tiltUniforms>) => {
  const cy = cos(t.rotY);
  const sy = sin(t.rotY);
  const cx = cos(t.rotX);
  const sx = sin(t.rotX);
  const x1 = p.x.mul(cy);
  const z1 = p.x.mul(sy).negate();
  const y2 = p.y.mul(cx);
  const z2 = z1.mul(cx).sub(p.y.mul(sx));
  const k = t.persp.div(max(t.persp.sub(z2), 1));
  return vec2(x1, y2).mul(k);
};

export function createImageMaterial(map: THREE.Texture) {
  const u = {
    size: uniform(new THREE.Vector2(1, 1)), // full size incl. frame bar, px
    bar: uniform(0), // frame bar height, px
    radius: uniform(0),
    opacity: uniform(1),
    crop: uniform(new THREE.Vector4(0, 0, 1, 1)),
    borderWidth: uniform(0),
    borderColor: uniform(new THREE.Vector4(1, 1, 1, 1)),
    map: texture(map),
    barMap: texture(blankTexture),
    ...tiltUniforms(),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  mat.positionNode = Fn(() => {
    const p = positionGeometry.xy.mul(u.size);
    return vec3(tilt(p, u).div(u.size), 0);
  })();
  mat.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(u.size);
    const d = sdRoundRect(p, u.size.mul(0.5), u.radius);
    const yTop = float(1).sub(uv().y).mul(u.size.y); // px from the top edge
    // 1 inside the frame bar, 0 in the image. Both textures are sampled unconditionally and blended:
    // sampling (implicit mip/derivatives) inside a divergent branch is undefined on GPUs and made the
    // edge row flicker between renders whenever the layer was scaled.
    const inBar = float(1).sub(step(u.bar, yTop));
    // Textures are uploaded with flipY=false on both backends: v=0 is the first (top) row.
    const st = vec2(uv().x, yTop.sub(u.bar).div(max(u.size.y.sub(u.bar), 1)));
    const img = u.map.sample(u.crop.xy.add(st.mul(u.crop.zw)));
    const barC = u.barMap.sample(vec2(uv().x, yTop.div(max(u.bar, 1))));
    const c = mix(img, barC, inBar);
    const outer = aaCoverage(d);
    const inner = aaCoverage(d.add(u.borderWidth));
    const borderAmt = outer.sub(inner).mul(u.borderColor.w).mul(step(0.001, u.borderWidth));
    const rgb = mix(c.rgb, u.borderColor.xyz, borderAmt);
    // Content fills inside the border; the border ring is opaque by its own alpha.
    const a = max(c.a.mul(inner), borderAmt);
    return vec4(rgb, a.mul(u.opacity));
  })();
  return { mat, u };
}

export function createShadowMaterial() {
  const u = {
    planeSize: uniform(new THREE.Vector2(1, 1)),
    offset: uniform(new THREE.Vector2(0, 0)), // shadow offset in local px, y up
    size: uniform(new THREE.Vector2(1, 1)),
    radius: uniform(0),
    blur: uniform(1),
    color: uniform(new THREE.Vector3()),
    alpha: uniform(0.5),
    ...tiltUniforms(),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  mat.positionNode = Fn(() => {
    // Tilt around the layer centre (shadow mesh sits at `offset`), so the shadow follows the card.
    const p = positionGeometry.xy.mul(u.planeSize).add(u.offset);
    return vec3(tilt(p, u).sub(u.offset).div(u.planeSize), 0);
  })();
  mat.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(u.planeSize);
    const d = sdRoundRect(p, u.size.mul(0.5), u.radius);
    const a = float(1).sub(smoothstep(u.blur.mul(-0.5), u.blur.mul(0.5), d));
    return vec4(u.color, a.mul(a).mul(u.alpha));
  })();
  return { mat, u };
}

