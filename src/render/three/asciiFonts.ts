// Fonts for the ASCII effect: which outlines an effect's glyph atlas is built from. The built-in font is the
// embedded JetBrains Mono 500 (synchronous); characters it doesn't embed, and every other font, come from the
// app's font library once that font has loaded (the backend's prepare() waits for it).
import { ASCII_BUILTIN_FONT } from '@/doc';
import { fontLibrary } from '@/text/fontLibrary';
import { effectiveWeight } from '@/text/fonts';
import { BUILTIN_FONT, charsetGlyphs, EDGE_CHARS, type OutlineFont } from './asciiAtlas';
import { ASCII_GLYPHS } from './asciiGlyphs';

/** Library font that backs the built-in one for characters it doesn't embed. */
const BUILTIN_LIBRARY_ID = 'jetbrains-mono';
const BUILTIN_WEIGHT = 500;

/** A missing (unknown or broken) font falls back to the built-in one. */
const usable = (fontId: string) => (fontId === ASCII_BUILTIN_FONT || fontLibrary.isMissing(fontId) ? ASCII_BUILTIN_FONT : fontId);

const embedsAll = (charset: string) => [...charsetGlyphs(charset), ...EDGE_CHARS].every((ch) => ch === ' ' || ch in ASCII_GLYPHS);

/** Library fonts that must be loaded before the effect can draw with this font + charset. */
export function asciiFontsNeeded(fontId: string, charset: string): string[] {
  const id = usable(fontId);
  if (id !== ASCII_BUILTIN_FONT) return [id];
  return embedsAll(charset) ? [] : [BUILTIN_LIBRARY_ID];
}

const fonts = new Map<string, OutlineFont>();

/** The outlines for an effect, or null while a font it needs is still loading (loading is started). */
export function asciiFont(fontId: string, weight: number, charset: string): OutlineFont | null {
  const id = usable(fontId);
  if (id === ASCII_BUILTIN_FONT && embedsAll(charset)) return BUILTIN_FONT;
  const libId = id === ASCII_BUILTIN_FONT ? BUILTIN_LIBRARY_ID : id;
  const w = id === ASCII_BUILTIN_FONT ? BUILTIN_WEIGHT : effectiveWeight(fontLibrary.info(id), weight);
  const key = `${id || 'builtin'}@${w}`;
  const cached = fonts.get(key);
  if (cached) return cached;
  const m = fontLibrary.outline(libId, w, 'M');
  if (!m) {
    if (!fontLibrary.isMissing(libId)) void fontLibrary.load(libId).catch(() => undefined);
    return null;
  }
  const lib = (ch: string) => {
    const o = fontLibrary.outline(libId, w, ch);
    return o?.found ? o.path : null;
  };
  const font: OutlineFont =
    id === ASCII_BUILTIN_FONT
      ? { ...BUILTIN_FONT, key, outline: (ch) => ASCII_GLYPHS[ch] ?? lib(ch) }
      : { key, upem: m.upem, advance: m.advance || m.upem * 0.6, ascender: m.ascender, descender: m.descender, outline: lib };
  fonts.set(key, font);
  return font;
}
