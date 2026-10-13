import * as THREE from 'three/webgpu';
import {
  assignUnits,
  easingLUT,
  mulberry32,
  unitDelays,
  type Color,
  type GlyphAnimator,
  type BackgroundItem,
  type FrameKind,
  type ImageItem,
  type RenderItem,
  type RenderList,
  type TextItem,
} from '@/doc';
import { assetStore, pickLevel } from '@/assets/assetStore';
import { ATLAS_SPREAD_EM, fontLibrary, type LaidOutGlyph, type TextLayout } from '@/text/fontLibrary';
import { drawFrameBar } from '@/styling/frameBar';
import { getSharedDevice } from './gpuDevice';
import type { BackendKind, CreateBackendOptions, RenderBackend, RenderStats, View } from '../backend';
import { BG_MODE, blankTexture, createBackgroundMaterial, createImageMaterial, createShadowMaterial, tiltPlane } from './materials';
import {
  createGlyphMaterials,
  createGlyphUniforms,
  LOOP_KIND,
  LUT_SIZE,
  PARAMS_ROWS,
  PARAMS_WIDTH,
  SCRAMBLE_MAX,
  type GlyphUniforms,
  type PoseUniforms,
} from './glyphMaterial';

const DEG = Math.PI / 180;
const unitPlane = new THREE.PlaneGeometry(1, 1);

const tmpColor = new THREE.Color();
const tmpVec3 = new THREE.Vector3();

/** Doc colors are sRGB; shaders work in linear. */
function setColor(target: THREE.Vector3, c: Color) {
  tmpColor.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  target.set(tmpColor.r, tmpColor.g, tmpColor.b);
}

/** Comp space (y down, px) → world (y up). Rotation in the doc is clockwise degrees. */
function applyTransform(obj: THREE.Object3D, item: { x: number; y: number; scale: number; rotation: number }) {
  obj.position.set(item.x, -item.y, 0);
  obj.rotation.z = -item.rotation * DEG;
  obj.scale.setScalar(item.scale);
}

interface LayerNode {
  readonly root: THREE.Object3D;
  update(item: RenderItem, ctx: FrameCtx): void;
  dispose(): void;
}

interface FrameCtx {
  t: number;
  width: number;
  height: number;
  textures: TextureCache;
  /** Device pixels per comp pixel. */
  pxPerUnit: number;
  stats: { glyphs: number };
}

// ---------------------------------------------------------------------------

/**
 * GPU textures per (asset, proxy level). Picks the smallest proxy that is still sharp at the
 * on-screen size; export backends force full resolution. Entries unused for a while are evicted.
 */
class TextureCache {
  private cache = new Map<string, { tex: THREE.Texture; version: number; lastUsed: number }>();
  private frame = 0;

  constructor(private readonly fullRes: boolean) {}

  /** @param neededWidth on-screen width of the layer in device pixels */
  get(assetId: string, neededWidth: number): THREE.Texture | null {
    const asset = assetStore.get(assetId);
    if (!asset) return null;
    const level = this.fullRes ? 0 : pickLevel(asset, neededWidth);
    const key = `${assetId}@${level}`;
    const hit = this.cache.get(key);
    if (hit && hit.version === asset.version) {
      hit.lastUsed = this.frame;
      return hit.tex;
    }
    hit?.tex.dispose();
    const tex = new THREE.Texture(asset.levels[level]!.source as THREE.Texture['image']);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.cache.set(key, { tex, version: asset.version, lastUsed: this.frame });
    return tex;
  }

  /** Call once per frame after rendering. */
  endFrame(maxIdleFrames = 180) {
    this.frame++;
    for (const [key, entry] of this.cache) {
      if (this.frame - entry.lastUsed > maxIdleFrames) {
        entry.tex.dispose();
        this.cache.delete(key);
      }
    }
  }

  get size() {
    return this.cache.size;
  }

