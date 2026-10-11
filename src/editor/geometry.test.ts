import { describe, expect, it } from 'vitest';
import { createDemoDoc } from '@/doc';
import { aabb, containsPoint, cropFromEdge, hitTest, layerBox, resizeFromEdge, rotationToward, scaleFromCorner, snapMove, type OBox } from './geometry';

const measure = () => ({ width: 400, height: 100 });
const box: OBox = { cx: 100, cy: 100, w: 200, h: 100, rotation: 0 };

describe('geometry', () => {
  it('rotated containment', () => {
    const r = { ...box, rotation: 90 };
    expect(containsPoint(r, { x: 100, y: 190 })).toBe(true); // tall after rotation
    expect(containsPoint(r, { x: 190, y: 100 })).toBe(false);
    const a = aabb(r);
    expect(a.x1 - a.x0).toBeCloseTo(100);
    expect(a.y1 - a.y0).toBeCloseTo(200);
  });

  it('hit-tests topmost unlocked visible layer', () => {
    const doc = createDemoDoc();
    // Headline sits at (960,150); screenshot at (960, 640 after anim).
    expect(hitTest(doc, { x: 960, y: 150 }, 2, measure)?.id).toBe('headline');
    expect(hitTest(doc, { x: 960, y: 640 }, 2, measure)?.id).toBe('shot');
    expect(hitTest(doc, { x: 10, y: 10 }, 2, measure)).toBeNull(); // background is locked
    expect(layerBox(doc.comp.layers[0]!, 0, measure)).toBeNull();
  });

  it('corner scale keeps the opposite corner fixed', () => {
    const r = scaleFromCorner(box, 'se', { x: 400, y: 250 });
    expect(r.factor).toBeCloseTo(2);
    // nw corner stays at (0,50)
    expect(r.cx - (box.w * r.factor) / 2).toBeCloseTo(0);
    expect(r.cy - (box.h * r.factor) / 2).toBeCloseTo(50);
  });

  it('edge resize keeps the opposite edge fixed', () => {
    const r = resizeFromEdge(box, 'e', { x: 300, y: 999 });
    expect(r.w).toBeCloseTo(300);
    expect(r.h).toBe(100);
    expect(r.cx - r.w / 2).toBeCloseTo(0);
  });

  it('rotation handle angle with snapping', () => {
    expect(rotationToward(box, { x: 200, y: 100 })).toBeCloseTo(90);
    expect(rotationToward(box, { x: 100, y: 0 })).toBeCloseTo(0);
    expect(rotationToward(box, { x: 200, y: 92 }, 15)).toBe(90);
  });

  it('snaps edges and centres within threshold', () => {
    const r = snapMove({ x0: 3, y0: 500, x1: 103, y1: 600 }, { xs: [0, 960], ys: [540] }, 6);
    expect(r.dx).toBe(-3);
    expect(r.guidesX).toEqual([0]);
    expect(r.dy).toBe(0); // centre 550 is 10px from 540: beyond the 6px threshold
    expect(r.guidesY).toEqual([]);
  });

  it('cropping the right edge shrinks width without rescaling pixels', () => {
    const start = { crop: { x: 0, y: 0, w: 1, h: 1 }, width: 200, height: 100, box, scale: 1 };
    const r = cropFromEdge(start, 'e', { x: 150, y: 100 });
    expect(r.width).toBeCloseTo(150);
    expect(r.crop.w).toBeCloseTo(0.75);
    expect(r.cx).toBeCloseTo(75); // left edge (0) fixed
    // Can't crop beyond the source.
    expect(cropFromEdge(start, 'e', { x: 900, y: 100 }).width).toBeCloseTo(200);
  });
});
