import type { Doc } from './types';

/** Every asset id a document needs (image layers + image backgrounds), deduplicated. */
export function referencedAssets(doc: Doc): string[] {
  const ids = new Set<string>();
  for (const l of doc.comp.layers) {
    if (l.type === 'image') ids.add(l.assetId);
    if (l.type === 'background' && l.fill.kind === 'image') ids.add(l.fill.assetId);
  }
  return [...ids];
}
