// Frame-exact video frames (export, thumbnails, tests, the paused preview). Each video layer has
// one decode session: a Mediabunny VideoSampleSink.samples() stream started at the requested time,
// walked forward by a FrameCursor. A forward sequence of times (export, stepping) decodes every
// packet once without re-seeking; going backwards or jumping more than ~2 s ahead starts a new
// session at the nearest key frame. The frame on screen stays until its replacement is decoded.
//
// (samplesAtTimestamps() can't be fed lazily: it only decodes a key-frame group once a timestamp
// beyond it arrives, so a request for one frame would wait for the next request.)
import { VideoSampleSink, type VideoSample } from 'mediabunny';
import type { RenderList } from '@/doc';
import { videoSource } from './videoAssets';
import { FrameCursor, needsRestart, TIME_EPSILON } from './frameCursor';
import type { VideoFrameProvider } from './provider';

/**
 * Firefox's WebGPU draws a VideoFrame texture as its first frame forever; there, frames are handed to the
 * renderer as ImageBitmaps, converted here (off the render path) when each frame is decoded.
 */
const AS_BITMAP = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

interface Slot {
  assetId: string;
  cursor: FrameCursor<VideoSample> | null;
  /** The cursor's current sample as a VideoFrame (survives session restarts). */
  frame: VideoFrame | null;
  /** AS_BITMAP: `frame` as an ImageBitmap — what frame() returns there. */
  bitmap: ImageBitmap | null;
  /** Last time requested and the time of the latest queued request (older queued ones are skipped). */
  lastTime: number;
  wanted: number;
  /** Requests queued and not finished. */
  queued: number;
  /** Requests for this layer run one at a time. */
  chain: Promise<void>;
}

export interface ExactFrames extends VideoFrameProvider {
  /** Debug counters: VideoFrames this provider holds open, decode sessions started, frames delivered. */
  stats(): { openFrames: number; sessions: number; frames: number };
  /** Start and duration (s) of the frame held for a layer, or null. */
  frameSpan(layerId: string): { start: number; duration: number } | null;
}

/** A VideoFrame for a sample, with rotation / flip metadata applied (display orientation). */
function toFrame(sample: VideoSample): VideoFrame {
  if (!sample.rotation && !sample.flip) return sample.toVideoFrame();
  const canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
  sample.drawWithFit(canvas.getContext('2d')!, { fit: 'fill' });
  return new VideoFrame(canvas, { timestamp: sample.microsecondTimestamp, duration: sample.microsecondDuration });
}

export function createExactFrames(): ExactFrames {
  const slots = new Map<string, Slot>();
  const sinks = new Map<string, Promise<{ sink: VideoSampleSink; firstTimestamp: number } | null>>();
  let version = 0;
  let disposed = false;
  let openFrames = 0;
  let sessions = 0;
  let delivered = 0;

  const sinkFor = (assetId: string) => {
    let s = sinks.get(assetId);
    if (!s) {
      const src = videoSource(assetId);
      if (!src) return null; // not loaded (yet): don't cache, it may arrive later
      s = src.then((v) => ({ sink: new VideoSampleSink(v.track), firstTimestamp: v.firstTimestamp })).catch(() => null);
      sinks.set(assetId, s);
    }
    return s;
  };

  const setFrame = (slot: Slot, frame: VideoFrame | null) => {
    if (slot.frame) {
      slot.frame.close();
      openFrames--;
    }
    slot.frame = frame;
    if (frame) {
      openFrames++;
      delivered++;
    }
    version++;
  };

  async function seek(slot: Slot, layerId: string, time: number): Promise<void> {
    const s = await sinkFor(slot.assetId);
    if (!s || disposed || slots.get(layerId) !== slot) return;
    const t = Math.max(time, s.firstTimestamp);
    if (!slot.cursor || needsRestart(slot.cursor.current?.timestamp ?? null, t)) {
      slot.cursor?.close();
      slot.cursor = new FrameCursor(s.sink.samples(t + TIME_EPSILON)[Symbol.asyncIterator]());
      sessions++;
    }
    const cursor = slot.cursor;
    try {
      const changed = await cursor.advance(t);
      if (disposed || slot.cursor !== cursor || slots.get(layerId) !== slot) return;
      if (changed && cursor.current) {
        const frame = toFrame(cursor.current);
        if (AS_BITMAP) {
          const bitmap = await createImageBitmap(frame);
          if (disposed || slot.cursor !== cursor || slots.get(layerId) !== slot) {
            bitmap.close();
            frame.close();
            return;
          }
          slot.bitmap?.close();
          slot.bitmap = bitmap;
        }
        setFrame(slot, frame);
      }
      slot.lastTime = time;
    } catch (e) {
      // Decoder error: drop the session (the next request starts a new one) and keep the old frame.
      if (slot.cursor === cursor) {
        cursor.close();
        slot.cursor = null;
      }
      console.warn('Video decode failed', slot.assetId, e);
    }
  }

  function request(layerId: string, assetId: string, time: number): Promise<void> {
    let slot = slots.get(layerId);
    if (slot && slot.assetId !== assetId) {
      dropSlot(layerId, slot);
      slot = undefined;
    }
    if (!slot) {
      slot = { assetId, cursor: null, frame: null, bitmap: null, lastTime: NaN, wanted: NaN, queued: 0, chain: Promise.resolve() };
      slots.set(layerId, slot);
    }
    if ((time === slot.wanted && slot.queued > 0) || (time === slot.lastTime && slot.frame)) return slot.chain;
    slot.wanted = time;
    slot.queued++;
    const s = slot;
    s.chain = s.chain
      .then(() => (s.wanted === time ? seek(s, layerId, time) : undefined))
      .finally(() => void s.queued--);
    return s.chain;
  }

  function dropSlot(layerId: string, slot: Slot) {
    slot.cursor?.close();
    slot.cursor = null;
    if (slot.frame) setFrame(slot, null);
    slot.bitmap?.close();
    slot.bitmap = null;
    slots.delete(layerId);
  }

  return {
    async prepare(list: RenderList) {
      if (disposed) return;
      const jobs: Promise<void>[] = [];
      for (const item of list.items) {
        if (item.kind === 'image' && item.video) jobs.push(request(item.id, item.assetId, item.video.time));
      }
      await Promise.all(jobs);
    },
    frame(layerId: string, assetId: string) {
      const slot = slots.get(layerId);
      if (!slot || slot.assetId !== assetId) return null;
      return AS_BITMAP ? slot.bitmap : slot.frame;
    },
    frameSpan(layerId: string) {
      const f = slots.get(layerId)?.frame;
      return f ? { start: f.timestamp / 1e6, duration: (f.duration ?? 0) / 1e6 } : null;
    },
    get version() {
      return version;
    },
    dispose() {
      if (disposed) return;
      for (const [id, slot] of slots) dropSlot(id, slot);
      disposed = true;
    },
    stats: () => ({ openFrames, sessions, frames: delivered }),
  };
}
