// One-click flows for the ASCII Studio.
import { pickVideoLayer, planVideoToAscii } from '@/doc';
import { videoMeta } from '@/video/videoAssets';
import { useEditor } from './store';

/**
 * Turn the selected video/GIF layer (or the only one) into an ASCII piece: canvas = clip size and length,
 * layer fills it, ASCII effect with a look added. One undo step. Throws a readable error when there is nothing to convert.
 */
export function videoToAscii(presetId = 'terminal'): void {
  const s = useEditor.getState();
  const layer = pickVideoLayer(s.doc, s.selectedId);
  if (!layer) throw new Error('Select a video or GIF layer first.');
  const meta = videoMeta(layer.assetId);
  if (!meta) throw new Error('This video isn’t loaded yet.');
  const plan = planVideoToAscii(s.doc, s.selectedId, meta, presetId);
  if (!plan) throw new Error('Unknown ASCII look.');
  s.set(plan.label, plan.patches);
  s.select(plan.layerId);
}
