// Projects in IndexedDB: documents + the image files they reference.
import { migrate, referencedAssets, type Doc } from '@/doc';
import { assetBlob, assetStore, loadAssetBlob } from '@/assets/assetStore';
import { fontBlob } from '@/assets/fontAssets';
import { del, get, getAll, getAllKeys, put, putMany } from './db';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Plain JSON; always run through migrate() when loading. */
  doc: unknown;
  thumbnail?: Blob;
}

export type ProjectSummary = Omit<ProjectRecord, 'doc'>;

interface AssetRecord {
  id: string;
  blob: Blob;
}

/** Asset ids already known to be in the database (avoids re-checking on every autosave). */
const storedAssets = new Set<string>();

export function newProjectId(): string {
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await getAll<ProjectRecord>('projects');
  return all.map(({ doc: _doc, ...rest }) => rest).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Save the doc and any referenced assets not yet stored. */
export async function saveProject(doc: Doc, thumbnail?: Blob): Promise<void> {
  const missing = referencedAssets(doc).filter((id) => !storedAssets.has(id));
  if (missing.length) {
    const known = new Set((await getAllKeys('assets')) as string[]);
    const records: AssetRecord[] = [];
    for (const id of missing) {
      if (known.has(id)) {
        storedAssets.add(id);
        continue;
      }
      const blob = await assetBlob(id);
      if (blob) records.push({ id, blob });
    }
    await putMany('assets', records);
    records.forEach((r) => storedAssets.add(r.id));
  }
  const prev = await get<ProjectRecord>('projects', doc.id);
  const now = Date.now();
  await put('projects', {
    id: doc.id,
    name: doc.name,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    doc: JSON.parse(JSON.stringify(doc)),
    thumbnail: thumbnail ?? prev?.thumbnail,
  } satisfies ProjectRecord);
  await setLastProjectId(doc.id);
}

/**
 * Attach a thumbnail to an existing project. Never creates a project (a thumbnail rendered for a
 * project that was deleted meanwhile must not bring it back) and doesn't change its edit time.
 */
export async function setThumbnail(id: string, thumbnail: Blob): Promise<void> {
  const rec = await get<ProjectRecord>('projects', id);
  if (rec) await put('projects', { ...rec, thumbnail } satisfies ProjectRecord);
}

/**
 * Load a project and decode its images into the asset store. Missing images don't fail the load
 * (the document is still the user's work); their ids are returned so the UI can say so.
 */
export async function loadProject(id: string): Promise<{ doc: Doc; missing: string[] }> {
  const rec = await get<ProjectRecord>('projects', id);
  if (!rec) throw new Error('Project not found');
  const doc = migrate(rec.doc);
  const missing = await restoreAssets(doc);
  await setLastProjectId(doc.id);
  return { doc, missing };
}

/** Returns the ids of assets that couldn't be found. */
export async function restoreAssets(doc: Doc): Promise<string[]> {
  const missing: string[] = [];
  await Promise.all(
    referencedAssets(doc).map(async (assetId) => {
      if (assetStore.has(assetId) || fontBlob(assetId)) return;
      const rec = await get<AssetRecord>('assets', assetId);
      if (!rec) return void missing.push(assetId);
      await loadAssetBlob(assetId, rec.blob);
      storedAssets.add(assetId);
    }),
  );
  return missing;
}

/** Delete a project and any images no other project uses. */
export async function deleteProject(id: string): Promise<void> {
  await del('projects', [id]);
  const remaining = await getAll<ProjectRecord>('projects');
  const inUse = new Set(remaining.flatMap((p) => referencedAssets(migrate(p.doc))));
  const all = (await getAllKeys('assets')) as string[];
  const orphans = all.filter((a) => !inUse.has(a));
  await del('assets', orphans);
  orphans.forEach((a) => storedAssets.delete(a));
  if ((await getLastProjectId()) === id) await setLastProjectId(remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null);
}

export async function getLastProjectId(): Promise<string | null> {
  return (await get<{ key: string; value: string | null }>('meta', 'lastProject'))?.value ?? null;
}

async function setLastProjectId(id: string | null): Promise<void> {
  await put('meta', { key: 'lastProject', value: id });
}
