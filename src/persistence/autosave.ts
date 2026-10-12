// Autosave: every document change is saved ~800 ms after the last edit, and on tab hide.
// On startup the last project is restored (or the demo becomes a new project).
import { create } from 'zustand';
import { createDemoDoc, type Doc } from '@/doc';
import { useEditor } from '@/app/store';
import { exportPng } from '@/export/exporter';
import { getLastProjectId, loadProject, newProjectId, saveProject } from './projects';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const useSaveStatus = create<{ state: SaveState; savedAt: number | null; error: string | null }>(() => ({
  state: 'idle',
  savedAt: null,
  error: null,
}));

const DEBOUNCE_MS = 800;
const THUMB_EVERY_MS = 30_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Doc | null = null;
let lastThumbAt = 0;
let inFlight: Promise<void> = Promise.resolve();

async function thumbnail(doc: Doc): Promise<Blob | undefined> {
  if (Date.now() - lastThumbAt < THUMB_EVERY_MS) return undefined;
  lastThumbAt = Date.now();
  try {
    // A late frame, after entrance animations have played.
    return await exportPng(doc, Math.max(0, doc.comp.duration - 0.05), { scale: 360 / doc.comp.width });
  } catch {
    return undefined; // thumbnails are best-effort
  }
}

/** Save now (if the doc changed since the last save). Saves are serialised. */
export function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  inFlight = inFlight.then(async () => {
    const doc = useEditor.getState().doc;
    if (doc === lastSaved) return;
    useSaveStatus.setState({ state: 'saving' });
    try {
      await saveProject(doc, await thumbnail(doc));
      lastSaved = doc;
      useSaveStatus.setState({ state: 'saved', savedAt: Date.now(), error: null });
    } catch (e) {
      useSaveStatus.setState({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  });
  return inFlight;
}

let started = false;

export function startAutosave(): () => void {
  if (started) return () => {};
  started = true;
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.doc === prev.doc || s.doc === lastSaved) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushSave(), DEBOUNCE_MS);
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushSave();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  return () => {
    started = false;
    unsub();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
  };
}

/** Mark a freshly loaded doc as saved so loading doesn't immediately re-save it. */
export function markSaved(doc: Doc) {
  lastSaved = doc;
  lastThumbAt = 0;
  useSaveStatus.setState({ state: 'saved', savedAt: Date.now(), error: null });
}

export interface BootResult {
  doc: Doc;
  /** Set when the last project couldn't be restored and we fell back. */
  warning: string | null;
}

/** Restore the last project, or start the demo as a new project. */
export async function bootProject(): Promise<BootResult> {
  void navigator.storage?.persist?.().catch(() => false); // ask the browser not to evict our data
  let warning: string | null = null;
  try {
    const id = await getLastProjectId();
    if (id) {
      const { doc, missing } = await loadProject(id);
      markSaved(doc);
      if (missing.length) warning = `Your last project opened, but ${missing.length} image(s) were missing from storage.`;
      return { doc, warning };
    }
  } catch (e) {
    warning = `Couldn't restore your last project (${e instanceof Error ? e.message : String(e)}). Starting a new one.`;
  }
  const doc = { ...createDemoDoc(), id: newProjectId() };
  return { doc, warning };
}
