// .glyphix project files: a zip with project.json (the document + an asset manifest) and the
// image files under assets/. Opened files are untrusted input: sizes, paths and ids are validated
// and the document goes through migrate() like everything else.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { migrate, referencedAssets, SCHEMA_VERSION, type Doc } from '@/doc';
import { assetBlob } from '@/assets/assetStore';

export const PROJECT_EXTENSION = '.glyphix';
export const PROJECT_MIME = 'application/x-glyphix+zip';

/** Refuse archives that would expand beyond this (zip-bomb guard). */
const MAX_UNZIPPED_BYTES = 1024 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

interface Manifest {
  format: 'glyphix';
  schemaVersion: number;
  doc: unknown;
  assets: { id: string; path: string; type: string }[];
}

export async function writeProjectFile(doc: Doc): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const assets: Manifest['assets'] = [];
  for (const id of referencedAssets(doc)) {
    const blob = await assetBlob(id);
    if (!blob) continue; // missing in this session: the document still references it
    const type = EXT[blob.type] ? blob.type : 'image/png';
    const path = `assets/${id}.${EXT[type]}`;
    // Images are already compressed: store them without re-deflating.
    files[path] = new Uint8Array(await blob.arrayBuffer());
    assets.push({ id, path, type });
  }
  const manifest: Manifest = { format: 'glyphix', schemaVersion: SCHEMA_VERSION, doc, assets };
  const zipped = zipSync(
    {
      'project.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
      ...Object.fromEntries(Object.entries(files).map(([p, d]) => [p, [d, { level: 0 }] as [Uint8Array, { level: 0 }]])),
    },
    { mtime: new Date('1980-01-01T00:00:00') }, // fixed: same project → identical bytes
  );
  return new Blob([zipped], { type: PROJECT_MIME });
}

export class ProjectFileError extends Error {}

export async function readProjectFile(
  file: Blob,
  { maxUnzippedBytes = MAX_UNZIPPED_BYTES }: { maxUnzippedBytes?: number } = {},
): Promise<{ doc: Doc; assets: { id: string; blob: Blob }[] }> {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        total += f.originalSize;
        if (total > maxUnzippedBytes) throw new ProjectFileError('This file is too large to open.');
        return f.name === 'project.json' || f.name.startsWith('assets/');
      },
    });
  } catch (e) {
    if (e instanceof ProjectFileError) throw e;
    throw new ProjectFileError("This isn't a Glyphix project file (it couldn't be unzipped).");
  }
  const json = entries['project.json'];
  if (!json) throw new ProjectFileError("This isn't a Glyphix project file (project.json is missing).");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(json)) as Manifest;
  } catch {
    throw new ProjectFileError('The project file is damaged (project.json is not valid JSON).');
  }
  if (manifest.format !== 'glyphix') throw new ProjectFileError("This isn't a Glyphix project file.");
  const doc = migrate(manifest.doc);

  const assets: { id: string; blob: Blob }[] = [];
  for (const a of Array.isArray(manifest.assets) ? manifest.assets : []) {
    if (!ID_PATTERN.test(a.id) || typeof a.path !== 'string' || !a.path.startsWith('assets/')) continue;
    const data = entries[a.path];
    if (!data) continue;
    const ext = a.path.split('.').pop() ?? '';
    const type = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    assets.push({ id: a.id, blob: new Blob([data as Uint8Array<ArrayBuffer>], { type }) });
  }
  return { doc, assets };
}

/** A filesystem-safe file name for a project. */
export function projectFileName(doc: Pick<Doc, 'name'>): string {
  const base = doc.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 80) || 'Untitled';
  return `${base}${PROJECT_EXTENSION}`;
}
