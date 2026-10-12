import { describe, expect, it } from 'vitest';
import { createDemoDoc } from './demo';
import { evaluate, glyphProgress, glyphRanks } from './evaluate';
import { migrate, NewerSchemaError } from './migrations';
import { defaultEnter, defaultLoop, ENTER_PRESETS, glyphAnimatorFor, IDENTITY, LOOP_PRESETS, motionModifiers, waveFor, type Motion } from './motion';
import { SCHEMA_VERSION, type ImageLayer, type TextLayer } from './types';

const comp = { width: 1920, height: 1080, duration: 5 };
const enter = (preset: Parameters<typeof defaultEnter>[0]): Motion => ({ enter: defaultEnter(preset, 1), loop: null });

describe('enter presets (whole layer)', () => {
  const imagePresets = ENTER_PRESETS.filter((p) => p.for.includes('image')).map((p) => p.id);
  it.each(imagePresets)('%s: hidden or offset at start, identity at the end', (preset) => {
    const before = motionModifiers(enter(preset), 0.5, comp, 'image');
    const after = motionModifiers(enter(preset), 10, comp, 'image');
    expect(after).toEqual(IDENTITY);
    const changed = before.opacity < 1 || before.dx !== 0 || before.dy !== 0 || before.scale !== 1 || before.tiltX !== 0;
    expect(changed).toBe(true);
  });
  it('opacity never exceeds 1 even with overshooting easings', () => {
    for (let t = 0; t <= 3; t += 0.01) expect(motionModifiers(enter('pop'), t, comp, 'image').opacity).toBeLessThanOrEqual(1);
  });
  it('slides scale with the comp size', () => {
    const small = motionModifiers(enter('slide-up'), 1, { width: 960, height: 540 }, 'image').dy;
    const big = motionModifiers(enter('slide-up'), 1, comp, 'image').dy;
    expect(big).toBeCloseTo(small * 2);
  });
  it('per-glyph presets leave text layers untouched as a whole', () => {
    expect(motionModifiers(enter('rise'), 1.2, comp, 'text')).toEqual(IDENTITY);
  });
});

describe('loops are seamless', () => {
  it.each(LOOP_PRESETS.map((p) => p.id))('%s matches at the start and end of a cycle', (preset) => {
    const loop = defaultLoop(preset, comp);
    const m: Motion = { enter: null, loop };
    const a = motionModifiers(m, 0.3, comp, 'image');
    const b = motionModifiers(m, 0.3 + loop.period, comp, 'image');
    expect(a.dy).toBeCloseTo(b.dy, 6);
    expect(a.scale).toBeCloseTo(b.scale, 6);
    expect(a.dx).toBeCloseTo(b.dx, 6);
  });
  it('ken burns defaults to the comp duration', () => {
    expect(defaultLoop('ken-burns', comp).period).toBe(5);
  });
  it('wave only exists for the wave preset', () => {
    expect(waveFor(defaultLoop('wave', comp), 96)?.amplitude).toBeGreaterThan(0);
    expect(waveFor(defaultLoop('float', comp), 96)).toBeNull();
  });
});

describe('text presets compile to the glyph animator', () => {
  const text = 'Ship it';
  it.each(['rise', 'typewriter', 'cascade', 'scatter'] as const)('%s: last glyph finishes exactly at start + duration', (preset) => {
    const e = defaultEnter(preset, 0.5);
    const a = glyphAnimatorFor(e, text)!;
    const n = text.replace(/\s/g, '').length;
    const lastRank = n - 1;
    expect(glyphProgress(a, lastRank, e.start + e.duration - 1e-6)).toBeLessThan(1);
    expect(glyphProgress(a, lastRank, e.start + e.duration + 1e-6)).toBe(1);
    expect(glyphRanks(n, a.order, a.seed)).toHaveLength(n);
  });
  it('non-glyph presets return null', () => {
    expect(glyphAnimatorFor(defaultEnter('fade'), text)).toBeNull();
  });
});

describe('evaluate applies motion', () => {
  it('image enter preset changes opacity/position before it finishes', () => {
    const doc = createDemoDoc();
    const shot = doc.comp.layers[1] as ImageLayer;
    shot.motion = { enter: defaultEnter('slide-up', 2), loop: null };
    const at = (t: number) => evaluate(doc, t).items.find((i) => i.id === 'shot') as { y: number; opacity: number };
    expect(at(2).opacity).toBe(0);
    expect(at(2.1).y).toBeGreaterThan(at(5).y);
    expect(at(5).opacity).toBe(1);
  });
  it('text glyph preset overrides the legacy animator', () => {
    const doc = createDemoDoc();
    const h = doc.comp.layers[2] as TextLayer;
    h.motion = { enter: defaultEnter('typewriter', 0), loop: null };
    const item = evaluate(doc, 0).items.find((i) => i.id === 'headline') as { animator: { order: string; easing: { kind: string } } };
    expect(item.animator.easing.kind).toBe('hold');
  });
});

describe('migrations', () => {
  it('upgrades a v1 document (no motion) to the current schema', () => {
    const v1 = createDemoDoc() as unknown as Record<string, unknown> & { comp: { layers: Record<string, unknown>[] } };
    v1.schemaVersion = 1;
    v1.comp.layers.forEach((l) => delete l.motion);
    const doc = migrate(JSON.parse(JSON.stringify(v1)));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect((doc.comp.layers[1] as ImageLayer).motion).toEqual({ enter: null, loop: null });
    expect(doc.comp.layers[0]).not.toHaveProperty('motion');
  });
  it('current documents pass through unchanged', () => {
    const doc = createDemoDoc();
    expect(migrate(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
  it('refuses newer formats and garbage', () => {
    expect(() => migrate({ ...createDemoDoc(), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(NewerSchemaError);
    expect(() => migrate({ hello: 1 })).toThrow();
  });
});
