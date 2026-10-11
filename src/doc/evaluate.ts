import { ease } from './easing';
import { seededPermutation } from './random';
import { frameBarHeight } from './frame';
import type {
  Color,
  CropRect,
  Doc,
  Easing,
  GlyphAnimator,
  BackgroundFill,
  Border,
  Frame,
  Prop,
  Shadow,
  StaggerOrder,
  Transform,
} from './types';

// ---------------------------------------------------------------------------
// RenderList: flat, renderer-agnostic description of one frame.
// ---------------------------------------------------------------------------

export interface ResolvedTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export interface BackgroundItem {
  kind: 'background';
  id: string;
  opacity: number;
  fill: BackgroundFill;
}

export interface ImageItem extends ResolvedTransform {
  kind: 'image';
  id: string;
  assetId: string;
  crop: CropRect;
  width: number;
  height: number;
  opacity: number;
  radius: number;
  shadow: Shadow | null;
  border: Border | null;
  frame: Frame;
  /** Frame bar height in comp px (scale 1); 0 when there's no frame. */
  frameBar: number;
  tilt: { rotateX: number; rotateY: number; perspective: number };
}

export interface TextItem extends ResolvedTransform {
  kind: 'text';
  id: string;
  text: string;
  fontId: string;
  fontSize: number;
  color: Color;
  align: 'left' | 'center' | 'right';
  tracking: number;
  opacity: number;
  glow: number;
  glowColor: Color;
  /** Static animator template; per-glyph expansion happens in the renderer (GPU). */
  animator: GlyphAnimator | null;
}

export type RenderItem = BackgroundItem | ImageItem | TextItem;

export interface RenderList {
  width: number;
  height: number;
  /** Comp time in seconds this list was evaluated at. */
  t: number;
  items: RenderItem[];
}

// ---------------------------------------------------------------------------

export function sampleProp<V extends number>(prop: Prop<V>, t: number): number {
  if ('static' in prop) return prop.static;
  const keys = prop.track.keys;
  if (keys.length === 0) throw new Error('Track has no keyframes');
  const first = keys[0]!;
  if (t <= first.t) return first.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t < b.t) {
      const p = (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * ease(a.out, p);
    }
  }
  return keys[keys.length - 1]!.v;
}

function resolveTransform(tr: Transform, t: number): ResolvedTransform {
  return {
    x: sampleProp(tr.x, t),
    y: sampleProp(tr.y, t),
    scale: sampleProp(tr.scale, t),
    rotation: sampleProp(tr.rotation, t),
  };
}

/** Pure: same (doc, t) → same RenderList. */
export function evaluate(doc: Doc, t: number): RenderList {
  const items: RenderItem[] = [];
  for (const layer of doc.comp.layers) {
    if (!layer.visible) continue;
    const opacity = sampleProp(layer.opacity, t);
    switch (layer.type) {
      case 'background':
        items.push({ kind: 'background', id: layer.id, opacity, fill: layer.fill });
        break;
      case 'image':
        items.push({
          kind: 'image',
          id: layer.id,
          assetId: layer.assetId,
          crop: layer.crop,
          width: layer.width,
          height: layer.height,
          opacity,
          radius: layer.radius,
          shadow: layer.shadow,
          border: layer.border,
          frame: layer.frame,
          frameBar: frameBarHeight(layer),
          tilt: { rotateX: sampleProp(layer.tilt.rotateX, t), rotateY: sampleProp(layer.tilt.rotateY, t), perspective: layer.tilt.perspective },
          ...resolveTransform(layer.transform, t),
        });
        break;
      case 'text':
        items.push({
          kind: 'text',
          id: layer.id,
          text: layer.text,
          fontId: layer.fontId,
          fontSize: layer.fontSize,
          color: layer.color,
          align: layer.align,
          tracking: layer.tracking,
          opacity,
          glow: sampleProp(layer.glow, t),
          glowColor: layer.glowColor,
          animator: layer.animator,
          ...resolveTransform(layer.transform, t),
        });
        break;
    }
  }
  return { width: doc.comp.width, height: doc.comp.height, t, items };
}

// ---------------------------------------------------------------------------
// Glyph animator math. The renderer runs the same formula on the GPU; these
// CPU versions are the reference (tests, hit-testing, future CPU fallback).
// ---------------------------------------------------------------------------

/** Stagger rank for each glyph index. rank 0 starts first. */
export function glyphRanks(count: number, order: StaggerOrder, seed: number): number[] {
  switch (order) {
    case 'forward':
      return Array.from({ length: count }, (_, i) => i);
    case 'reverse':
      return Array.from({ length: count }, (_, i) => count - 1 - i);
    case 'center': {
      const mid = (count - 1) / 2;
      return Array.from({ length: count }, (_, i) => Math.round(Math.abs(i - mid)));
    }
    case 'random': {
      const perm = seededPermutation(count, seed);
      const ranks = new Array<number>(count);
      perm.forEach((glyph, rank) => (ranks[glyph] = rank));
      return ranks;
    }
  }
}

/** Linear (un-eased) progress 0..1 of one glyph at comp time t. */
export function glyphProgress(anim: GlyphAnimator, rank: number, t: number): number {
  if (anim.duration <= 0) return 1;
  const p = (t - anim.start - anim.stagger * rank) / anim.duration;
  return Math.min(1, Math.max(0, p));
}

export const EASING_LUT_SIZE = 256;

/** Easing curve baked into a lookup table so the GPU reproduces any easing (bezier, spring…) exactly. */
export function easingLUT(e: Easing, size = EASING_LUT_SIZE): Float32Array {
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = ease(e, i / (size - 1));
  return lut;
}

/** Last moment any glyph is still animating; useful for auto comp duration. */
export function animatorEnd(anim: GlyphAnimator, glyphCount: number): number {
  return anim.start + anim.stagger * Math.max(0, glyphCount - 1) + anim.duration;
}
