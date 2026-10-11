import { describe, expect, it } from 'vitest';
import { coverageToSDF } from './sdf';

describe('coverageToSDF', () => {
  it('is > 128 inside the shape and < 128 outside', () => {
    const w = 32, h = 32;
    const a = new Uint8Array(w * h);
    for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) a[y * w + x] = 255;
    const sdf = coverageToSDF(a, w, h, 8);
    expect(sdf[16 * w + 16]).toBeGreaterThan(200);
    expect(sdf[2 * w + 2]).toBeLessThan(30);
    expect(Math.abs(sdf[16 * w + 10]! - 128)).toBeLessThan(24);
  });
});
