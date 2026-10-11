import type { ImageLayer } from '@/doc';

/** Height (comp px at scale 1) of the window/browser bar drawn above an image. Frames arrive in B3. */
export function frameBarHeight(_layer: ImageLayer): number {
  return 0;
}
