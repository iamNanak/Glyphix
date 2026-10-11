import type { Comp, ImageLayer } from './types';

export function newLayerId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Size that fits `w×h` inside the comp with `margin` (0..1) on each side, never upscaling. */
export function fitSize(comp: Comp, w: number, h: number, margin = 0.14): { width: number; height: number } {
  const s = Math.min(1, (comp.width * (1 - 2 * margin)) / w, (comp.height * (1 - 2 * margin)) / h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

export function createImageLayer(comp: Comp, assetId: string, srcW: number, srcH: number, name = 'Image'): ImageLayer {
  const { width, height } = fitSize(comp, srcW, srcH);
  return {
    id: newLayerId('img'),
    name,
    type: 'image',
    visible: true,
    locked: false,
    assetId,
    width,
    height,
    radius: 16,
    shadow: { blur: 60, offsetX: 0, offsetY: 30, color: [0, 0, 0, 0.45] },
    opacity: { static: 1 },
    transform: { x: { static: comp.width / 2 }, y: { static: comp.height / 2 }, scale: { static: 1 }, rotation: { static: 0 } },
  };
}
