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
