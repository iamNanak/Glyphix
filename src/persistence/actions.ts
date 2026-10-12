// User-level project actions. Every switch saves the current project first.
import { createBlankDoc, type Doc } from '@/doc';
import { loadAssetBlob } from '@/assets/assetStore';
import { useEditor } from '@/app/store';
import { downloadBlob } from '@/export/exporter';
import { flushSave, markSaved, refreshThumbnail } from './autosave';
import { get, putMany } from './db';
import { deleteProject, listProjects, loadProject, newProjectId, saveProject } from './projects';
import { projectFileName, readProjectFile, writeProjectFile } from './projectFile';

function show(doc: Doc, { thumbnail = false } = {}) {
  markSaved(doc); // loading is not an edit: don't re-save it
  useEditor.getState().loadDoc(doc);
  if (thumbnail) void refreshThumbnail(doc);
}

export async function newProject(): Promise<void> {
  await flushSave();
  const doc = createBlankDoc(newProjectId());
  await saveProject(doc);
  show(doc, { thumbnail: true });
}

/** @returns a warning if some images were missing */
export async function openProject(id: string): Promise<string | null> {
  await flushSave();
  const { doc, missing } = await loadProject(id);
  show(doc);
  return missing.length ? `${missing.length} image(s) in this project were missing from storage.` : null;
}

/** Open a .glyphix file as a project. If that project already exists here, it opens as a copy. */
export async function openProjectFile(file: Blob): Promise<void> {
  const { doc: fileDoc, assets } = await readProjectFile(file);
  await flushSave();
  const exists = await get('projects', fileDoc.id);
  const doc: Doc = exists ? { ...fileDoc, id: newProjectId(), name: `${fileDoc.name} (copy)` } : fileDoc;
  await putMany('assets', assets);
  await Promise.all(assets.map((a) => loadAssetBlob(a.id, a.blob)));
  await saveProject(doc);
  show(doc, { thumbnail: true });
}

export async function saveProjectFile(): Promise<void> {
  const doc = useEditor.getState().doc;
  downloadBlob(await writeProjectFile(doc), projectFileName(doc));
}

/** Delete a project; if it was open, switch to the most recent other one (or a new project). */
export async function removeProject(id: string): Promise<void> {
  const current = useEditor.getState().doc.id === id;
  // Otherwise the next switch would flush (and so re-create) the project we're deleting.
  if (current) markSaved(useEditor.getState().doc);
  await deleteProject(id);
  if (!current) return;
  const next = (await listProjects())[0];
  if (next) await openProject(next.id);
  else await newProject();
}
