// Placing user files on the canvas: images and videos, from paste, drop or the toolbar's file picker.
import { importImage } from '@/assets/assetStore';
import { createImageLayer, defaultClip, fitSize, makeInsert } from '@/doc';
import { importVideo, isVideoFile, VIDEO_ACCEPT } from '@/video/videoAssets';
import { layerIndex, useEditor } from './store';

export const MEDIA_ACCEPT = `image/*,${VIDEO_ACCEPT}`;

export const isMediaFile = (f: File) => f.type.startsWith('image/') || isVideoFile(f);

/**
 * Import a file and put it on the canvas. A selected image/video layer is replaced in place (keeping its
 * position and styling); otherwise a new layer goes above the selection. Throws readable errors.
 */
export async function placeMedia(file: File): Promise<void> {
  const started = performance.now();
  const video = isVideoFile(file);
  const imported = video ? await importVideo(file) : await importImage(file);
  const { width: srcW, height: srcH } = 'meta' in imported ? imported.meta : imported;
  const clip = 'meta' in imported ? defaultClip(imported.meta.duration, useEditor.getState().doc.comp) : null;
  const s = useEditor.getState();
  const selected = s.doc.comp.layers.find((l) => l.id === s.selectedId);
  if (selected?.type === 'image') {
    const idx = layerIndex(s.doc, selected.id);
    const { width, height } = fitSize(s.doc.comp, srcW, srcH);
    const base = ['comp', 'layers', idx];
    s.set(video ? 'Replace with video' : 'Replace image', [
      { path: [...base, 'assetId'], value: imported.id },
      { path: [...base, 'video'], value: clip },
      { path: [...base, 'width'], value: width },
      { path: [...base, 'height'], value: height },
    ]);
  } else {
    const name = file.name.replace(/\.[^.]+$/, '') || (video ? 'Video' : 'Image');
    const layer = { ...createImageLayer(s.doc.comp, imported.id, srcW, srcH, name), video: clip };
    const at = selected ? layerIndex(s.doc, selected.id) + 1 : s.doc.comp.layers.length;
    s.commit(makeInsert(['comp', 'layers'], at, layer, video ? 'Add video' : 'Add image'));
    s.select(layer.id);
  }
  console.info(`[glyphix] ${video ? 'video' : 'image'} ${srcW}×${srcH} placed in ${Math.round(performance.now() - started)} ms`);
}
