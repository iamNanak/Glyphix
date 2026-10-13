// STUB — replaced by the frame-exact decoder (Milestone F, task F2).
import type { VideoFrameProvider } from './provider';

export function createExactFrames(): VideoFrameProvider {
  return { prepare: async () => {}, frame: () => null, version: 0, dispose: () => {} };
}
