import { describe, expect, it } from 'vitest';
import { FrameCursor, needsRestart } from './frameCursor';

/** A fake decoded stream of `n` frames at `fps`, starting at `from`, that records opens/closes and pulls. */
function stream(n: number, fps = 30, from = 0) {
  const open = new Set<number>();
  let pulled = 0;
  async function* gen() {
    for (let i = from; i < n; i++) {
      pulled++;
      open.add(i);
      yield { index: i, timestamp: i / fps, close: () => open.delete(i) };
    }
  }
  return { it: gen(), open, pulled: () => pulled };
}

describe('FrameCursor', () => {
  it('holds the last frame starting at or before t, for every frame of a forward sequence', async () => {
    const s = stream(150);
    const c = new FrameCursor(s.it);
    for (let i = 0; i < 150; i++) {
      await c.advance(i / 30);
      expect(c.current?.index).toBe(i);
      expect(s.open.size).toBeLessThanOrEqual(2); // held + one decoded ahead
    }
    expect(s.pulled()).toBe(150);
  });

  it('treats float noise below a frame start as that frame, and mid-frame times as the frame', async () => {
    const c = new FrameCursor(stream(10).it);
    await c.advance(1 / 30 - 4e-4); // millisecond-rounded container timestamp just above the requested time
    expect(c.current?.index).toBe(1);
    await c.advance(3 / 30 - 1e-9);
    expect(c.current?.index).toBe(3);
    await c.advance(4.5 / 30);
    expect(c.current?.index).toBe(4);
  });

  it('does not decode again for the same time and reports no change', async () => {
    const s = stream(10);
    const c = new FrameCursor(s.it);
    expect(await c.advance(0.1)).toBe(true);
    const pulled = s.pulled();
    expect(await c.advance(0.1)).toBe(false);
    expect(s.pulled()).toBe(pulled);
  });

  it('shows the first frame before the stream starts and the last after it ends', async () => {
    const c = new FrameCursor(stream(5, 30, 2).it);
    await c.advance(0);
    expect(c.current?.index).toBe(2);
    await c.advance(99);
    expect(c.current?.index).toBe(4);
  });

  it('closes everything on close(), including a frame that arrives afterwards', async () => {
    const s = stream(10);
    const c = new FrameCursor(s.it);
    await c.advance(0.05);
    c.close();
    expect(s.open.size).toBe(0);
    c.close();
  });
});

describe('needsRestart', () => {
  it('restarts on backward or far-forward jumps, or with nothing held', () => {
    expect(needsRestart(null, 1)).toBe(true);
    expect(needsRestart(1, 1)).toBe(false);
    expect(needsRestart(1, 2.9)).toBe(false);
    expect(needsRestart(1, 3.5)).toBe(true);
    expect(needsRestart(1, 0.9)).toBe(true);
    expect(needsRestart(1, 1 - 1e-9)).toBe(false);
  });
});
