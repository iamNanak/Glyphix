// Document model: Comp → Layers → (animated) properties.
// Pure data. No renderer, DOM, or framework imports allowed in src/doc/.

export const SCHEMA_VERSION = 1;

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

export interface BackgroundLayer extends LayerBase {
  type: 'background';
  /** Linear gradient angle in degrees (0 = left→right, 90 = top→bottom). */
  angle: Prop<number>;
  stops: GradientStop[];
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

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: string;
  crop: CropRect;
  /** Displayed size of the (cropped) image in comp pixels, before transform.scale. */
  width: number;
  height: number;
  transform: Transform;
  radius: number;
  shadow: Shadow | null;
}

export type StaggerOrder = 'forward' | 'reverse' | 'center' | 'random';

/**
 * After Effects-style glyph animator: ONE template applied to every glyph.
 * glyph i starts at `start + stagger * rank(i)` and animates "from" values → rest pose over `duration`.
 */
export interface GlyphAnimator {
  start: number;
  duration: number;
  stagger: number;
  order: StaggerOrder;
  seed: number;
  easing: Easing;
  from: {
    offsetX: number;
    offsetY: number;
    scale: number;
    rotation: number;
    opacity: number;
  };
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontId: string;
  fontSize: number;
  color: Color;
  align: 'left' | 'center' | 'right';
  /** Extra space between glyphs, in em. */
  tracking: number;
  transform: Transform;
  animator: GlyphAnimator | null;
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
