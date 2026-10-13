// Where video layers get their pixels. The renderer asks synchronously while drawing; providers
// do any async work (decoding, seeking) in prepare(), which callers await before render().
import type { RenderList } from '@/doc';

/** Anything the GPU can upload as a video frame. */
export type FrameImage = VideoFrame | ImageBitmap | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas;

export interface VideoFrameProvider {
  /**
   * Make the frame for every video item in `list` available to frame().
   * Exact providers decode the frame at item.video.time; live ones may resolve immediately.
   */
  prepare(list: RenderList): Promise<void>;
  /**
   * The frame to draw for this layer, or null (the renderer then shows the asset's poster image).
   * Must not block. Ownership stays with the provider: the renderer never closes it.
   */
  frame(layerId: string, assetId: string, time: number): FrameImage | null;
  /** Bumps whenever frame() would return different pixels for some layer (renderer re-uploads). */
  readonly version: number;
  dispose(): void;
}
