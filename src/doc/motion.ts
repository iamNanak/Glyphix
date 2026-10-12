// Motion presets. A layer stores *which* preset it uses (data); the pure evaluator turns that
// into modifiers on top of the layer's own properties, or (for text) into a glyph animator that
// the GPU expands per glyph. Nothing is baked into keyframes, so editing stays simple.
import { ease, Easings } from './easing';
import type { Comp, Easing, GlyphAnimator } from './types';

export type EnterPreset =
  // any layer
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'zoom-in'
  | 'pop'
  // images
  | 'tilt-in'
  // text (per glyph, on the GPU)
  | 'rise'
  | 'typewriter'
  | 'cascade'
  | 'scatter';

export type LoopPreset = 'float' | 'ken-burns' | 'wave' | 'pulse';

export interface EnterMotion {
  preset: EnterPreset;
  /** Seconds from comp start. */
  start: number;
  /** Seconds; for per-glyph text presets this is the whole line's duration. */
  duration: number;
  easing: Easing;
}

export interface LoopMotion {
  preset: LoopPreset;
  /** Seconds per cycle. Cycles are seamless (start and end of a cycle match). */
  period: number;
  /** 0..1 strength; each preset maps it to a sensible range. */
  amount: number;
}

export interface Motion {
  enter: EnterMotion | null;
  loop: LoopMotion | null;
}

export const NO_MOTION: Motion = { enter: null, loop: null };

export interface PresetInfo<P extends string> {
  id: P;
  label: string;
  /** Which layer types offer it. */
  for: ('image' | 'text')[];
  easing: Easing;
}

export const ENTER_PRESETS: PresetInfo<EnterPreset>[] = [
  { id: 'fade', label: 'Fade', for: ['image', 'text'], easing: Easings.easeOutCubic },
  { id: 'slide-up', label: 'Slide up', for: ['image', 'text'], easing: Easings.easeOutCubic },
  { id: 'slide-down', label: 'Slide down', for: ['image', 'text'], easing: Easings.easeOutCubic },
  { id: 'slide-left', label: 'Slide left', for: ['image', 'text'], easing: Easings.easeOutCubic },
  { id: 'slide-right', label: 'Slide right', for: ['image', 'text'], easing: Easings.easeOutCubic },
  { id: 'zoom-in', label: 'Zoom in', for: ['image', 'text'], easing: Easings.easeOutCubic },
  { id: 'pop', label: 'Pop', for: ['image', 'text'], easing: Easings.easeOutBack },
  { id: 'tilt-in', label: '3D tilt in', for: ['image'], easing: Easings.easeOutCubic },
  { id: 'rise', label: 'Rise', for: ['text'], easing: Easings.easeOutBack },
  { id: 'typewriter', label: 'Typewriter', for: ['text'], easing: { kind: 'hold' } },
  { id: 'cascade', label: 'Cascade', for: ['text'], easing: Easings.easeOutBack },
  { id: 'scatter', label: 'Scatter', for: ['text'], easing: Easings.easeOutCubic },
];

export const LOOP_PRESETS: PresetInfo<LoopPreset>[] = [
  { id: 'float', label: 'Float', for: ['image', 'text'], easing: Easings.linear },
  { id: 'pulse', label: 'Pulse', for: ['image', 'text'], easing: Easings.linear },
  { id: 'ken-burns', label: 'Ken Burns', for: ['image'], easing: Easings.linear },
  { id: 'wave', label: 'Wave', for: ['text'], easing: Easings.linear },
];

const GLYPH_ENTER = new Set<EnterPreset>(['rise', 'typewriter', 'cascade', 'scatter']);
export const isGlyphPreset = (p: EnterPreset) => GLYPH_ENTER.has(p);

export function defaultEnter(preset: EnterPreset, start = 0): EnterMotion {
  const info = ENTER_PRESETS.find((p) => p.id === preset)!;
  return { preset, start, duration: preset === 'typewriter' ? 1.2 : 0.8, easing: info.easing };
}

export function defaultLoop(preset: LoopPreset, comp: Pick<Comp, 'duration'>): LoopMotion {
  // Ken Burns spans the whole comp so a looping export stays seamless.
  const period = preset === 'ken-burns' ? comp.duration : preset === 'wave' ? 1.6 : 3;
  return { preset, period, amount: 0.5 };
}

// ---------------------------------------------------------------------------

/** What motion does to a layer at time t, on top of its own props. Identity = no change. */
export interface Modifiers {
  dx: number;
  dy: number;
  /** Multiplies the layer's scale. */
  scale: number;
  /** Degrees added to rotation. */
  rotation: number;
  /** Multiplies opacity. */
  opacity: number;
  /** Degrees added to the 3D tilt (images). */
  tiltX: number;
  tiltY: number;
}

export const IDENTITY: Modifiers = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, tiltX: 0, tiltY: 0 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Travel distance for slides, proportional to the comp so presets look the same at any size. */
const slideDistance = (comp: Pick<Comp, 'width' | 'height'>) => 0.09 * Math.min(comp.width, comp.height);

