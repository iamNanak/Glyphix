// The editor's video frames. While playing, each video layer is a <video> element kept in step with the
// timeline (it also plays the audio); while paused or scrubbing, frames come from the frame-exact decoder,
// so a paused preview shows exactly what the export will.
import type { RenderList } from '@/doc';
import { assetStore } from '@/assets/assetStore';
import { createExactFrames } from './exactFrames';
import type { FrameImage, VideoFrameProvider } from './provider';

/** Seek instead of nudging when the element is this far off (s). */
const SEEK_DRIFT = 0.15;
const SEEK_LEAD = 0.05;
/** Drop elements of layers that haven't been drawn for this long (ms). */
const IDLE_MS = 5000;

interface Live {
  el: HTMLVideoElement;
  assetId: string;
  url: string;
  /** The last presented frame, copied out of the element (null until the first one). */
  frame: VideoFrame | null;
  lastExpected: number;
  lastUsed: number;
  /** |presented media time − timeline time| per presented frame (s), for sync stats. */
  drift: number[];
}

export interface PreviewFrames extends VideoFrameProvider {
  /** The timeline is playing: use live elements (and their audio). */
  setPlaying(playing: boolean): void;
  /** Called when a new frame is available, so the viewport redraws. */
  onFrame: (() => void) | null;
  /** Sync stats of the live elements since the last call (for tests and the bench). */
  takeDrift(): number[];
}

export function createPreviewFrames(): PreviewFrames {
  const exact = createExactFrames();
  const live = new Map<string, Live>();
  let playing = false;
  let liveVersion = 0;

  const bump = () => {
    liveVersion++;
    provider.onFrame?.();
  };

  function element(layerId: string, assetId: string): Live | null {
    const cur = live.get(layerId);
    if (cur && cur.assetId === assetId) return cur;
    if (cur) drop(layerId);
    const blob = assetStore.get(assetId)?.blob;
    if (!blob) return null;
    const el = document.createElement('video');
    el.playsInline = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const url = URL.createObjectURL(blob);
    el.src = url;
    const entry: Live = { el, assetId, url, frame: null, lastExpected: -1, lastUsed: performance.now(), drift: [] };
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (!live.has(layerId) || live.get(layerId) !== entry) return;
      // Same frame type as the exact decoder, so the renderer has one upload path.
      try {
        const f = new VideoFrame(el, { timestamp: Math.round(meta.mediaTime * 1e6) });
        entry.frame?.close();
        entry.frame = f;
      } catch {
        // No decodable frame yet (e.g. mid-seek): keep the previous one.
      }
      if (playing) entry.drift.push(Math.abs(meta.mediaTime - entry.lastExpected));
      bump();
      el.requestVideoFrameCallback(onFrame);
    };
    el.requestVideoFrameCallback(onFrame);
    live.set(layerId, entry);
    return entry;
  }

  function drop(layerId: string) {
    const e = live.get(layerId);
    if (!e) return;
    e.el.pause();
    e.frame?.close();
    e.el.removeAttribute('src');
    e.el.load();
    URL.revokeObjectURL(e.url);
    live.delete(layerId);
  }

  /** Keep each element at the timeline's source time: nudge the rate for small drift, seek for large. */
  function sync(list: RenderList) {
    const now = performance.now();
    for (const item of list.items) {
      if (item.kind !== 'image' || !item.video) continue;
      const e = element(item.id, item.assetId);
      if (!e) continue;
      e.lastUsed = now;
      const want = item.video.time;
      const held = Math.abs(want - e.lastExpected) < 1e-6; // before/after the clip: a still frame
      e.lastExpected = want;
      e.el.volume = Math.min(1, Math.max(0, item.video.volume));
      e.el.muted = item.video.volume <= 0;
      if (held) {
        if (!e.el.paused) e.el.pause();
        if (Math.abs(e.el.currentTime - want) > 0.02) e.el.currentTime = want;
        continue;
      }
      // A seek in flight: let it land before judging drift again (re-seeking would never catch up).
      if (e.el.seeking) continue;
      const drift = e.el.currentTime - want;
      if (Math.abs(drift) > SEEK_DRIFT) {
        // Aim a little ahead: the timeline keeps moving while the element seeks.
        e.el.currentTime = want + SEEK_LEAD;
        e.el.playbackRate = 1;
      } else {
        // Proportional correction: a 40 ms lead plays 20% slower until it's gone (≈ 0.2 s to settle).
        e.el.playbackRate = Math.min(1.5, Math.max(0.5, 1 - drift * 5));
      }
      if (e.el.paused) {
        e.el.play().catch(() => {
          // Autoplay with sound needs a user gesture; fall back to muted playback.
          e.el.muted = true;
          void e.el.play().catch(() => undefined);
        });
      }
    }
    for (const [id, e] of live) if (now - e.lastUsed > IDLE_MS) drop(id);
  }

  const provider: PreviewFrames = {
    onFrame: null,
    get version() {
      return exact.version * 1_000_003 + liveVersion;
    },
    setPlaying(p) {
      if (p === playing) return;
      playing = p;
      if (!p) for (const e of live.values()) e.el.pause();
    },
    async prepare(list) {
      if (playing) return sync(list);
      await exact.prepare(list);
    },
    frame(layerId, assetId, time): FrameImage | null {
      const e = live.get(layerId);
      const liveFrame = e && e.assetId === assetId ? e.frame : null;
      if (playing) return liveFrame ?? exact.frame(layerId, assetId, time);
      return exact.frame(layerId, assetId, time) ?? liveFrame;
    },
    takeDrift() {
      return [...live.values()].flatMap((e) => e.drift.splice(0));
    },
    dispose() {
      for (const id of [...live.keys()]) drop(id);
      exact.dispose();
    },
  };
  return provider;
}
