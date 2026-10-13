import { describe, expect, it } from 'vitest';
import {
  addKey,
  createAdjustmentLayer,
  createDemoDoc,
  createEffect,
  EFFECTS,
  evaluate,
  isNoOp,
  keyAt,
  migrate,
  removeKey,
  resolveEffects,
  sampleProp,
  setValueAt,
  SCHEMA_VERSION,
  type Prop,
} from '.';

describe('effects', () => {
  it('has 12 kinds, each with defaults inside its ranges', () => {
    expect(EFFECTS.length).toBeGreaterThanOrEqual(10);
    for (const d of EFFECTS) {
      for (const p of d.params) {
        expect(p.default, `${d.kind}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${d.kind}.${p.key}`).toBeLessThanOrEqual(p.max);
      }
      const e = createEffect(d.kind);
      expect(Object.keys(e.params)).toEqual(d.params.map((p) => p.key));
      // A freshly added effect visibly does something (except colour adjust, which starts neutral).
      const [r] = resolveEffects([e], 0, sampleProp);
      expect(isNoOp(r!), d.kind).toBe(d.kind === 'colorAdjust');
    }
  });

  it('samples keyframed params and skips disabled effects', () => {
    const blur = createEffect('blur');
    blur.params.radius = { track: { keys: [{ t: 0, v: 0, out: { kind: 'linear' } }, { t: 2, v: 40, out: { kind: 'linear' } }] } };
    const off = { ...createEffect('grain'), enabled: false };
    const r = resolveEffects([blur, off], 1, sampleProp);
    expect(r).toHaveLength(1);
    expect(r[0]!.params.radius).toBeCloseTo(20);
  });

  it('puts effects and adjustment layers into the render list', () => {
    const doc = createDemoDoc();
    const adj = createAdjustmentLayer('vignette');
    doc.comp.layers.push(adj);
    doc.comp.layers[1]!.effects.push(createEffect('glow'));
    const list = evaluate(doc, 1);
    expect(list.items.at(-1)).toMatchObject({ kind: 'adjustment', id: adj.id, opacity: 1 });
    expect(list.items[1]!.effects.map((e) => e.kind)).toEqual(['glow']);
    // A neutral adjustment (colour adjust at defaults) costs nothing.
    doc.comp.layers[doc.comp.layers.length - 1] = createAdjustmentLayer('colorAdjust');
    expect(evaluate(doc, 1).items.some((i) => i.kind === 'adjustment')).toBe(false);
  });

  it('migrates v3 documents: every layer gains an empty effect stack', () => {
    const v3 = JSON.parse(JSON.stringify(createDemoDoc())) as { schemaVersion: number; comp: { layers: Record<string, unknown>[] } };
    v3.schemaVersion = 3;
    v3.comp.layers.forEach((l) => delete l.effects);
    const doc = migrate(v3);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    doc.comp.layers.forEach((l) => expect(l.effects).toEqual([]));
  });
});

describe('keyframes at the playhead', () => {
  const eps = 1 / 60;
  it('adds, updates and removes keys; the last key removed makes the value static again', () => {
    let p: Prop<number> = { static: 10 };
    expect(setValueAt(p, 1, 5, eps)).toEqual({ static: 5 });
    p = addKey(p, 1, 10, eps);
    p = addKey(p, 0, 0, eps);
    expect(sampleProp(p, 0)).toBe(0);
    expect(sampleProp(p, 1)).toBe(10);
    p = setValueAt(p, 1.005, 20, eps); // within half a frame: updates the existing key
    expect('track' in p && p.track.keys.length).toBe(2);
    expect(keyAt(p, 1, eps)?.v).toBe(20);
    p = removeKey(p, 0, eps);
    p = removeKey(p, 1, eps);
    expect(p).toEqual({ static: 20 });
  });
});
