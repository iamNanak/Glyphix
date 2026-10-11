import { describe, expect, it } from 'vitest';
import { extractPalette, suggestBackgrounds } from './palette';

function image(colors: [number, number, number][], counts: number[]) {
  const px: number[] = [];
  colors.forEach((c, i) => {
    for (let n = 0; n < counts[i]!; n++) px.push(c[0], c[1], c[2], 255);
  });
  return new Uint8ClampedArray(px);
}

describe('palette', () => {
  it('finds dominant colours ordered by weight', () => {
    const p = extractPalette(image([[20, 20, 30], [120, 80, 255], [255, 255, 255]], [600, 300, 100]), 3);
    expect(p).toHaveLength(3);
    expect(p[0]!.weight).toBeCloseTo(0.6, 1);
    expect(p[1]!.color[2]).toBeGreaterThan(0.9); // the violet
  });
  it('is deterministic', () => {
    const px = image([[10, 200, 30], [200, 10, 30], [30, 30, 200]], [50, 60, 70]);
    expect(extractPalette(px, 3, 7)).toEqual(extractPalette(px, 3, 7));
  });
  it('suggests backgrounds built around the most saturated colour', () => {
    const s = suggestBackgrounds(extractPalette(image([[20, 20, 30], [120, 80, 255]], [900, 100]), 2));
    expect(s.map((f) => f.kind)).toEqual(['linear', 'linear', 'mesh', 'solid']);
    const first = s[0]!;
    expect(first.kind === 'linear' && first.stops[0]!.color[2] > first.stops[0]!.color[1]).toBe(true);
  });
});
