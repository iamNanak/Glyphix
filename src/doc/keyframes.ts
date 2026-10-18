// Keyframe editing for the timeline: pure operations on Props and layers. Keys are identified by their time
// (frame-snapped, so at most one key per frame); the UI turns results into patches.
import { animatableProps, propAt } from './animatable';
import { Easings } from './easing';
import type { Patch } from './history';
import type { Easing, Keyframe, Layer, Prop } from './types';

/** Nearest frame time. */
export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps;

/** Same frame (keys are frame-snapped, so half a frame is a safe tolerance). */
export const sameFrame = (a: number, b: number, fps: number) => Math.abs(a - b) < 0.5 / fps;

const keysOf = (prop: Prop<number>): Keyframe<number>[] => ('track' in prop ? prop.track.keys : []);
const fromKeys = (keys: Keyframe<number>[], fallback: number): Prop<number> =>
  keys.length ? { track: { keys: [...keys].sort((a, b) => a.t - b.t) } } : { static: fallback };

/**
 * Move the keys at `times` by `dt`, onto whole frames (never before 0). A moved key lands on top of (replaces) an
 * unmoved key at the same frame, like dropping a clip onto another.
 */
export function moveKeys(prop: Prop<number>, times: readonly number[], dt: number, fps: number): Prop<number> {
  const keys = keysOf(prop);
  if (!keys.length) return prop;
  const picked = (k: Keyframe<number>) => times.some((t) => sameFrame(t, k.t, fps));
  const moved = keys.filter(picked).map((k) => ({ ...k, t: Math.max(0, snapToFrame(k.t + dt, fps)) }));
  const kept = keys.filter((k) => !picked(k) && !moved.some((m) => sameFrame(m.t, k.t, fps)));
  // Two moved keys can only collide when clamped at 0: keep the later one.
  const unique = moved.filter((m, i) => !moved.slice(i + 1).some((n) => sameFrame(n.t, m.t, fps)));
  return fromKeys([...kept, ...unique], keys[0]!.v);
}

/** Remove the keys at `times`; removing the last key leaves the value of the earliest removed one, static. */
export function deleteKeys(prop: Prop<number>, times: readonly number[], fps: number): Prop<number> {
  const keys = keysOf(prop);
  if (!keys.length) return prop;
  const gone = keys.filter((k) => times.some((t) => sameFrame(t, k.t, fps)));
  return fromKeys(keys.filter((k) => !gone.includes(k)), gone[0]?.v ?? keys[0]!.v);
}

/** Add (or replace) a key at frame-snapped `t`, keeping the replaced key's easing. */
export function putKey(prop: Prop<number>, t: number, v: number, fps: number, out?: Easing): Prop<number> {
  const at = Math.max(0, snapToFrame(t, fps));
  const keys = keysOf(prop);
  const old = keys.find((k) => sameFrame(k.t, at, fps));
  return fromKeys([...keys.filter((k) => k !== old), { t: at, v, out: out ?? old?.out ?? Easings.easeInOutCubic }], v);
}

/**
 * Set the easing leaving each key at `times` (towards the next key). The last key has no next key, so it is left
 * as it is.
 */
export function setKeyEasing(prop: Prop<number>, times: readonly number[], easing: Easing, fps: number): Prop<number> {
  const keys = keysOf(prop);
  if (!keys.length) return prop;
  const last = keys.reduce((a, b) => (b.t > a.t ? b : a));
  return { track: { keys: keys.map((k) => (k !== last && times.some((t) => sameFrame(t, k.t, fps)) ? { ...k, out: easing } : k)) } };
}

/** Copied keys, relative to the earliest one (so they paste at any time). */
export interface KeyClipboard {
  items: { propId: string; dt: number; v: number; out: Easing }[];
}

/** Copy the selected keys of one layer (`selection`: prop id → key times). */
export function copyKeys(layer: Layer, selection: ReadonlyMap<string, readonly number[]>, fps: number): KeyClipboard | null {
  const items: KeyClipboard['items'] = [];
  for (const p of animatableProps(layer)) {
    const times = selection.get(p.id);
    const prop = times && propAt(layer, p.path);
    if (!prop) continue;
    for (const k of keysOf(prop)) if (times.some((t) => sameFrame(t, k.t, fps))) items.push({ propId: p.id, dt: k.t, v: k.v, out: k.out });
  }
  if (!items.length) return null;
  const t0 = Math.min(...items.map((i) => i.dt));
  return { items: items.map((i) => ({ ...i, dt: i.dt - t0 })) };
}

/**
 * Paste copied keys at `t` onto the same properties of `layer` (by id; effect params match by effect kind and
 * param when the effect ids differ). Returns layer-relative patches.
 */
export function pasteKeys(layer: Layer, clip: KeyClipboard, t: number, fps: number): Patch[] {
  const props = animatableProps(layer);
  const byId = new Map(props.map((p) => [p.id, p]));
  const fxParam = (id: string) => id.split(':')[2];
  const target = (id: string) => byId.get(id) ?? (id.startsWith('fx:') ? props.find((p) => p.id.startsWith('fx:') && fxParam(p.id) === fxParam(id)) : undefined);
  const next = new Map<string, Prop<number>>();
  for (const item of clip.items) {
    const p = target(item.propId);
    if (!p) continue;
    const prop = next.get(p.id) ?? propAt(layer, p.path);
    if (!prop) continue;
    next.set(p.id, putKey(prop, t + item.dt, item.v, fps, item.out));
  }
  return [...next].map(([id, value]) => ({ path: byId.get(id)!.path, value }));
}

/**
 * Move a whole layer along the timeline by `dt`: its in/out points, every keyframe, a custom glyph animator and
 * a video clip's start. Presets follow by themselves (they are timed from the in/out points). Layer-relative patches.
 */
export function moveLayerInTime(layer: Layer, dt: number): Patch[] {
  const patches: Patch[] = [];
  if (layer.type !== 'background') {
    const { in: a, out: b } = layer.timing;
    patches.push({ path: ['timing'], value: { in: a + dt, out: b === null ? null : b + dt } });
  }
  for (const p of animatableProps(layer)) {
    const prop = propAt(layer, p.path);
    if (prop && 'track' in prop) patches.push({ path: p.path, value: { track: { keys: prop.track.keys.map((k) => ({ ...k, t: k.t + dt })) } } });
  }
  if (layer.type === 'image' && layer.video) patches.push({ path: ['video', 'start'], value: layer.video.start + dt });
  if (layer.type === 'text' && layer.animator) patches.push({ path: ['animator', 'start'], value: layer.animator.start + dt });
  return patches;
}
