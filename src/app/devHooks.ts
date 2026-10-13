// Dev-only test hooks used by scripts/e2e-*.mjs. Not included in production builds.
import { useEditor } from './store';
import { useView } from '@/editor/viewStore';
import { layerBox } from '@/editor/geometry';
import { measureText } from '@/editor/Overlay';
import { frameBarHeight } from '@/styling/frames';
import { assetStore } from '@/assets/assetStore';
import { useSaveStatus } from '@/persistence/autosave';
import { fontLibrary } from '@/text/fontLibrary';
import { createBackend } from '@/render/backend';
import { exportVideo, renderFrameBitmap, runExport } from '@/export/exporter';
import { mixAudio } from '@/export/audioMix';
import * as mediabunny from 'mediabunny';
import { importVideo, videoMeta } from '@/video/videoAssets';
import { createExactFrames } from '@/video/exactFrames';

declare global {
  interface Window {
    __glyphix?: unknown;
  }
}

window.__glyphix = {
  state: () => {
    const s = useEditor.getState();
    return { doc: s.doc, selectedId: s.selectedId, cropId: s.cropId, editingTextId: s.editingTextId, time: s.time };
  },
  view: () => useView.getState().view,
  /** Asset ids currently decoded in memory. */
  assets: () => assetStore.ids(),
  saveState: () => useSaveStatus.getState().state,
  /** The app's font library instance (test scripts must not import their own copy). */
  fonts: fontLibrary,
  /** Renderer + frame capture from the app's own module graph (same font/asset singletons). */
  render: { createBackend, renderFrameBitmap },
  /** Video assets and the frame-exact provider (app module instances). */
  video: { importVideo, videoMeta, createExactFrames },
  /** Raw store access for experiments (dev only). */
  editor: useEditor,
  /** Export internals for e2e-export-v2 (mediabunny is exposed to decode outputs in the page). */
  export: {
    runExport,
    exportVideo,
    mixAudio,
    mediabunny,
    /** Register a video file as an asset (poster = `poster`), as video import will. */
    putVideoAsset: (id: string, poster: HTMLCanvasElement | ImageBitmap, file: Blob) => void assetStore.put(id, poster, { blob: file }),
  },
  setTime: (t: number) => useEditor.getState().setTime(t),
  select: (id: string | null) => useEditor.getState().select(id),
  box: (id: string) => {
    const s = useEditor.getState();
    const l = s.doc.comp.layers.find((x) => x.id === id);
    return l ? layerBox(l, s.time, measureText, frameBarHeight) : null;
  },
};
