import { create } from 'zustand';
import {
  createDemoDoc,
  History,
  makeInsert,
  makeMove,
  makeRemove,
  makeSet,
  newLayerId,
  offsetProp,
  type Doc,
  type HistoryEntry,
  type Layer,
  type Patch,
} from '@/doc';

interface EditorState {
  doc: Doc;
  time: number;
  playing: boolean;
  loop: boolean;
  forceWebGL: boolean;
  selectedId: string | null;
  /** Image layer currently in crop mode. */
  cropId: string | null;
  /** Text layer currently being edited inline. */
  editingTextId: string | null;
  canUndo: boolean;
  canRedo: boolean;

  commit(entry: HistoryEntry): void;
  /** Convenience: set paths on the doc as one undoable step. */
  set(label: string, patches: Patch[], coalesceKey?: string): void;
  /** Group every commit until endGesture() into one undo step (drags, inline typing). */
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  loadDoc(doc: Doc): void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  setForceWebGL(v: boolean): void;
  select(id: string | null): void;
  setCrop(id: string | null): void;
  setEditingText(id: string | null): void;

  // Layer operations (all undoable)
  removeLayer(id: string): void;
  duplicateLayer(id: string): void;
  /** Move a layer by `delta` positions in the stack (+1 = up / towards front). */
  moveLayer(id: string, delta: number): void;
  moveLayerTo(id: string, index: number): void;
  toggleLayer(id: string, key: 'visible' | 'locked'): void;
  renameLayer(id: string, name: string): void;
}

const history = new History<Doc>(createDemoDoc());

const fromHistory = () => ({ doc: history.current, canUndo: history.canUndo, canRedo: history.canRedo });

export const layerIndex = (doc: Doc, id: string) => doc.comp.layers.findIndex((l) => l.id === id);

const LAYERS = ['comp', 'layers'] as const;

export const useEditor = create<EditorState>((set, get) => ({
  ...fromHistory(),
  time: 0,
  playing: true,
  loop: true,
  forceWebGL: new URLSearchParams(location.search).has('webgl'),
  selectedId: 'headline',
  cropId: null,
  editingTextId: null,

  commit(entry) {
    history.commit(entry);
    set(fromHistory());
  },
  set(label, patches, coalesceKey) {
    history.commit(makeSet(history.current, label, patches, coalesceKey));
    set(fromHistory());
  },
  beginGesture: () => history.beginGesture(),
  endGesture: () => history.endGesture(),
  undo() {
    history.undo();
    const doc = history.current;
    const exists = (id: string | null) => (id && layerIndex(doc, id) >= 0 ? id : null);
    set({ ...fromHistory(), selectedId: exists(get().selectedId), cropId: null, editingTextId: null });
  },
  redo() {
    history.redo();
    set({ ...fromHistory(), cropId: null, editingTextId: null });
  },
  loadDoc(doc) {
    history.reset(doc);
    set({ ...fromHistory(), time: 0, selectedId: null, cropId: null, editingTextId: null });
  },
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setForceWebGL: (forceWebGL) => set({ forceWebGL }),
  select: (selectedId) => set((s) => ({ selectedId, cropId: s.cropId === selectedId ? s.cropId : null, editingTextId: null })),
  setCrop: (cropId) => set({ cropId, selectedId: cropId ?? get().selectedId }),
  setEditingText: (editingTextId) => set({ editingTextId }),

  removeLayer(id) {
    const { doc } = get();
    const i = layerIndex(doc, id);
    if (i < 0) return;
    get().commit(makeRemove(LAYERS, i, doc.comp.layers[i], 'Delete layer'));
    set({ selectedId: null, cropId: null, editingTextId: null });
  },
  duplicateLayer(id) {
    const { doc } = get();
    const i = layerIndex(doc, id);
    const src = doc.comp.layers[i];
    if (!src || src.type === 'background') return;
    const copy = structuredClone(src);
    const dup: Layer = {
      ...copy,
      id: newLayerId(src.type),
      name: `${src.name} copy`,
      locked: false,
      transform: { ...copy.transform, x: offsetProp(copy.transform.x, 40), y: offsetProp(copy.transform.y, 40) },
    };
    get().commit(makeInsert(LAYERS, i + 1, dup, 'Duplicate layer'));
    set({ selectedId: dup.id });
  },
  moveLayer(id, delta) {
    const i = layerIndex(get().doc, id);
    get().moveLayerTo(id, i + delta);
  },
  moveLayerTo(id, index) {
    const { doc } = get();
    const i = layerIndex(doc, id);
    // The background stays at the bottom of the stack.
    const floor = doc.comp.layers[0]?.type === 'background' ? 1 : 0;
    const to = Math.max(floor, Math.min(doc.comp.layers.length - 1, index));
    if (i < 0 || to === i) return;
    get().commit(makeMove(LAYERS, i, to, doc.comp.layers[i], to > i ? 'Bring forward' : 'Send backward'));
  },
  toggleLayer(id, key) {
    const { doc } = get();
    const i = layerIndex(doc, id);
    const layer = doc.comp.layers[i];
    if (!layer) return;
    const on = !layer[key];
    const label = key === 'visible' ? (on ? 'Show layer' : 'Hide layer') : on ? 'Lock layer' : 'Unlock layer';
    get().set(label, [{ path: [...LAYERS, i, key], value: on }]);
  },
  renameLayer(id, name) {
    const i = layerIndex(get().doc, id);
    if (i >= 0 && name.trim()) get().set('Rename layer', [{ path: [...LAYERS, i, 'name'], value: name.trim() }]);
  },
}));
