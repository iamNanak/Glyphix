import * as THREE from 'three/webgpu';
import {
  easingLUT,
  glyphRanks,
  type Color,
  type GradientItem,
  type ImageItem,
  type RenderItem,
  type RenderList,
  type TextItem,
} from '@/doc';
import { assetStore } from '@/assets/assetStore';
import { fontLibrary, type LaidOutGlyph } from '@/text/fontLibrary';
import type { BackendKind, CreateBackendOptions, RenderBackend, RenderStats } from '../backend';
import {
  createGlyphMaterial,
  createGradientMaterial,
  createImageMaterial,
  createShadowMaterial,
  GLYPH_LUT_SIZE,
} from './materials';

const DEG = Math.PI / 180;
const unitPlane = new THREE.PlaneGeometry(1, 1);

const tmpColor = new THREE.Color();

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
  stats: { glyphs: number };
}

// ---------------------------------------------------------------------------

class TextureCache {
  private cache = new Map<string, { tex: THREE.Texture; version: number }>();

  get(assetId: string): THREE.Texture | null {
    const asset = assetStore.get(assetId);
    if (!asset) return null;
    const hit = this.cache.get(assetId);
    if (hit && hit.version === asset.version) return hit.tex;
    hit?.tex.dispose();
    const tex = new THREE.Texture(asset.source as THREE.Texture['image']);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.cache.set(assetId, { tex, version: asset.version });
    return tex;
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

class GradientNode implements LayerNode {
  readonly root: THREE.Mesh;
  private m = createGradientMaterial();

  constructor() {
    this.root = new THREE.Mesh(unitPlane, this.m.mat);
  }

  update(raw: RenderItem, ctx: FrameCtx) {
    const item = raw as GradientItem;
    const { u } = this.m;
    this.root.position.set(ctx.width / 2, -ctx.height / 2, 0);
    this.root.scale.set(ctx.width, ctx.height, 1);
    u.size.value.set(ctx.width, ctx.height);
    u.angle.value = item.angle * DEG;
    u.opacity.value = item.opacity;
    const stops = item.stops.length ? item.stops : [{ offset: 0, color: [0, 0, 0, 1] as Color }];
    const at = (i: number) => stops[Math.min(i, stops.length - 1)]!;
    u.offsets.value.set(at(0).offset, at(1).offset, at(2).offset, at(3).offset);
    [u.c0, u.c1, u.c2, u.c3].forEach((c, i) => setColor(c.value, at(i).color));
  }

  dispose() {
    this.m.mat.dispose();
  }
}

class ImageNode implements LayerNode {
  readonly root = new THREE.Group();
  private image: ReturnType<typeof createImageMaterial> | null = null;
  private imageMesh: THREE.Mesh | null = null;
  private shadow = createShadowMaterial();
  private shadowMesh: THREE.Mesh;
  private boundTexture: THREE.Texture | null = null;

  constructor() {
    this.shadowMesh = new THREE.Mesh(unitPlane, this.shadow.mat);
    this.root.add(this.shadowMesh);
  }

  update(raw: RenderItem, ctx: FrameCtx) {
    const item = raw as ImageItem;
    applyTransform(this.root, item);
    const tex = ctx.textures.get(item.assetId);
    if (tex && tex !== this.boundTexture) {
      if (this.imageMesh) {
        this.root.remove(this.imageMesh);
        this.image!.mat.dispose();
      }
      this.image = createImageMaterial(tex);
      this.imageMesh = new THREE.Mesh(unitPlane, this.image.mat);
      this.root.add(this.imageMesh);
      this.boundTexture = tex;
    }
    if (this.image && this.imageMesh) {
      this.imageMesh.scale.set(item.width, item.height, 1);
      this.image.u.size.value.set(item.width, item.height);
      this.image.u.radius.value = item.radius;
      this.image.u.opacity.value = item.opacity;
      this.imageMesh.visible = !!tex;
    }

    const sh = item.shadow;
    this.shadowMesh.visible = !!sh && item.opacity > 0;
    if (sh) {
      const margin = sh.blur * 2;
      const pw = item.width + margin * 2;
      const ph = item.height + margin * 2;
      this.shadowMesh.position.set(sh.offsetX, -sh.offsetY, 0);
      this.shadowMesh.scale.set(pw, ph, 1);
      const u = this.shadow.u;
      u.planeSize.value.set(pw, ph);
      u.size.value.set(item.width, item.height);
      u.radius.value = item.radius;
      u.blur.value = Math.max(1, sh.blur);
      setColor(u.color.value, sh.color);
      u.alpha.value = sh.color[3] * item.opacity;
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
  private textures = new TextureCache();
  private atlas: THREE.DataTexture;
  private atlasVersion = -1;
  private lastStats = { glyphs: 0 };

  private constructor(
    private renderer: THREE.WebGPURenderer,
    readonly kind: BackendKind,
  ) {
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
    const renderer = new THREE.WebGPURenderer({
      canvas: opts.canvas as HTMLCanvasElement | undefined,
      antialias: true,
      alpha: true,
      forceWebGL: opts.forceWebGL ?? false,
    });
    await renderer.init();
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const backend = renderer.backend as { isWebGPUBackend?: boolean };
    return new ThreeBackend(renderer, backend.isWebGPUBackend ? 'webgpu' : 'webgl2');
  }

  get canvas() {
    return this.renderer.domElement as HTMLCanvasElement | OffscreenCanvas;
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
  }

  render(list: RenderList) {
    if (this.camera.right !== list.width || this.camera.bottom !== -list.height) {
      this.camera.right = list.width;
      this.camera.bottom = -list.height;
      this.camera.updateProjectionMatrix();
    }
    if (fontLibrary.atlasVersion !== this.atlasVersion) {
      this.atlas.needsUpdate = true;
      this.atlasVersion = fontLibrary.atlasVersion;
    }

    const ctx: FrameCtx = { t: list.t, width: list.width, height: list.height, textures: this.textures, atlas: this.atlas, stats: { glyphs: 0 } };
    const seen = new Set<string>();
    list.items.forEach((item, order) => {
      const nodeKey = `${item.kind}:${item.id}`;
      seen.add(nodeKey);
      let node = this.nodes.get(nodeKey);
      if (!node) {
        node = item.kind === 'gradient' ? new GradientNode() : item.kind === 'image' ? new ImageNode() : new TextNode();
        this.nodes.set(nodeKey, node);
        this.scene.add(node.root);
      }
      node.update(item, ctx);
      node.root.traverse((o) => (o.renderOrder = order * 10 + (o === node!.root ? 0 : 1)));
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
    this.renderer.render(this.scene, this.camera);
  }

  stats(): RenderStats {
    const info = this.renderer.info as unknown as { render: { drawCalls: number } };
    return { backend: this.kind, drawCalls: info.render.drawCalls, glyphs: this.lastStats.glyphs, textures: this.textures.size };
  }

  dispose() {
    this.nodes.forEach((n) => n.dispose());
    this.nodes.clear();
    this.textures.dispose();
    this.atlas.dispose();
    this.renderer.dispose();
  }
}
