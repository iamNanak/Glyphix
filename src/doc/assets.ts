import type { Doc } from './types';

/** Uploaded fonts are assets too: content-hash ids with this prefix (see src/text/fonts.ts). */
export const FONT_ASSET_PREFIX = 'font-';

/** Every asset id a document needs (images, image backgrounds, uploaded fonts), deduplicated. */
export function referencedAssets(doc: Doc): string[] {
  const ids = new Set<string>();
  for (const l of doc.comp.layers) {
    if (l.type === 'image') ids.add(l.assetId);
    if (l.type === 'background' && l.fill.kind === 'image') ids.add(l.fill.assetId);
    if (l.type === 'text' && l.fontId.startsWith(FONT_ASSET_PREFIX)) ids.add(l.fontId);
  }
  return [...ids];
}
