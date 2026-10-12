import * as THREE from 'three/webgpu';
import {
  easingLUT,
  glyphRanks,
  type Color,
  type BackgroundItem,
  type FrameKind,
  type ImageItem,
  type RenderItem,
  type RenderList,
  type TextItem,
} from '@/doc';
import { assetStore, pickLevel } from '@/assets/assetStore';
import { fontLibrary, type LaidOutGlyph } from '@/text/fontLibrary';
import { drawFrameBar } from '@/styling/frameBar';
import { getSharedDevice } from './gpuDevice';
import type { BackendKind, CreateBackendOptions, RenderBackend, RenderStats, View } from '../backend';
import {
  BG_MODE,
  blankTexture,
  createBackgroundMaterial,
  createGlyphMaterial,
  createImageMaterial,
  createShadowMaterial,
  GLYPH_LUT_SIZE,
  tiltPlane,
} from './materials';

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
  atlas: THREE.DataTexture;
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

class TextNode implements LayerNode {
  readonly root = new THREE.Group();
  private m: ReturnType<typeof createGlyphMaterial> | null = null;
  private mesh: THREE.Mesh | null = null;
  private geom: THREE.InstancedBufferGeometry | null = null;
  private layoutKey = '';
  private lutKey = '';
  private glyphCount = 0;

  update(raw: RenderItem, ctx: FrameCtx) {
    const item = raw as TextItem;
    applyTransform(this.root, item);
    if (!this.m) {
      this.m = createGlyphMaterial(ctx.atlas);
    }
    const anim = item.animator;
    const key = `${item.fontId}|${item.tracking}|${item.align}|${item.text}|${anim?.order}|${anim?.seed}`;
    if (key !== this.layoutKey) {
      const layout = fontLibrary.layout(item.fontId, item.text, item.tracking, item.align);
      if (!layout) {
        this.root.visible = false;
        return;
      }
      this.rebuild(layout.glyphs, item);
      this.layoutKey = key;
    }
    this.root.visible = true;
    ctx.stats.glyphs += this.glyphCount;

    const u = this.m.u;
    u.t.value = ctx.t;
    u.fontSize.value = item.fontSize;
    setColor(u.color.value, item.color);
    u.alpha.value = item.color[3] * item.opacity;
    u.glow.value = item.glow;
    setColor(u.glowColor.value, item.glowColor);
    u.glowAlpha.value = item.glowColor[3] * item.opacity;

    if (anim) {
      u.start.value = anim.start;
      u.duration.value = anim.duration;
      u.stagger.value = anim.stagger;
      // Doc offsets are comp px (y down) at scale 1; glyph space is y-up.
      u.fromOffset.value.set(anim.from.offsetX, -anim.from.offsetY);
      u.fromScale.value = anim.from.scale;
      u.fromRotation.value = -anim.from.rotation * DEG;
      u.fromOpacity.value = anim.from.opacity;
      const lutKey = JSON.stringify(anim.easing);
      if (lutKey !== this.lutKey) {
        const lut = easingLUT(anim.easing, GLYPH_LUT_SIZE);
        const arr = u.lut.array as number[];
        for (let i = 0; i < GLYPH_LUT_SIZE; i++) arr[i] = lut[i]!;
        this.lutKey = lutKey;
      }
    } else {
      // Rest pose.
      u.start.value = -1e6;
      u.duration.value = 1;
      u.stagger.value = 0;
    }
  }

  private rebuild(glyphs: LaidOutGlyph[], item: TextItem) {
    const drawn = glyphs.filter((g) => g.glyph);
    const n = drawn.length;
    const anim = item.animator;
    const ranks = anim ? glyphRanks(n, anim.order, anim.seed) : new Array<number>(n).fill(0);
    const quad = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 4);
    const rank = new Float32Array(n);
    const size = fontLibrary.atlasSize;
    drawn.forEach((g, i) => {
      const a = g.glyph!;
      quad.set([g.x + a.l, g.y + a.b, g.x + a.r, g.y + a.t], i * 4);
      uvs.set([a.ax / size, a.ay / size, a.aw / size, a.ah / size], i * 4);
      rank[i] = ranks[i]!;
    });

    if (this.mesh) {
      this.root.remove(this.mesh);
      this.geom!.dispose();
    }
    const geom = new THREE.InstancedBufferGeometry();
    geom.index = unitPlane.index;
    geom.setAttribute('position', unitPlane.getAttribute('position'));
    geom.setAttribute('uv', unitPlane.getAttribute('uv'));
    geom.setAttribute('aQuad', new THREE.InstancedBufferAttribute(quad, 4));
    geom.setAttribute('aUV', new THREE.InstancedBufferAttribute(uvs, 4));
    geom.setAttribute('aRank', new THREE.InstancedBufferAttribute(rank, 1));
    geom.instanceCount = n;
    const mesh = new THREE.Mesh(geom, this.m!.mat);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.mesh = mesh;
    this.geom = geom;
    this.glyphCount = n;
  }

  dispose() {
    this.geom?.dispose();
    this.m?.mat.dispose();
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
  private atlas: THREE.DataTexture;
  private atlasVersion = -1;
  private lastStats = { glyphs: 0 };

  private constructor(
    private renderer: THREE.WebGPURenderer,
    readonly kind: BackendKind,
    fullResAssets: boolean,
  ) {
    this.textures = new TextureCache(fullResAssets);
    this.atlas = new THREE.DataTexture(fontLibrary.atlas, fontLibrary.atlasSize, fontLibrary.atlasSize, THREE.RedFormat, THREE.UnsignedByteType);
    this.atlas.flipY = false;
    this.atlas.minFilter = THREE.LinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.generateMipmaps = false;
    this.atlas.colorSpace = THREE.NoColorSpace;
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
    if (fontLibrary.atlasVersion !== this.atlasVersion) {
      this.atlas.needsUpdate = true;
      this.atlasVersion = fontLibrary.atlasVersion;
    }

    this.renderer.getDrawingBufferSize(this.bufferSize);
    const ctx: FrameCtx = {
      t: list.t,
      width: list.width,
      height: list.height,
      textures: this.textures,
      atlas: this.atlas,
      pxPerUnit: this.bufferSize.x / (x1 - x0),
      stats: { glyphs: 0 },
    };
    const seen = new Set<string>();
    list.items.forEach((item, order) => {
      const nodeKey = `${item.kind}:${item.id}`;
      seen.add(nodeKey);
      let node = this.nodes.get(nodeKey);
      if (!node) {
        node = item.kind === 'background' ? new BackgroundNode() : item.kind === 'image' ? new ImageNode(this.bars) : new TextNode();
        this.nodes.set(nodeKey, node);
        this.scene.add(node.root);
      }
      node.update(item, ctx);
      // Children may set userData.order (0..9) to stack within their layer.
      node.root.traverse((o) => (o.renderOrder = order * 10 + ((o.userData.order as number | undefined) ?? 0)));
    });
    for (const [key, node] of this.nodes) {
      if (!seen.has(key)) {
        this.scene.remove(node.root);
        node.dispose();
        this.nodes.delete(key);
      }
    }
    // Text layout may have pulled new glyphs into the atlas during update().
    if (fontLibrary.atlasVersion !== this.atlasVersion) {
      this.atlas.needsUpdate = true;
      this.atlasVersion = fontLibrary.atlasVersion;
    }
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
