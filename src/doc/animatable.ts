// Every property of a layer that can carry keyframes, in timeline order. The timeline, keyframe operations
// and (later) animation presets and Lottie export all read this list, so a new keyframable property is one entry.
import { effectDef } from './effects';
import type { Path } from './history';
import type { Layer, Prop } from './types';

export interface AnimatableProp {
  /** Stable within a layer (effect params use the effect's id), e.g. `opacity`, `fx:fx-ab12:radius`. */
  id: string;
  label: string;
  /** Row group in the timeline ("Transform", "Blur", …). */
  group: string;
  /** Path from the layer to the Prop. */
  path: Path;
}

const P = (id: string, label: string, group: string, path: Path): AnimatableProp => ({ id, label, group, path });

export function animatableProps(layer: Layer): AnimatableProp[] {
  const out: AnimatableProp[] = [P('opacity', 'Opacity', 'Layer', ['opacity'])];
  if (layer.type === 'image' || layer.type === 'text') {
    out.push(
      P('x', 'Position X', 'Transform', ['transform', 'x']),
      P('y', 'Position Y', 'Transform', ['transform', 'y']),
      P('scale', 'Scale', 'Transform', ['transform', 'scale']),
      P('rotation', 'Rotation', 'Transform', ['transform', 'rotation']),
    );
  }
  if (layer.type === 'image') out.push(P('tiltX', 'Tilt X', 'Tilt', ['tilt', 'rotateX']), P('tiltY', 'Tilt Y', 'Tilt', ['tilt', 'rotateY']));
  if (layer.type === 'text') out.push(P('glow', 'Glow', 'Text', ['glow']));
  (layer.effects ?? []).forEach((e, i) => {
    const def = effectDef(e.kind);
    for (const q of def.params) if (!q.fixed) out.push(P(`fx:${e.id}:${q.key}`, q.label, def.label, ['effects', i, 'params', q.key]));
  });
  return out;
}

/** The Prop at a layer-relative path (a missing effect param reads as its default, static). */
export function propAt(layer: Layer, path: Path): Prop<number> | undefined {
  let v: unknown = layer;
  for (const k of path) v = v == null ? undefined : (v as Record<string | number, unknown>)[k];
  return v as Prop<number> | undefined;
}
