// Font registry: bundled OFL families (files + licenses in /public/fonts) and user-uploaded fonts.
// Pure data + small helpers; the shaping/atlas side lives in fontLibrary.ts.
import { FONT_ASSET_PREFIX } from '@/doc/assets';

export type FontCategory = 'sans' | 'serif' | 'display' | 'mono' | 'handwriting';

export interface WeightRange {
  min: number;
  max: number;
  default: number;
}

export interface FontInfo {
  id: string;
  family: string;
  category: FontCategory;
  /** null for static (single-weight) fonts. */
  weights: WeightRange | null;
  /** Bundled fonts only. */
  url?: string;
  /** User fonts: true when the bytes came from an upload (stored as a project asset). */
  user?: boolean;
}

const bundled = (id: string, family: string, file: string, category: FontCategory, weights: [number, number, number] | null): FontInfo => ({
  id,
  family,
  category,
  url: `/fonts/${file}`,
  weights: weights && { min: weights[0], default: weights[1], max: weights[2] },
});

/** Bundled families. Axis ranges were read from the files (fvar). */
export const BUNDLED_FONTS: FontInfo[] = [
  bundled('inter', 'Inter', 'Inter.ttf', 'sans', [100, 400, 900]),
  bundled('geist', 'Geist', 'Geist.ttf', 'sans', [100, 400, 900]),
  bundled('space-grotesk', 'Space Grotesk', 'SpaceGrotesk.ttf', 'sans', [300, 400, 700]),
  bundled('manrope', 'Manrope', 'Manrope.ttf', 'sans', [200, 400, 800]),
  bundled('bricolage', 'Bricolage Grotesque', 'BricolageGrotesque.ttf', 'display', [200, 600, 800]),
  bundled('unbounded', 'Unbounded', 'Unbounded.ttf', 'display', [200, 500, 900]),
  bundled('syne', 'Syne', 'Syne.ttf', 'display', [400, 600, 800]),
  bundled('anton', 'Anton', 'Anton.ttf', 'display', null),
  bundled('bebas', 'Bebas Neue', 'BebasNeue.ttf', 'display', null),
  bundled('instrument-serif', 'Instrument Serif', 'InstrumentSerif.ttf', 'serif', null),
  bundled('fraunces', 'Fraunces', 'Fraunces.ttf', 'serif', [100, 500, 900]),
  bundled('playfair', 'Playfair Display', 'PlayfairDisplay.ttf', 'serif', [400, 600, 900]),
  bundled('jetbrains-mono', 'JetBrains Mono', 'JetBrainsMono.ttf', 'mono', [100, 400, 800]),
  bundled('geist-mono', 'Geist Mono', 'GeistMono.ttf', 'mono', [100, 400, 900]),
  bundled('caveat', 'Caveat', 'Caveat.ttf', 'handwriting', [400, 500, 700]),
];

export const DEFAULT_FONT_ID = 'inter';
export const CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: 'Sans serif',
  serif: 'Serif',
  display: 'Display',
  mono: 'Monospace',
  handwriting: 'Handwriting',
};

const bundledById = new Map(BUNDLED_FONTS.map((f) => [f.id, f]));
export const bundledFont = (id: string) => bundledById.get(id);

/** Uploaded fonts are assets: content-hash ids with the `font-` prefix. */
export const isUserFontId = (id: string) => id.startsWith(FONT_ASSET_PREFIX);

/** The weight a font actually renders at: clamped to its axis, rounded; static fonts ignore it. */
export function effectiveWeight(info: Pick<FontInfo, 'weights'> | undefined, weight: number): number {
  const w = info?.weights;
  if (!w) return 400;
  return Math.round(Math.min(w.max, Math.max(w.min, weight)));
}

/** Standard CSS weight names, for menus. */
export const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

/** Named weights a font offers (multiples of 100 inside its axis). */
export function namedWeights(info: Pick<FontInfo, 'weights'> | undefined): number[] {
  const w = info?.weights;
  if (!w) return [400];
  const out: number[] = [];
  for (let v = Math.ceil(w.min / 100) * 100; v <= w.max; v += 100) out.push(v);
  return out;
}
