import type { ImageLayer } from './types';

/**
 * Height (comp px, scale 1) of the window/browser bar drawn above an image.
 * Proportional to the image width so frames look the same at any size.
 */
export function frameBarHeight(layer: Pick<ImageLayer, 'frame' | 'width'>): number {
  if (layer.frame.kind === 'none') return 0;
  const k = layer.frame.kind.startsWith('browser') ? 0.042 : 0.03;
  return Math.round(Math.min(72, Math.max(22, layer.width * k)));
}
