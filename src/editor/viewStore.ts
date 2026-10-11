import { create } from 'zustand';
import type { View } from '@/render/backend';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const FIT_PAD = 40;

interface ViewState {
  host: { width: number; height: number };
  comp: { width: number; height: number };
  /** 'fit' keeps the comp centred and fitted as the window resizes. */
  mode: 'fit' | 'manual';
  view: View;
  setHost(width: number, height: number): void;
  setComp(width: number, height: number): void;
  fit(): void;
  /** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void;
  zoomTo(zoom: number): void;
  panBy(dx: number, dy: number): void;
}

export function fitView(host: { width: number; height: number }, comp: { width: number; height: number }, pad = FIT_PAD): View {
  const zoom = Math.max(MIN_ZOOM, Math.min((host.width - pad * 2) / comp.width, (host.height - pad * 2) / comp.height));
  return { zoom, offsetX: (host.width - comp.width * zoom) / 2, offsetY: (host.height - comp.height * zoom) / 2 };
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const useView = create<ViewState>((set, get) => ({
  host: { width: 1, height: 1 },
  comp: { width: 1920, height: 1080 },
  mode: 'fit',
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  setHost(width, height) {
    const s = get();
    const host = { width, height };
    if (s.mode === 'fit') set({ host, view: fitView(host, s.comp) });
    else {
      // Keep the comp point under the old centre at the new centre.
      const dx = (width - s.host.width) / 2;
      const dy = (height - s.host.height) / 2;
      set({ host, view: { ...s.view, offsetX: s.view.offsetX + dx, offsetY: s.view.offsetY + dy } });
    }
  },
  setComp(width, height) {
    const s = get();
    if (s.comp.width === width && s.comp.height === height) return;
    const comp = { width, height };
    set({ comp, mode: 'fit', view: fitView(s.host, comp) });
  },
  fit() {
    const s = get();
    set({ mode: 'fit', view: fitView(s.host, s.comp) });
  },
  zoomAt(factor, sx, sy) {
    const { view } = get();
    const zoom = clampZoom(view.zoom * factor);
    const k = zoom / view.zoom;
    set({ mode: 'manual', view: { zoom, offsetX: sx - (sx - view.offsetX) * k, offsetY: sy - (sy - view.offsetY) * k } });
  },
  zoomTo(zoom) {
    const { host } = get();
    get().zoomAt(clampZoom(zoom) / get().view.zoom, host.width / 2, host.height / 2);
  },
  panBy(dx, dy) {
    const { view } = get();
    set({ mode: 'manual', view: { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy } });
  },
}));

/** comp px → screen (host) px */
export const toScreen = (v: View, x: number, y: number) => ({ x: v.offsetX + x * v.zoom, y: v.offsetY + y * v.zoom });
/** screen (host) px → comp px */
export const toComp = (v: View, x: number, y: number) => ({ x: (x - v.offsetX) / v.zoom, y: (y - v.offsetY) / v.zoom });
