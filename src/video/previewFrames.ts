// The editor's video frames and sound. Pictures always come from the frame-exact decoder (sequential decoding
// keeps up with playback easily), so the preview shows exactly what the export will, playing or paused.
// Sound comes from one <video> element per audible video layer, kept in step with the timeline while it plays.
import type { RenderList } from '@/doc';
import { assetStore } from '@/assets/assetStore';
import { createExactFrames } from './exactFrames';
import { videoMeta } from './videoAssets';
import type { FrameImage, VideoFrameProvider } from './provider';

/** Seek the sound instead of nudging its rate when it is this far off (s). */
const SEEK_DRIFT = 0.15;
/** Aim seeks a little ahead: the timeline keeps moving while the element seeks. */
const SEEK_LEAD = 0.05;
/** Drop sound elements of layers that haven't played for this long (ms). */
const IDLE_MS = 5000;

interface Sound {
  el: HTMLVideoElement;
  assetId: string;
  url: string;
  lastWant: number;
  lastUsed: number;
}

export interface SyncStats {
  /** How late the drawn frame is for every draw while playing (s): 0 when the frame covers the timeline time. */
  picture: number[];
  /** |sound position − timeline source time| sampled while playing (s). */
  sound: number[];
  /** Distinct frames drawn while playing. */
  frames: number;
}

export interface PreviewFrames extends VideoFrameProvider {
  /** The timeline is playing: play the sound too. */
  setPlaying(playing: boolean): void;
  /** Called when a new frame is available, so the viewport redraws. */
  onFrame: (() => void) | null;
  /** Sync stats since the last call (tests and the bench). */
  takeStats(): SyncStats;
}

export function createPreviewFrames(): PreviewFrames {
  const exact = createExactFrames();
  const sounds = new Map<string, Sound>();
  const lastDrawn = new Map<string, VideoFrame>();
  let playing = false;
  let stats: SyncStats = { picture: [], sound: [], frames: 0 };

  function sound(layerId: string, assetId: string): Sound | null {
    const cur = sounds.get(layerId);
    if (cur && cur.assetId === assetId) return cur;
    if (cur) drop(layerId);
    const blob = assetStore.get(assetId)?.blob;
    if (!blob) return null;
    const el = document.createElement('video');
    el.preload = 'auto';
    const url = URL.createObjectURL(blob);
    el.src = url;
    const s: Sound = { el, assetId, url, lastWant: -1, lastUsed: performance.now() };
    sounds.set(layerId, s);
    return s;
  }

  function drop(layerId: string) {
    const s = sounds.get(layerId);
    if (!s) return;
    s.el.pause();
    s.el.removeAttribute('src');
    s.el.load();
    URL.revokeObjectURL(s.url);
    sounds.delete(layerId);
  }

  /** Keep each audible layer's sound at the timeline's source time: nudge the rate, seek when far off. */
  function syncSound(list: RenderList) {
    const now = performance.now();
    for (const item of list.items) {
      if (item.kind !== 'image' || !item.video || item.video.volume <= 0) continue;
      if (videoMeta(item.assetId)?.hasAudio === false) continue;
      const s = sound(item.id, item.assetId);
      if (!s) continue;
      s.lastUsed = now;
      const want = item.video.time;
      const held = Math.abs(want - s.lastWant) < 1e-6; // before/after the clip: silence
      s.lastWant = want;
      s.el.volume = Math.min(1, item.video.volume);
      if (held) {
        if (!s.el.paused) s.el.pause();
        continue;
      }
      if (s.el.seeking) continue; // let a seek land before judging drift again
      const drift = s.el.currentTime - want;
      if (!s.el.paused) stats.sound.push(Math.abs(drift));
      if (Math.abs(drift) > SEEK_DRIFT) {
        s.el.currentTime = want + SEEK_LEAD;
        s.el.playbackRate = 1;
      } else {
        // Proportional correction: a 40 ms lead plays 20% slower until it's gone.
        s.el.playbackRate = Math.min(1.5, Math.max(0.5, 1 - drift * 5));
      }
      if (s.el.paused) void s.el.play().catch(() => undefined); // autoplay blocked: the picture still plays
    }
    for (const [id, s] of sounds) if (now - s.lastUsed > IDLE_MS) drop(id);
  }

  const provider: PreviewFrames = {
    onFrame: null,
    get version() {
      return exact.version;
    },
    setPlaying(p) {
      if (p === playing) return;
      playing = p;
      if (!p) for (const id of [...sounds.keys()]) drop(id);
    },
    async prepare(list) {
      if (playing) syncSound(list);
      await exact.prepare(list);
    },
    frame(layerId, assetId, time): FrameImage | null {
      const f = exact.frame(layerId, assetId, time);
      if (playing && f instanceof VideoFrame) {
        if (lastDrawn.get(layerId) !== f) stats.frames++;
        lastDrawn.set(layerId, f);
        stats.picture.push(Math.max(0, time - (f.timestamp + (f.duration ?? 0)) / 1e6));
      }
      return f;
    },
    takeStats() {
      const s = stats;
      stats = { picture: [], sound: [], frames: 0 };
      return s;
    },
    dispose() {
      for (const id of [...sounds.keys()]) drop(id);
      lastDrawn.clear();
      exact.dispose();
    },
  };
  return provider;
}