/**
 * Whole-layer modifiers for time t. For text layers, per-glyph enter presets are *not* applied
 * here (see glyphAnimatorFor); their whole-layer part is identity.
 */
export function motionModifiers(motion: Motion, t: number, comp: Pick<Comp, 'width' | 'height'>, layerType: 'image' | 'text'): Modifiers {
  const m = { ...IDENTITY };
  const enter = motion.enter;
  if (enter && !(layerType === 'text' && isGlyphPreset(enter.preset))) {
    const p = enter.duration > 0 ? clamp01((t - enter.start) / enter.duration) : 1;
    const e = ease(enter.easing, p);
    // Opacity follows linear progress (fast-in) so overshooting easings never push it past 1.
    const fadeIn = clamp01(p * 2.5);
    const d = slideDistance(comp);
    switch (enter.preset) {
      case 'fade':
        m.opacity = clamp01(e);
        break;
      case 'slide-up':
        m.dy = (1 - e) * d;
        m.opacity = fadeIn;
        break;
      case 'slide-down':
        m.dy = (e - 1) * d;
        m.opacity = fadeIn;
        break;
      case 'slide-left':
        m.dx = (1 - e) * d;
        m.opacity = fadeIn;
        break;
      case 'slide-right':
        m.dx = (e - 1) * d;
        m.opacity = fadeIn;
        break;
      case 'zoom-in':
        m.scale = mix(0.85, 1, e);
        m.opacity = fadeIn;
        break;
      case 'pop':
        m.scale = mix(0.5, 1, e);
        m.opacity = fadeIn;
        break;
      case 'tilt-in':
        m.tiltX = (1 - e) * 38;
        m.tiltY = (e - 1) * 24;
        m.dy = (1 - e) * d * 0.6;
        m.opacity = fadeIn;
        break;
      default:
        break;
    }
  }
  const loop = motion.loop;
  if (loop && loop.period > 0) {
    const phase = (2 * Math.PI * t) / loop.period;
    const a = loop.amount;
    switch (loop.preset) {
      case 'float':
        m.dy += Math.sin(phase) * mix(4, 28, a) * (Math.min(comp.width, comp.height) / 1080);
        break;
      case 'pulse':
        m.scale *= 1 + (0.5 - 0.5 * Math.cos(phase)) * mix(0.01, 0.08, a);
        break;
      case 'ken-burns':
        // Ping-pong zoom + pan: seamless when the period equals the comp duration.
        m.scale *= 1 + (0.5 - 0.5 * Math.cos(phase)) * mix(0.03, 0.18, a);
        m.dx += Math.sin(phase) * mix(4, 30, a);
        break;
      case 'wave':
        break; // per glyph, in the shader
    }
  }
  return m;
}

/** Visible glyph count as the evaluator sees it (shaping may merge a few; ranks still cover them). */
export const glyphCount = (text: string) => text.replace(/\s/g, '').length;

/**
 * Compile a text enter preset into the GPU glyph animator. `duration` is the whole line: each
 * glyph animates for part of it and the starts are staggered across the rest.
 */
export function glyphAnimatorFor(enter: EnterMotion, text: string): GlyphAnimator | null {
  if (!isGlyphPreset(enter.preset)) return null;
  const n = Math.max(1, glyphCount(text));
  const total = Math.max(0.01, enter.duration);
  const per = (share: number) => total * share;
  const staggerOver = (share: number) => (n > 1 ? (total * (1 - share)) / (n - 1) : 0);
  const base = { start: enter.start, seed: 7, easing: enter.easing };
  switch (enter.preset) {
    case 'rise':
      return { ...base, duration: per(0.45), stagger: staggerOver(0.45), order: 'forward', from: { offsetX: 0, offsetY: 60, scale: 0.6, rotation: 0, opacity: 0 } };
    case 'typewriter':
      // Each glyph appears instantly ('hold'), one after another.
      return { ...base, duration: total / n, stagger: total / n, order: 'forward', easing: { kind: 'hold' }, from: { offsetX: 0, offsetY: 0, scale: 1, rotation: 0, opacity: 0 } };
    case 'cascade':
      return { ...base, duration: per(0.5), stagger: staggerOver(0.5), order: 'center', from: { offsetX: 0, offsetY: -50, scale: 0.4, rotation: -18, opacity: 0 } };
    case 'scatter':
      return { ...base, duration: per(0.55), stagger: staggerOver(0.55), order: 'random', from: { offsetX: 0, offsetY: 0, scale: 2.2, rotation: 40, opacity: 0 } };
    default:
      return null;
  }
}

/** Continuous per-glyph wave (computed in the glyph shader). */
export interface Wave {
  /** Peak vertical offset in px at font scale 1. */
  amplitude: number;
  period: number;
  /** Phase step between neighbouring glyphs, in cycles. */
  spread: number;
}

export function waveFor(loop: LoopMotion | null, fontSize: number): Wave | null {
  if (!loop || loop.preset !== 'wave' || loop.period <= 0) return null;
  return { amplitude: fontSize * mix(0.04, 0.22, loop.amount), period: loop.period, spread: 0.07 };
}
