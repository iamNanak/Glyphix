import { create } from 'zustand';
import { createDemoDoc, History, makeSet, type Doc, type HistoryEntry, type Patch } from '@/doc';

interface EditorState {
  doc: Doc;
  time: number;
  playing: boolean;
  loop: boolean;
  forceWebGL: boolean;
  selectedId: string | null;
  canUndo: boolean;
  canRedo: boolean;

  commit(entry: HistoryEntry): void;
  /** Convenience: set paths on the doc as one undoable step. */
  set(label: string, patches: Patch[], coalesceKey?: string): void;
  undo(): void;
  redo(): void;
  loadDoc(doc: Doc): void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  setForceWebGL(v: boolean): void;
  select(id: string | null): void;
}

const history = new History<Doc>(createDemoDoc());

const fromHistory = () => ({ doc: history.current, canUndo: history.canUndo, canRedo: history.canRedo });

export const useEditor = create<EditorState>((set) => ({
  ...fromHistory(),
  time: 0,
  playing: true,
  loop: true,
  forceWebGL: new URLSearchParams(location.search).has('webgl'),
  selectedId: 'headline',

  commit(entry) {
    history.commit(entry);
    set(fromHistory());
  },
  set(label, patches, coalesceKey) {
    history.commit(makeSet(history.current, label, patches, coalesceKey));
    set(fromHistory());
  },
  undo() {
    history.undo();
    set(fromHistory());
  },
  redo() {
    history.redo();
    set(fromHistory());
  },
  loadDoc(doc) {
    history.reset(doc);
    set({ ...fromHistory(), time: 0 });
  },
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setForceWebGL: (forceWebGL) => set({ forceWebGL }),
  select: (selectedId) => set({ selectedId }),
}));

export const layerIndex = (doc: Doc, id: string) => doc.comp.layers.findIndex((l) => l.id === id);
