import { describe, expect, it } from 'vitest';
import { applyPatches, createDemoDoc, sampleProp, type ImageLayer } from '@/doc';
import { currentPadding, fitWithPaddingPatches, resizeCompPatches } from './presets';

describe('styling presets', () => {
  it('resizing the canvas scales the layout to fit', () => {
    const doc = createDemoDoc();
    const out = applyPatches(doc, resizeCompPatches(doc, 1080, 1080));
    const shot = out.comp.layers[1] as ImageLayer;
    const k = 1080 / 1920;
    expect(sampleProp(shot.transform.x, 5)).toBeCloseTo(540);
    expect(sampleProp(shot.transform.y, 5)).toBeCloseTo(540 + (640 - 540) * k);
    expect(sampleProp(shot.transform.scale, 5)).toBeCloseTo(k);
    // Card still fits horizontally.
    expect(shot.width * k).toBeLessThan(1080);
  });

  it('fit with padding round-trips through currentPadding', () => {
    const doc = createDemoDoc();
    const out = applyPatches(doc, fitWithPaddingPatches(doc, 1, 120));
    expect(currentPadding(out, out.comp.layers[1] as ImageLayer)).toBe(120);
  });
});
