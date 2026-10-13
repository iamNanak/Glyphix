import { describe, expect, it } from 'vitest';
import { ASCII_CELL, asciiAtlas, CHARSETS, EDGE_CHARS, LUT_SIZE, rasterizeGlyph } from './asciiAtlas';

describe('ASCII atlas', () => {
  it('measures plausible coverage: space is empty, blocks are 25/50/75/100 %', () => {
    const blocks = asciiAtlas(1);
    const cov = Object.fromEntries(blocks.chars.slice(0, blocks.count).map((c, i) => [c, blocks.coverage[i]!]));
    expect(cov[' ']).toBe(0);
    expect(cov['░']).toBeCloseTo(0.25, 1);
    expect(cov['▒']).toBeCloseTo(0.5, 1);
    expect(cov['▓']).toBeCloseTo(0.75, 1);
    expect(cov['█']).toBeGreaterThan(0.99);
  });

  it('builds every charset: sorted by coverage, edge glyphs last, monotonic LUT spanning the set', () => {
    CHARSETS.forEach((cs, id) => {
      const a = asciiAtlas(id);
      expect(a.count).toBe(new Set(cs).size);
      expect(a.chars.slice(a.count).join('')).toBe(EDGE_CHARS);
      const cov = a.coverage.slice(0, a.count);
      for (let i = 1; i < cov.length; i++) expect(cov[i]!).toBeGreaterThanOrEqual(cov[i - 1]!);
      expect(a.lut).toHaveLength(LUT_SIZE);
      expect(a.lut[0]).toBe(0);
      expect(a.lut[LUT_SIZE - 1]).toBe(a.count - 1);
      for (let k = 1; k < LUT_SIZE; k++) expect(a.lut[k]!).toBeGreaterThanOrEqual(a.lut[k - 1]!);
      // Mips are box filtered: the 1-texel-per-glyph level holds each glyph's coverage.
      const lvl = a.mips[Math.log2(ASCII_CELL)]!;
      a.coverage.forEach((c, i) => expect(lvl.data[Math.floor(i / 16) * lvl.width + (i % 16)]! / 255).toBeCloseTo(c, 1));
    });
  });

  it('calibrates linearly: the chosen glyph coverage tracks brightness', () => {
    const a = asciiAtlas(2); // detailed: dense enough to follow brightness closely
    const max = a.coverage[a.count - 1]!;
    for (let k = 0; k < LUT_SIZE; k += 15) expect(Math.abs(a.coverage[a.lut[k]!]! / max - k / (LUT_SIZE - 1))).toBeLessThan(0.08);
  });

  it('rasterises deterministically', () => {
    expect(rasterizeGlyph('@')).toEqual(rasterizeGlyph('@'));
  });
});
