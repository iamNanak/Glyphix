// Animated GIF decoder (GIF87a / GIF89a), pure JS: LZW, interlacing, local/global colour tables, the
// graphic control extension (delay, disposal, transparency). Frames come back fully composited onto the
// logical screen as RGBA, so a consumer just draws frame i. Runs on untrusted files: every length is
// bounds-checked and decoded size is capped.

export class GifError extends Error {}

export interface GifFrame {
  /** Composited RGBA of the whole logical screen (straight alpha). */
  rgba: Uint8ClampedArray<ArrayBuffer>;
  /** Start and length on the GIF's own timeline (s). */
  time: number;
  duration: number;
}

export interface Gif {
  width: number;
  height: number;
  frames: GifFrame[];
  /** Sum of all frame durations (s). */
  duration: number;
  /** Times the animation repeats after the first play; 0 = forever (also when the file has no loop block). */
  loopCount: number;
}

/** Refuse GIFs whose decoded frames would take more memory than this. */
export const MAX_GIF_DECODED_BYTES = 300 * 1024 * 1024;
/** Browser convention: delays of 0 or 1 centisecond play at 10 cs. */
const DEFAULT_DELAY_CS = 10;

export const isGifBytes = (b: Uint8Array) => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;

interface Reader {
  b: Uint8Array;
  p: number;
}
const u8 = (r: Reader) => {
  if (r.p >= r.b.length) throw new GifError('This GIF is cut off.');
  return r.b[r.p++]!;
};
const u16 = (r: Reader) => u8(r) | (u8(r) << 8);

/** Skip a chain of data sub-blocks. */
function skipBlocks(r: Reader) {
  for (let n = u8(r); n > 0; n = u8(r)) r.p += n;
}

/** Concatenate a chain of data sub-blocks. */
function readBlocks(r: Reader): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let n = u8(r); n > 0; n = u8(r)) {
    if (r.p + n > r.b.length) throw new GifError('This GIF is cut off.');
    parts.push(r.b.subarray(r.p, r.p + n));
    total += n;
    r.p += n;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/** LZW-decode `data` into at most `count` palette indices (missing ones stay 0). */
export function lzwDecode(data: Uint8Array, minCodeSize: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  if (minCodeSize < 1 || minCodeSize > 11) throw new GifError('This GIF is damaged (bad LZW code size).');
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let first = 0;
  let o = 0;
  let acc = 0;
  let bits = 0;
  let i = 0;
  for (let k = 0; k < clear; k++) suffix[k] = k;
  while (o < count) {
    while (bits < size) {
      if (i >= data.length) return out; // ran out of data: keep what we have
      acc |= data[i++]! << bits;
      bits += 8;
    }
    const code = acc & ((1 << size) - 1);
    acc >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      if (code >= clear) throw new GifError('This GIF is damaged (bad LZW data).');
      out[o++] = suffix[code]!;
      prev = code;
      first = code;
      continue;
    }
    let cur = code;
    let sp = 0;
    if (code >= next) {
      if (code > next) throw new GifError('This GIF is damaged (bad LZW data).');
      stack[sp++] = first; // the "KwKwK" case: the code being defined right now
      cur = prev;
    }
    while (cur >= clear) {
      stack[sp++] = suffix[cur]!;
      cur = prefix[cur]!;
    }
    first = suffix[cur]!;
    stack[sp++] = first;
    while (sp > 0 && o < count) out[o++] = stack[--sp]!;
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
  return out;
}

/** Output row of the n-th stored row of an interlaced image. */
function interlaceRows(h: number): Int32Array {
  const rows = new Int32Array(h);
  let n = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) for (let y = start; y < h; y += step) rows[n++] = y;
  return rows;
}

/** Read the signature, logical screen and global colour table. */
function readHeader(r: Reader): { width: number; height: number; gct: Uint8Array | null } {
  if (!isGifBytes(r.b)) throw new GifError('This isn’t a GIF file.');
  r.p = 6;
  const width = u16(r);
  const height = u16(r);
  const packed = u8(r);
  r.p += 2; // background colour index, pixel aspect ratio (browsers ignore both)
  let gct: Uint8Array | null = null;
  if (packed & 0x80) {
    const n = 3 * (1 << ((packed & 7) + 1));
    if (r.p + n > r.b.length) throw new GifError('This GIF is cut off.');
    gct = r.b.subarray(r.p, r.p + n);
    r.p += n;
  }
  return { width, height, gct };
}

/**
 * Number of images in the file, without decoding any pixels (a cheap "is this really animated?").
 * A file that is damaged after its first image still reports what was found.
 */
