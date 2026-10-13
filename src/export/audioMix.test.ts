import { describe, expect, it } from 'vitest';
import { fadeEnvelope, placeChunk, sampleCount } from './audioMix';
import { sequenceFrameName } from './exporter';

describe('audio mix sample math', () => {
  it('counts samples, never zero', () => {
    expect(sampleCount(5, 48000)).toBe(240000);
    expect(sampleCount(1 / 30, 48000)).toBe(1600);
    expect(sampleCount(0, 48000)).toBe(1);
  });

  it('trims a chunk that starts before the segment', () => {
    // Segment reads source 1.0 s.. (100 samples at 100 Hz); the decoder's chunk starts at 0.9 s.
    expect(placeChunk(0.9, 50, 1.0, 100, 100)).toEqual({ srcOffset: 10, destOffset: 0, count: 40 });
  });

  it('places a chunk inside the segment', () => {
    expect(placeChunk(1.25, 20, 1.0, 100, 100)).toEqual({ srcOffset: 0, destOffset: 25, count: 20 });
  });

  it('trims a chunk that runs past the end, and skips chunks outside', () => {
    expect(placeChunk(1.9, 50, 1.0, 100, 100)).toEqual({ srcOffset: 0, destOffset: 90, count: 10 });
    expect(placeChunk(2.5, 50, 1.0, 100, 100).count).toBeLessThanOrEqual(0);
    expect(placeChunk(0, 50, 1.0, 100, 100).count).toBeLessThanOrEqual(0);
  });

  it('fades every segment edge, at its volume', () => {
    expect(fadeEnvelope({ compStart: 1, duration: 2, volume: 0.5 }, 0.005)).toEqual([
      [1, 0],
      [1.005, 0.5],
      [2.995, 0.5],
      [3, 0],
    ]);
  });

  it('shortens fades on very short segments so they never cross', () => {
    const env = fadeEnvelope({ compStart: 0, duration: 0.004, volume: 1 }, 0.005);
    expect(env[1]![0]).toBeCloseTo(0.002);
    expect(env[2]![0]).toBeCloseTo(0.002);
  });
});

describe('PNG sequence naming', () => {
  it('zero-pads to five digits, in order', () => {
    expect(sequenceFrameName(0)).toBe('frame-00000.png');
    expect(sequenceFrameName(149)).toBe('frame-00149.png');
    expect(sequenceFrameName(123456)).toBe('frame-123456.png');
  });
});
