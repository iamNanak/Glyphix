// Dev-only test hooks used by scripts/e2e-*.mjs. Not included in production builds.
import { useEditor } from './store';
import { useView } from '@/editor/viewStore';
import { layerBox } from '@/editor/geometry';
import { measureText } from '@/editor/Overlay';
import { frameBarHeight } from '@/styling/frames';
import { assetStore } from '@/assets/assetStore';
import { useSaveStatus } from '@/persistence/autosave';

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
  /** Raw store access for experiments (dev only). */
  editor: useEditor,
  setTime: (t: number) => useEditor.getState().setTime(t),
  select: (id: string | null) => useEditor.getState().select(id),
  box: (id: string) => {
    const s = useEditor.getState();
    const l = s.doc.comp.layers.find((x) => x.id === id);
    return l ? layerBox(l, s.time, measureText, frameBarHeight) : null;
  },
};
