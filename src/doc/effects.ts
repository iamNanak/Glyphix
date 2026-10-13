// Effects: a stack of GPU passes on a layer, or on everything below an adjustment layer.
// The registry is the single source of truth for each effect's parameters: their ranges and
// defaults drive the UI, new effects, and the renderer's uniforms.
import type { Color, Effect, EffectKind, Prop } from './types';

export interface EffectParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Shown after the value (px, °, %…). */
  unit?: string;
  /** Rendered as an on/off switch (0 or 1). */
  toggle?: boolean;
  /** Shown as 0–100 % (value is 0..1 or −1..1). */
  percent?: boolean;
}

export interface EffectColorDef {
  key: string;
  label: string;
  default: Color;
}

export interface EffectDef {
  kind: EffectKind;
  label: string;
  /** One line for the add menu. */
  description: string;
  params: EffectParamDef[];
  colors: EffectColorDef[];
}

const p = (key: string, label: string, min: number, max: number, def: number, step = 1, extra: Partial<EffectParamDef> = {}): EffectParamDef => ({
  key,
  label,
  min,
  max,
  step,
  default: def,
  ...extra,
});

export const EFFECTS: readonly EffectDef[] = [
  {
    kind: 'blur',
    label: 'Blur',
    description: 'Gaussian blur',
    params: [p('radius', 'Radius', 0, 200, 12, 0.5, { unit: 'px' })],
    colors: [],
  },
  {
    kind: 'glow',
    label: 'Glow',
    description: 'Soft light around bright parts',
    params: [
      p('radius', 'Radius', 1, 200, 24, 0.5, { unit: 'px' }),
      p('intensity', 'Intensity', 0, 4, 1.2, 0.05),
      p('threshold', 'Threshold', 0, 1, 0, 0.01, { percent: true }),
    ],
    colors: [{ key: 'color', label: 'Glow colour', default: [1, 1, 1, 1] }],
  },
  {
    kind: 'shadow',
    label: 'Drop shadow',
    description: 'Blurred shadow from the layer’s shape',
    params: [
      p('offsetX', 'Offset X', -200, 200, 0, 1, { unit: 'px' }),
      p('offsetY', 'Offset Y', -200, 200, 12, 1, { unit: 'px' }),
      p('blur', 'Blur', 0, 200, 16, 0.5, { unit: 'px' }),
      p('opacity', 'Opacity', 0, 1, 0.6, 0.01, { percent: true }),
    ],
    colors: [{ key: 'color', label: 'Shadow colour', default: [0, 0, 0, 1] }],
  },
  {
    kind: 'grain',
    label: 'Grain',
    description: 'Film grain noise',
    params: [
      p('amount', 'Amount', 0, 1, 0.12, 0.01, { percent: true }),
      p('size', 'Size', 1, 8, 1.5, 0.1, { unit: 'px' }),
      p('animated', 'Animated', 0, 1, 1, 1, { toggle: true }),
    ],
    colors: [],
  },
  {
    kind: 'displace',
    label: 'Displace',
    description: 'Wavy, liquid distortion',
    params: [
      p('amount', 'Amount', 0, 200, 20, 0.5, { unit: 'px' }),
      p('scale', 'Scale', 10, 1000, 220, 1, { unit: 'px' }),
      p('speed', 'Speed', 0, 4, 0.5, 0.05),
    ],
    colors: [],
  },
  {
    kind: 'glitch',
    label: 'Glitch',
    description: 'Digital slices and colour tears',
    params: [
      p('amount', 'Amount', 0, 1, 0.5, 0.01, { percent: true }),
      p('blockSize', 'Block size', 4, 200, 36, 1, { unit: 'px' }),
      p('speed', 'Speed', 0, 30, 8, 0.5, { unit: '/s' }),
      p('split', 'Colour split', 0, 60, 10, 0.5, { unit: 'px' }),
    ],
    colors: [],
  },
  {
    kind: 'rgbSplit',
    label: 'RGB split',
    description: 'Offset red and blue channels',
    params: [p('amount', 'Amount', 0, 60, 6, 0.5, { unit: 'px' }), p('angle', 'Angle', 0, 360, 0, 1, { unit: '°' })],
    colors: [],
  },
  {
    kind: 'gradientMap',
    label: 'Gradient map',
    description: 'Recolour by brightness',
    params: [p('mix', 'Mix', 0, 1, 1, 0.01, { percent: true })],
    colors: [
      { key: 'dark', label: 'Shadows colour', default: [0.12, 0.05, 0.35, 1] },
      { key: 'light', label: 'Highlights colour', default: [1, 0.78, 0.45, 1] },
    ],
  },
  {
    kind: 'dissolve',
    label: 'Dissolve',
    description: 'Burn away with a noisy edge',
    params: [
      p('progress', 'Progress', 0, 1, 0.4, 0.01, { percent: true }),
      p('scale', 'Noise scale', 2, 300, 40, 1, { unit: 'px' }),
      p('edge', 'Edge width', 0, 1, 0.08, 0.01, { percent: true }),
    ],
    colors: [{ key: 'color', label: 'Edge colour', default: [1, 0.55, 0.15, 1] }],
  },
  {
    kind: 'pixelate',
    label: 'Pixelate',
    description: 'Big square pixels',
    params: [p('size', 'Cell size', 1, 200, 16, 1, { unit: 'px' })],
    colors: [],
  },
  {
    kind: 'vignette',
    label: 'Vignette',
    description: 'Darken the edges of the canvas',
    params: [
      p('amount', 'Amount', 0, 1, 0.5, 0.01, { percent: true }),
      p('size', 'Size', 0, 1, 0.55, 0.01, { percent: true }),
      p('softness', 'Softness', 0.01, 1, 0.5, 0.01, { percent: true }),
    ],
    colors: [{ key: 'color', label: 'Vignette colour', default: [0, 0, 0, 1] }],
  },
  {
    kind: 'colorAdjust',
    label: 'Colour adjust',
    description: 'Brightness, contrast, saturation, hue',
    params: [
      p('brightness', 'Brightness', -1, 1, 0, 0.01, { percent: true }),
      p('contrast', 'Contrast', -1, 1, 0, 0.01, { percent: true }),
      p('saturation', 'Saturation', -1, 1, 0, 0.01, { percent: true }),
      p('hue', 'Hue', -180, 180, 0, 1, { unit: '°' }),
    ],
    colors: [],
  },
];

