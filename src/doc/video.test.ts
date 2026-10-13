import { describe, expect, it } from 'vitest';
import { audioSegments, createDemoDoc, defaultClip, evaluate, migrate, SCHEMA_VERSION, videoSourceTime, type ImageLayer, type VideoClip } from '.';

const clip = (c: Partial<VideoClip> = {}): VideoClip => ({ start: 1, in: 2, out: 5, loop: false, volume: 1, muted: false, ...c });

describe('video clips', () => {
  it('maps comp time to source time, holding the ends', () => {
    expect(videoSourceTime(clip(), 0)).toBe(2); // before start: first frame
    expect(videoSourceTime(clip(), 2.5)).toBeCloseTo(3.5);
    expect(videoSourceTime(clip(), 10)).toBe(5); // after the end: last frame
  });

  it('loops in both directions', () => {
    const c = clip({ loop: true });
    expect(videoSourceTime(c, 4)).toBeCloseTo(2); // 1 + 3 s = one full loop
    expect(videoSourceTime(c, 4.5)).toBeCloseTo(2.5);
    expect(videoSourceTime(c, 0.5)).toBeCloseTo(4.5); // before start: still looping
  });

  it('default clip loops short sources', () => {
    expect(defaultClip(2, { duration: 5 }).loop).toBe(true);
    expect(defaultClip(8, { duration: 5 })).toMatchObject({ start: 0, in: 0, out: 8, loop: false });
  });

  it('puts the source time into the render list', () => {
    const doc = createDemoDoc();
    const shot = doc.comp.layers.find((l) => l.id === 'shot') as ImageLayer;
    shot.video = clip();
    const item = evaluate(doc, 2).items.find((i) => i.id === 'shot');
    expect(item && item.kind === 'image' && item.video?.time).toBeCloseTo(3);
  });

  it('lists audio segments, clipped to the comp and split per loop', () => {
    const doc = createDemoDoc(); // 5 s comp
    const shot = doc.comp.layers.find((l) => l.id === 'shot') as ImageLayer;
    shot.assetId = 'vid-x';
    shot.video = clip({ start: -1, in: 0, out: 2, loop: true, volume: 0.5 });
    const segs = audioSegments(doc);
    expect(segs.map((s) => [s.compStart, s.duration, s.sourceStart])).toEqual([
      [0, 1, 1],
      [1, 2, 0],
      [3, 2, 0],
    ]);
    expect(segs.every((s) => s.volume === 0.5 && s.assetId === 'vid-x')).toBe(true);
    shot.video.muted = true;
    expect(audioSegments(doc)).toEqual([]);
  });

  it('migrates v4 image layers to video: null', () => {
    const v4 = JSON.parse(JSON.stringify(createDemoDoc())) as { schemaVersion: number; comp: { layers: Record<string, unknown>[] } };
    v4.schemaVersion = 4;
    v4.comp.layers.forEach((l) => delete l.video);
    const doc = migrate(v4);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect((doc.comp.layers.find((l) => l.id === 'shot') as ImageLayer).video).toBeNull();
  });
});
