// Document model: Comp → Layers → (animated) properties.
// Pure data. No renderer, DOM, or framework imports allowed in src/doc/.

import type { Motion } from './motion';

/** Bump when the saved document shape changes, and add a migration in migrations.ts. */
export const SCHEMA_VERSION = 3;

export type Easing =
  | { kind: 'linear' }
  | { kind: 'hold' }
  | { kind: 'bezier'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'spring'; mass: number; stiffness: number; damping: number }
  | { kind: 'steps'; n: number };

export interface Keyframe<V> {
  /** Seconds from comp start. */
  t: number;
  v: V;
  /** Easing used from this keyframe to the next one. */
  out: Easing;
}

export interface Track<V> {
  keys: Keyframe<V>[];
}

/** A property is either a static value or an animated track. */
export type Prop<V> = { static: V } | { track: Track<V> };

export type Color = [r: number, g: number, b: number, a: number];

export interface GradientStop {
  offset: number;
  color: Color;
}

export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: Prop<number>;
}

export interface Transform {
  /** Center position in comp pixels (origin top-left, y down). */
  x: Prop<number>;
  y: Prop<number>;
  scale: Prop<number>;
  /** Degrees, clockwise. */
  rotation: Prop<number>;
}

export interface MeshPoint {
  /** Position in comp-normalised coords (0..1). */
  x: number;
  y: number;
  color: Color;
}

export type BackgroundFill =
  | { kind: 'solid'; color: Color }
  /** angle in degrees (0 = left→right, 90 = top→bottom); up to 4 stops are rendered. */
  | { kind: 'linear'; angle: number; stops: GradientStop[] }
  /** Smoothly blended colour points (up to 4). */
  | { kind: 'mesh'; points: MeshPoint[] }
  /** Image covering the comp, optionally blurred and dimmed. */
  | { kind: 'image'; assetId: string; blur: number; dim: number };

export interface BackgroundLayer extends LayerBase {
  type: 'background';
  fill: BackgroundFill;
}

export interface Shadow {
  blur: number;
  offsetX: number;
  offsetY: number;
  color: Color;
}

/** Rectangle in source-normalised coordinates (0..1, origin top-left). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

export type FrameKind = 'none' | 'macos-light' | 'macos-dark' | 'browser-light' | 'browser-dark';

export interface Frame {
  kind: FrameKind;
  /** Shown in the browser address bar. */
  url: string;
}

export interface Border {
  width: number;
  color: Color;
}

/** 3D tilt of a flat layer, degrees. Perspective distance in comp px. */
export interface Tilt {
  rotateX: Prop<number>;
  rotateY: Prop<number>;
  perspective: number;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: string;
  crop: CropRect;
  /** Displayed size of the (cropped) image in comp pixels, before transform.scale. Excludes the frame bar. */
  width: number;
  height: number;
  transform: Transform;
  radius: number;
  shadow: Shadow | null;
  border: Border | null;
  frame: Frame;
  tilt: Tilt;
  motion: Motion;
}

export const NO_FRAME: Frame = { kind: 'none', url: '' };
export const NO_TILT: Tilt = { rotateX: { static: 0 }, rotateY: { static: 0 }, perspective: 2400 };

export type StaggerOrder = 'forward' | 'reverse' | 'center' | 'edges' | 'random';

/** What one animator step moves: single glyphs, whole words, or whole lines. */
export type GlyphUnit = 'glyph' | 'word' | 'line';

/**
 * How far a glyph is from its rest pose when an animator is fully "away" (k = 1).
 * Identity values (offset 0, scale 1, opacity 1, spread 1, …) mean "no change".
 */
export interface GlyphPose {
  /** Comp px at layer scale 1 (y down). */
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 3D flip around the unit's horizontal / vertical axis, degrees. */
  rotateX: number;
  rotateY: number;
  /** Horizontal shear, degrees. */
  skewX: number;
  opacity: number;
  /** Edge softness in em (0..0.25). */
  blur: number;
  /** Multiplies each unit's distance from the block centre (1 = none; >1 starts spread out). */
  spread: number;
  /** Tint the glyphs towards this colour while away; null = no tint. */
  color: Color | null;
  /** Random-direction offset (px) and random rotation (±deg), per unit, seeded. */
  randomOffset: number;
  randomRotation: number;
  /** Show random characters while away (a "decode" effect). */
  scramble: boolean;
}

export const REST_POSE: GlyphPose = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  rotateX: 0,
  rotateY: 0,
  skewX: 0,
  opacity: 1,
  blur: 0,
  spread: 1,
  color: null,
  randomOffset: 0,
  randomRotation: 0,
  scramble: false,
};

/**
 * After Effects-style glyph animator: ONE template applied to every unit (glyph / word / line).
 * Unit i starts at `start + delay(rank(i))` and moves between `pose` and rest over `duration`.
 * delay(r) = stagger · (n−1) · falloff(r / (n−1)): a linear falloff spaces the starts evenly.
 */
export interface GlyphAnimator {
  unit: GlyphUnit;
  order: StaggerOrder;
  start: number;
  duration: number;
  stagger: number;
  falloff: Easing;
  seed: number;
  easing: Easing;
  pose: GlyphPose;
}

export interface TextOutline {
  /** Comp px at layer scale 1; limited to about a fifth of the font size. */
  width: number;
  color: Color;
}

export interface TextShadow {
  offsetX: number;
  offsetY: number;
  /** Softness in px; limited to about a fifth of the font size. */
  blur: number;
  color: Color;
}

/** Linear gradient across the text block; replaces the solid colour when set. */
export interface TextGradient {
  /** Degrees (0 = left→right, 90 = top→bottom). */
  angle: number;
  from: Color;
  to: Color;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontId: string;
  /** CSS weight (100..900); clamped to what the font offers. */
  weight: number;
  fontSize: number;
  /** Multiple of the font's natural line height. */
  lineHeight: number;
  color: Color;
  gradient: TextGradient | null;
  outline: TextOutline | null;
  shadow: TextShadow | null;
  align: 'left' | 'center' | 'right';
  /** Extra space between glyphs, in em. */
  tracking: number;
  transform: Transform;
  /** Custom per-glyph animator; a glyph enter preset in `motion` takes precedence. */
  animator: GlyphAnimator | null;
  motion: Motion;
  /** SDF glow strength 0..1 (animatable). */
  glow: Prop<number>;
  glowColor: Color;
}

export type Layer = BackgroundLayer | ImageLayer | TextLayer;

export interface Comp {
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  fps: number;
  /** Bottom-most first. */
  layers: Layer[];
}

export interface Doc {
  schemaVersion: number;
  id: string;
  name: string;
  comp: Comp;
}