export function countGifFrames(bytes: Uint8Array): number {
  const r: Reader = { b: bytes, p: 0 };
  let frames = 0;
  try {
    readHeader(r);
    for (;;) {
      const t = u8(r);
      if (t === 0x3b) break;
      if (t === 0x21) {
        u8(r);
        skipBlocks(r);
      } else if (t === 0x2c) {
        r.p += 8;
        const packed = u8(r);
        if (packed & 0x80) r.p += 3 * (1 << ((packed & 7) + 1));
        u8(r);
        skipBlocks(r);
        frames++;
      } else break;
    }
  } catch (e) {
    if (frames === 0) throw e;
  }
  return frames;
}

/** Decode every frame. Throws GifError (readable message) for files that aren't usable. */
export function decodeGif(bytes: Uint8Array): Gif {
  const r: Reader = { b: bytes, p: 0 };
  const header = readHeader(r);
  const gct = header.gct;
  let w = header.width;
  let h = header.height;
  const frames: GifFrame[] = [];
  let loopCount = 0;
  // The graphic control extension applies to the next image only.
  let delayCs = 0;
  let disposal = 0;
  let transparent = -1;
  let canvas: Uint8ClampedArray<ArrayBuffer> | null = null;
  let time = 0;

  try {
    for (;;) {
      const t = u8(r);
      if (t === 0x3b) break;
      if (t === 0x21) {
        const label = u8(r);
        if (label === 0xf9) {
          u8(r); // block size (4)
          const packed = u8(r);
          delayCs = u16(r);
          const ti = u8(r);
          disposal = (packed >> 2) & 7;
          transparent = packed & 1 ? ti : -1;
          skipBlocks(r);
        } else if (label === 0xff) {
          const n = u8(r);
          const id = String.fromCharCode(...bytes.subarray(r.p, r.p + n));
          r.p += n;
          if (id === 'NETSCAPE2.0' && bytes[r.p] === 3 && bytes[r.p + 1] === 1) loopCount = bytes[r.p + 2]! | (bytes[r.p + 3]! << 8);
          skipBlocks(r);
        } else skipBlocks(r);
      } else if (t === 0x2c) {
        const fx = u16(r);
        const fy = u16(r);
        const fw = u16(r);
        const fh = u16(r);
        const packed = u8(r);
        let palette = gct;
        if (packed & 0x80) {
          const n = 3 * (1 << ((packed & 7) + 1));
          if (r.p + n > bytes.length) throw new GifError('This GIF is cut off.');
          palette = bytes.subarray(r.p, r.p + n);
          r.p += n;
        }
        const minCode = u8(r);
        const data = readBlocks(r);
        if (!canvas && (!w || !h)) {
          // A 0×0 logical screen is legal; browsers then size to the first image.
          w = fx + fw;
          h = fy + fh;
          if (!w || !h) throw new GifError('This GIF has no size.');
        }
        if ((frames.length + 1) * w * h * 4 > MAX_GIF_DECODED_BYTES) {
          throw new GifError(`This GIF is too large to open (${w}×${h} with more than ${frames.length} frames). Try a shorter or smaller one.`);
        }
        canvas ??= new Uint8ClampedArray(w * h * 4);
        const idx = lzwDecode(data, minCode, fw * fh);
        const rows = packed & 0x40 ? interlaceRows(fh) : null;
        const saved = disposal === 3 ? canvas.slice() : null;
        const pal = palette ?? new Uint8Array(0);
        for (let sy = 0; sy < fh; sy++) {
          const y = fy + (rows ? rows[sy]! : sy);
          if (y >= h) continue;
          for (let sx = 0; sx < fw; sx++) {
            const x = fx + sx;
            if (x >= w) continue;
            const c = idx[sy * fw + sx]!;
            if (c === transparent) continue;
            const o = (y * w + x) * 4;
            canvas[o] = pal[c * 3] ?? 0;
            canvas[o + 1] = pal[c * 3 + 1] ?? 0;
            canvas[o + 2] = pal[c * 3 + 2] ?? 0;
            canvas[o + 3] = 255;
          }
        }
        const cs = delayCs <= 1 ? DEFAULT_DELAY_CS : delayCs;
        frames.push({ rgba: canvas.slice(), time, duration: cs / 100 });
        time += cs / 100;
        // Disposal prepares the canvas for the next image: 2 clears this image's area, 3 restores what was there before it.
        if (disposal === 2) {
          for (let y = fy; y < Math.min(h, fy + fh); y++) canvas.fill(0, (y * w + Math.min(w, fx)) * 4, (y * w + Math.min(w, fx + fw)) * 4);
        } else if (saved) canvas.set(saved);
        delayCs = 0;
        disposal = 0;
        transparent = -1;
      } else break; // unknown block: stop with what we have
    }
  } catch (e) {
    // A file cut off after some frames still plays (as in browsers); the size error always surfaces.
    if (frames.length === 0 || (e instanceof GifError && /too large/.test(e.message))) throw e;
  }
  if (!frames.length) throw new GifError('This GIF has no frames.');
  return { width: w, height: h, frames, duration: time, loopCount };
}
