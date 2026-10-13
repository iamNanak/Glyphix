// The editor's video frames. Pictures always come from the frame-exact decoder (sequential decoding keeps up
// with playback easily), so the preview shows exactly what the export will, playing or paused.
// Sound is separate: see previewAudio.ts.
import { createExactFrames } from './exactFrames';
import type { FrameImage, VideoFrameProvider } from './provider';

export interface SyncStats {
  /** How late the drawn frame is for every draw while playing (s): 0 when the frame covers the timeline time. */
  picture: number[];
  /** Distinct frames drawn while playing. */
  frames: number;
}

export interface PreviewFrames extends VideoFrameProvider {
  setPlaying(playing: boolean): void;
  /** Sync stats since the last call (tests and the bench). */
  takeStats(): SyncStats;
}

export function createPreviewFrames(): PreviewFrames {
  const exact = createExactFrames();
  const lastDrawn = new Map<string, VideoFrame>();
  let playing = false;
  let stats: SyncStats = { picture: [], frames: 0 };

  return {
    get version() {
      return exact.version;
    },
    setPlaying(p) {
      playing = p;
    },
    prepare: (list) => exact.prepare(list),
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
      stats = { picture: [], frames: 0 };
      return s;
    },
    dispose() {
      lastDrawn.clear();
      exact.dispose();
    },
  };
}