const BY_KIND = new Map(EFFECTS.map((d) => [d.kind, d]));

export function effectDef(kind: EffectKind): EffectDef {
  const d = BY_KIND.get(kind);
  if (!d) throw new Error(`Unknown effect ${kind}`);
  return d;
}

export function createEffect(kind: EffectKind): Effect {
  const d = effectDef(kind);
  return {
    id: `fx-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    enabled: true,
    params: Object.fromEntries(d.params.map((q) => [q.key, { static: q.default } as Prop<number>])),
    colors: Object.fromEntries(d.colors.map((c) => [c.key, [...c.default] as Color])),
  };
}

/** An effect with every parameter sampled at one time. Missing params fall back to defaults. */
export interface ResolvedEffect {
  kind: EffectKind;
  params: Record<string, number>;
  colors: Record<string, Color>;
}

export function resolveEffects(effects: readonly Effect[], t: number, sample: (p: Prop<number>, t: number) => number): ResolvedEffect[] {
  const out: ResolvedEffect[] = [];
  for (const e of effects) {
    if (!e.enabled) continue;
    const d = BY_KIND.get(e.kind);
    if (!d) continue; // from a newer version: skip rather than fail
    const params: Record<string, number> = {};
    for (const q of d.params) {
      const prop = e.params[q.key];
      params[q.key] = prop ? sample(prop, t) : q.default;
    }
    const colors: Record<string, Color> = {};
    for (const c of d.colors) colors[c.key] = e.colors[c.key] ?? c.default;
    out.push({ kind: e.kind, params, colors });
  }
  return out;
}

/** True when an effect does nothing at these settings (skipped by the renderer). */
export function isNoOp(e: ResolvedEffect): boolean {
  const q = e.params;
  switch (e.kind) {
    case 'blur':
      return q.radius! < 0.25;
    case 'glow':
      return q.intensity! <= 0;
    case 'shadow':
      return q.opacity! <= 0;
    case 'grain':
    case 'glitch':
    case 'vignette':
      return q.amount! <= 0;
    case 'displace':
    case 'rgbSplit':
      return q.amount! <= 0;
    case 'gradientMap':
      return q.mix! <= 0;
    case 'dissolve':
      return q.progress! <= 0;
    case 'pixelate':
      return q.size! <= 1;
    case 'colorAdjust':
      return q.brightness === 0 && q.contrast === 0 && q.saturation === 0 && q.hue === 0;
  }
}
