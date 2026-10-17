// Animated GIFs as video assets. A GIF is stored like a video (`vid-<sha20>`, the original file bytes),
// decoded once into composited frames, and served through the same frame providers (exactFrames.ts).
import { countGifFrames, isGifBytes, type Gif } from './gifDecoder';

const gifs = new Map<string, Gif>();

/** The decoded GIF behind a video asset id, or null when the asset isn't a GIF (or isn't loaded). */
export const gifFor = (id: string): Gif | null => gifs.get(id) ?? null;
export const registerGif = (id: string, gif: Gif) => void gifs.set(id, gif);

/** Does this file start with a GIF signature? */
export async function sniffGif(blob: Blob): Promise<boolean> {
  return isGifBytes(new Uint8Array(await blob.slice(0, 6).arrayBuffer()));
}

/** A GIF with more than one image: it becomes a video-like layer. A one-frame GIF stays a plain image. */
export async function isAnimatedGif(blob: Blob): Promise<boolean> {
  if (!(await sniffGif(blob))) return false;
  try {
    return countGifFrames(new Uint8Array(await blob.arrayBuffer())) > 1;
  } catch {
    return false; // damaged: let the normal image path report it
  }
}

/** Index of the frame shown at `time` (s): the last frame that has started; holds the last frame past the end. */
export function gifFrameIndex(gif: Gif, time: number): number {
  const t = time + 1e-6; // frame starts are sums of centiseconds: tolerate float error
  let lo = 0;
  let hi = gif.frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (gif.frames[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
