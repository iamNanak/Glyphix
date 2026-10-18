// Saved documents carry `schemaVersion`. Every load (IndexedDB or .glyphix file) runs the
// migrations from the saved version up to SCHEMA_VERSION, in order. Migrations take and return
// plain JSON so they never depend on the current TypeScript types.
import { SCHEMA_VERSION, type Doc } from './types';

type Json = Record<string, unknown>;

/** MIGRATIONS[v] upgrades a version-v document to v+1. */
const MIGRATIONS: Record<number, (doc: Json) => Json> = {
  // v1 → v2: layers gain `motion` (animation presets).
  1: (doc) => {
    const comp = doc.comp as Json & { layers: Json[] };
    return {
      ...doc,
      comp: {
        ...comp,
        layers: comp.layers.map((l) => (l.type === 'background' || 'motion' in l ? l : { ...l, motion: { enter: null, loop: null } })),
      },
    };
  },
  // v2 → v3: motion gains `exit`; text gains weight/lineHeight/gradient/outline/shadow;
  // the glyph animator's `from` becomes a full pose with unit + falloff.
  2: (doc) => {
    const comp = doc.comp as Json & { layers: Json[] };
    const layers = comp.layers.map((l) => {
      if (l.type === 'background') return l;
      const motion = { exit: null, ...(l.motion as Json) };
      if (l.type !== 'text') return { ...l, motion };
      const a = l.animator as (Json & { from?: Record<string, number> }) | null;
      // Tolerate documents that already have the new shape (hand-edited or partially migrated).
      const animator = !a || !a.from ? a : {
        unit: 'glyph',
        order: a.order,
        start: a.start,
        duration: a.duration,
        stagger: a.stagger,
        falloff: { kind: 'linear' },
        seed: a.seed,
        easing: a.easing,
        pose: {
          offsetX: a.from.offsetX ?? 0,
          offsetY: a.from.offsetY ?? 0,
          scaleX: a.from.scale ?? 1,
          scaleY: a.from.scale ?? 1,
          rotation: a.from.rotation ?? 0,
          rotateX: 0,
          rotateY: 0,
          skewX: 0,
          opacity: a.from.opacity ?? 1,
          blur: 0,
          spread: 1,
          color: null,
          randomOffset: 0,
          randomRotation: 0,
          scramble: false,
        },
      };
      return { weight: 400, lineHeight: 1.15, gradient: null, outline: null, shadow: null, ...l, animator, motion };
    });
    return { ...doc, comp: { ...comp, layers } };
  },
  // v3 → v4: every layer gains an effect stack.
  3: (doc) => {
    const comp = doc.comp as Json & { layers: Json[] };
    return { ...doc, comp: { ...comp, layers: comp.layers.map((l) => ({ effects: [], ...l })) } };
  },
  // v4 → v5: image layers can show a video.
  4: (doc) => {
    const comp = doc.comp as Json & { layers: Json[] };
    return { ...doc, comp: { ...comp, layers: comp.layers.map((l) => (l.type === 'image' ? { video: null, ...l } : l)) } };
  },
  // v6 → v7: layers gain in/out points (on for the whole comp, as before).
  6: (doc) => {
    const comp = doc.comp as Json & { layers: Json[] };
    return { ...doc, comp: { ...comp, layers: comp.layers.map((l) => ({ timing: { in: 0, out: null }, ...l })) } };
  },
  // v7 → v8: a new easing kind (bounce); nothing to change.
  7: (doc) => doc,
  // v5 → v6: effects gain text settings; existing ASCII effects keep their square cells.
  5: (doc) => {
    const comp = doc.comp as Json & { layers: Json[] };
    const effect = (e: Json): Json => {
      const out: Json = { text: {}, ...e };
      if (e.kind === 'ascii') out.params = { square: { static: 1 }, ...(e.params as Json) };
      return out;
    };
    return { ...doc, comp: { ...comp, layers: comp.layers.map((l) => ({ ...l, effects: ((l.effects as Json[] | undefined) ?? []).map(effect) })) } };
  },
};

export class NewerSchemaError extends Error {
  constructor(readonly found: number) {
    super(`This project was saved by a newer version of Glyphix (format ${found}; this app reads up to ${SCHEMA_VERSION}).`);
  }
}

export function migrate(input: unknown): Doc {
  if (!input || typeof input !== 'object' || !('comp' in input)) throw new Error('Not a Glyphix project');
  let doc = input as Json;
  let v = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1;
  if (v > SCHEMA_VERSION) throw new NewerSchemaError(v);
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from format ${v}`);
    doc = step(doc);
    v++;
  }
  return { ...doc, schemaVersion: SCHEMA_VERSION } as unknown as Doc;
}
