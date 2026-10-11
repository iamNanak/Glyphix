import type { Prop } from './types';

// Editing helpers for properties that may be animated. Direct manipulation on the canvas
// shifts/scales the whole animation so it keeps its shape (there's no keyframe editor in Phase 1).

export function offsetProp(prop: Prop<number>, delta: number): Prop<number> {
  if ('static' in prop) return { static: prop.static + delta };
  return { track: { keys: prop.track.keys.map((k) => ({ ...k, v: k.v + delta })) } };
}

export function scaleProp(prop: Prop<number>, factor: number): Prop<number> {
  if ('static' in prop) return { static: prop.static * factor };
  return { track: { keys: prop.track.keys.map((k) => ({ ...k, v: k.v * factor })) } };
}

export function isAnimated(prop: Prop<unknown>): boolean {
  return 'track' in prop;
}