  dispose() {
    this.cache.forEach((c) => c.tex.dispose());
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------

class BackgroundNode implements LayerNode {
  readonly root: THREE.Mesh;
  private m = createBackgroundMaterial();

  constructor() {
    this.root = new THREE.Mesh(unitPlane, this.m.mat);
  }

  update(raw: RenderItem, ctx: FrameCtx) {
    const item = raw as BackgroundItem;
    const { u } = this.m;
    const fill = item.fill;
    this.root.position.set(ctx.width / 2, -ctx.height / 2, 0);
    this.root.scale.set(ctx.width, ctx.height, 1);
    u.size.value.set(ctx.width, ctx.height);
    u.opacity.value = item.opacity;
    u.mode.value = BG_MODE[fill.kind];
    switch (fill.kind) {
      case 'solid':
        setColor(u.c0.value, fill.color);
        break;
      case 'linear': {
        u.angle.value = fill.angle * DEG;
        const stops = fill.stops.length ? fill.stops : [{ offset: 0, color: [0, 0, 0, 1] as Color }];
        const at = (i: number) => stops[Math.min(i, stops.length - 1)]!;
        u.offsets.value.set(at(0).offset, at(1).offset, at(2).offset, at(3).offset);
        [u.c0, u.c1, u.c2, u.c3].forEach((c, i) => setColor(c.value, at(i).color));
        break;
      }
      case 'mesh':
        [u.p0, u.p1, u.p2, u.p3].forEach((p, i) => {
          const pt = fill.points[i];
          const m = [u.m0, u.m1, u.m2, u.m3][i]!.value;
          if (pt) {
            p.value.set(pt.x, pt.y);
            setColor(tmpVec3, pt.color);
            m.set(tmpVec3.x, tmpVec3.y, tmpVec3.z, 1);
          } else m.set(0, 0, 0, 0);
        });
        break;
      case 'image': {
        // Blurred backgrounds never need many pixels: request a small proxy.
        const needed = (ctx.width * ctx.pxPerUnit) / Math.max(1, fill.blur / 8);
        const tex = ctx.textures.get(fill.assetId, needed);
        const asset = assetStore.get(fill.assetId);
        u.map.value = tex ?? blankTexture;
        if (asset) {
          const a = asset.width / asset.height;
          const A = ctx.width / ctx.height;
          u.coverScale.value.set(a > A ? A / a : 1, a > A ? 1 : a / A);
        }
        // Blur radius in uv units of the comp; sample from a mip level that roughly matches.
        u.blurRadius.value = fill.blur / Math.max(ctx.width, ctx.height);
        u.lod.value = fill.blur > 0 ? Math.log2(1 + fill.blur * ((tex?.image as { width?: number })?.width ?? ctx.width) / ctx.width / 2) : 0;
        u.dim.value = fill.dim;
        break;
      }
    }
  }

  dispose() {
    this.m.mat.dispose();
  }
}

/** Frame bar textures, keyed by appearance; regenerated when fonts finish loading. */
class FrameBarCache {
  private cache = new Map<string, { tex: THREE.Texture; lastUsed: number }>();
  private frame = 0;

  get(kind: Exclude<FrameKind, 'none'>, url: string, w: number, h: number): THREE.Texture {
    // Draw at 2× layer px (capped) so bars stay crisp when zoomed or exported.
    const res = Math.min(2, 4096 / Math.max(1, w));
    const fontsReady = typeof document !== 'undefined' && document.fonts.check('500 12px Inter');
    const key = `${kind}|${url}|${Math.round(w * res)}x${Math.round(h * res)}|${fontsReady}`;
    const hit = this.cache.get(key);
    if (hit) {
      hit.lastUsed = this.frame;
      return hit.tex;
    }
    if (!fontsReady) void document.fonts.load('500 12px Inter');
    const tex = new THREE.CanvasTexture(drawFrameBar(kind, url, w * res, h * res));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.cache.set(key, { tex, lastUsed: this.frame });
    return tex;
  }

  /** Drop bars nobody has drawn for a few frames (e.g. intermediate sizes during a crop drag). */
  endFrame(maxIdleFrames = 30) {
    this.frame++;
    for (const [key, e] of this.cache) {
      if (this.frame - e.lastUsed > maxIdleFrames) {
        e.tex.dispose();
        this.cache.delete(key);
      }
    }
  }

  dispose() {
    this.cache.forEach((e) => e.tex.dispose());
    this.cache.clear();
  }
}

class ImageNode implements LayerNode {
  readonly root = new THREE.Group();
  private image: ReturnType<typeof createImageMaterial> | null = null;
  private imageMesh: THREE.Mesh | null = null;
  private shadow = createShadowMaterial();
  private shadowMesh: THREE.Mesh;

  constructor(private readonly bars: FrameBarCache) {
    this.shadowMesh = new THREE.Mesh(tiltPlane, this.shadow.mat);
    this.shadowMesh.userData.order = 1;
    this.root.add(this.shadowMesh);
  }

  update(raw: RenderItem, ctx: FrameCtx) {
    const item = raw as ImageItem;
    applyTransform(this.root, item);
    const w = item.width;
    const h = item.height + item.frameBar; // full card height
    const tex = ctx.textures.get(item.assetId, (w / item.crop.w) * item.scale * ctx.pxPerUnit);
    if (tex && !this.image) {
      this.image = createImageMaterial(tex);
      this.imageMesh = new THREE.Mesh(tiltPlane, this.image.mat);
      this.imageMesh.userData.order = 2;
      this.root.add(this.imageMesh);
    } else if (tex && this.image && this.image.u.map.value !== tex) {
      this.image.u.map.value = tex; // proxy level or asset changed: rebind, no shader rebuild
    }
    const tilt = item.tilt;
    if (this.image && this.imageMesh) {
      const u = this.image.u;
      this.imageMesh.scale.set(w, h, 1);
      u.size.value.set(w, h);
      u.bar.value = item.frameBar;
      u.barMap.value = item.frame.kind === 'none' ? blankTexture : this.bars.get(item.frame.kind, item.frame.url, w, item.frameBar);
      u.radius.value = item.radius;
      u.crop.value.set(item.crop.x, item.crop.y, item.crop.w, item.crop.h);
      u.opacity.value = item.opacity;
      u.borderWidth.value = item.border?.width ?? 0;
      if (item.border) {
        setColor(tmpVec3, item.border.color);
        u.borderColor.value.set(tmpVec3.x, tmpVec3.y, tmpVec3.z, item.border.color[3]);
      }
      u.rotX.value = tilt.rotateX * DEG;
      u.rotY.value = tilt.rotateY * DEG;
      u.persp.value = tilt.perspective;
      this.imageMesh.visible = !!tex;
    }

    const sh = item.shadow;
    this.shadowMesh.visible = !!sh && item.opacity > 0;
    if (sh) {
      const margin = sh.blur * 2;
      const pw = w + margin * 2;
      const ph = h + margin * 2;
      this.shadowMesh.position.set(sh.offsetX, -sh.offsetY, 0);
      this.shadowMesh.scale.set(pw, ph, 1);
      const u = this.shadow.u;
      u.planeSize.value.set(pw, ph);
      u.offset.value.set(sh.offsetX, -sh.offsetY);
      u.size.value.set(w, h);
      u.radius.value = item.radius;
      u.blur.value = Math.max(1, sh.blur);
      setColor(u.color.value, sh.color);
      u.alpha.value = sh.color[3] * item.opacity;
      u.rotX.value = tilt.rotateX * DEG;
      u.rotY.value = tilt.rotateY * DEG;
      u.persp.value = tilt.perspective;
    }
  }

  dispose() {
    this.image?.mat.dispose();
    this.shadow.mat.dispose();
  }
}

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*+?<>';

/** Pose uniforms from a doc animator (doc: comp px, y down, degrees → shader: px, y up, radians). */
function setPose(P: PoseUniforms, anim: GlyphAnimator | null, kind: 'enter' | 'exit') {
  if (!anim) {
    // Enter: always finished (k = 0). Exit: never started (k = 0).
    P.start.value = kind === 'enter' ? -1e6 : 1e9;
    P.duration.value = 1;
    return;
  }
  const pose = anim.pose;
  P.start.value = anim.start;
  P.duration.value = anim.duration;
  P.offset.value.set(pose.offsetX, -pose.offsetY);
  P.scale.value.set(pose.scaleX, pose.scaleY);
  P.rotation.value = -pose.rotation * DEG;
  P.rotateX.value = pose.rotateX * DEG;
  P.rotateY.value = pose.rotateY * DEG;
  P.skew.value = pose.skewX * DEG;
  P.opacity.value = pose.opacity;
  P.blur.value = Math.max(0, pose.blur) / (2 * ATLAS_SPREAD_EM);
  P.spread.value = pose.spread;
  if (pose.color) {
    setColor(tmpVec3, pose.color);
    P.tint.value.set(tmpVec3.x, tmpVec3.y, tmpVec3.z, pose.color[3]);
  } else P.tint.value.set(0, 0, 0, 0);
  P.randomOffset.value = pose.randomOffset;
  P.randomRotation.value = pose.randomRotation * DEG;
  P.scramble.value = pose.scramble ? 1 : 0;
}

const timingKey = (a: GlyphAnimator | null) => (a ? `${a.unit}|${a.order}|${a.seed}|${a.stagger}|${JSON.stringify(a.falloff)}` : '-');

class TextNode implements LayerNode {
  readonly root = new THREE.Group();
  private params = new THREE.DataTexture(new Float32Array(PARAMS_WIDTH * PARAMS_ROWS * 4), PARAMS_WIDTH, PARAMS_ROWS, THREE.RGBAFormat, THREE.FloatType);
  private u: GlyphUniforms;
  private mats: ReturnType<typeof createGlyphMaterials>;
  private fillMesh: THREE.Mesh | null = null;
  private shadowMesh: THREE.Mesh | null = null;
  private geom: THREE.InstancedBufferGeometry | null = null;
  private drawn: LaidOutGlyph[] = [];
  private text = '';
  private layoutKey = '';
  private timing = '';
  private lutKeys = ['', ''];
  private scrambleKey = '';

  /** The atlas array texture was recreated (it grew a page, or was rebuilt). */
  setAtlas(atlas: THREE.Texture) {
    this.u.atlas.value = atlas;
  }

  constructor(atlas: THREE.Texture) {
    this.params.minFilter = THREE.NearestFilter;
    this.params.magFilter = THREE.NearestFilter;
    this.params.generateMipmaps = false;
    this.params.colorSpace = THREE.NoColorSpace;
    this.params.needsUpdate = true;
    this.u = createGlyphUniforms(atlas, this.params);
    this.mats = createGlyphMaterials(this.u);
  }

  update(raw: RenderItem, ctx: FrameCtx) {
    const item = raw as TextItem;
    applyTransform(this.root, item);
    const layout = fontLibrary.layout(item);
    if (!layout) {
      this.root.visible = false;
      return;
    }
    const key = `${layout.fontId}|${item.weight}|${item.tracking}|${item.align}|${item.lineHeight}|${item.text}|${layout.generation}`;
    if (key !== this.layoutKey) {
      this.rebuild(layout, item.text);
      this.layoutKey = key;
      this.timing = '';
      this.scrambleKey = '';
    }
    const timing = `${timingKey(item.enter)}#${timingKey(item.exit)}`;
    if (timing !== this.timing) {
      this.writeTiming(item);
      this.timing = timing;
    }
    const u = this.u;
    if ((item.enter?.pose.scramble || item.exit?.pose.scramble) && this.scrambleKey !== key) {
      this.writeScramble(layout.fontId, item.weight);
      this.scrambleKey = key;
    }
    this.writeLUT(0, item.enter?.easing ?? null);
    this.writeLUT(1, item.exit?.easing ?? null);

    this.root.visible = true;
    ctx.stats.glyphs += this.drawn.length;

    const fs = item.fontSize;
    u.t.value = ctx.t;
    u.fontSize.value = fs;
    u.blockSize.value.set(layout.width, layout.height);
    setColor(u.color.value, item.color);
    u.alpha.value = item.color[3] * item.opacity;
    u.opacity.value = item.opacity;
    u.glow.value = item.glow;
    setColor(u.glowColor.value, item.glowColor);
    u.glowAlpha.value = item.glowColor[3] * item.opacity;

    const g = item.gradient;
    u.gradient.value = g ? 1 : 0;
    if (g) {
      u.gradAngle.value = g.angle * DEG;
      setColor(tmpVec3, g.from);
      u.gradFrom.value.set(tmpVec3.x, tmpVec3.y, tmpVec3.z, g.from[3]);
      setColor(tmpVec3, g.to);
      u.gradTo.value.set(tmpVec3.x, tmpVec3.y, tmpVec3.z, g.to[3]);
    }
    // SDF units: 0.5 of the field spans ATLAS_SPREAD_EM on each side of the edge.
    const toSDF = (px: number, maxShare: number) => Math.min(maxShare, Math.max(0, px / fs) / (2 * ATLAS_SPREAD_EM));
    const o = item.outline;
    u.outline.value = o && o.width > 0 ? toSDF(o.width, 0.42) : 0;
    if (o) {
      setColor(tmpVec3, o.color);
      u.outlineColor.value.set(tmpVec3.x, tmpVec3.y, tmpVec3.z, o.color[3]);
    }
    const sh = item.shadow;
    if (this.shadowMesh) this.shadowMesh.visible = !!sh;
    if (sh) {
      u.shadowOffset.value.set(sh.offsetX, -sh.offsetY);
      u.shadowBlur.value = toSDF(sh.blur, 0.48 - u.outline.value);
      setColor(tmpVec3, sh.color);
      u.shadowColor.value.set(tmpVec3.x, tmpVec3.y, tmpVec3.z, sh.color[3]);
    }

    setPose(u.enter, item.enter, 'enter');
    setPose(u.exit, item.exit, 'exit');
    const loop = item.loop;
    u.loopKind.value = loop ? LOOP_KIND[loop.kind] : 0;
    u.loopAmp.value = loop?.amplitude ?? 0;
    u.loopPeriod.value = loop?.period ?? 1;
    u.loopSpread.value = loop?.spread ?? 0;
  }

  /** Easing LUT rows (0 = enter, 1 = exit); null = linear. */
  private writeLUT(row: 0 | 1, easing: GlyphAnimator['easing'] | null) {
    const key = JSON.stringify(easing);
    if (this.lutKeys[row] === key) return;
    const lut = easingLUT(easing ?? { kind: 'linear' }, LUT_SIZE);
    const data = this.params.image.data as Float32Array;
    for (let i = 0; i < LUT_SIZE; i++) data[(row * PARAMS_WIDTH + i) * 4] = lut[i]!;
    this.params.needsUpdate = true;
    this.lutKeys[row] = key;
  }

  /** Alternate glyphs for the scramble effect, from the same font and weight. */
  private writeScramble(fontId: string, weight: number) {
    const data = this.params.image.data as Float32Array;
    const size = fontLibrary.atlasSize;
    let n = 0;
    for (const ch of SCRAMBLE_CHARS) {
      const r = fontLibrary.glyphFor(fontId, weight, ch.codePointAt(0)!);
      const a = r?.glyph;
      if (!a || n >= SCRAMBLE_MAX) continue;
      data.set([a.page + a.ax / size, a.ay / size, a.aw / size, a.ah / size], (2 * PARAMS_WIDTH + n) * 4);
      data.set([a.l, a.b, a.r, a.t], (3 * PARAMS_WIDTH + n) * 4);
      n++;
    }
    this.u.scrambleCount.value = n;
    this.params.needsUpdate = true;
  }

  /** Per-glyph start delays, randoms and pivots for the enter and exit animators. */
  private writeTiming(item: TextItem) {
    const geom = this.geom;
    if (!geom) return;
    const delay = geom.getAttribute('aDelay') as THREE.InstancedBufferAttribute;
    const pivot = geom.getAttribute('aPivot') as THREE.InstancedBufferAttribute;
    const d = delay.array as Float32Array;
    const pv = pivot.array as Float32Array;
    const drawn = this.drawn;
    [item.enter, item.exit].forEach((anim, slot) => {
      const unit = anim?.unit ?? 'glyph';
      const { units, count } = assignUnits(this.text, drawn, unit);
      const delays = anim ? unitDelays(count, anim) : new Array<number>(count).fill(0);
      const rng = mulberry32(((anim?.seed ?? 0) + 1) * 7919);
      const rands = Array.from({ length: count }, () => rng());
      // Pivot = centre of the unit's glyph boxes.
      const box = Array.from({ length: count }, () => [Infinity, Infinity, -Infinity, -Infinity]);
      drawn.forEach((g, i) => {
        const a = g.glyph!;
        const b = box[units[i]!]!;
        b[0] = Math.min(b[0]!, g.x + a.l);
        b[1] = Math.min(b[1]!, g.y + a.b);
        b[2] = Math.max(b[2]!, g.x + a.r);
        b[3] = Math.max(b[3]!, g.y + a.t);
      });
      drawn.forEach((_, i) => {
        const un = units[i]!;
        const b = box[un]!;
        d[i * 4 + slot] = delays[un]!;
        d[i * 4 + 2 + slot] = rands[un]!;
        pv[i * 4 + slot * 2] = (b[0]! + b[2]!) / 2;
        pv[i * 4 + slot * 2 + 1] = (b[1]! + b[3]!) / 2;
      });
    });
    delay.needsUpdate = true;
    pivot.needsUpdate = true;
  }

  private rebuild(layout: TextLayout, text: string) {
    const drawn = layout.glyphs.filter((g) => g.glyph);
    const n = drawn.length;
    const quad = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 4);
    const pen = new Float32Array(n * 4);
    const size = fontLibrary.atlasSize;
    drawn.forEach((g, i) => {
      const a = g.glyph!;
      quad.set([g.x + a.l, g.y + a.b, g.x + a.r, g.y + a.t], i * 4);
      uvs.set([a.page + a.ax / size, a.ay / size, a.aw / size, a.ah / size], i * 4);
      pen.set([g.x, g.y, g.advance, i], i * 4);
    });

    if (this.fillMesh) {
      this.root.remove(this.fillMesh, this.shadowMesh!);
      this.geom!.dispose();
    }
    const geom = new THREE.InstancedBufferGeometry();
    geom.index = unitPlane.index;
    geom.setAttribute('position', unitPlane.getAttribute('position'));
    geom.setAttribute('uv', unitPlane.getAttribute('uv'));
    geom.setAttribute('aQuad', new THREE.InstancedBufferAttribute(quad, 4));
    geom.setAttribute('aUV', new THREE.InstancedBufferAttribute(uvs, 4));
    geom.setAttribute('aPen', new THREE.InstancedBufferAttribute(pen, 4));
    geom.setAttribute('aDelay', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    geom.setAttribute('aPivot', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    geom.instanceCount = n;
    const shadow = new THREE.Mesh(geom, this.mats.shadow);
    shadow.frustumCulled = false;
    shadow.userData.order = 0;
    const fill = new THREE.Mesh(geom, this.mats.fill);
    fill.frustumCulled = false;
    fill.userData.order = 1;
    this.root.add(shadow, fill);
    this.fillMesh = fill;
    this.shadowMesh = shadow;
    this.geom = geom;
    this.drawn = drawn;
    this.text = text;
  }

  dispose() {
    this.geom?.dispose();
    this.mats.fill.dispose();
    this.mats.shadow.dispose();
    this.params.dispose();
  }
}

// ---------------------------------------------------------------------------

export class ThreeBackend implements RenderBackend {
  onLost: ((reason: string) => void) | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1920, 0, -1080, -1000, 1000);
  private nodes = new Map<string, LayerNode>();
  private textures: TextureCache;
  private bars = new FrameBarCache();
  private bufferSize = new THREE.Vector2();
  private cssSize = { width: 1, height: 1 };
  private view: View | null = null;
  private atlas: THREE.DataArrayTexture;
  /** Atlas buffer + per-page versions this backend has uploaded. */
  private atlasData: Uint8Array | null = null;
  private uploaded: number[] = [];
  private lastStats = { glyphs: 0 };

  private constructor(
    private renderer: THREE.WebGPURenderer,
    readonly kind: BackendKind,
    fullResAssets: boolean,
  ) {
    this.textures = new TextureCache(fullResAssets);
    this.atlas = this.makeAtlas();
    renderer.onDeviceLost = (info) => {
      console.error('[glyphix] GPU device lost', info);
      this.onLost?.(info.reason ?? info.message ?? 'unknown');
    };
  }

  static async create(opts: CreateBackendOptions): Promise<ThreeBackend> {
    const device = opts.forceWebGL ? null : await getSharedDevice();
    const renderer = new THREE.WebGPURenderer({
      canvas: opts.canvas as HTMLCanvasElement | undefined,
      antialias: true,
      alpha: true,
      forceWebGL: opts.forceWebGL ?? false,
      ...(device ? { device } : {}),
    } as ConstructorParameters<typeof THREE.WebGPURenderer>[0]);
    await renderer.init();
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const backend = renderer.backend as { isWebGPUBackend?: boolean };
    return new ThreeBackend(renderer, backend.isWebGPUBackend ? 'webgpu' : 'webgl2', opts.fullResAssets ?? false);
  }

  get canvas() {
    return this.renderer.domElement as HTMLCanvasElement | OffscreenCanvas;
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.cssSize = { width, height };
  }

  setView(view: View | null) {
    this.view = view;
  }

  render(list: RenderList) {
    // Visible comp rect. World space is comp space with y flipped.
    const v = this.view;
    const x0 = v ? -v.offsetX / v.zoom : 0;
    const y0 = v ? -v.offsetY / v.zoom : 0;
    const x1 = v ? x0 + this.cssSize.width / v.zoom : list.width;
    const y1 = v ? y0 + this.cssSize.height / v.zoom : list.height;
    const cam = this.camera;
    if (cam.left !== x0 || cam.right !== x1 || cam.top !== -y0 || cam.bottom !== -y1) {
      cam.left = x0;
      cam.right = x1;
      cam.top = -y0;
      cam.bottom = -y1;
      cam.updateProjectionMatrix();
    }
    this.syncAtlas();

    this.renderer.getDrawingBufferSize(this.bufferSize);
    const ctx: FrameCtx = {
      t: list.t,
      width: list.width,
      height: list.height,
      textures: this.textures,
      pxPerUnit: this.bufferSize.x / (x1 - x0),
      stats: { glyphs: 0 },
    };
    const seen = new Set<string>();
    const gen = fontLibrary.generation;
    list.items.forEach((item, order) => {
      const nodeKey = `${item.kind}:${item.id}`;
      seen.add(nodeKey);
      let node = this.nodes.get(nodeKey);
      if (!node) {
        node = item.kind === 'background' ? new BackgroundNode() : item.kind === 'image' ? new ImageNode(this.bars) : new TextNode(this.atlas);
        this.nodes.set(nodeKey, node);
        this.scene.add(node.root);
      }
      node.update(item, ctx);
      // Children may set userData.order (0..9) to stack within their layer.
      node.root.traverse((o) => (o.renderOrder = order * 10 + ((o.userData.order as number | undefined) ?? 0)));
    });
    // The glyph atlas filled up and was rebuilt during this frame: earlier text layers hold stale
    // glyph rects, so lay them out again before drawing (keeps preview = export).
    if (fontLibrary.generation !== gen) {
      ctx.stats.glyphs = 0;
      list.items.forEach((item) => this.nodes.get(`${item.kind}:${item.id}`)!.update(item, ctx));
    }
    for (const [key, node] of this.nodes) {
      if (!seen.has(key)) {
        this.scene.remove(node.root);
        node.dispose();
        this.nodes.delete(key);
      }
    }
    // Text layout may have pulled new glyphs into the atlas during update().
    this.syncAtlas();
    this.lastStats = ctx.stats;
    const r = this.renderer;
    if (v) {
      // Preview: clip to the artboard so the preview never shows what the export would crop.
      // Clear the whole canvas first: WebGL's clear honours the scissor rect.
      r.autoClear = false;
      r.setScissorTest(false);
      r.clear();
      const sx0 = Math.max(0, Math.floor(v.offsetX));
      const sy0 = Math.max(0, Math.floor(v.offsetY));
      const sx1 = Math.min(this.cssSize.width, Math.ceil(v.offsetX + list.width * v.zoom));
      const sy1 = Math.min(this.cssSize.height, Math.ceil(v.offsetY + list.height * v.zoom));
      r.setScissor(sx0, sy0, Math.max(0, sx1 - sx0), Math.max(0, sy1 - sy0));
      r.setScissorTest(true);
      r.render(this.scene, this.camera);
      r.setScissorTest(false);
    } else {
      r.autoClear = true;
      r.render(this.scene, this.camera);
    }
    this.textures.endFrame();
    this.bars.endFrame();
  }

  private makeAtlas(): THREE.DataArrayTexture {
    const size = fontLibrary.atlasSize;
    const tex = new THREE.DataArrayTexture(fontLibrary.atlas, size, size, fontLibrary.pages);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.flipY = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    this.atlasData = fontLibrary.atlas;
    this.uploaded = fontLibrary.pageVersions.slice();
    return tex;
  }

  /** Upload changed atlas pages; recreate the array texture when pages were added or reset. */
  private syncAtlas() {
    if (fontLibrary.atlas !== this.atlasData) {
      this.atlas.dispose();
      this.atlas = this.makeAtlas();
      for (const node of this.nodes.values()) if (node instanceof TextNode) node.setAtlas(this.atlas);
      return;
    }
    let dirty = false;
    fontLibrary.pageVersions.forEach((v, i) => {
      if (this.uploaded[i] !== v) {
        this.atlas.addLayerUpdate(i);
        this.uploaded[i] = v;
        dirty = true;
      }
    });
    if (dirty) this.atlas.needsUpdate = true;
  }

  stats(): RenderStats {
    const info = this.renderer.info as unknown as { render: { drawCalls: number } };
    return { backend: this.kind, drawCalls: info.render.drawCalls, glyphs: this.lastStats.glyphs, textures: this.textures.size };
  }

  async idle() {
    const device = (this.renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device;
    await device?.queue.onSubmittedWorkDone();
  }

  dispose() {
    this.nodes.forEach((n) => n.dispose());
    this.nodes.clear();
    this.textures.dispose();
    this.bars.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
  }
}
