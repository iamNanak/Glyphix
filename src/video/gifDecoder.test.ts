import { describe, expect, it } from 'vitest';
import { countGifFrames, decodeGif, GifError, isGifBytes } from './gifDecoder';

// A minimal GIF writer for fixtures: global palette, per-frame rect, disposal, transparency, interlace, real LZW.
interface F {
  x?: number;
  y?: number;
  w: number;
  h: number;
  /** Palette indices, row-major, in display order (the writer interlaces them when asked). */
  px: number[];
  disposal?: number;
  transparent?: number;
  delayCs?: number;
  interlace?: boolean;
  /** Local colour table (RGB triplets). */
  local?: number[][];
}

function lzw(indices: number[], minCode: number): number[] {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let size = minCode + 1;
  const put = (code: number) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  let dict = new Map<string, number>();
  let next = eoi + 1;
  put(clear);
  let cur: number[] = [];
  const codeOf = (seq: number[]) => (seq.length === 1 ? seq[0]! : dict.get(seq.join(','))!);
  for (const v of indices) {
    const seq = [...cur, v];
    if (seq.length === 1 || dict.has(seq.join(','))) {
      cur = seq;
      continue;
    }
    put(codeOf(cur));
    if (next >= 1 << size && size < 12) size++; // applies from the next code written
    dict.set(seq.join(','), next++);
    if (next === 4096) {
      put(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    cur = [v];
  }
  if (cur.length) put(codeOf(cur));
  put(eoi);
  if (bits > 0) out.push(acc & 255);
  return out;
}

function blocks(data: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

const le = (n: number) => [n & 255, n >> 8];

function interlaced(px: number[], w: number, h: number): number[] {
  const order: number[] = [];
  for (const [s, st] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = s!; y < h; y += st!) order.push(y);
  return order.flatMap((y) => px.slice(y * w, (y + 1) * w));
}

function makeGif(w: number, h: number, palette: number[][], frames: F[], loop?: number): Uint8Array {
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const pad = (p: number[][], n: number) => [...p, ...Array.from({ length: n - p.length }, () => [0, 0, 0])].flat();
  const b: number[] = [...'GIF89a'].map((c) => c.charCodeAt(0));
  b.push(...le(w), ...le(h), 0x80 | (bits - 1), 0, 0, ...pad(palette, 1 << bits));
  if (loop !== undefined) b.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, ...le(loop), 0);
  for (const f of frames) {
    const t = f.transparent;
    b.push(0x21, 0xf9, 4, ((f.disposal ?? 0) << 2) | (t === undefined ? 0 : 1), ...le(f.delayCs ?? 5), t ?? 0, 0);
    const lbits = f.local ? Math.max(1, Math.ceil(Math.log2(f.local.length))) : 0;
    b.push(0x2c, ...le(f.x ?? 0), ...le(f.y ?? 0), ...le(f.w), ...le(f.h), (f.local ? 0x80 | (lbits - 1) : 0) | (f.interlace ? 0x40 : 0));
    if (f.local) b.push(...pad(f.local, 1 << lbits));
    const minCode = Math.max(2, f.local ? lbits : bits);
    b.push(minCode, ...blocks(lzw(f.interlace ? interlaced(f.px, f.w, f.h) : f.px, minCode)));
  }
  b.push(0x3b);
  return Uint8Array.from(b);
}

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];
const PAL = [RED, GREEN, BLUE, WHITE];
const px = (g: ReturnType<typeof decodeGif>, i: number, x: number, y: number) => [...g.frames[i]!.rgba.subarray((y * g.width + x) * 4, (y * g.width + x) * 4 + 4)];

describe('decodeGif', () => {
  it('decodes a single frame with a palette', () => {
    const g = decodeGif(makeGif(2, 2, PAL, [{ w: 2, h: 2, px: [0, 1, 2, 3] }]));
    expect([g.width, g.height, g.frames.length]).toEqual([2, 2, 1]);
    expect(px(g, 0, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(g, 0, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(px(g, 0, 0, 1)).toEqual([0, 0, 255, 255]);
    expect(px(g, 0, 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it('round-trips a large image with long runs and many dictionary entries (code size growth, KwKwK)', () => {
    const w = 64;
    const h = 64;
    const data = Array.from({ length: w * h }, (_, i) => (i < 600 ? 0 : (i * 7 + (i >> 3)) % 4));
    const g = decodeGif(makeGif(w, h, PAL, [{ w, h, px: data }]));
    const got = Array.from({ length: w * h }, (_, i) => PAL.findIndex((c) => c[0] === g.frames[0]!.rgba[i * 4] && c[1] === g.frames[0]!.rgba[i * 4 + 1] && c[2] === g.frames[0]!.rgba[i * 4 + 2]));
    expect(got).toEqual(data);
  });

  it('timing: centiseconds to seconds, 0 and 1 cs become 0.1 s, loop count read', () => {
    const f = (delayCs: number): F => ({ w: 1, h: 1, px: [0], delayCs });
    const g = decodeGif(makeGif(1, 1, PAL, [f(0), f(1), f(2), f(50)], 3));
    expect(g.frames.map((x) => x.duration)).toEqual([0.1, 0.1, 0.02, 0.5]);
    expect(g.frames.map((x) => Number(x.time.toFixed(2)))).toEqual([0, 0.1, 0.2, 0.22]);
    expect(g.duration).toBeCloseTo(0.72);
    expect(g.loopCount).toBe(3);
    expect(decodeGif(makeGif(1, 1, PAL, [f(5)])).loopCount).toBe(0);
  });

  it('disposal 0/1: later frames draw over the previous ones', () => {
    const g = decodeGif(makeGif(2, 1, PAL, [{ w: 2, h: 1, px: [0, 0], disposal: 1 }, { x: 1, w: 1, h: 1, px: [1] }]));
    expect(px(g, 1, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(g, 1, 1, 0)).toEqual([0, 255, 0, 255]);
  });

  it('disposal 2: the frame’s area is cleared to transparent before the next one', () => {
    const g = decodeGif(makeGif(2, 1, PAL, [{ w: 2, h: 1, px: [0, 0], disposal: 2 }, { x: 1, w: 1, h: 1, px: [1] }]));
    expect(px(g, 0, 0, 0)).toEqual([255, 0, 0, 255]); // the frame itself was shown
    expect(px(g, 1, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(g, 1, 1, 0)).toEqual([0, 255, 0, 255]);
  });

  it('disposal 3: restores what was on screen before the frame', () => {
    const g = decodeGif(
      makeGif(2, 1, PAL, [
        { w: 2, h: 1, px: [0, 0], disposal: 1 }, // base: red
        { w: 2, h: 1, px: [2, 2], disposal: 3 }, // blue, then restore
        { x: 1, w: 1, h: 1, px: [1] }, // green over the restored red
      ]),
    );
    expect(px(g, 1, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(px(g, 2, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(g, 2, 1, 0)).toEqual([0, 255, 0, 255]);
  });

  it('transparency keeps what is underneath', () => {
    const g = decodeGif(makeGif(2, 1, PAL, [{ w: 2, h: 1, px: [0, 1], disposal: 1 }, { w: 2, h: 1, px: [3, 2], transparent: 3 }]));
    expect(px(g, 1, 0, 0)).toEqual([255, 0, 0, 255]); // index 3 is see-through
    expect(px(g, 1, 1, 0)).toEqual([0, 0, 255, 255]);
    // On the very first frame it stays transparent.
    const first = decodeGif(makeGif(2, 1, PAL, [{ w: 2, h: 1, px: [3, 0], transparent: 3 }]));
    expect(px(first, 0, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('interlaced images come out in row order', () => {
    const w = 3;
    const h = 11;
    const data = Array.from({ length: w * h }, (_, i) => Math.floor(i / w) % 4);
    const g = decodeGif(makeGif(w, h, PAL, [{ w, h, px: data, interlace: true }]));
    for (let y = 0; y < h; y++) expect(px(g, 0, 1, y).slice(0, 3)).toEqual(PAL[y % 4]);
  });

  it('local colour tables override the global one', () => {
    const g = decodeGif(makeGif(1, 1, PAL, [{ w: 1, h: 1, px: [1], local: [[10, 20, 30], [40, 50, 60]] }]));
    expect(px(g, 0, 0, 0)).toEqual([40, 50, 60, 255]);
  });

  it('sub-rectangles are placed at their offset', () => {
    const g = decodeGif(makeGif(3, 3, PAL, [{ x: 1, y: 2, w: 2, h: 1, px: [2, 3] }]));
    expect(px(g, 0, 1, 2)).toEqual([0, 0, 255, 255]);
    expect(px(g, 0, 2, 2)).toEqual([255, 255, 255, 255]);
    expect(px(g, 0, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('counts frames without decoding', () => {
    const bytes = makeGif(1, 1, PAL, [{ w: 1, h: 1, px: [0] }, { w: 1, h: 1, px: [1] }, { w: 1, h: 1, px: [2] }]);
    expect(countGifFrames(bytes)).toBe(3);
    expect(isGifBytes(bytes)).toBe(true);
  });

  it('rejects junk and empty GIFs with readable errors; keeps frames of a truncated file', () => {
    expect(() => decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(GifError);
    expect(() => decodeGif(makeGif(1, 1, PAL, []))).toThrow(/no frames/);
    const two = makeGif(1, 1, PAL, [{ w: 1, h: 1, px: [0] }, { w: 1, h: 1, px: [1] }]);
    expect(decodeGif(two.subarray(0, two.length - 6)).frames.length).toBe(1);
  });

  it('refuses GIFs that would decode to too much memory', () => {
    const big = makeGif(1, 1, PAL, [{ w: 1, h: 1, px: [0] }]);
    big[6] = 0xff; // width 65535 (low byte)
    big[7] = 0xff;
    big[8] = 0xff; // height 65535
    big[9] = 0xff;
    expect(() => decodeGif(big)).toThrow(/too large/);
  });
});
