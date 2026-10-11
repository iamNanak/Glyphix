import { describe, expect, it } from 'vitest';
import { pickLevel, type Asset } from './assetStore';

const asset = (widths: number[]): Asset => ({
  id: 'a',
  levels: widths.map((w) => ({ source: {} as ImageBitmap, width: w, height: w / 2 })),
  width: widths[0]!,
  height: widths[0]! / 2,
  blob: null,
  version: 1,
});

describe('pickLevel', () => {
  const a = asset([3840, 1920, 960]);
  it('picks the smallest proxy that still covers the on-screen width', () => {
    expect(pickLevel(a, 800)).toBe(2);
    expect(pickLevel(a, 961)).toBe(1);
    expect(pickLevel(a, 1920)).toBe(1);
    expect(pickLevel(a, 2000)).toBe(0);
  });
  it('falls back to full res without proxies', () => {
    expect(pickLevel(asset([500]), 100)).toBe(0);
  });
});
